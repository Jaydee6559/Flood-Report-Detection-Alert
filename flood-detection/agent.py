"""The agent's Rule 1 on the server (the Python copy of static/js/core/agent.js checkPhoto).

The page runs Rule 1 first so the person sees the result at once. When the report is sent,
reports_api.py runs it again here with inputs the server looks up itself, so a changed page
cannot make up a status:

    P  the server's own photo check when the trained model is loaded (app.photo_probability),
       otherwise the page's value (marked "demo"/"tfjs" in model_source)
    H  the hazard level of the barangay polygon that holds the pin (static/data/barangays.geojson)
    R  live rain the server fetched in the last RAIN_MAX_AGE_MIN minutes (jobs.py, Open-Meteo);
       only when it has none does it use the page's rain level, and it says so (rainSource "page")
    S  recurring flood spots within SPOT_M: the moderators' log (flood_spots table) plus the
       sample seed spots unless they are turned off (spots_data.sample_spots_on)
    N  other flood warnings / possible floods within REPORT_M in the last REPORT_MIN minutes

check(prob, lat, lng, barangay, page_rain) -> {"status", "start", "inputs", "raised", "note", "recommendation", ...}

Keep the numbers and the rules the same as in agent.js.
"""
import json
import math
import os
from datetime import datetime, timedelta, timezone

import spots_data
from database import FloodSpot, Report

FLOOD_AT, POSSIBLE_AT, UNCLEAR_AT = 0.80, 0.50, 0.30   # agent.js config: floodAt, possibleAt, unclearAt
SPOT_M = 200          # spotMeters
REPORT_M = 500        # reportMeters
REPORT_MIN = 120      # reportMin
RAIN_MAX_AGE_MIN = 30
LABEL = {"flood-warning": "Flood warning", "possible-flood": "Possible flood", "unclear-photo": "Unclear photo", "no-flood": "No flood"}
LONG = {
    "flood-warning": "Do not walk or drive through floodwater. Use another route if you can.",
    "possible-flood": "Use caution. Water may be rising; avoid low areas.",
    "unclear-photo": "The photo is unclear. Please send a clearer photo of the street.",
    "no-flood": "No flood seen. Review local conditions before travel.",
}
HERE = os.path.dirname(os.path.abspath(__file__))
_polys = []


def status_from_probability(p):
    if p >= FLOOD_AT:
        return "flood-warning"
    if p >= POSSIBLE_AT:
        return "possible-flood"
    if p >= UNCLEAR_AT:
        return "unclear-photo"
    return "no-flood"


def meters(lat1, lng1, lat2, lng2):
    """Haversine distance, as FDA.geo.distance."""
    r = math.radians
    h = math.sin(r(lat2 - lat1) / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lng2 - lng1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


# ---- H: hazard at a point ----------------------------------------------------------------
def _barangays():
    if not _polys:
        with open(os.path.join(HERE, "static", "data", "barangays.geojson"), encoding="utf-8") as f:
            for feat in json.load(f)["features"]:
                g, p = feat["geometry"], feat["properties"]
                rings = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
                pts = [c for poly in rings for c in poly[0]]
                _polys.append({"name": p["name"], "hazard": p.get("hazard") or "none", "lat": p.get("lat"), "lng": p.get("lng"),
                               "rings": rings, "bbox": (min(c[1] for c in pts), min(c[0] for c in pts), max(c[1] for c in pts), max(c[0] for c in pts))})
    return _polys


def _in_ring(lat, lng, ring):
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi, xj, yj = ring[i][0], ring[i][1], ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def hazard_at(lat, lng, barangay=None):
    """{"barangay", "hazard"} for a pin, as FDA.hazard.at: the polygon that holds it, else the named barangay."""
    for b in _barangays():
        if not (b["bbox"][0] <= lat <= b["bbox"][2] and b["bbox"][1] <= lng <= b["bbox"][3]):
            continue
        for poly in b["rings"]:
            if _in_ring(lat, lng, poly[0]) and not any(_in_ring(lat, lng, hole) for hole in poly[1:]):
                return {"barangay": b["name"], "hazard": b["hazard"]}
    named = next((b for b in _barangays() if b["name"] == barangay), None)
    return {"barangay": barangay, "hazard": named["hazard"] if named else "none"}


def barangay_centre(name):
    b = next((b for b in _barangays() if b["name"] == name), None)
    return (b["lat"], b["lng"]) if b else None


# ---- S: recurring flood spots near a point ------------------------------------------------
def spots_near(lat, lng, radius=SPOT_M):
    out = []
    for s in spots_data.seed_spots():
        d = meters(lat, lng, s["lat"], s["lng"])
        if d <= radius:
            out.append({"corner": s["corner"], "times": s["times"], "meters": round(d), "seed": True})
    for s in FloodSpot.query.all():
        d = meters(lat, lng, s.lat, s.lng)
        if d <= radius:
            out.append({"corner": s.corner, "times": s.times, "meters": round(d), "seed": False})
    return sorted(out, key=lambda s: s["meters"])


# ---- N: other recent flood reports near a point -------------------------------------------
def _utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def reports_near(lat, lng, now=None):
    now = now or datetime.now(timezone.utc)
    since = (now - timedelta(minutes=REPORT_MIN)).replace(tzinfo=None)
    out = []
    for r in Report.query.filter(Report.created_at >= since).order_by(Report.id.desc()):
        if r.removed or r.dup_of_id or r.status not in ("flood-warning", "possible-flood"):
            continue
        if r.lat is not None and meters(lat, lng, r.lat, r.lng) <= REPORT_M:
            out.append(r.id)
    return out


# ---- R: rain -----------------------------------------------------------------------------
def rain_for(barangay, page_rain, page_mm, now=None):
    """(level, mm, source). Live rain the server already has for the barangay's district, else the page's value."""
    import jobs
    live = jobs.latest_rain(max_age_min=RAIN_MAX_AGE_MIN, now=now)
    district = next((d for name, d, _ in jobs.reference()["barangays"] if name == barangay), None)
    if live and district is not None:
        mm_all = live.get(district) or live.get(str(district))
        if mm_all:
            return jobs.rain_level(mm_all[0]), mm_all[0], "live"
    return page_rain, page_mm, "page"


# ---- Rule 1 --------------------------------------------------------------------------------
def rule1(start, hazard, rain, has_s, has_n):
    """(status, raised-by keys, risk note) exactly as agent.js checkPhoto."""
    rain_high = rain in ("orange", "red")
    hz_high, hz_med = hazard == "high", hazard in ("high", "medium")
    if start == "possible-flood" and (rain_high or has_n or hz_high):
        return "flood-warning", [k for k, on in (("H", hz_high), ("R", rain_high), ("S", has_s), ("N", has_n)) if on], False
    if start == "unclear-photo" and rain_high and (hz_med or has_s):
        return "possible-flood", [k for k, on in (("H", hz_med), ("R", True), ("S", has_s)) if on], False
    return start, [], start == "no-flood" and rain_high and hz_med


def check(prob, lat, lng, barangay, page_rain=None, page_mm=None, now=None):
    start = status_from_probability(prob)
    hz = hazard_at(lat, lng, barangay)["hazard"]
    rain, mm, rain_source = rain_for(barangay, page_rain, page_mm, now)
    spots = spots_near(lat, lng)
    nearby = reports_near(lat, lng, now)
    status, raised, risk_note = rule1(start, hz, rain, bool(spots), bool(nearby))
    names = {"H": "hazard", "R": "rain", "S": "a recurring spot", "N": "%d nearby report%s" % (len(nearby), "" if len(nearby) == 1 else "s")}
    if status != start:
        parts = [names[k] for k in raised]
        joined = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
        note = "Photo alone said %s; %s raised it to %s." % (LABEL[start], joined, LABEL[status])
    elif risk_note:
        note = "The photo does not show a flood, but rain is heavy and this is a %s-hazard area, so risk is high here." % hz
    else:
        note = None      # nothing raised: the page's wording stays
    return {
        "status": status, "start": start, "raised": raised, "note": note,
        "recommendation": ((note + " ") if note else "") + LONG[status],
        "inputs": {"hazard": hz, "rain": rain, "rainMm": mm, "rainSource": rain_source, "spots": len(spots), "reports": len(nearby),
                   "evidence": nearby[:20]},
        "spots": spots,
    }
