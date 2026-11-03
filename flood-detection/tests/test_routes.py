"""Saved routes and travel schedules (step 5), and adding columns to an older database."""
import re

import pytest
from sqlalchemy import inspect, text

from conftest import ROUTE
from database import Route, Schedule, add_missing_columns, db


def mine(c):
    d = c.script("/api/my.js", "FDA_MY")
    return d["routes"], d["schedules"]


def test_route_is_saved_and_private(make_user, guest):
    ana, ben = make_user("Ana Reyes"), make_user("Ben Cruz")
    assert guest.post("/api/routes", json=ROUTE).status_code == 401
    rt = ana.post("/api/routes", json=ROUTE).json["route"]
    assert rt["userId"] == ana.me["id"] and rt["alert"] is True
    assert rt["startPoint"]["street"] == "Tandang Sora Ave." and len(rt["geometry"]) == 2
    assert [r["id"] for r in mine(ana)[0]] == [rt["id"]] and mine(ben)[0] == []
    for url in ("/api/routes/%d" % rt["id"], "/api/routes/%d/delete" % rt["id"], "/api/routes/%d/alert" % rt["id"]):
        assert ben.post(url, json=ROUTE).status_code == 404


@pytest.mark.parametrize("over", [{"name": " "}, {"startPoint": {"lat": 10.3, "lng": 123.9}}, {"endPoint": None},
                                  {"vias": [{"lat": 14.6, "lng": 121.0}] * 31}, {"geometry": [["a", "b"], [1]]}])
def test_bad_routes_are_refused(make_user, over):
    assert make_user().post("/api/routes", json=dict(ROUTE, **over)).status_code == 400


def test_schedules(make_user, app):
    ana, ben = make_user("Ana Reyes"), make_user("Ben Cruz")
    rid = ana.post("/api/routes", json=ROUTE).json["route"]["id"]
    S = {"routeId": rid, "days": [5, 1, 2, 3, 4], "time": "06:45", "before": 30}
    s = ana.post("/api/schedules", json=S).json["schedule"]
    assert s["days"] == [1, 2, 3, 4, 5] and s["enabled"] and s["lastCheck"] is None
    assert ben.post("/api/schedules", json=S).status_code == 400                   # not Ben's route
    for bad in ({"days": []}, {"days": [7]}, {"time": "25:00"}, {"routeId": None}):
        assert ana.post("/api/schedules", json=dict(S, **bad)).status_code == 400
    assert ana.post("/api/schedules/%d" % s["id"], json=dict(S, before=999)).json["schedule"]["before"] == 30

    checked = ana.post("/api/schedules/%d/checked" % s["id"]).json["schedule"]["lastCheck"]
    assert re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", checked)
    assert ana.post("/api/schedules/%d" % s["id"], json=dict(S, time="07:30")).json["schedule"]["lastCheck"] is None
    assert ana.post("/api/schedules/%d/enabled" % s["id"], json={"enabled": False}).json["schedule"]["enabled"] is False
    assert ben.post("/api/schedules/%d/enabled" % s["id"], json={"enabled": True}).status_code == 404

    ana.post("/api/schedules/%d/checked" % s["id"])
    ana.post("/api/routes/%d" % rid, json=dict(ROUTE, name="Renamed"))
    assert mine(ana)[1][0]["lastCheck"]                                            # rename: today's check stays
    ana.post("/api/routes/%d" % rid, json=dict(ROUTE, endPoint={"lat": 14.67, "lng": 121.02}))
    assert mine(ana)[1][0]["lastCheck"] is None                                    # moved: check again

    assert ana.post("/api/routes/%d/delete" % rid).status_code == 200
    with app.app_context():
        assert Schedule.query.count() == 0                                         # its schedules go too


def test_one_time_import_from_the_browser(make_user):
    ana = make_user()
    routes = [dict(ROUTE, id=1, alert=False), dict(ROUTE, id=2, name="Bad", startPoint={"lat": 1, "lng": 1})]
    schedules = [{"id": 1, "routeId": 1, "days": [0], "time": "07:30", "before": 30, "enabled": False},
                 {"id": 2, "routeId": 2, "days": [1], "time": "08:00", "before": 30}]
    r = ana.post("/api/my/import", json={"routes": routes, "schedules": schedules}).json
    assert (r["routes"], r["schedules"], r["skipped"]) == (1, 1, 2)
    rts, scs = mine(ana)
    assert rts[0]["alert"] is False and scs[0]["routeId"] == rts[0]["id"] and scs[0]["enabled"] is False


def test_older_database_gets_the_new_columns(app):
    """add_missing_columns() adds start_place / end_place to a routes table made before step 5, keeping its rows."""
    with app.app_context():
        with db.engine.begin() as conn:
            conn.execute(text("DROP TABLE schedules"))
            conn.execute(text("DROP TABLE routes"))
            conn.execute(text("CREATE TABLE routes (id INTEGER PRIMARY KEY, user_id INTEGER, name VARCHAR(80), start_label VARCHAR(120), "
                              "start_lat FLOAT, start_lng FLOAT, end_label VARCHAR(120), end_lat FLOAT, end_lng FLOAT, geometry JSON, "
                              "segments JSON, vias JSON, mode VARCHAR(20), distance_m FLOAT, alert BOOLEAN, created_at DATETIME)"))
            conn.execute(text("INSERT INTO routes (id, name, start_label, start_lat, start_lng, end_label, end_lat, end_lng, alert) "
                              "VALUES (1, 'Old', 'A', 14.6, 121.0, 'B', 14.7, 121.05, 1)"))
        add_missing_columns()
        add_missing_columns()                                                        # safe to run again
        cols = {c["name"] for c in inspect(db.engine).get_columns("routes")}
        assert {"start_place", "end_place"} <= cols
        assert db.session.get(Route, 1).name == "Old"
