"""Sample data for demos: 15 users, 20 flood reports with real Quezon City flood photos, confirmations,
comments, flags, saved routes, schedules, notifications and a few real flood-spot sightings.

    set FDA_DEMO=1                           (PowerShell: $env:FDA_DEMO = "1")
    flask --app app seed-demo                builds instance/demo.db and uploads/demo/ from scratch
    flask --app app run --debug              the site now shows the demo data

Remove FDA_DEMO to go back to the real database (instance/flood.db). The real database is never touched:
the command refuses to run unless the app is pointed at demo.db.

The photos (demo/photos/) are news photos of floods in Quezon City; demo/CREDITS.md lists the source of each.
Every photo is checked by the trained model and every report goes through the agent's Rule 1 (agent.py) with
the server's own hazard map, flood spots and nearby reports, at the time the report is dated. The times are
moved to the last few weeks so recent and outdated reports both show; each report says it is a sample.
Rain is not known for these photos, so no rain level is recorded (R is left empty).
"""
import math
import os
import random
import shutil
from datetime import datetime, timedelta, timezone

import accounts
import agent
import notifications_api
import reports_api
from database import (AgentDecision, Comment, Confirmation, Flag, FloodSpot, Notification, NotificationSettings, Report,
                      Route, Schedule, User, WatchedBarangay, db)

HERE = os.path.dirname(os.path.abspath(__file__))
PHOTOS = os.path.join(HERE, "demo", "photos")
PASSWORD = "FloodDemo2026"
MODERATOR = ("Demo Moderator", "moderator@example.com")

TRIBUNE = "Daily Tribune"
MT = "The Manila Times"
SOURCES = {
    "araneta-2026-08-29": (TRIBUNE, "Analy Labor", "2026-08-29", "https://tribune.net.ph/2026/08/29/g-araneta-flooding",
                           "Pedestrians and motorists cross above-knee-deep floodwater along G. Araneta Avenue."),
    "maria-clara-2025-07-19": (TRIBUNE, "Analy Labor", "2025-07-19", "https://tribune.net.ph/2025/07/19/drivers-brave-deep-floods-from-habagat-storm-crising",
                               "Motorists navigate floodwaters at Maria Clara Street corner Araneta Avenue."),
    "mother-ignacia-2025-09-29": (TRIBUNE, "Analy Labor", "2025-09-29", "https://tribune.net.ph/2025/09/29/qc-flooded-area-2",
                                  "Flooded portions of Mother Ignacia Avenue after a sudden heavy downpour."),
    "west-riverside-2023-06-11": (MT, "Mike de Juan", "2023-06-11", "https://www.manilatimes.net/2023/06/11/photos/motorists-wade-through-floods-in-qc/1895613",
                                  "Motorists pass a gutter-deep flood at West Riverside corner Valencia Street."),
    "batasan-mrt7-2025-07-23": (TRIBUNE, "Daily Tribune", "2025-07-23", "https://tribune.net.ph/2025/07/23/mmda-chief-inspects-clogged-manhole-near-mrt-7-station",
                                "The MMDA inspects a clogged manhole that caused flooding near MRT-7 Batasan Station, Commonwealth Avenue."),
    "santo-domingo-2025-08-30": (TRIBUNE, "Toto Lozano", "2025-08-30", "https://tribune.net.ph/2025/08/30/flood-hits-barangay-santo-domingo-quezon-city",
                                 "Barangay Santo Domingo submerged after intense thunderstorms."),
    "ns-amoranto-2026-07-10": (TRIBUNE, "Analy Labor", "2026-07-10", "https://tribune.net.ph/2026/07/10/qc-flooded-area-3",
                               "Motorists pass a gutter-deep flood along N.S. Amoranto."),
    "edsa-kamuning-2025-04-05": (TRIBUNE, "Analy Labor", "2025-04-05", "https://tribune.net.ph/2025/04/05/heavy-downpour-floods-parts-of-edsa",
                                 "Localized flooding along EDSA in Kamuning after a sudden thunderstorm."),
    "edsa-kamuning-2026-06-24": (TRIBUNE, "Analy Labor", "2026-06-24", "https://tribune.net.ph/2026/06/24/downpour-ii",
                                 "Motorists in a sudden heavy downpour along EDSA in Kamuning."),
    "araneta-2025-07-21": (MT, "Ismael de Juan", "2025-07-21", "https://www.manilatimes.net/2025/07/21/photos/araneta-ave-floods/2153225",
                           "People wade through knee- to waist-deep floodwater along Araneta Avenue."),
    "araneta-cleanup-2025-07-22": (MT, "Ismael de Juan", "2025-07-22", "https://www.manilatimes.net/2025/07/22/photos/flood-swept-trash/2153993",
                                   "MMDA personnel clean up trash swept by the flood along Araneta Avenue."),
}

# Points checked against the barangay map (agent.hazard_at) and OpenStreetMap's address for the place.
PLACES = {
    "araneta_tatalon": (14.62296, 121.015196, "Tatalon", "G. Araneta Ave."),
    "araneta_donaimelda": (14.615281, 121.016752, "Doña Imelda", "G. Araneta Ave."),
    "araneta_santodomingo": (14.630118, 121.011451, "Santo Domingo (Matalahib)", "G. Araneta Ave."),
    "araneta_talayan": (14.634845, 121.008995, "Talayan", "G. Araneta Ave."),
    "mariaclara": (14.630759, 121.011246, "Talayan", "Maria Clara St. cor. G. Araneta Ave."),
    "westriverside": (14.640564, 121.012945, "Del Monte", "West Riverside cor. Valencia St."),
    "motherignacia": (14.640136, 121.035493, "South Triangle", "Mother Ignacia Ave."),
    "nsamoranto": (14.633686, 121.003876, "Santo Domingo (Matalahib)", "N.S. Amoranto Sr. Ave."),
    "batasan": (14.685065, 121.08657, "Batasan Hills", "Commonwealth Ave. near MRT-7 Batasan Station"),
    "edsa_kamuning": (14.635373, 121.043265, "Pinyahan", "EDSA near GMA-Kamuning Station"),
    "santodomingo": (14.63, 121.00512, "Santo Domingo (Matalahib)", None),     # caption names the barangay only
}

USERS = [  # name, login, home barangay
    ("Maria Santos", "maria.santos@example.com", "Tatalon"),
    ("Jose Reyes", "jose.reyes@example.com", "Doña Imelda"),
    ("Ana Cruz", "ana.cruz@example.com", "Talayan"),
    ("Mark Bautista", "mark.bautista@example.com", "Santo Domingo (Matalahib)"),
    ("Liza Garcia", "liza.garcia@example.com", "South Triangle"),
    ("Paolo Mendoza", "paolo.mendoza@example.com", "Roxas"),
    ("Grace Villanueva", "grace.villanueva@example.com", "Del Monte"),
    ("Ramon Torres", "ramon.torres@example.com", "Pinyahan"),
    ("Kristine Ramos", "kristine.ramos@example.com", "Batasan Hills"),
    ("Daniel Aquino", "daniel.aquino@example.com", "Masambong"),
    ("Joy Navarro", "joy.navarro@example.com", "Damayang Lagi"),
    ("Carlo Dizon", "carlo.dizon@example.com", "Holy Spirit"),
    ("Bea Castillo", "bea.castillo@example.com", "Paligsahan"),
    ("Miguel Flores", "miguel.flores@example.com", "Commonwealth"),
    ("Rica Domingo", "rica.domingo@example.com", "Siena"),
]

# photo file, place, minutes ago, reporter (index into USERS), metres moved east (so reports on one corner do not overlap), reporter's note
REPORTS = [
    ("edsa-kamuning-2025-04-05-b", "edsa_kamuning", 21 * 1440 + 300, 7, 0, "Water across the outer lane after the thunderstorm."),
    ("batasan-mrt7-2025-07-23", "batasan", 15 * 1440 + 120, 8, 0, "Crews are clearing the clogged manhole near the station. Road is open."),
    ("santo-domingo-2025-08-30-b", "santodomingo", 12 * 1440 + 200, 3, 0, "Whole street under water near our house."),
    ("west-riverside-2023-06-11-b", "westriverside", 9 * 1440 + 90, 6, 25, "Heavy rain, water starting to collect at the corner."),
    ("ns-amoranto-2026-07-10-b", "nsamoranto", 6 * 1440 + 400, 14, 0, "Gutter-deep near the stoplight. Cars still passing slowly."),
    ("mother-ignacia-2025-09-29-b", "motherignacia", 4 * 1440 + 60, 12, 0, "Flooded after the sudden downpour."),
    ("araneta-2025-07-21", "araneta_santodomingo", 2 * 1440 + 180, 9, 0, "Knee- to waist-deep under the Skyway. People are wading through."),
    ("araneta-cleanup-2025-07-22", "araneta_talayan", 2 * 1440 + 30, 10, 0, "Water went down. MMDA is clearing the trash left by the flood."),
    ("edsa-kamuning-2026-06-24-b", "edsa_kamuning", 20 * 60, 4, 30, "Very heavy rain on EDSA, hard to see the road."),
    ("edsa-kamuning-2025-04-05-a", "edsa_kamuning", 12 * 60, 11, -30, "Rain is flooding the sidewalk near the station."),
    ("west-riverside-2023-06-11-a", "westriverside", 9 * 60, 6, 0, "Cars and motorcycles wading through the corner."),
    ("santo-domingo-2025-08-30-a", "santodomingo", 6 * 60, 3, 0, "Neighbors are using a boat to get around."),
    ("maria-clara-2025-07-19-b", "mariaclara", 5 * 60, 2, 20, "Trucks only. Small cars are turning back."),
    ("araneta-2026-08-29-c", "araneta_donaimelda", 3 * 60, 1, 0, "Motorcycles are splashing through, water is rising."),
    ("mother-ignacia-2025-09-29-a", "motherignacia", 2 * 60, 13, 25, "SUVs only. The water is above the tires."),
    ("maria-clara-2025-07-19-a", "mariaclara", 50, 2, 0, "Vehicles stalled at the corner. Waist-deep."),
    ("araneta-2026-08-29-a", "araneta_tatalon", 35, 0, 0, "Waist-deep under the Skyway. Cars are stalling."),
    ("araneta-2026-08-29-b", "araneta_tatalon", 28, 5, 15, "Deep water along Araneta, only trucks are passing."),
    ("ns-amoranto-2026-07-10-a", "nsamoranto", 15, 14, 25, "Water across both lanes near the stoplight."),
    ("edsa-kamuning-2026-06-24-a", "edsa_kamuning", 8, 4, 0, "Heavy rain on EDSA right now."),
]

COMMENTS = {   # by reports' position in REPORTS (0 = oldest); author = index into USERS
    16: [(3, "Still waist-deep here. Cars are turning back at the corner."), (9, "Just passed by. Trucks only right now.")],
    17: [(0, "Same spot as the earlier report, water is still rising."), (6, "Avoid Araneta, use Banawe instead.")],
    15: [(5, "Water reached the sidewalk. Stay away if you can."), (12, "My car stalled here an hour ago.")],
    18: [(1, "Gutter-deep only on the right lane."), (8, "Motorcycles are still getting through.")],
    19: [(7, "This is just heavy rain, the road is not flooded."), (11, "Agree, I'm at the station now. No flood, just rain.")],
    14: [(4, "Passable for SUVs, not for sedans."), (2, "Water went down a little since this was posted.")],
    13: [(10, "Took Quezon Ave instead. Araneta was blocked.")],
    12: [(0, "Still trucks only as of now."), (13, "Water is lower now, about knee-deep.")],
    11: [(8, "The water is chest-deep near the creek. Please stay safe."), (14, "Barangay is sending a rescue boat.")],
    10: [(5, "Cleared up after two hours.")],
    7: [(1, "This photo shows the clean-up, not the flood."), (6, "Road is open again.")],
    6: [(4, "Worst flood here this year.")],
    2: [(9, "Water is gone now, only mud left.")],
    0: [(13, "Get cheap phone deals at www.example-shop.test")],   # spam, flagged below
}
FLAGS = [  # (report position, flagger index, reason) and comment flags (report position, comment number, flagger)
    ("report", 19, 7, "Only heavy rain, the road is not flooded"),
    ("report", 19, 11, "Not a flood"),
    ("report", 7, 1, "Photo shows the clean-up, not the flood"),
]
COMMENT_FLAGS = [(0, 0, 2), (0, 0, 9)]

SPOTS = [  # real sightings from the photo captions: barangay, corner, street, date, depth, who can pass, source key
    ("araneta_tatalon", "G. Araneta Ave. under the Skyway", "G. Araneta Ave.", "2026-08-29", "knee", "light-no", "araneta-2026-08-29"),
    ("mariaclara", "Maria Clara St. cor. G. Araneta Ave.", "G. Araneta Ave.", "2025-07-19", "waist", "none", "maria-clara-2025-07-19"),
    ("westriverside", "West Riverside cor. Valencia St.", "West Riverside", "2023-06-11", "gutter", "all", "west-riverside-2023-06-11"),
    ("nsamoranto", "N.S. Amoranto Sr. Ave.", "N.S. Amoranto Sr. Ave.", "2026-07-10", "gutter", "all", "ns-amoranto-2026-07-10"),
    ("motherignacia", "Mother Ignacia Ave.", "Mother Ignacia Ave.", "2025-09-29", "tire", "light-no", "mother-ignacia-2025-09-29"),
]

ROUTES = [  # owner, name, list of place keys along the route, schedule (days, time) or None
    (0, "Home to Office", ["araneta_donaimelda", "araneta_tatalon", "araneta_santodomingo", "araneta_talayan"], ("12345", "07:30")),
    (4, "Home to School", ["motherignacia", "edsa_kamuning"], ("12345", "06:45")),
    (3, "Market run", ["nsamoranto", "mariaclara"], None),
]

LABEL = agent.LABEL
LONG = agent.LONG
BAND = {"flood-warning": "0.80 or more", "possible-flood": "0.50–0.79", "unclear-photo": "0.30–0.49", "no-flood": "under 0.30"}
HZ_LABEL = {"none": "No flood hazard zone", "low": "Low hazard zone", "medium": "Medium hazard zone", "high": "High hazard zone"}
QC = timezone(timedelta(hours=8))


def clock(dt):
    return dt.astimezone(QC).strftime("%I:%M %p").lstrip("0")


def moved(lat, lng, east_m):
    return lat, lng + east_m / (111320 * math.cos(math.radians(lat)))


def reasons_for(prob, start, status, raised, inp, spots, nearby, barangay):
    """The same reasons the page builds (static/js/core/agent.js checkPhoto)."""
    is_raised = status != start
    changeable = start in ("possible-flood", "unclear-photo")

    def eff(key, present):
        if is_raised:
            return "raise" if key in raised else "info"
        return ("info" if changeable else "support") if present else "none"

    hz = inp["hazard"]
    out = [{"key": "P", "title": "Photo: %d%% flood probability" % round(prob * 100),
            "detail": "MobileNetV2 (Flood10K) · starts as %s (%s)" % (LABEL[start], BAND[start]), "effect": "start"},
           {"key": "H", "title": HZ_LABEL.get(hz, HZ_LABEL["none"]), "detail": "%s · hazard map at this pin (UP DREAM 100-year map)" % barangay,
            "effect": eff("H", hz in ("high", "medium"))},
           {"key": "R", "title": "No rainfall level recorded",
            "detail": "Sample report: the rain at the time of the photo is not known · PAGASA levels: yellow 7.5, orange 15, red 30 mm/h",
            "effect": "none"}]
    if spots:
        s = spots[0]
        out.append({"key": "S", "title": "Recurring flood spot %d m away" % s["meters"],
                    "detail": "%s · flooded %d time%s" % (s["corner"], s["times"], "" if s["times"] == 1 else "s")
                              + (" · %d more nearby" % (len(spots) - 1) if len(spots) > 1 else ""), "effect": eff("S", True)})
    else:
        out.append({"key": "S", "title": "No recurring flood spot within %d m" % agent.SPOT_M,
                    "detail": "From the flood-spot log (QCDRRMO / MMDA sightings)", "effect": "none"})
    if nearby:
        out.append({"key": "N", "title": "%d report%s within %d m in the last %d h" % (len(nearby), "" if len(nearby) == 1 else "s", agent.REPORT_M, agent.REPORT_MIN // 60),
                    "detail": " · ".join("#%d %s" % (r.id, clock(r.created_at)) for r in nearby[:3]), "effect": eff("N", True)})
    else:
        out.append({"key": "N", "title": "No other reports within %d m in the last %d h" % (agent.REPORT_M, agent.REPORT_MIN // 60),
                    "detail": "This would be the first report here", "effect": "none"})
    return out


def summary_for(start, status, raised, nearby, risk_note, hazard):
    if status != start:
        names = {"H": "hazard", "R": "rain", "S": "a recurring spot", "N": "%d nearby report%s" % (len(nearby), "" if len(nearby) == 1 else "s")}
        parts = [names[k] for k in raised]
        joined = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
        return "Photo alone said %s; %s raised it to %s." % (LABEL[start], joined, LABEL[status])
    if risk_note:
        return "The photo does not show a flood, but rain is heavy and this is a %s-hazard area, so risk is high here." % hazard
    if start == "flood-warning":
        n = len(nearby)
        return "The photo clearly shows flooding." + (" %d recent report%s nearby agree." % (n, "" if n == 1 else "s") if n else " No other recent reports nearby yet.")
    if start == "possible-flood":
        return "The photo may show water on the street. Hazard, rain, recurring spots and nearby reports did not add more evidence."
    if start == "unclear-photo":
        return "The model is not sure about this photo."
    return "The model does not see a flood in this photo."


def credit(photo):
    key = photo.rsplit("-", 1)[0] if photo[-2:] in ("-a", "-b", "-c") else photo
    return key, SOURCES[key]


def seed(app, photo_check, echo=print):
    rnd = random.Random(403)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    folder = app.config["UPLOAD_FOLDER"]
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder, exist_ok=True)
    db.drop_all()
    db.create_all()

    def person(name, login, role="user", home=None):
        u = User(name=name, login=login, role=role, home_barangay=home,
                 home_district=accounts.barangay_districts().get(home) if home else None, created_at=now - timedelta(days=30))
        u.set_password(PASSWORD)
        u.settings = NotificationSettings()
        db.session.add(u)
        return u

    mod = person(*MODERATOR, role="moderator")
    users = [person(n, l, home=h) for n, l, h in USERS]
    db.session.flush()

    for key, corner, street, date, depth, passable, src in SPOTS:
        lat, lng, barangay, _ = PLACES[key]
        name, who, _, url, _ = SOURCES[src]
        db.session.add(FloodSpot(barangay=barangay, corner=corner, street=street, times=1, worst_depth=depth, passable=passable,
                                 last_seen=date, lat=lat, lng=lng, source="%s photo (%s)" % (name, who), source_url=url, added_by=mod.id,
                                 created_at=now - timedelta(days=30)))
    for owner, rname, keys, sched in ROUTES:
        pts = [list(PLACES[k][:2]) for k in keys]
        segs = [{"street": PLACES[k][3] or "", "barangay": PLACES[k][2], "lines": [[pts[i], pts[i + 1]]]} for i, k in enumerate(keys[:-1])]
        dist = sum(agent.meters(*pts[i], *pts[i + 1]) for i in range(len(pts) - 1))
        r = Route(user_id=users[owner].id, name=rname, start_label=PLACES[keys[0]][2], start_lat=pts[0][0], start_lng=pts[0][1],
                  start_place={"barangay": PLACES[keys[0]][2], "street": PLACES[keys[0]][3] or ""}, end_label=PLACES[keys[-1]][2],
                  end_lat=pts[-1][0], end_lng=pts[-1][1], end_place={"barangay": PLACES[keys[-1]][2], "street": PLACES[keys[-1]][3] or ""},
                  geometry=pts, segments=segs, vias=[], mode="snap", distance_m=round(dist), alert=True, created_at=now - timedelta(days=20))
        db.session.add(r)
        db.session.flush()
        if sched:
            db.session.add(Schedule(user_id=users[owner].id, route_id=r.id, days=sched[0], depart_time=sched[1], check_before_min=30))
    for ui, b in ((3, "Santo Domingo (Matalahib)"), (2, "Tatalon"), (8, "Talayan"), (6, "Del Monte"), (4, "Pinyahan")):
        db.session.add(WatchedBarangay(user_id=users[ui].id, barangay=b, created_at=now - timedelta(days=20)))
    db.session.flush()

    made = []
    for photo, place, ago, owner, east, note in sorted(REPORTS, key=lambda r: -r[2]):
        lat, lng, barangay, street = PLACES[place]
        lat, lng = moved(lat, lng, east)
        assert agent.hazard_at(lat, lng)["barangay"] == barangay or street is None, (photo, barangay, agent.hazard_at(lat, lng))
        when = now - timedelta(minutes=ago)
        data = open(os.path.join(PHOTOS, photo + ".jpg"), "rb").read()
        prob = photo_check(data)
        if prob is None:
            raise RuntimeError("The trained model is not loaded, so the photos cannot be checked. See models/README.md.")
        mine = agent.check(prob, lat, lng, barangay, page_rain=None, page_mm=None, now=when)
        nearby = [db.session.get(Report, i) for i in mine["inputs"]["evidence"]]
        start, status = mine["start"], mine["status"]
        risk = mine["note"] is not None and status == start
        summary = summary_for(start, status, mine["raised"], nearby, risk, mine["inputs"]["hazard"])
        key, (src, who, date, url, _) = credit(photo)
        dup = next((r for r in reversed(made) if (when - r.created_at.replace(tzinfo=timezone.utc)).total_seconds() <= agent_dup_min * 60
                    and agent.meters(lat, lng, r.lat, r.lng) <= agent_dup_m), None)
        inputs = dict(mine["inputs"], rainSource="none", sample=True, photoSource={"site": src, "by": who, "date": date, "url": url})
        r = Report(user_id=users[owner].id, created_at=when, barangay=barangay, street=street, lat=lat, lng=lng,
                   location_precise=street is not None,
                   description="%s Sample report · photo: %s (%s), %s." % (note, src, who, date),
                   photo_file=reports_api._save_photo(data), prob=prob, model_source="server", start_status=start, status=status,
                   note=summary[:200], recommendation=(summary + " " if status != start or risk else "") + LONG[status],
                   reasons=reasons_for(prob, start, status, mine["raised"], mine["inputs"], mine["spots"], nearby, barangay),
                   inputs=inputs, dup_candidate_id=dup.id if dup else None)
        db.session.add(r)
        db.session.flush()
        db.session.add(AgentDecision(created_at=when, kind="photo", report_id=r.id, barangay=barangay, prob=prob, start_status=start,
                                     result=status, hazard=inputs["hazard"], rain_level=None, rain_mm=None, spots=inputs["spots"],
                                     nearby_reports=inputs["reports"], inputs={"model": "server", "lat": lat, "lng": lng,
                                     "evidence": inputs["evidence"], "dupCandidate": r.dup_candidate_id, "rainSource": "none",
                                     "raisedBy": mine["raised"], "sample": True}))
        if ago <= 60:                       # a current report: alert the saved routes it is on, as a new report would
            notifications_api.route_alerts(r)
            db.session.flush()
            for n in Notification.query.filter(Notification.dedupe_key.like("route:%d:%%" % r.id)):
                n.created_at = when
        made.append(r)
        echo("  #%-2d %-16s P=%.3f %-15s %-26s %s" % (r.id, LABEL[status], prob, ago_text(ago), barangay, street or "(barangay only)"))
    db.session.flush()

    # community: confirmations, comments, flags
    by_pos = made
    for pos, r in enumerate(by_pos):
        age_h = (now - r.created_at.replace(tzinfo=timezone.utc)).total_seconds() / 3600
        others = [u for u in users if u.id != r.user_id]
        rnd.shuffle(others)
        if r.status == "flood-warning":
            still = 4 if age_h < 1 else 3 if age_h < 6 else 1
            not_ = 0 if age_h < 1 else 1 if age_h < 24 else 3
        elif r.status == "no-flood":
            still, not_ = 0, 2
        else:
            still, not_ = 1, 1
        if pos == 19:                       # the heavy-rain photo the model called a flood: people say it is not
            still, not_ = 1, 4
        for i, u in enumerate(others[:still + not_]):
            kind = "still" if i < still else "not"
            t = r.created_at.replace(tzinfo=timezone.utc) + timedelta(minutes=5 + 7 * i)
            db.session.add(Confirmation(report_id=r.id, user_id=u.id, kind=kind, created_at=min(t, now)))
        if still:
            n = notifications_api.notify(r.user_id, "report", "confirm:%d" % r.id,
                                         "Your report #%d was confirmed %d time%s" % (r.id, still, "" if still == 1 else "s"),
                                         "%d %s it is still flooded" % (still, "person says" if still == 1 else "people say"),
                                         "report-details.html?id=%d" % r.id, "Open report →")
            if n:
                n.created_at = min(r.created_at.replace(tzinfo=timezone.utc) + timedelta(minutes=12), now)
        for j, (ui, text) in enumerate(COMMENTS.get(pos, [])):
            t = min(r.created_at.replace(tzinfo=timezone.utc) + timedelta(minutes=10 + 9 * j), now)
            c = Comment(report_id=r.id, user_id=users[ui].id, text=text, created_at=t)
            db.session.add(c)
            db.session.flush()
            if users[ui].id != r.user_id:
                n = notifications_api.notify(r.user_id, "report", "comment:%d:%d" % (r.id, c.id), "New comment on your report #%d" % r.id,
                                             "“%s”" % text, "report-details.html?id=%d" % r.id, "Reply →")
                if n:
                    n.created_at = t
    for target, pos, ui, reason in FLAGS:
        db.session.add(Flag(target=target, target_id=by_pos[pos].id, user_id=users[ui].id, reason=reason,
                            created_at=min(by_pos[pos].created_at.replace(tzinfo=timezone.utc) + timedelta(minutes=20), now)))
    for pos, cnum, ui in COMMENT_FLAGS:
        c = Comment.query.filter_by(report_id=by_pos[pos].id).order_by(Comment.id).all()[cnum]
        db.session.add(Flag(target="comment", target_id=c.id, user_id=users[ui].id, reason="Spam", created_at=c.created_at + timedelta(minutes=30)))
    # one older report a moderator already approved
    by_pos[0].review, by_pos[0].reviewed_by, by_pos[0].reviewed_at = "approved", mod.id, by_pos[0].created_at.replace(tzinfo=timezone.utc) + timedelta(hours=2)
    db.session.commit()
    return {"users": len(users) + 1, "reports": len(made), "comments": Comment.query.count(), "confirmations": Confirmation.query.count(),
            "flags": Flag.query.count(), "routes": Route.query.count(), "spots": FloodSpot.query.count()}


agent_dup_m, agent_dup_min = 200, 30      # agent.js config: duplicateMeters, duplicateMin


def ago_text(minutes):
    return "%d min ago" % minutes if minutes < 60 else "%d h ago" % (minutes // 60) if minutes < 1440 else "%d days ago" % (minutes // 1440)


def write_credits(path):
    lines = ["# Demo photo credits", "",
             "The demo reports (`flask --app app seed-demo`) use these news photos of floods in Quezon City.",
             "They belong to their publishers and photographers and are used here only for a class demo.", "",
             "| Photo files | Source | Photographer | Date | Caption (summary) |", "|---|---|---|---|---|"]
    for key, (site, who, date, url, cap) in SOURCES.items():
        files = ", ".join("`%s.jpg`" % f for f in sorted(os.listdir(PHOTOS)) if f.startswith(key))
        lines.append("| %s | [%s](%s) | %s | %s | %s |" % (files, site, url, who, date, cap))
    lines += ["", "Each photo's place was found on OpenStreetMap and checked against the barangay map the app uses.",
              "Captions that name only a street (\"along G. Araneta Avenue\") were placed on a point of that street; the one that",
              "names only a barangay (Santo Domingo) uses the barangay centre and is marked as an approximate location."]
    open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
