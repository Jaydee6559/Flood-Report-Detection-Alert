"""Rate limits, the flood-spot log on the server, and the server's pre-departure check."""
from datetime import datetime, timedelta, timezone

import pytest

import jobs
import limits
from conftest import PASSWORD, ROUTE, Client
from database import Report, Schedule, db

QC = timezone(timedelta(hours=8))


# ---- Rate limits ----------------------------------------------------------------------------------
def test_too_many_wrong_passwords(make_user, app, monkeypatch):
    make_user("Ana Reyes", login="ana@example.com")
    app.config["RATE_LIMITS"] = True
    monkeypatch.setitem(limits.RULES, "login", (3, 900))
    c = Client(app)
    for _ in range(3):
        assert c.post("/api/auth/login", json={"login": "ana@example.com", "password": "nope"}).status_code == 401
    r = c.post("/api/auth/login", json={"login": "ana@example.com", "password": PASSWORD})
    assert r.status_code == 429 and "Wait 15 minutes" in r.json["error"]     # even the right password, for now


def test_too_many_reports_and_comments(make_user, app, monkeypatch):
    ana, ben = make_user("Ana Reyes"), make_user("Ben Cruz")
    app.config["RATE_LIMITS"] = True
    monkeypatch.setitem(limits.RULES, "report", (2, 600))
    monkeypatch.setitem(limits.RULES, "comment", (2, 600))
    assert ana.report(barangay="Makati").status_code == 400                  # a refused report does not count
    assert ana.report().status_code == 200 and ana.report().status_code == 200
    r = ana.report()
    assert r.status_code == 429 and "too often" in r.json["error"]
    assert ben.report().status_code == 200                                    # per account
    for expected in (200, 200, 429):
        assert ben.post("/api/reports/1/comments", json={"text": "hi"}).status_code == expected


def test_limits_are_off_in_the_other_tests(make_user):
    ana = make_user()
    for _ in range(12):
        assert ana.report().status_code == 200


# ---- The flood-spot log ----------------------------------------------------------------------------
SPOT = {"barangay": "Culiat", "corner": "Tandang Sora cor. Mindanao", "date": "2026-10-01", "depth": "knee", "pass": "light-no",
        "lat": 14.667, "lng": 121.052}


def test_flood_spot_log(make_user, moderator, guest):
    ana = make_user()
    assert ana.post("/api/spots", json=SPOT).status_code == 403
    s = moderator.post("/api/spots", json=SPOT).json["spot"]
    assert s["id"] == "L1" and s["times"] == 1 and s["street"] == "Tandang Sora"
    again = moderator.post("/api/spots", json=dict(SPOT, corner="TANDANG SORA cor. Mindanao", date="2026-10-20", depth="waist")).json
    assert again["again"] and again["spot"]["times"] == 2 and again["spot"]["depth"] == "waist" and again["spot"]["last"] == "2026-10-20"
    assert moderator.post("/api/spots", json=dict(SPOT, depth="knee", date="2026-09-01")).json["spot"]["depth"] == "waist"   # worst kept

    for bad in ({"barangay": "Makati"}, {"corner": ""}, {"date": "yesterday"}, {"depth": "deep"}, {"lat": 10.0}, {"url": "ftp://x"}):
        assert moderator.post("/api/spots", json=dict(SPOT, **bad)).status_code == 400
    assert [x["times"] for x in guest.script("/api/spots.js", "FDA_SPOTS_LOG")] == [3]

    assert ana.post("/api/spots/1/delete").status_code == 403
    assert moderator.post("/api/spots/1/delete").status_code == 200
    assert guest.script("/api/spots.js", "FDA_SPOTS_LOG") == []


# ---- The server's pre-departure check -------------------------------------------------------------------
def at(hh, mm, day=(2026, 11, 3)):
    """A moment in Quezon City time (3 Nov 2026 is a Tuesday) as UTC."""
    return datetime(*day, hh, mm, tzinfo=QC).astimezone(timezone.utc)


@pytest.fixture
def commuter(make_user, app):
    """Ben has a route along Tandang Sora and a weekday 06:45 schedule, checked 30 min before."""
    ben = make_user("Ben Cruz")
    rid = ben.post("/api/routes", json=ROUTE).json["route"]["id"]
    sid = ben.post("/api/schedules", json={"routeId": rid, "days": [1, 2, 3, 4, 5], "time": "06:45", "before": 30}).json["schedule"]["id"]
    ben.post("/api/notifications", json={"kind": "schedule", "title": "ignore"})   # (makes sure settings exist)
    ben.post("/api/notifications/read", json={"all": True})
    return ben, sid


def report_at(app, client, when, **over):
    rid = client.report(**over).json["report"]["id"]
    with app.app_context():
        db.session.get(Report, rid).created_at = when
        db.session.commit()
    return rid


def run(app, when):
    with app.app_context():
        return jobs.run_due_checks(when)


def schedule_notes(c):
    return [n for n in c.notes() if n["kind"] == "schedule" and n["title"] != "ignore"]


def test_warns_before_the_trip(app, commuter, make_user):
    ben, sid = commuter
    ana = make_user("Ana Reyes")
    report_at(app, ana, at(6, 5))                       # a flood warning on Tandang Sora, 10 min before the check
    assert run(app, at(6, 10)) == 0                     # not due yet (due 06:15)
    assert run(app, at(6, 15)) == 1
    n = schedule_notes(ben)
    assert len(n) == 1 and n[0]["title"] == "Flood warning before your 6:45 AM trip · Home to School"
    assert n[0]["text"] == "Tandang Sora Ave., Culiat · reported 10 min ago" and n[0]["key"] == "check:%d:2026-11-3" % sid
    assert run(app, at(6, 16)) == 0                     # once a day
    assert ben.script("/api/my.js", "FDA_MY")["schedules"][0]["lastCheck"] == "2026-11-3"


def test_all_clear_only_when_turned_on(app, commuter):
    ben, sid = commuter
    assert run(app, at(6, 20)) == 1
    assert schedule_notes(ben) == []                     # "all clear" is off by default
    ben.post("/api/notifications/settings", json={"clear": True})
    with app.app_context():
        db.session.get(Schedule, sid).last_check_at = None
        db.session.commit()
    run(app, at(6, 21))
    assert [n["title"] for n in schedule_notes(ben)] == ["No recent reports on Home to School"]


def test_skips_old_reports_wrong_days_late_checks_and_paused(app, commuter, make_user):
    ben, sid = commuter
    ana = make_user("Ana Reyes")
    report_at(app, ana, at(4, 0))                        # over an hour old: may be outdated, no warning
    assert run(app, at(6, 30, day=(2026, 11, 1))) == 0   # Sunday: not a schedule day
    assert run(app, at(8, 0)) == 0                       # more than an hour after the 6:45 departure: skipped...
    with app.app_context():
        assert jobs.day_key(db.session.get(Schedule, sid).last_check_at) == "2026-11-3"   # ...but marked for today
        db.session.get(Schedule, sid).last_check_at = None
        db.session.commit()
    ben.post("/api/schedules/%d/enabled" % sid, json={"enabled": False})
    assert run(app, at(6, 30)) == 0
    assert schedule_notes(ben) == []


def test_possible_flood_near_the_route(app, commuter, make_user):
    ben, sid = commuter
    ana = make_user("Ana Reyes")
    report_at(app, ana, at(6, 0), lat=14.669, lng=121.0565, street="Visayas Ave.")   # about 300 m off the route
    run(app, at(6, 15))
    assert schedule_notes(ben)[0]["title"].startswith("Possible flood before your 6:45 AM trip")
