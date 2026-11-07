"""The flood-spot log (Modules 3, 13): recurring flood spots moderators add from QCDRRMO / MMDA
advisories, saved in the flood_spots table. They are the agent's S input for everyone.

    GET  /api/spots.js                 window.FDA_SPOTS_LOG = [...] (everyone; app.js loads it before the page scripts)
                                       and window.FDA_SAMPLE_SPOTS_ON (false after  flask sample-spots off )
    POST /api/spots                    moderators: {barangay, corner, street?, date, depth, pass, url?, lat, lng}
                                       the same barangay + corner again counts as another time (times + 1)
    POST /api/spots/<id>/delete        moderators

The SAMPLE seed spots in static/data/flood-spots.js are added on top, unless they are turned off
(spots_data.py). Real sightings can also be loaded in bulk with  flask --app app import-spots FILE.csv .
"""
import json
import math
import re

from flask import Blueprint, Response, jsonify, request
from flask_login import current_user, login_required

import accounts
import spots_data
from database import DEPTHS, PASSABLE, FloodSpot, db

bp = Blueprint("spots_api", __name__)

DEPTH_RANK = {d: i for i, d in enumerate(DEPTHS)}
QC_BOUNDS = (14.55, 14.80, 120.95, 121.15)


def spot_json(s):
    """The shape core/hazard.js uses for a logged spot."""
    return {"id": "L%d" % s.id, "barangay": s.barangay, "corner": s.corner, "street": s.street or "", "times": s.times,
            "depth": s.worst_depth, "pass": s.passable, "last": s.last_seen, "lat": s.lat, "lng": s.lng,
            "source": s.source or "Moderator log", "sourceUrl": s.source_url or ""}


@bp.get("/api/spots.js")
def spots_script():
    rows = FloodSpot.query.order_by(FloodSpot.id).all()
    body = "window.FDA_SPOTS_LOG = %s;\nwindow.FDA_SAMPLE_SPOTS_ON = %s;\n" % (
        json.dumps([spot_json(s) for s in rows], separators=(",", ":")), "true" if spots_data.sample_spots_on() else "false")
    resp = Response(body, mimetype="application/javascript")
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _moderator():
    if not current_user.is_moderator:
        return jsonify(ok=False, error="Only moderators can change the flood-spot log."), 403
    return None


@bp.post("/api/spots")
@login_required
def add_spot():
    err = _moderator()
    if err:
        return err
    d = request.get_json(silent=True) or {}
    barangay, corner = str(d.get("barangay") or "").strip(), " ".join(str(d.get("corner") or "").split())[:120]
    date, depth, passable = str(d.get("date") or ""), d.get("depth"), d.get("pass") or "all"
    url = str(d.get("url") or "").strip()[:300]
    problem = (None if barangay in accounts.barangay_districts() else "Choose a barangay from the list.") \
        or (None if corner else "Enter the corner or street.") \
        or (None if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) else "Enter the date it was seen.") \
        or (None if depth in DEPTHS else "Choose how deep it was.") \
        or (None if passable in PASSABLE else "Choose who can pass.") \
        or (None if not url or re.match(r"^https?://", url, re.I) else "The source link must start with http:// or https://.")
    try:
        lat, lng = float(d.get("lat")), float(d.get("lng"))
        if not (math.isfinite(lat) and math.isfinite(lng) and QC_BOUNDS[0] <= lat <= QC_BOUNDS[1] and QC_BOUNDS[2] <= lng <= QC_BOUNDS[3]):
            raise ValueError
    except (TypeError, ValueError):
        problem = problem or "The spot must be inside Quezon City."
    if problem:
        return jsonify(ok=False, error=problem), 400

    same = next((s for s in FloodSpot.query.filter_by(barangay=barangay)
                 if s.corner.lower() == corner.lower()), None)
    if same is not None:     # the same corner seen again: one more time, the worst depth, the latest date
        same.times += 1
        same.last_seen = max(same.last_seen or "", date)
        if DEPTH_RANK[depth] > DEPTH_RANK.get(same.worst_depth, -1):
            same.worst_depth = depth
        if url and not same.source_url:
            same.source_url = url
        spot = same
    else:
        spot = FloodSpot(barangay=barangay, corner=corner, street=str(d.get("street") or "").strip()[:120] or re.split(r" cor\.? ", corner, flags=re.I)[0],
                         times=1, worst_depth=depth, passable=passable, last_seen=date, lat=lat, lng=lng,
                         source=str(d.get("source") or "Moderator log")[:120], source_url=url or None, added_by=current_user.id)
        db.session.add(spot)
    db.session.commit()
    return jsonify(ok=True, spot=spot_json(spot), again=same is not None)


@bp.post("/api/spots/<int:spot_id>/delete")
@login_required
def delete_spot(spot_id):
    err = _moderator()
    if err:
        return err
    s = db.session.get(FloodSpot, spot_id)
    if s is None:
        return jsonify(ok=False, error="That spot was already removed."), 404
    db.session.delete(s)
    db.session.commit()
    return jsonify(ok=True)


def init_app(app):
    app.register_blueprint(bp)
