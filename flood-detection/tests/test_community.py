"""Confirmations, comments and flags (step 4)."""


def test_confirmations_one_per_account(make_user, guest):
    ana, ben, cara = make_user("Ana Reyes"), make_user("Ben Cruz"), make_user("Cara Lim")
    rid = ana.report().json["report"]["id"]
    url = "/api/reports/%d/confirm" % rid
    assert guest.post(url, json={"kind": "still"}).status_code == 401
    assert ana.post(url, json={"kind": "still"}).status_code == 400          # your own report
    assert ben.post(url, json={"kind": "maybe"}).status_code == 400

    r = ben.post(url, json={"kind": "still"}).json["report"]
    assert (r["still"], r["myVote"]) == (1, "still") and r["lastConfirmTs"]
    cara.post(url, json={"kind": "not"})
    r = ben.post(url, json={"kind": "not"}).json["report"]                   # changes the vote
    assert (r["still"], r["not"]) == (0, 2)
    r = ben.post(url, json={"kind": "not"}).json["report"]                   # the same again takes it back
    assert (r["not"], r["myVote"]) == (1, None)
    assert [x for x in cara.script("/api/reports.js", "FDA_REPORTS") if x["id"] == rid][0]["myVote"] == "not"


def test_comments(make_user, guest):
    ana, ben = make_user("Ana Reyes"), make_user("Ben Cruz")
    rid = ana.report().json["report"]["id"]
    url = "/api/reports/%d/comments" % rid
    assert guest.post(url, json={"text": "hi"}).status_code == 401
    assert ben.post(url, json={"text": "   "}).status_code == 400
    assert ben.post(url, json={"text": "x" * 201}).status_code == 400
    c = ben.post(url, json={"text": "  Still   knee-deep. "}).json["comment"]
    assert c["text"] == "Still knee-deep." and c["author"] == "Ben C."
    listed = guest.get(url).json["comments"]
    assert [x["id"] for x in listed] == [c["id"]] and "Cruz" not in str(listed)
    assert guest.get("/api/reports/999/comments").status_code == 404


def test_flags_and_the_comment_queue(make_user, moderator):
    ana, ben, cara = make_user("Ana Reyes"), make_user("Ben Cruz"), make_user("Cara Lim")
    rid = ana.report().json["report"]["id"]
    spam = cara.post("/api/reports/%d/comments" % rid, json={"text": "Buy phones"}).json["comment"]["id"]

    assert cara.post("/api/comments/%d/flag" % spam, json={}).status_code == 400   # your own comment
    assert not ana.post("/api/comments/%d/flag" % spam, json={"reason": "Spam"}).json["already"]
    assert ana.post("/api/comments/%d/flag" % spam, json={}).json["already"]
    ben.post("/api/comments/%d/flag" % spam, json={})
    assert ana.post("/api/reports/%d/flag" % rid, json={}).status_code == 400      # your own report
    assert ben.post("/api/reports/%d/flag" % rid, json={}).json["report"]["flags"] == 1

    assert ben.get("/api/moderation/comments").status_code == 403
    q = moderator.get("/api/moderation/comments").json["comments"]
    assert [(x["id"], x["flags"], x["flagReason"]) for x in q] == [(spam, 2, "Spam")]
    assert moderator.post("/api/comments/%d/review" % spam, json={"action": "remove"}).status_code == 200
    assert moderator.get("/api/moderation/comments").json == {"ok": True, "comments": [], "reviewedToday": 1}
    assert spam not in [x["id"] for x in ben.get("/api/reports/%d/comments" % rid).json["comments"]]

    # approving clears a report's flags; a new flag brings it back
    moderator.post("/api/reports/%d/review" % rid, json={"action": "approve"})
    assert moderator.script("/api/reports.js", "FDA_REPORTS")[0]["flags"] == 0
    cara.post("/api/reports/%d/flag" % rid, json={})
    assert moderator.script("/api/reports.js", "FDA_REPORTS")[0]["flags"] == 1


def test_removed_report_is_closed(make_user, moderator, guest):
    ana, ben = make_user("Ana Reyes"), make_user("Ben Cruz")
    rid = ana.report().json["report"]["id"]
    moderator.post("/api/reports/%d/review" % rid, json={"action": "remove", "reason": "Test"})
    assert ben.post("/api/reports/%d/confirm" % rid, json={"kind": "still"}).status_code in (400, 404)
    assert ben.post("/api/reports/%d/comments" % rid, json={"text": "hi"}).status_code in (400, 404)
    assert guest.get("/api/reports/%d/comments" % rid).status_code == 404
