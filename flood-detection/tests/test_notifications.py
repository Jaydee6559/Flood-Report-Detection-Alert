"""Notifications (step 6): made on the server for other people, settings, read state, watched barangays."""
from conftest import ROUTE

FAR = dict(ROUTE, name="Far route", startPoint={"lat": 14.60, "lng": 121.00}, endPoint={"lat": 14.61, "lng": 121.01},
           geometry=[[14.60, 121.00], [14.61, 121.01]], segments=[])


def test_route_alerts(make_user):
    ana, ben, cara = make_user("Ana Reyes"), make_user("Ben Cruz"), make_user("Cara Lim")
    route = ben.post("/api/routes", json=ROUTE).json["route"]["id"]
    cara.post("/api/routes", json=FAR)
    muted = cara.post("/api/routes", json=dict(ROUTE, name="Muted")).json["route"]["id"]
    cara.post("/api/routes/%d/alert" % muted, json={"alert": False})
    cara.post("/api/routes", json=dict(ROUTE, name="Not placed", geometry=None))

    ana.report()                                                      # a precise flood warning on Tandang Sora
    n = ben.notes()
    assert len(n) == 1 and n[0]["title"] == "Flood warning on Home to School" and n[0]["href"] == "routes.html?id=%d" % route
    assert n[0]["text"].startswith("Tandang Sora Ave., Culiat")
    assert cara.notes() == [] and ana.notes() == []                   # far, muted, unplaced; no routes
    ana.report(location="approximate")
    ana.report(status="no-flood", startStatus="no-flood", prob=0.1)
    assert len(ben.notes()) == 1                                      # neither raises a route alert


def test_the_reporter_is_told(make_user, moderator):
    ana, ben, cara = make_user("Ana Reyes"), make_user("Ben Cruz"), make_user("Cara Lim")
    rid = ana.report().json["report"]["id"]
    ben.post("/api/reports/%d/confirm" % rid, json={"kind": "still"})
    assert ana.notes()[0]["title"] == "Your report #%d was confirmed 1 time" % rid
    cara.post("/api/reports/%d/confirm" % rid, json={"kind": "not"})
    cara.post("/api/reports/%d/confirm" % rid, json={"kind": "still"})          # not -> still counts too
    assert len(ana.notes()) == 1 and "2 times" in ana.notes()[0]["title"]      # one notification, refreshed
    cara.post("/api/reports/%d/confirm" % rid, json={"kind": "still"})          # taken back: nothing new
    assert "2 times" in ana.notes()[0]["title"]

    ben.post("/api/reports/%d/comments" % rid, json={"text": "Still knee-deep"})
    assert ana.notes()[0]["text"] == "“Still knee-deep”"
    ana.post("/api/reports/%d/comments" % rid, json={"text": "Thanks"})
    assert len(ana.notes()) == 2                                                 # not for your own comment

    moderator.post("/api/reports/%d/review" % rid, json={"action": "remove", "reason": "Wrong place"})
    assert (ana.notes()[0]["title"], ana.notes()[0]["text"]) == ("Your report #%d was removed" % rid, "Wrong place")


def test_settings_turn_kinds_off(make_user):
    ana, ben = make_user("Ana Reyes"), make_user("Ben Cruz")
    rid = ana.report().json["report"]["id"]
    s = ana.post("/api/notifications/settings", json={"reports": False}).json["settings"]
    assert s == {"route": True, "area": True, "schedule": True, "reports": False, "clear": False}
    ben.post("/api/reports/%d/comments" % rid, json={"text": "Water rising"})
    assert ana.notes() == []
    r = ana.post("/api/notifications", json={"kind": "schedule", "clear": True, "key": "clear:1", "title": "No recent reports"})
    assert r.json["notification"] is None                                       # "all clear" is off by default


def test_own_notifications_and_read_state(make_user, guest):
    ana, ben = make_user("Ana Reyes"), make_user("Ben Cruz")
    ok = ana.post("/api/notifications", json={"kind": "schedule", "key": "set:1", "title": "Check set", "href": "schedules.html"})
    assert ok.json["notification"]["href"] == "schedules.html"
    bad = ana.post("/api/notifications", json={"kind": "schedule", "key": "x", "title": "Click", "href": "javascript:alert(1)", "cta": "Go"})
    assert bad.json["notification"]["href"] == "" and bad.json["notification"]["cta"] == ""
    assert ana.post("/api/notifications", json={"kind": "spam", "title": "x"}).status_code == 400
    assert guest.post("/api/notifications", json={"kind": "schedule", "title": "x"}).status_code == 401

    ben.post("/api/notifications", json={"kind": "schedule", "title": "Ben's"})
    assert ana.get("/api/notifications").json["unread"] == 2
    ana.post("/api/notifications/read", json={"ids": [ana.notes()[0]["id"], ben.notes()[0]["id"]]})
    assert ana.get("/api/notifications").json["unread"] == 1 and ben.notes()[0]["read"] is False
    ana.post("/api/notifications/read", json={"all": True})
    assert ana.get("/api/notifications").json["unread"] == 0


def test_watched_barangays(make_user):
    ana, ben = make_user("Ana Reyes"), make_user("Ben Cruz")
    assert ana.post("/api/watch", json={"barangay": "Bahay Toro", "on": True}).json["watch"] == ["Bahay Toro"]
    assert ana.post("/api/watch", json={"barangay": "Makati", "on": True}).status_code == 400
    ana.post("/api/watch", json={"barangay": "Bahay Toro", "on": True})
    assert ana.post("/api/watch", json={"barangay": "Culiat", "on": True}).json["watch"] == ["Bahay Toro", "Culiat"]
    assert ana.post("/api/watch", json={"barangay": "Bahay Toro", "on": False}).json["watch"] == ["Culiat"]
    assert ben.script("/api/my.js", "FDA_MY")["watch"] == []
