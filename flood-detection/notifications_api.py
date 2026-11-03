"""In-app notifications (Module 12), saved in the database.

Notifications for OTHER people are made here on the server, when the thing happens,
so they reach that person wherever they sign in:
    report  your report was confirmed, got a comment, or a moderator merged or removed it
            (community_api.py and reports_api.py call notify())
    route   a new flood report lies along one of your saved routes (route_alerts(), called
            when a report is saved)
Notifications for YOURSELF that the page works out (a travel schedule was set, the
pre-departure check result, an area rain alert, a "Remind me") are sent by the page:
    POST /api/notifications              {kind, key, title, text, href, cta, clear}
Reading and settings:
    GET  /api/notifications              your latest notifications and the unread count (the pages poll this)
    POST /api/notifications/read         {ids: [...]} or {all: true}
    POST /api/notifications/settings     {route, area, schedule, reports, clear}: true / false
    POST /api/watch                      {barangay, on}: the "Alert me" list on the Flood areas page
/api/my.js (routes_api.py) also carries notifications, settings and watch for the page to start with.

Every notification has a dedupe key: the same key again refreshes that notification (new
text, unread again) instead of adding another one. Turned-off kinds are not saved at all.
"""
import math
import re
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

import accounts
import limits
from database import NOTICE_KINDS, Notification, NotificationSettings, Route, User, WatchedBarangay, db

bp = Blueprint("notifications_api", __name__)

KEEP = 200                     # notifications sent to the page
NEAR_ROUTE_M = 800             # agent config nearRouteMeters: a report this close to a route's line is "near route"
LINK = re.compile(r"^[a-z-]+\.html(\?[\w=&%.+-]*)?(#[\w-]*)?$")   # only links to our own pages
LABEL = {"flood-warning": "Flood warning", "possible-flood": "Possible flood"}


def _ms(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def settings_of(user_id):
    s = db.session.get(NotificationSettings, user_id)
    if s is None:              # accounts made before settings existed get the defaults
        s = NotificationSettings(user_id=user_id)
        db.session.add(s)
        db.session.flush()
    return s


def settings_json(s):
    return {"route": s.route, "area": s.area, "schedule": s.schedule, "reports": s.reports, "clear": s.all_clear}


def _allowed(s, kind, clear):
    if kind == "area":
        return s.area
    if kind == "route":
        return s.route
    if kind == "schedule":
        return s.schedule and (s.all_clear if clear else True)
    return s.reports


def notify(user_id, kind, key, title, text="", link="", cta="", clear=False):
    """Add a notification, or refresh the one with the same key. Returns it, or None when that kind is turned off.
    The caller commits."""
    if kind not in NOTICE_KINDS or not _allowed(settings_of(user_id), kind, clear):
        return None
    key = (key or "once:" + uuid.uuid4().hex)[:120]
    n = Notification.query.filter_by(user_id=user_id, dedupe_key=key).first()
    if n is None:
        n = Notification(user_id=user_id, kind=kind, dedupe_key=key)
        db.session.add(n)
    n.title, n.text = str(title)[:160], (str(text)[:300] or None)
    n.link = link if link and LINK.match(link) else None
    n.cta = (str(cta)[:40] or None) if n.link else None
    n.created_at, n.read = datetime.now(timezone.utc), False
    return n


def notice_json(n):
    return {"id": n.id, "userId": "u%d" % n.user_id, "kind": n.kind, "key": n.dedupe_key, "title": n.title, "text": n.text or "",
            "href": n.link or "", "cta": n.cta or "", "ts": _ms(n.created_at), "read": n.read}


def mine():
    """Notifications, settings and watched barangays of the signed-in person (for /api/my.js)."""
    rows = Notification.query.filter_by(user_id=current_user.id).order_by(Notification.created_at.desc()).limit(KEEP).all()
    watch = [w.barangay for w in WatchedBarangay.query.filter_by(user_id=current_user.id).order_by(WatchedBarangay.created_at)]
    s = settings_of(current_user.id)
    db.session.commit()
    return {"notifications": [notice_json(n) for n in rows], "settings": settings_json(s), "watch": watch}


# ---- Route alerts: a new report along someone's saved route ------------------------------------
def _meters_to_line(lat, lng, line):
    """Meters from a point to a polyline of [lat, lng] points (flat-earth: fine at city scale)."""
    if not line:
        return math.inf
    kx, ky = 111320 * math.cos(math.radians(lat)), 110540
    best = math.inf
    pts = [((p[1] - lng) * kx, (p[0] - lat) * ky) for p in line]
    if len(pts) == 1:
        return math.hypot(*pts[0])
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        dx, dy = bx - ax, by - ay
        t = 0 if dx == dy == 0 else max(0, min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


def route_alerts(report):
    """Tell everyone with route alerts on whose saved route passes near this new report (precise location only:
    a report that only knows its barangay never raises a route warning in the agent either). The caller commits."""
    if report.status not in LABEL or not report.location_precise:
        return 0
    sent = 0
    for route in Route.query.filter_by(alert=True).all():
        if not route.geometry or len(route.geometry) < 2:
            continue      # not placed on the streets: the agent does not check it either
        if _meters_to_line(report.lat, report.lng, route.geometry) > NEAR_ROUTE_M:
            continue
        street, barangay, best = report.street or "Street not given", report.barangay, math.inf
        for seg in route.segments or []:       # name the stretch of the route the report is on
            for line in seg.get("lines") or []:
                d = _meters_to_line(report.lat, report.lng, line)
                if d < best:
                    best, street, barangay = d, seg.get("street") or street, seg.get("barangay") or barangay
        if notify(route.user_id, "route", "route:%d:%d" % (report.id, route.id), "%s on %s" % (LABEL[report.status], route.name),
                  "%s, %s · reported just now" % (street, barangay), "routes.html?id=%d" % route.id, "View route →"):
            sent += 1
    return sent


# ---- Endpoints -----------------------------------------------------------------------------------
@bp.get("/api/notifications")
@login_required
def list_notices():
    data = mine()
    return jsonify(ok=True, notifications=data["notifications"], unread=sum(1 for n in data["notifications"] if not n["read"]))


@bp.post("/api/notifications")
@login_required
def push_own():
    """A notification the page made for the signed-in person themself (never for anyone else)."""
    stop = limits.too_many("notice", current_user.id)
    if stop:
        return stop
    data = request.get_json(silent=True) or {}
    kind = data.get("kind")
    if kind not in NOTICE_KINDS or not str(data.get("title") or "").strip():
        return jsonify(ok=False, error="Unknown notification."), 400
    n = notify(current_user.id, kind, str(data.get("key") or ""), str(data["title"]).strip(), str(data.get("text") or ""),
               str(data.get("href") or ""), str(data.get("cta") or ""), clear=bool(data.get("clear")))
    db.session.commit()
    return jsonify(ok=True, notification=notice_json(n) if n else None)


@bp.post("/api/notifications/read")
@login_required
def mark_read():
    data = request.get_json(silent=True) or {}
    q = Notification.query.filter_by(user_id=current_user.id, read=False)
    if not data.get("all"):
        ids = [i for i in (data.get("ids") or []) if isinstance(i, int) and not isinstance(i, bool)][:500]
        if not ids:
            return jsonify(ok=True, changed=0)
        q = q.filter(Notification.id.in_(ids))
    changed = q.update({"read": True}, synchronize_session=False)
    db.session.commit()
    return jsonify(ok=True, changed=changed)


@bp.post("/api/notifications/settings")
@login_required
def save_settings():
    data = request.get_json(silent=True) or {}
    s = settings_of(current_user.id)
    for key, col in (("route", "route"), ("area", "area"), ("schedule", "schedule"), ("reports", "reports"), ("clear", "all_clear")):
        if key in data:
            setattr(s, col, bool(data[key]))
    db.session.commit()
    return jsonify(ok=True, settings=settings_json(s))


@bp.post("/api/watch")
@login_required
def watch():
    data = request.get_json(silent=True) or {}
    name = str(data.get("barangay") or "").strip()
    if name not in accounts.barangay_districts():
        return jsonify(ok=False, error="Choose a Quezon City barangay."), 400
    row = db.session.get(WatchedBarangay, (current_user.id, name))
    if data.get("on") and row is None:
        if WatchedBarangay.query.filter_by(user_id=current_user.id).count() >= 50:
            return jsonify(ok=False, error="You can watch up to 50 barangays."), 400
        db.session.add(WatchedBarangay(user_id=current_user.id, barangay=name))
    elif not data.get("on") and row is not None:
        db.session.delete(row)
    db.session.commit()
    return jsonify(ok=True, watch=[w.barangay for w in WatchedBarangay.query.filter_by(user_id=current_user.id).order_by(WatchedBarangay.created_at)])


def init_app(app):
    app.register_blueprint(bp)
