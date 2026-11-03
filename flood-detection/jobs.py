"""Timed jobs on the server, so alerts go out even when nobody has the site open.

    run_due_checks(now)   the pre-departure check (Module 11): for every travel schedule that is due,
                          check the reports along its route and notify its owner. The same as
                          static/js/core/scheduler.js, with the same notification keys and day format, so a
                          check that a page already ran is not sent twice.
    start(app)            runs run_due_checks once a minute in a background thread.

The thread starts with `flask run` (in a debug reloader, only in the process that serves pages).
Set FDA_JOBS=0 to turn it off (the tests do). The 15-minute area rain check still runs in the pages
(core/areas.js): it needs the rain forecast, which is only fetched in the browser for now.
"""
import math
import os
import re
import sys
import threading
import time
from datetime import datetime, timedelta, timezone

from database import Report, Route, Schedule, db

QC_TIME = timezone(timedelta(hours=8))
EVERY_S = 60

# The agent's route check (static/js/core/agent.js config)
RECENT_MIN = 60           # recentMin: older reports "may be outdated" and are not warned about
ON_ROUTE_M = 50           # onRouteMeters
SAME_STREET_M = 150       # sameStreetMeters, on the same street in the same barangay
NEAR_ROUTE_M = 800        # nearRouteMeters
LATE_MIN = 60             # a check that is more than an hour past the departure is skipped (as in the page)
LABEL = {"flood-warning": "Flood warning", "possible-flood": "Possible flood"}


def _utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def day_key(dt):
    """The pages' day key, "2026-11-3" (Quezon City date, no leading zeros)."""
    d = _utc(dt).astimezone(QC_TIME)
    return "%d-%d-%d" % (d.year, d.month, d.day)


def clock(dt):
    """ "6:45 AM", as the pages write times."""
    return dt.strftime("%I:%M %p").lstrip("0")


def street_key(name):
    s = str(name or "").lower().replace("ñ", "n")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\b(avenue|ave|street|st|road|rd)\b", " ", s)
    return " ".join(s.split())


def barangay_key(name):
    s = str(name or "").split(",")[0].lower().replace("ñ", "n")
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", s).split())


def meters_to_line(lat, lng, line):
    """Meters from a point to a polyline of [lat, lng] points (flat-earth: fine at city scale)."""
    if not line:
        return math.inf
    kx, ky = 111320 * math.cos(math.radians(lat)), 110540
    pts = [((p[1] - lng) * kx, (p[0] - lat) * ky) for p in line]
    if len(pts) == 1:
        return math.hypot(*pts[0])
    best = math.inf
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        dx, dy = bx - ax, by - ay
        t = 0 if dx == dy == 0 else max(0, min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


def route_check(route, reports, now):
    """The agent's routeCheck for the live part: {"warnings": [...], "possible": [...]}; each item {report, street, barangay}.
    Only recent flood warnings / possible floods with a precise location count (as in the page)."""
    segs = route.segments or []
    out = {"warnings": [], "possible": []}
    if not route.geometry or len(route.geometry) < 2 or not segs:
        return None     # not placed on the streets: cannot be checked
    for r in reports:
        if r.removed or r.dup_of_id or not r.location_precise or r.status not in LABEL:
            continue
        if (now - _utc(r.created_at)).total_seconds() / 60 > RECENT_MIN:
            continue
        best, best_seg, same, same_seg = math.inf, None, math.inf, None
        st, brgy = street_key(r.street), barangay_key(r.barangay)
        for seg in segs:
            d = min((meters_to_line(r.lat, r.lng, line) for line in seg.get("lines") or []), default=math.inf)
            if d < best:
                best, best_seg = d, seg
            if st and street_key(seg.get("street")) == st and barangay_key(seg.get("barangay")) == brgy and d < same:
                same, same_seg = d, seg
        if same <= SAME_STREET_M:
            where, seg = "on", same_seg
        elif best <= ON_ROUTE_M:
            where, seg = "on", best_seg
        elif best <= NEAR_ROUTE_M:
            where, seg = "near", best_seg
        else:
            continue
        item = {"report": r, "street": (seg or {}).get("street") or r.street, "barangay": (seg or {}).get("barangay") or r.barangay}
        if r.status == "flood-warning" and where == "on":
            out["warnings"].append(item)
        else:
            out["possible"].append(item)
    for k in out:
        out[k].sort(key=lambda i: _utc(i["report"].created_at), reverse=True)
    return out


def run_due_checks(now=None):
    """Run every travel-schedule check that is due now and has not run today. Returns how many ran."""
    from notifications_api import notify    # imported here: notifications_api imports the app's modules
    now = now or datetime.now(timezone.utc)
    qc = now.astimezone(QC_TIME)
    today, weekday = day_key(now), (qc.weekday() + 1) % 7      # the pages count days from Sunday = 0
    recent = Report.query.filter(Report.created_at >= now - timedelta(minutes=RECENT_MIN + 1)).all()
    ran = 0
    for s in Schedule.query.filter_by(enabled=True).all():
        if str(weekday) not in s.days or (s.last_check_at is not None and day_key(s.last_check_at) == today):
            continue
        hh, mm = (int(x) for x in s.depart_time.split(":"))
        depart = qc.replace(hour=hh, minute=mm, second=0, microsecond=0)
        due = depart - timedelta(minutes=s.check_before_min)
        if qc < due:
            continue
        s.last_check_at = now
        if qc > depart + timedelta(minutes=LATE_MIN):
            continue                       # too late to help: skip, as the page does
        route = db.session.get(Route, s.route_id)
        res = route_check(route, recent, now) if route else None
        if res is None:
            continue                       # a route that is not on the streets: say nothing rather than "all clear"
        ran += 1
        dep, chk = clock(depart), clock(due)
        top = (res["warnings"] or res["possible"] or [None])[0]
        if top:
            age = max(1, round((now - _utc(top["report"].created_at)).total_seconds() / 60))
            notify(s.user_id, "schedule", "check:%d:%s" % (s.id, today),
                   "%s before your %s trip · %s" % ("Flood warning" if res["warnings"] else "Possible flood", dep, route.name),
                   "%s, %s · reported %d min ago" % (top["street"], top["barangay"], age), "routes.html?id=%d" % route.id, "View on route →")
        else:
            notify(s.user_id, "schedule", "clear:%d:%s" % (s.id, today), "No recent reports on %s" % route.name,
                   "Checked %s before your %s trip" % (chk, dep), clear=True)
    db.session.commit()
    return ran


_started = False


def start(app):
    """Run the checks once a minute in a background thread (only when serving pages, see the module notes)."""
    global _started
    if _started or os.environ.get("FDA_JOBS", "1") == "0":
        return False
    serving = "run" in sys.argv[1:] or os.environ.get("FDA_JOBS") == "1"
    reloader_parent = os.environ.get("FLASK_DEBUG") in ("1", "true") and os.environ.get("WERKZEUG_RUN_MAIN") != "true"
    if not serving or reloader_parent:
        return False
    _started = True

    def loop():
        time.sleep(5)
        while True:
            try:
                with app.app_context():
                    run_due_checks()
            except Exception:
                app.logger.exception("The pre-departure check job failed; trying again in a minute.")
            time.sleep(EVERY_S)

    threading.Thread(target=loop, name="fda-jobs", daemon=True).start()
    print(" * Pre-departure checks run on the server once a minute (jobs.py)", flush=True)
    return True
