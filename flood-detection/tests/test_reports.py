"""Flood reports (step 3), the server photo re-check and the agent dashboard."""
import io
import json
import os

import pytest
from PIL import Image

from conftest import photo
from database import AgentDecision, Report, db


def test_guest_cannot_report(guest):
    assert guest.report().status_code == 401


def test_report_is_saved_with_the_agent_decision(make_user, app):
    ana = make_user("Ana Reyes")
    r = ana.report(depthCm=40, evidence=[999])
    assert r.status_code == 200, r.get_data(as_text=True)
    rep = r.json["report"]
    assert rep["id"] == 1 and rep["ownerId"] == ana.me["id"]
    assert rep["evidence"] == []                      # a report number that does not exist is dropped
    assert rep["depthCm"] == 40 and rep["inputs"]["hazard"] == "high"
    with app.app_context():
        d = AgentDecision.query.one()
        assert (d.kind, d.report_id, d.result, d.rain_level) == ("photo", 1, "flood-warning", "orange")


def test_photo_is_resaved_without_exif(make_user, app):
    ana = make_user()
    big = {"photo": (io.BytesIO(photo((1600, 1200), exif=True)), "p.jpg"),
           "data": json.dumps({"barangay": "Culiat", "lat": 14.666, "lng": 121.054, "prob": 0.9, "status": "flood-warning", "startStatus": "flood-warning"})}
    assert ana.post("/api/reports", data=big, content_type="multipart/form-data").status_code == 200
    with app.app_context():
        name = Report.query.one().photo_file
    img = Image.open(os.path.join(os.environ["UPLOAD_FOLDER"], name))
    assert max(img.size) == 1280 and not img.getexif()


@pytest.mark.parametrize("over, message", [
    ({"barangay": "Makati"}, "barangay"), ({"lat": 10.3}, "lat"), ({"prob": 1.5}, "prob"), ({"status": "tsunami"}, "status"),
])
def test_bad_values_are_refused_and_no_photo_is_kept(make_user, over, message):
    ana = make_user()
    r = ana.report(**over)
    assert r.status_code == 400 and message in r.json["error"].lower()
    assert os.listdir(os.environ["UPLOAD_FOLDER"]) == []


def test_reports_list_hides_names_and_removed_reports(make_user, moderator, guest):
    ana = make_user("Ana Reyes")
    first = ana.report().json["report"]
    second = ana.report(dupCandidate=1, evidence=[1]).json["report"]
    assert second["dupCandidate"] == 1 and second["evidence"] == [1]

    js = guest.get("/api/reports.js").get_data(as_text=True)
    assert "ana@example.com" not in js and "Ana" not in js
    assert [x["id"] for x in guest.script("/api/reports.js", "FDA_REPORTS")] == [2, 1]
    assert guest.get(first["photo"]).status_code == 200

    assert ana.post("/api/reports/2/review", json={"action": "approve"}).status_code == 403
    r = moderator.post("/api/reports/2/review", json={"action": "duplicate"})
    assert r.json["report"]["dupOf"] == 1
    assert moderator.post("/api/reports/1/review", json={"action": "remove"}).status_code == 400     # needs a reason
    assert moderator.post("/api/reports/1/review", json={"action": "remove", "reason": "Not a street"}).status_code == 200

    one = [x for x in guest.script("/api/reports.js", "FDA_REPORTS") if x["id"] == 1][0]
    assert one["removed"] and "photo" not in one and "removeReason" not in one
    assert guest.get(first["photo"]).status_code == 404       # a removed report's photo
    assert ana.get(first["photo"]).status_code == 200         # ... except for its reporter
    assert [x for x in ana.script("/api/reports.js", "FDA_REPORTS") if x["id"] == 1][0]["removeReason"] == "Not a street"


def test_server_photo_check_overrules_the_page(make_user, app):
    """With the trained model loaded, the server's own P is used, and a page that claims another band is refused."""
    ana = make_user()
    app.config["PHOTO_CHECK"] = lambda data: 0.12          # the model says: no flood
    r = ana.report(prob=0.91, status="flood-warning", startStatus="flood-warning")
    assert r.status_code == 400 and "different result" in r.json["error"]

    app.config["PHOTO_CHECK"] = lambda data: 0.86
    r = ana.report(prob=0.83, model="demo", status="flood-warning", startStatus="flood-warning")
    assert r.status_code == 200
    rep = r.json["report"]
    assert rep["prob"] == 0.86 and rep["model"] == "server" and rep["inputs"]["pageProb"] == 0.83

    app.config["PHOTO_CHECK"] = lambda data: None          # model not loaded: the page's value is kept
    assert ana.report(prob=0.62, model="demo", status="flood-warning", startStatus="possible-flood").json["report"]["prob"] == 0.62


def test_agent_dashboard(make_user, moderator):
    ana, ben = make_user("Ana Reyes"), make_user("Ben Cruz")
    ana.report(status="flood-warning", startStatus="possible-flood", prob=0.6,
               reasons=[{"key": "P", "effect": "start"}, {"key": "R", "effect": "raise"}, {"key": "N", "effect": "raise"}])
    ana.report(status="no-flood", startStatus="no-flood", prob=0.1, model="demo")
    ben.post("/api/reports/1/confirm", json={"kind": "not"})
    moderator.post("/api/reports/2/review", json={"action": "remove", "reason": "Not a street"})

    assert ana.get("/api/moderation/stats").status_code == 403
    d = moderator.get("/api/moderation/stats").json
    assert d["total"] == 2 and d["models"] == {"server": 1, "demo": 1}
    assert d["raisedBy"] == {"H": 0, "R": 1, "S": 0, "N": 1}
    assert d["byStatus"]["flood-warning"]["raised"] == 1 and d["byStatus"]["flood-warning"]["not"] == 1
    assert d["byStatus"]["no-flood"]["removed"] == 1
