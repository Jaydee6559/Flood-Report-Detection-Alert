"""Timed jobs on the server, so alerts go out even when nobody has the site open.

    run_due_checks(now)    once a minute: the pre-departure check (Module 11). For every travel schedule that is
                           due, check the reports along its route and notify its owner. The same as
                           static/js/core/scheduler.js, with the same notification keys and day format, so a
                           check that a page already ran is not sent twice.
    run_reminders(now)     once a minute: "Remind me" reminders that are due become notifications.
    run_area_check(now)    every 15 minutes: the area rain check (Rule 2, Modules 3 and 7). Live rain from
                           Open-Meteo for the 6 districts, Rule 2 for all 142 barangays, every level change saved
                           in area_state and agent_decisions, and an alert to everyone watching a barangay that
                           has just become High. With no live rain it does nothing (no made-up rain on the server).
    start(app)             runs them in a background thread.

The thread starts with `flask run` (in a debug reloader, only in the process that serves pages).
Set FDA_JOBS=0 to turn it off (the tests do).
"""
import json
import math
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from database import AgentDecision, AreaState, FloodSpot, Reminder, Report, Route, Schedule, User, WatchedBarangay, db

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


# ---- "Remind me" ------------------------------------------------------------------------------------
def run_reminders(now=None):
    """Turn every due reminder into a notification. Returns how many."""
    from notifications_api import notify
    now = now or datetime.now(timezone.utc)
    sent = 0
    for m in Reminder.query.filter(Reminder.done.is_(False)).all():
        if _utc(m.due_at) > now:
            continue
        m.done = True
        notify(m.user_id, "schedule", "remind:%d" % m.id, m.title, m.text or "", m.link or "routes.html", "View routes →")
        sent += 1
    db.session.commit()
    return sent


# ---- The area rain check (Rule 2) --------------------------------------------------------------------
AREA_EVERY_S = 15 * 60
REPORT_WINDOW_MIN = 120          # N: flood reports in the last 2 hours (core/areas.js)
PAGASA = (("red", 30), ("orange", 15), ("yellow", 7.5))
RAIN_NAMES = {"yellow": "Yellow", "orange": "Orange", "red": "Red"}
HERE = os.path.dirname(os.path.abspath(__file__))
_ref = {}


def reference():
    """The read-only data the pages use too: districts (locations.json), barangays with their hazard level
    (barangays.geojson) and the seed flood spots (flood-spots.js), loaded once."""
    if not _ref:
        with open(os.path.join(HERE, "static", "data", "locations.json"), encoding="utf-8") as f:
            city = next(c for c in json.load(f)["cities"] if c["name"] == "Quezon City")
        _ref["districts"] = [(d["id"], d["center"]["lat"], d["center"]["lng"]) for d in city["districts"]]
        with open(os.path.join(HERE, "static", "data", "barangays.geojson"), encoding="utf-8") as f:
            _ref["barangays"] = [(p["name"], p["district"], p.get("hazard") or "none")
                                 for p in (feat["properties"] for feat in json.load(f)["features"])]
        with open(os.path.join(HERE, "static", "data", "flood-spots.js"), encoding="utf-8") as f:
            seeds = re.findall(r'\{\s*b:\s*"([^"]+)"', f.read())
        _ref["seed_spots"] = {name: seeds.count(name) for name in set(seeds)}
    return _ref


def rain_level(mm):
    for name, at_least in PAGASA:
        if mm >= at_least:
            return name
    return None


def fetch_rain(timeout=20):
    """Live rain from Open-Meteo, the same call as core/rain.js: {district id: [mm now, +1 h, +2 h, +3 h]}."""
    ds = reference()["districts"]
    q = urllib.parse.urlencode({"latitude": ",".join(str(d[1]) for d in ds), "longitude": ",".join(str(d[2]) for d in ds),
                                "current": "precipitation", "hourly": "precipitation", "forecast_days": 2, "timezone": "Asia/Manila"})
    req = urllib.request.Request("https://api.open-meteo.com/v1/forecast?" + q, headers={"User-Agent": "flood-detection-alert"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.load(resp)
    rows, out = (data if isinstance(data, list) else [data]), {}
    for (did, _, _), row in zip(ds, rows):
        times, hourly = row["hourly"]["time"], row["hourly"]["precipitation"]
        now_hour = row["current"]["time"][:13]
        idx = next((i for i, t in enumerate(times) if t[:13] == now_hour), 0)
        mm = [row["current"].get("precipitation") or 0] + [(hourly[idx + k] if idx + k < len(hourly) else 0) or 0 for k in (1, 2, 3)]
        out[did] = [round(float(v), 1) for v in mm]
    return out


def area_risk(hazard, level, spots):
    """agent.areaRisk: High when the rain is orange/red and (hazard medium/high or a recurring spot)."""
    rank = {"yellow": 1, "orange": 2, "red": 3}.get(level, 0)
    hz_med, has_s = hazard in ("high", "medium"), spots > 0
    if rank >= 2 and (hz_med or has_s):
        return "high"
    if (rank == 1 and (hz_med or has_s)) or rank >= 2:
        return "elevated"
    return "low"


def run_area_check(now=None, rain=None):
    """Rule 2 for every barangay with live rain. rain: {district: [mm, ...]} (fetched when left out).
    Returns {"changed": n, "alerts": n}, or None when there is no live rain."""
    from notifications_api import notify
    now = now or datetime.now(timezone.utc)
    if rain is None:
        try:
            rain = fetch_rain()
        except Exception as exc:          # offline, or the service is down: try again next time
            print(" * Area rain check skipped: live rain could not be loaded (%s)" % exc, flush=True)
            return None
    ref = reference()
    spots = dict(ref["seed_spots"])
    for (name,) in db.session.query(FloodSpot.barangay):
        spots[name] = spots.get(name, 0) + 1
    reports = {}
    for r in Report.query.filter(Report.created_at >= now - timedelta(minutes=REPORT_WINDOW_MIN)).all():
        if not r.removed and not r.dup_of_id and r.status in ("flood-warning", "possible-flood"):
            reports[r.barangay] = reports.get(r.barangay, 0) + 1
    state = {a.barangay: a for a in AreaState.query.all()}
    hour = int(now.timestamp() // 3600)      # the same key as the pages: one alert per barangay per hour
    changed = alerts = 0
    for name, district, hazard in ref["barangays"]:
        mm_all = rain.get(district) or rain.get(str(district)) or [0, 0, 0, 0]
        mm, level = mm_all[0], rain_level(mm_all[0])
        n_spots = spots.get(name, 0)
        result = area_risk(hazard, level, n_spots)
        before = state.get(name)
        if before is not None and before.level == result:
            continue
        changed += 1
        if before is None:
            db.session.add(AreaState(barangay=name, level=result))
        else:
            before.level, before.updated_at = result, now
        if before is not None or result != "low":
            db.session.add(AgentDecision(kind="area", barangay=name, result=result, hazard=hazard, rain_level=level, rain_mm=mm,
                                         spots=n_spots, nearby_reports=reports.get(name, 0),
                                         inputs={"district": district, "mmNext3h": mm_all[1:], "rainSource": "live"}))
        if result != "high":
            continue
        watchers = {w.user_id for w in WatchedBarangay.query.filter_by(barangay=name)}
        homes = {u.id for u in User.query.filter_by(home_barangay=name)}
        for uid in sorted(watchers | homes):
            title = "%s rain over District %s · %s is high risk" % (RAIN_NAMES[level], district, "your home barangay" if uid in homes else name)
            text = "%s mm/h now · %s is a %s-hazard zone with %d recurring flood spot%s" % (mm, name, hazard, n_spots, "" if n_spots == 1 else "s")
            if notify(uid, "area", "area:%s:%d" % (name, hour), title, text, "areas.html?b=" + urllib.parse.quote(name), "See area risk →"):
                alerts += 1
    db.session.commit()
    return {"changed": changed, "alerts": alerts}


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
        last_area = None
        while True:
            for job in (run_due_checks, run_reminders):
                try:
                    with app.app_context():
                        job()
                except Exception:
                    app.logger.exception("%s failed; trying again in a minute.", job.__name__)
            if last_area is None or time.monotonic() - last_area >= AREA_EVERY_S:
                last_area = time.monotonic()
                try:
                    with app.app_context():
                        run_area_check()
                except Exception:
                    app.logger.exception("The area rain check failed; trying again in 15 minutes.")
            time.sleep(EVERY_S)

    threading.Thread(target=loop, name="fda-jobs", daemon=True).start()
    print(" * Timed jobs on: pre-departure checks and reminders every minute, area rain check every 15 minutes (jobs.py)", flush=True)
    return True
