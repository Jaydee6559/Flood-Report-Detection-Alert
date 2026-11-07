"""Flood reports (Modules 5-8, 13): saved in the database instead of the browser.

The pages read reports the same way they learn who is signed in: a small script,
    GET /api/reports.js     ->  window.FDA_REPORTS = [...]
that static/js/app.js loads before the page scripts, so pages can keep reading
FDA.store.db().reports without waiting. It holds the last REPORT_DAYS days of
reports (newest first), plus any report asked for with ?id=<number>.

    POST /api/reports                    (signed in)  a new report: form field "photo" + form field "data" (JSON)
    POST /api/reports/<id>/review        (moderator)  {action: approve|duplicate|later|remove, reason}
    GET  /uploads/<file>                              report photos

The photo check (MobileNetV2) and the agent's Rule 1 run in the page first, so the
person sees a result at once. The server then checks the photo again with the
trained model (when it is loaded) and runs Rule 1 again with its own hazard map,
flood spots, nearby reports and live rain (agent.py); its result is what is saved.
Every decision is logged in agent_decisions. Confirmations, comments and flags are in
community_api.py.
"""
import io
import json
import math
import os
import uuid
from datetime import datetime, timedelta, timezone

from flask import Blueprint, Response, abort, current_app, jsonify, request, send_from_directory
from flask_login import current_user, login_required

import accounts
import agent
import limits
import notifications_api
from database import STATUSES, AgentDecision, Confirmation, Flag, Report, db, utcnow

bp = Blueprint("reports_api", __name__)

REPORT_DAYS = 30            # how far back the pages get reports
MAX_REPORTS = 2000          # and at most this many
PHOTO_MAX_SIDE = 1280       # photos are re-saved as JPEG no bigger than this
QC_BOUNDS = (14.55, 14.80, 120.95, 121.15)   # lat min/max, lng min/max: Quezon City with a margin
RAIN_LEVELS = (None, "yellow", "orange", "red")
HAZARDS = ("none", "low", "medium", "high")


# ---- Shape the pages use (the same fields the browser data had) ---------------
def _ms(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:            # SQLite gives times back without a zone; they are UTC
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def naive_utc(dt):
    """SQLite gives times back without a zone; compare everything as plain UTC."""
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt is not None and dt.tzinfo else dt


def _counts(ids, viewer=None, reviewed=None):
    """{report id: {"still", "not", "last", "flags", "myVote", "myFlag"}} counted from the confirmations and flags rows.
    "flags" only counts flags made after the report was last reviewed (reviewed = {id: reviewed_at}), so a report that
    was approved comes back to the queue if people report it again."""
    out = {i: {"still": 0, "not": 0, "last": None, "flags": 0, "myVote": None, "myFlag": False} for i in ids}
    if not ids:
        return out
    reviewed = reviewed or {}
    me = viewer.id if viewer is not None else None
    for c in Confirmation.query.filter(Confirmation.report_id.in_(ids)):
        o = out[c.report_id]
        o[c.kind] += 1
        if o["last"] is None or (c.created_at and naive_utc(c.created_at) > naive_utc(o["last"])):
            o["last"] = c.created_at
        if c.user_id == me:
            o["myVote"] = c.kind
    for f in Flag.query.filter(Flag.target == "report", Flag.target_id.in_(ids)):
        o = out.get(f.target_id)
        if o is None:
            continue
        since = naive_utc(reviewed.get(f.target_id))
        if since is None or naive_utc(f.created_at) > since:
            o["flags"] += 1
        if f.user_id == me:
            o["myFlag"] = True
    return out


def counts_for(reports, viewer=None):
    return _counts([r.id for r in reports], viewer, {r.id: r.reviewed_at for r in reports if r.reviewed_at})


def public(r, counts=None, viewer=None):
    """One report as the pages see it. A removed report keeps only its number and the reason,
    except for its owner and moderators."""
    c = counts or {"still": 0, "not": 0, "last": None, "flags": 0, "myVote": None, "myFlag": False}
    inputs = r.inputs or {}
    out = {
        "id": r.id, "ownerId": "u%d" % r.user_id, "ts": _ms(r.created_at), "removed": r.removed,
        "review": r.review, "reviewedAt": _ms(r.reviewed_at),
    }
    may_see = not r.removed or (viewer is not None and (viewer.is_moderator or viewer.id == r.user_id))
    if not may_see:
        return out
    if r.removed:
        out["removeReason"] = r.remove_reason      # for the reporter and moderators only
    out.update({
        "city": accounts.CITY, "barangay": r.barangay, "street": r.street or "Street not given",
        "lat": r.lat, "lng": r.lng, "location": "precise" if r.location_precise else "approximate",
        "desc": r.description or "", "photo": "/uploads/" + r.photo_file,
        "prob": r.prob, "model": r.model_source, "depthCm": inputs.get("depthCm"),
        "status": r.status, "startStatus": r.start_status, "note": r.note or "", "recommendation": r.recommendation or "",
        "reasons": r.reasons or [], "inputs": {k: v for k, v in inputs.items() if k not in ("evidence", "depthCm")},
        "evidence": inputs.get("evidence") or [], "dupCandidate": r.dup_candidate_id, "dupOf": r.dup_of_id,
        "flags": c["flags"], "still": c["still"], "not": c["not"], "lastConfirmTs": _ms(c["last"]),
        "myVote": c["myVote"], "myFlag": c["myFlag"],      # the signed-in viewer's own vote and flag
    })
    return out


def _viewer():
    return current_user if current_user.is_authenticated else None


def report_list(extra_id=None):
    since = utcnow() - timedelta(days=REPORT_DAYS)
    rows = Report.query.filter(Report.created_at >= since).order_by(Report.id.desc()).limit(MAX_REPORTS).all()
    if extra_id and not any(r.id == extra_id for r in rows):
        r = db.session.get(Report, extra_id)
        if r is not None:
            rows.append(r)
    viewer = _viewer()
    counts = counts_for(rows, viewer)
    return [public(r, counts[r.id], viewer) for r in rows]


# ---- Reading --------------------------------------------------------------------
@bp.get("/api/reports.js")
def reports_script():
    extra = request.args.get("id", type=int)
    body = "window.FDA_REPORTS = %s;\n" % json.dumps(report_list(extra), separators=(",", ":"))
    resp = Response(body, mimetype="application/javascript")
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.get("/api/reports")
def reports_json():
    return jsonify(reports=report_list(request.args.get("id", type=int)))


@bp.get("/uploads/<path:name>")
def photo(name):
    """Report photos. A removed report's photo is only shown to its owner and moderators."""
    r = Report.query.filter_by(photo_file=name).first()
    if r is None:
        abort(404)
    viewer = _viewer()
    if r.removed and not (viewer is not None and (viewer.is_moderator or viewer.id == r.user_id)):
        abort(404)
    resp = send_from_directory(current_app.config["UPLOAD_FOLDER"], name)
    resp.headers["Cache-Control"] = "private, max-age=86400"
    return resp


# ---- Creating a report --------------------------------------------------------------
class Bad(Exception):
    pass


def _text(data, key, limit, required=False):
    v = data.get(key)
    v = "" if v is None else str(v).strip()
    if required and not v:
        raise Bad("Missing %s." % key)
    return v[:limit] or None


def _number(data, key, lo=None, hi=None, required=True):
    v = data.get(key)
    if v is None and not required:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        raise Bad("%s must be a number." % key)
    if not math.isfinite(v) or (lo is not None and v < lo) or (hi is not None and v > hi):
        raise Bad("%s is out of range." % key)
    return v


def _existing_ids(ids):
    ids = [int(i) for i in ids if isinstance(i, (int, float)) and not isinstance(i, bool)][:20]
    if not ids:
        return []
    found = {r.id for r in Report.query.filter(Report.id.in_(ids)).with_entities(Report.id)}
    return [i for i in ids if i in found]


def _clean_reasons(reasons):
    out = []
    for x in (reasons if isinstance(reasons, list) else [])[:10]:
        if isinstance(x, dict):
            out.append({k: str(x.get(k) or "")[:300] for k in ("key", "title", "detail", "effect")})
    return out


# Starting cut-offs of the agent's Rule 1 (static/js/core/agent.js config: floodAt, possibleAt, unclearAt)
FLOOD_AT, POSSIBLE_AT, UNCLEAR_AT = 0.80, 0.50, 0.30


def status_from_probability(p):
    if p >= FLOOD_AT:
        return "flood-warning"
    if p >= POSSIBLE_AT:
        return "possible-flood"
    if p >= UNCLEAR_AT:
        return "unclear-photo"
    return "no-flood"


def _server_probability(data):
    """P(flood) from the trained model on the server, or None when it is not loaded (or fails)."""
    check = current_app.config.get("PHOTO_CHECK")
    if not check:
        return None
    try:
        return check(data)
    except Exception as exc:   # an unreadable photo is caught by _save_photo; anything else: fall back to the page's value
        current_app.logger.warning("Server photo re-check failed: %s", exc)
        return None


def _save_photo(data):
    """Re-save the upload (bytes) as a JPEG (this also drops EXIF data such as GPS). Returns the file name."""
    from PIL import Image, ImageOps
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception:
        raise Bad("That file could not be read as a photo.")
    img.thumbnail((PHOTO_MAX_SIDE, PHOTO_MAX_SIDE))
    folder = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(folder, exist_ok=True)
    name = uuid.uuid4().hex + ".jpg"
    img.save(os.path.join(folder, name), "JPEG", quality=85)
    return name


@bp.post("/api/reports")
@login_required
def create_report():
    stop = limits.blocked("report", current_user.id)
    if stop:
        return stop
    photo_file = None
    try:
        try:
            data = json.loads(request.form.get("data") or "{}")
        except ValueError:
            raise Bad("The report data could not be read.")
        if not isinstance(data, dict):
            raise Bad("The report data could not be read.")
        if request.files.get("photo") is None:
            raise Bad("Add a photo of the street first.")

        barangay = _text(data, "barangay", 80, required=True)
        if barangay not in accounts.barangay_districts():
            raise Bad("Choose a Quezon City barangay from the list.")
        lat = _number(data, "lat", QC_BOUNDS[0], QC_BOUNDS[1])
        lng = _number(data, "lng", QC_BOUNDS[2], QC_BOUNDS[3])
        prob = _number(data, "prob", 0, 1)
        status, start = data.get("status"), data.get("startStatus")
        if status not in STATUSES or start not in STATUSES:
            raise Bad("Unknown report status.")
        source = "server" if data.get("model") == "server" else "tfjs" if data.get("model") == "tfjs" else "demo"

        inp = data.get("inputs") if isinstance(data.get("inputs"), dict) else {}
        hazard = inp.get("hazard") if inp.get("hazard") in HAZARDS else None
        rain = inp.get("rain") if inp.get("rain") in RAIN_LEVELS else None
        rain_mm = _number(inp, "rainMm", 0, 500, required=False)
        spots = int(_number(inp, "spots", 0, 1000, required=False) or 0)
        nearby = int(_number(inp, "reports", 0, 10000, required=False) or 0)
        depth = _number(data, "depthCm", 0, 500, required=False)
        dup = _existing_ids([data.get("dupCandidate")]) if data.get("dupCandidate") is not None else []
        inputs = {"hazard": hazard, "rain": rain, "rainMm": rain_mm, "spots": spots, "reports": nearby,
                  "evidence": _existing_ids(data.get("evidence") if isinstance(data.get("evidence"), list) else [])}
        if depth is not None:
            inputs["depthCm"] = depth

        photo_bytes = request.files["photo"].read()
        # With the trained model loaded, the server checks the photo itself instead of trusting the page:
        # the starting status must be the one the server's probability gives, and the server's P is saved.
        server_p = _server_probability(photo_bytes)
        if server_p is not None:
            if status_from_probability(server_p) != start:
                raise Bad("The photo check on the server gave a different result. Please check the photo again, then send the report.")
            inputs["pageProb"] = prob
            prob, source = server_p, "server"
        if status_from_probability(prob) != start:
            raise Bad("The report's status does not match its photo probability. Please check the photo again.")

        # Rule 1 again, with the hazard, flood spots, nearby reports and (when the server has it) the rain looked up here.
        # The server's result is what is saved; what the page sent is kept in inputs["page"] for the log.
        note, recommendation, reasons = _text(data, "note", 200), _text(data, "recommendation", 2000), _clean_reasons(data.get("reasons"))
        mine = agent.check(prob, lat, lng, barangay, page_rain=rain, page_mm=rain_mm)
        page_inputs = {k: inputs[k] for k in ("hazard", "rain", "rainMm", "spots", "reports") if k in inputs}
        page_inputs["status"] = status
        inputs.update(mine["inputs"])
        inputs["page"] = page_inputs
        hazard, rain, rain_mm, spots, nearby = inputs["hazard"], inputs["rain"], inputs["rainMm"], inputs["spots"], inputs["reports"]
        if mine["status"] != status:
            reasons.append({"key": "server", "title": "Checked again on the server: %s" % agent.LABEL[mine["status"]],
                            "detail": "The page said %s. With the server's hazard map, flood spots, nearby reports and %s rain the result is %s."
                                      % (agent.LABEL[status], "live" if inputs["rainSource"] == "live" else "the page's", agent.LABEL[mine["status"]]),
                            "effect": "info"})
            status = mine["status"]
            note = (mine["note"] or "Checked again on the server.")[:200]
            recommendation = mine["recommendation"][:2000]
        photo_file = _save_photo(photo_bytes)
        report = Report(
            user_id=current_user.id, barangay=barangay, street=_text(data, "street", 120), lat=lat, lng=lng,
            location_precise=data.get("location") == "precise", description=_text(data, "desc", 500),
            photo_file=photo_file, prob=prob, model_source=source, start_status=start, status=status,
            note=note, recommendation=recommendation,
            reasons=reasons, inputs=inputs, dup_candidate_id=dup[0] if dup else None,
        )
        db.session.add(report)
        db.session.flush()   # gives the report its number
        db.session.add(AgentDecision(
            kind="photo", report_id=report.id, barangay=barangay, prob=prob, start_status=start, result=status,
            hazard=hazard, rain_level=rain, rain_mm=rain_mm, spots=spots, nearby_reports=nearby,
            inputs={"model": source, "lat": lat, "lng": lng, "evidence": inputs["evidence"], "dupCandidate": report.dup_candidate_id,
                    "rainSource": inputs["rainSource"], "raisedBy": mine["raised"], "pageStatus": page_inputs["status"]},
        ))
        notifications_api.route_alerts(report)   # everyone whose saved route passes near it
        db.session.commit()
        limits.count("report", current_user.id)
    except Bad as e:
        db.session.rollback()
        if photo_file:
            _remove_photo(photo_file)
        return jsonify(ok=False, error=str(e)), 400
    except Exception:
        db.session.rollback()
        if photo_file:
            _remove_photo(photo_file)
        raise
    return jsonify(ok=True, report=public(report, None, current_user))


def _remove_photo(name):
    try:
        os.remove(os.path.join(current_app.config["UPLOAD_FOLDER"], name))
    except OSError:
        pass


# ---- Moderation -------------------------------------------------------------------
@bp.post("/api/reports/<int:report_id>/review")
@login_required
def review_report(report_id):
    if not current_user.is_moderator:
        return jsonify(ok=False, error="Only moderators can review reports."), 403
    r = db.session.get(Report, report_id)
    if r is None:
        return jsonify(ok=False, error="There is no report with that number."), 404
    data = request.get_json(silent=True) or {}
    action = data.get("action")
    now = datetime.now(timezone.utc)
    if action == "approve":
        r.review, r.dup_candidate_id = "approved", None
    elif action == "duplicate":
        if not r.dup_candidate_id:
            return jsonify(ok=False, error="This report has no possible original to merge with."), 400
        r.review, r.dup_of_id = "duplicate", r.dup_candidate_id
    elif action == "later":
        r.review = "later"
    elif action == "remove":
        reason = str(data.get("reason") or "").strip()[:200]
        if not reason:
            return jsonify(ok=False, error="Give a reason. The reporter will see it."), 400
        r.review, r.remove_reason = "removed", reason
    else:
        return jsonify(ok=False, error="Unknown action."), 400
    if action != "later":
        r.reviewed_by, r.reviewed_at = current_user.id, now
    link = "report-details.html?id=%d" % r.id
    if action == "duplicate":       # tell the reporter
        notifications_api.notify(r.user_id, "report", "dup:%d" % r.id, "Your report #%d was marked as a duplicate" % r.id,
                                 "Merged with #%d by a moderator" % r.dup_of_id, link, "Open report →")
    elif action == "remove":
        notifications_api.notify(r.user_id, "report", "removed:%d" % r.id, "Your report #%d was removed" % r.id, r.remove_reason, link, "Open report →")
    db.session.commit()
    return jsonify(ok=True, report=public(r, counts_for([r], current_user)[r.id], current_user))


# ---- Agent dashboard (moderators) ---------------------------------------------------------------
STATS_DAYS = 30


@bp.get("/api/moderation/stats")
@login_required
def agent_stats():
    """How the agent's Rule 1 did over the last STATS_DAYS days: what it decided, what raised a status,
    and what moderators and the community said afterwards. For the moderation page."""
    if not current_user.is_moderator:
        return jsonify(ok=False, error="Only moderators can see this."), 403
    since = utcnow() - timedelta(days=STATS_DAYS)
    rows = Report.query.filter(Report.created_at >= since).all()
    counts = counts_for(rows)
    by_status = {s: {"reports": 0, "raised": 0, "approved": 0, "duplicate": 0, "removed": 0, "waiting": 0, "still": 0, "not": 0}
                 for s in STATUSES}
    raised_by = {"H": 0, "R": 0, "S": 0, "N": 0}
    models = {}
    for r in rows:
        b = by_status[r.status]
        b["reports"] += 1
        if r.start_status != r.status:
            b["raised"] += 1
            for x in r.reasons or []:
                if x.get("effect") == "raise" and x.get("key") in raised_by:
                    raised_by[x["key"]] += 1
        if r.review in ("approved", "duplicate", "removed"):
            b[r.review] += 1
        elif r.review is None and (r.dup_candidate_id or counts[r.id]["flags"]):
            b["waiting"] += 1
        b["still"] += counts[r.id]["still"]
        b["not"] += counts[r.id]["not"]
        models[r.model_source] = models.get(r.model_source, 0) + 1
    return jsonify(ok=True, days=STATS_DAYS, total=len(rows), byStatus=by_status, raisedBy=raised_by, models=models)


def init_app(app):
    app.register_blueprint(bp)
