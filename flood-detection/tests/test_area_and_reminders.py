"""The server's 15-minute area rain check (Rule 2) and "Remind me" reminders."""
from datetime import datetime, timedelta, timezone

import jobs
from database import AgentDecision, AreaState, Reminder, db

NOW = datetime(2026, 11, 3, 10, 0, tzinfo=timezone.utc)


def rain(mm):
    """The same rain (mm/h now) in all 6 districts."""
    return {d: [mm, 0, 0, 0] for d in range(1, 7)}


def high_hazard_barangay():
    return next(name for name, _, hazard in jobs.reference()["barangays"] if hazard == "high")


def low_and_no_spots():
    spots = jobs.reference()["seed_spots"]
    return next(name for name, _, hazard in jobs.reference()["barangays"] if hazard in ("low", "none") and not spots.get(name))


def area_notes(c):
    return [n for n in c.notes() if n["kind"] == "area"]


def test_rule_2_table():
    assert jobs.area_risk("high", "orange", 0) == "high"
    assert jobs.area_risk("low", "red", 2) == "high"            # a recurring spot is enough
    assert jobs.area_risk("low", "red", 0) == "elevated"
    assert jobs.area_risk("medium", "yellow", 0) == "elevated"
    assert jobs.area_risk("low", "yellow", 0) == "low"
    assert jobs.area_risk("high", None, 5) == "low"
    assert [jobs.rain_level(x) for x in (0, 7.5, 15, 30)] == [None, "yellow", "orange", "red"]


def test_area_check_logs_changes_and_alerts_watchers(app, make_user):
    name = high_hazard_barangay()
    ana, ben, cara = make_user("Ana Reyes"), make_user("Ben Cruz", barangay=name), make_user("Cara Lim")
    ana.post("/api/watch", json={"barangay": name, "on": True})
    cara.post("/api/watch", json={"barangay": name, "on": True})
    cara.post("/api/notifications/settings", json={"area": False})

    with app.app_context():
        res = jobs.run_area_check(NOW, rain=rain(20))           # orange rain everywhere
        assert res["changed"] == 142
        assert AreaState.query.count() == 142 and db.session.get(AreaState, name).level == "high"
        logged = AgentDecision.query.filter_by(kind="area").all()
        assert logged and all(d.result != "low" for d in logged)                 # the first run only logs non-low levels
        d = AgentDecision.query.filter_by(kind="area", barangay=name).one()
        assert (d.rain_level, d.rain_mm, d.hazard, d.inputs["rainSource"]) == ("orange", 20, "high", "live")

    a = area_notes(ana)
    assert len(a) == 1 and a[0]["title"] == "Orange rain over District %s · %s is high risk" % (
        next(dd for n, dd, _ in jobs.reference()["barangays"] if n == name), name)
    assert a[0]["href"].startswith("areas.html?b=")
    assert area_notes(ben)[0]["title"].endswith("your home barangay is high risk")      # home barangay, no "Alert me" needed
    assert area_notes(cara) == []                                                        # area alerts turned off

    with app.app_context():
        assert jobs.run_area_check(NOW + timedelta(minutes=15), rain=rain(20))["changed"] == 0   # nothing changed: nothing new
        assert jobs.run_area_check(NOW + timedelta(minutes=30), rain=rain(0))["changed"] > 0     # dry again
        assert db.session.get(AreaState, name).level == "low"
        assert AgentDecision.query.filter_by(kind="area", barangay=name).count() == 2           # the change back is logged too
    assert len(area_notes(ana)) == 1


def test_low_risk_barangay_never_alerts(app, make_user):
    name = low_and_no_spots()
    ana = make_user()
    ana.post("/api/watch", json={"barangay": name, "on": True})
    with app.app_context():
        jobs.run_area_check(NOW, rain=rain(20))
        assert db.session.get(AreaState, name).level == "elevated"        # orange rain, low hazard, no spot
    assert area_notes(ana) == []


def test_no_live_rain_means_no_check(app, monkeypatch):
    def offline(timeout=20):
        raise OSError("no internet")
    monkeypatch.setattr(jobs, "fetch_rain", offline)
    with app.app_context():
        assert jobs.run_area_check(NOW) is None
        assert AreaState.query.count() == 0                                # no made-up rain, no levels


# ---- Reminders --------------------------------------------------------------------------------------
def ms(dt):
    return int(dt.timestamp() * 1000)


def test_reminders(app, make_user, guest):
    ana, ben = make_user("Ana Reyes"), make_user("Ben Cruz")
    soon = datetime.now(timezone.utc) + timedelta(minutes=10)
    body = {"at": ms(soon), "title": "Time to leave soon: Home to School", "text": "Check Tandang Sora first.", "href": "routes.html?id=1"}
    assert guest.post("/api/reminders", json=body).status_code == 401
    assert ana.post("/api/reminders", json=dict(body, title=" ")).status_code == 400
    assert ana.post("/api/reminders", json=dict(body, at=ms(soon - timedelta(hours=1)))).status_code == 400
    assert ana.post("/api/reminders", json=dict(body, at=ms(soon + timedelta(days=8)))).status_code == 400
    r = ana.post("/api/reminders", json=body)
    assert r.status_code == 200 and abs(r.json["reminder"]["at"] - ms(soon)) < 1000

    with app.app_context():
        assert jobs.run_reminders(soon - timedelta(minutes=1)) == 0                 # not yet
        assert jobs.run_reminders(soon + timedelta(seconds=30)) == 1
        assert jobs.run_reminders(soon + timedelta(minutes=2)) == 0                 # only once
        assert Reminder.query.one().done
    n = [x for x in ana.notes() if x["key"].startswith("remind:")]
    assert len(n) == 1 and n[0]["title"] == "Time to leave soon: Home to School" and n[0]["href"] == "routes.html?id=1"
    assert ben.notes() == []


def test_reminder_limit(app, make_user):
    ana = make_user()
    at = ms(datetime.now(timezone.utc) + timedelta(hours=1))
    for _ in range(20):
        assert ana.post("/api/reminders", json={"at": at, "title": "x"}).status_code == 200
    assert ana.post("/api/reminders", json={"at": at, "title": "x"}).status_code == 400
