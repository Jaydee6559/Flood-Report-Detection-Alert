"""Saved routes and travel schedules (Modules 10-11), saved in the database.

The pages read the signed-in person's own routes and schedules from a small script,
    GET /api/my.js   ->  window.FDA_MY = {routes, schedules, notifications, settings, watch}
that static/js/app.js loads before the page scripts (a guest gets empty lists).
Notifications, settings and watch come from notifications_api.py.

All of these need an account, and only ever touch the signed-in person's own rows:
    POST /api/routes                       a new route
    POST /api/routes/<id>                  save changes (name, start and end, the street route, points added on the map)
    POST /api/routes/<id>/alert            {alert: true | false}
    POST /api/routes/<id>/delete           also deletes its schedules
    POST /api/schedules                    a new schedule
    POST /api/schedules/<id>               save changes
    POST /api/schedules/<id>/enabled       {enabled: true | false}
    POST /api/schedules/<id>/checked       the page ran today's pre-departure check
    POST /api/schedules/<id>/delete
    POST /api/my/import                    {routes, schedules} saved in this browser before step 5 (once)

The pre-departure check itself still runs in the page while it is open (core/scheduler.js).
"""
import math
import re
from datetime import datetime, timedelta, timezone

from flask import Blueprint, Response, jsonify, request
from flask_login import current_user, login_required

from database import Route, Schedule, db

bp = Blueprint("routes_api", __name__)

QC_TIME = timezone(timedelta(hours=8))         # schedules are in Quezon City time
BOUNDS = (14.30, 14.95, 120.85, 121.30)        # Metro Manila with a margin: lat min/max, lng min/max
MAX_GEOMETRY_POINTS = 20000
MAX_SEGMENTS = 1000
MAX_VIAS = 30
MAX_BODY = 4 * 1024 * 1024                     # one route, with its street lines
MAX_ROUTES = 50
MAX_SCHEDULES = 100
BEFORE_CHOICES = (15, 30, 45, 60)


class Bad(Exception):
    pass


def _qc_day(dt):
    """A time as the pages' day key, "2026-11-3" (Quezon City date, no leading zeros)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    d = dt.astimezone(QC_TIME)
    return "%d-%d-%d" % (d.year, d.month, d.day)


# ---- The shape the pages use ------------------------------------------------------------
def route_json(r):
    def point(lat, lng, place):
        p = dict(place or {})
        p.update(lat=lat, lng=lng)
        return p
    return {
        "id": r.id, "userId": "u%d" % r.user_id, "name": r.name, "start": r.start_label, "end": r.end_label,
        "startPoint": point(r.start_lat, r.start_lng, r.start_place), "endPoint": point(r.end_lat, r.end_lng, r.end_place),
        "geometry": r.geometry, "segments": r.segments, "distanceM": r.distance_m, "vias": r.vias or [],
        "mode": r.mode or "snap", "alert": r.alert,
    }


def schedule_json(s):
    return {
        "id": s.id, "userId": "u%d" % s.user_id, "routeId": s.route_id, "days": [int(c) for c in s.days],
        "time": s.depart_time, "before": s.check_before_min, "enabled": s.enabled, "lastCheck": _qc_day(s.last_check_at),
    }


def my_data():
    """Everything of the signed-in person's that the pages start with (a guest gets empty lists)."""
    if not current_user.is_authenticated:
        return {"routes": [], "schedules": [], "notifications": [], "settings": None, "watch": []}
    import notifications_api
    routes = Route.query.filter_by(user_id=current_user.id).order_by(Route.id).all()
    schedules = Schedule.query.filter_by(user_id=current_user.id).order_by(Schedule.id).all()
    out = {"routes": [route_json(r) for r in routes], "schedules": [schedule_json(s) for s in schedules]}
    out.update(notifications_api.mine())      # notifications, settings, watch
    return out


@bp.get("/api/my.js")
def my_script():
    import json
    resp = Response("window.FDA_MY = %s;\n" % json.dumps(my_data(), separators=(",", ":")), mimetype="application/javascript")
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.get("/api/my")
def my_json():
    return jsonify(my_data())


# ---- Checking what the page sends ---------------------------------------------------------
def _text(v, limit, what):
    v = " ".join(str(v or "").split())
    if not v:
        raise Bad("Give the route %s." % what)
    return v[:limit]


def _coord(v, lo, hi):
    try:
        v = float(v)
    except (TypeError, ValueError):
        raise Bad("A place on the route has no position.")
    if not math.isfinite(v) or v < lo or v > hi:
        raise Bad("A place on the route is outside Metro Manila.")
    return v


def _point(p):
    if not isinstance(p, dict):
        raise Bad("Pick a start point and a destination first.")
    lat, lng = _coord(p.get("lat"), BOUNDS[0], BOUNDS[1]), _coord(p.get("lng"), BOUNDS[2], BOUNDS[3])
    place = {k: str(p[k])[:120] for k in ("barangay", "street", "name") if p.get(k)}
    return lat, lng, place or None


def _geometry(g):
    if g is None:
        return None
    if not isinstance(g, list) or len(g) > MAX_GEOMETRY_POINTS:
        raise Bad("The route line is too long. Try a shorter route.")
    out = []
    for p in g:
        if not (isinstance(p, (list, tuple)) and len(p) >= 2):
            raise Bad("The route line could not be read.")
        out.append([_coord(p[0], BOUNDS[0], BOUNDS[1]), _coord(p[1], BOUNDS[2], BOUNDS[3])])
    return out if len(out) > 1 else None


def clean_route(data):
    if not isinstance(data, dict):
        raise Bad("The route could not be read.")
    s_lat, s_lng, s_place = _point(data.get("startPoint"))
    e_lat, e_lng, e_place = _point(data.get("endPoint"))
    segments = data.get("segments")
    if segments is not None and (not isinstance(segments, list) or len(segments) > MAX_SEGMENTS or not all(isinstance(x, dict) for x in segments)):
        raise Bad("The route's streets could not be read.")
    vias = data.get("vias") or []
    if not isinstance(vias, list) or len(vias) > MAX_VIAS:
        raise Bad("A route can have at most %d added points." % MAX_VIAS)
    vias = [{"lat": _coord(v.get("lat"), BOUNDS[0], BOUNDS[1]), "lng": _coord(v.get("lng"), BOUNDS[2], BOUNDS[3])} for v in vias if isinstance(v, dict)]
    dist = data.get("distanceM")
    try:
        dist = float(dist) if dist is not None else None
    except (TypeError, ValueError):
        dist = None
    if dist is not None and (not math.isfinite(dist) or dist < 0 or dist > 500000):
        dist = None
    return dict(
        name=_text(data.get("name"), 80, "a name"), start_label=_text(data.get("start"), 120, "a start point"),
        end_label=_text(data.get("end"), 120, "a destination"),
        start_lat=s_lat, start_lng=s_lng, start_place=s_place, end_lat=e_lat, end_lng=e_lng, end_place=e_place,
        geometry=_geometry(data.get("geometry")), segments=segments or None, vias=vias,
        mode="free" if data.get("mode") == "free" else "snap", distance_m=dist,
    )


def clean_schedule(data, route_ids):
    if not isinstance(data, dict):
        raise Bad("The schedule could not be read.")
    try:
        route_id = int(data.get("routeId"))
    except (TypeError, ValueError):
        raise Bad("Save a route first. Travel schedules check a saved route.")
    if route_id not in route_ids:
        raise Bad("Choose one of your saved routes.")
    days = data.get("days")
    if not isinstance(days, list) or not days or not all(isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 6 for d in days):
        raise Bad("Pick at least one day.")
    time = str(data.get("time") or "")
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", time):
        raise Bad("Set the usual departure time.")
    before = data.get("before")
    if before not in BEFORE_CHOICES:
        before = 30
    return dict(route_id=route_id, days="".join(str(d) for d in sorted(set(days))), depart_time=time, check_before_min=before)


def _body():
    if request.content_length and request.content_length > MAX_BODY:
        raise Bad("That route is too big to save. Try a shorter route.")
    return request.get_json(silent=True)


def _mine(model, item_id):
    row = db.session.get(model, item_id)
    return row if row is not None and row.user_id == current_user.id else None


def _my_route_ids():
    return {rid for (rid,) in db.session.query(Route.id).filter_by(user_id=current_user.id)}


def _bad(e, status=400):
    return jsonify(ok=False, error=str(e)), status


NOT_FOUND = "That route or schedule is not one of yours, or it was deleted."


# ---- Routes ---------------------------------------------------------------------------------
@bp.post("/api/routes")
@login_required
def create_route():
    try:
        if Route.query.filter_by(user_id=current_user.id).count() >= MAX_ROUTES:
            raise Bad("You can save up to %d routes. Delete one first." % MAX_ROUTES)
        r = Route(user_id=current_user.id, alert=True, **clean_route(_body()))
    except Bad as e:
        return _bad(e)
    db.session.add(r)
    db.session.commit()
    return jsonify(ok=True, route=route_json(r))


@bp.post("/api/routes/<int:route_id>")
@login_required
def update_route(route_id):
    r = _mine(Route, route_id)
    if r is None:
        return _bad(NOT_FOUND, 404)
    try:
        values = clean_route(_body())
    except Bad as e:
        return _bad(e)
    moved = (values["start_lat"], values["start_lng"], values["end_lat"], values["end_lng"]) != (r.start_lat, r.start_lng, r.end_lat, r.end_lng)
    for k, v in values.items():
        setattr(r, k, v)
    if moved:   # a different trip: today's check should run again
        Schedule.query.filter_by(route_id=r.id).update({"last_check_at": None})
    db.session.commit()
    return jsonify(ok=True, route=route_json(r))


@bp.post("/api/routes/<int:route_id>/alert")
@login_required
def route_alert(route_id):
    r = _mine(Route, route_id)
    if r is None:
        return _bad(NOT_FOUND, 404)
    r.alert = bool((request.get_json(silent=True) or {}).get("alert"))
    db.session.commit()
    return jsonify(ok=True, route=route_json(r))


@bp.post("/api/routes/<int:route_id>/delete")
@login_required
def delete_route(route_id):
    r = _mine(Route, route_id)
    if r is None:
        return _bad(NOT_FOUND, 404)
    Schedule.query.filter_by(route_id=r.id).delete()
    db.session.delete(r)
    db.session.commit()
    return jsonify(ok=True)


# ---- Schedules ------------------------------------------------------------------------------
@bp.post("/api/schedules")
@login_required
def create_schedule():
    try:
        if Schedule.query.filter_by(user_id=current_user.id).count() >= MAX_SCHEDULES:
            raise Bad("You can have up to %d travel schedules." % MAX_SCHEDULES)
        s = Schedule(user_id=current_user.id, enabled=True, **clean_schedule(request.get_json(silent=True), _my_route_ids()))
    except Bad as e:
        return _bad(e)
    db.session.add(s)
    db.session.commit()
    return jsonify(ok=True, schedule=schedule_json(s))


@bp.post("/api/schedules/<int:schedule_id>")
@login_required
def update_schedule(schedule_id):
    s = _mine(Schedule, schedule_id)
    if s is None:
        return _bad(NOT_FOUND, 404)
    try:
        values = clean_schedule(request.get_json(silent=True), _my_route_ids())
    except Bad as e:
        return _bad(e)
    for k, v in values.items():
        setattr(s, k, v)
    s.last_check_at = None    # new times: check again today if it is still due
    db.session.commit()
    return jsonify(ok=True, schedule=schedule_json(s))


@bp.post("/api/schedules/<int:schedule_id>/enabled")
@login_required
def schedule_enabled(schedule_id):
    s = _mine(Schedule, schedule_id)
    if s is None:
        return _bad(NOT_FOUND, 404)
    s.enabled = bool((request.get_json(silent=True) or {}).get("enabled"))
    db.session.commit()
    return jsonify(ok=True, schedule=schedule_json(s))


@bp.post("/api/schedules/<int:schedule_id>/checked")
@login_required
def schedule_checked(schedule_id):
    s = _mine(Schedule, schedule_id)
    if s is None:
        return _bad(NOT_FOUND, 404)
    s.last_check_at = datetime.now(timezone.utc)
    db.session.commit()
    return jsonify(ok=True, schedule=schedule_json(s))


@bp.post("/api/schedules/<int:schedule_id>/delete")
@login_required
def delete_schedule(schedule_id):
    s = _mine(Schedule, schedule_id)
    if s is None:
        return _bad(NOT_FOUND, 404)
    db.session.delete(s)
    db.session.commit()
    return jsonify(ok=True)


# ---- One-time import of what a browser saved before step 5 ----------------------------------------
@bp.post("/api/my/import")
@login_required
def import_mine():
    data = _body() or {}
    routes = data.get("routes") if isinstance(data.get("routes"), list) else []
    schedules = data.get("schedules") if isinstance(data.get("schedules"), list) else []
    have = Route.query.filter_by(user_id=current_user.id).count()
    new_ids, skipped = {}, 0
    for old in routes[:MAX_ROUTES]:
        if have >= MAX_ROUTES:
            skipped += 1
            continue
        try:
            r = Route(user_id=current_user.id, alert=bool(old.get("alert", True)), **clean_route(old))
        except (Bad, AttributeError):
            skipped += 1
            continue
        db.session.add(r)
        db.session.flush()
        new_ids[old.get("id")] = r.id
        have += 1
    added_s = 0
    for old in schedules[:MAX_SCHEDULES]:
        if not isinstance(old, dict) or old.get("routeId") not in new_ids:
            skipped += 1
            continue
        try:
            values = clean_schedule(dict(old, routeId=new_ids[old["routeId"]]), set(new_ids.values()))
        except Bad:
            skipped += 1
            continue
        db.session.add(Schedule(user_id=current_user.id, enabled=bool(old.get("enabled", True)), **values))
        added_s += 1
    db.session.commit()
    return jsonify(ok=True, routes=len(new_ids), schedules=added_s, skipped=skipped)


def init_app(app):
    app.register_blueprint(bp)
