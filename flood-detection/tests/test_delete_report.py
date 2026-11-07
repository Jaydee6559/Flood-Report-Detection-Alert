"""A user deletes their own report."""
import os

from database import AgentDecision, Comment, Confirmation, Flag, Notification, Report, db


def test_owner_deletes_report_and_everything_about_it(make_user, app):
    ana, ben = make_user("Ana Reyes"), make_user("Ben Cruz")
    rid = ana.report().json["report"]["id"]
    ben.post("/api/reports/%d/confirm" % rid, json={"kind": "still"})
    cid = ben.post("/api/reports/%d/comments" % rid, json={"text": "Still deep"}).json["comment"]["id"]
    ben.post("/api/reports/%d/flag" % rid, json={"reason": "x"})
    ana.post("/api/comments/%d/flag" % cid, json={"reason": "Spam"})
    other = ana.report(dupCandidate=rid).json["report"]          # a later report that points at this one
    assert other["dupCandidate"] == rid
    with app.app_context():
        photo = db.session.get(Report, rid).photo_file
        assert Notification.query.filter(Notification.link == "report-details.html?id=%d" % rid).count() >= 1
    assert os.path.exists(os.path.join(os.environ["UPLOAD_FOLDER"], photo))

    r = ana.post("/api/reports/%d/delete" % rid)
    assert r.status_code == 200 and r.json["ok"]
    assert rid not in [x["id"] for x in ana.script("/api/reports.js", "FDA_REPORTS")]
    assert not os.path.exists(os.path.join(os.environ["UPLOAD_FOLDER"], photo))
    with app.app_context():
        assert db.session.get(Report, rid) is None
        assert Comment.query.count() == 0 and Confirmation.query.count() == 0 and Flag.query.count() == 0
        assert Notification.query.filter(Notification.link == "report-details.html?id=%d" % rid).count() == 0
        assert db.session.get(Report, other["id"]).dup_candidate_id is None
        d = AgentDecision.query.order_by(AgentDecision.id).first()
        assert d is not None and d.report_id is None              # the agent's log keeps the decision


def test_only_the_owner_can_delete(make_user, moderator, guest):
    ana, ben = make_user("Ana Reyes"), make_user("Ben Cruz")
    rid = ana.report().json["report"]["id"]
    assert guest.post("/api/reports/%d/delete" % rid).status_code == 401
    assert ben.post("/api/reports/%d/delete" % rid).status_code == 403
    assert moderator.post("/api/reports/%d/delete" % rid).status_code == 403   # moderators use "Remove" instead
    assert ana.post("/api/reports/999/delete").status_code == 404
    assert rid in [x["id"] for x in guest.script("/api/reports.js", "FDA_REPORTS")]
