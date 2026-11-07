"""Forgot password, the sample flood-spot switch and CSV import, and Rule 1 re-run on the server."""
from datetime import datetime, timezone

import pytest

import agent
import jobs
import limits
import spots_data
from conftest import PASSWORD, Client
from database import AgentDecision, FloodSpot, PasswordReset, db

NEW = "Brand9New"


@pytest.fixture
def codes(app):
    """Catches the codes the server would send: [(login, code), ...]."""
    sent = []
    app.config["RESET_SENDER"] = lambda user, code: sent.append((user.login, code)) or "email"
    return sent


# ---- Forgot password --------------------------------------------------------------------
def test_reset_code_sets_a_new_password_and_signs_in(make_user, codes, app):
    make_user("Ana Reyes")
    c = Client(app)
    r = c.post("/api/auth/forgot", json={"login": "ANA@example.com"})
    assert r.status_code == 200 and r.json["ok"]
    assert len(codes) == 1 and codes[0][0] == "ana@example.com" and len(codes[0][1]) == 6
    r = c.post("/api/auth/reset", json={"login": "ana@example.com", "code": codes[0][1], "password": NEW, "confirm": NEW})
    assert r.status_code == 200 and r.json["user"]["login"] == "ana@example.com"
    assert c.me["login"] == "ana@example.com"                                        # signed in
    other = Client(app)
    assert other.post("/api/auth/login", json={"login": "ana@example.com", "password": PASSWORD}).status_code == 401
    assert other.post("/api/auth/login", json={"login": "ana@example.com", "password": NEW}).status_code == 200
    # the code works once only
    r = Client(app).post("/api/auth/reset", json={"login": "ana@example.com", "code": codes[0][1], "password": "Again123x", "confirm": "Again123x"})
    assert r.status_code == 400 and "code" in r.json["errors"]


def test_unknown_login_gets_the_same_answer_and_no_code(guest, codes):
    r = guest.post("/api/auth/forgot", json={"login": "nobody@example.com"})
    assert r.status_code == 200 and r.json["ok"] and codes == []


def test_wrong_code_counts_and_a_code_ends_after_five_tries(make_user, codes, app):
    make_user("Ana Reyes")
    c = Client(app)
    c.post("/api/auth/forgot", json={"login": "ana@example.com"})
    right = codes[0][1]
    wrong = "000000" if right != "000000" else "111111"
    for _ in range(5):
        r = c.post("/api/auth/reset", json={"login": "ana@example.com", "code": wrong, "password": NEW, "confirm": NEW})
        assert r.status_code == 400
    r = c.post("/api/auth/reset", json={"login": "ana@example.com", "code": right, "password": NEW, "confirm": NEW})
    assert r.status_code == 400, "the right code no longer works after 5 wrong tries"


def test_a_new_code_replaces_the_old_one(make_user, codes, app):
    make_user("Ana Reyes")
    c = Client(app)
    c.post("/api/auth/forgot", json={"login": "ana@example.com"})
    c.post("/api/auth/forgot", json={"login": "ana@example.com"})
    old, new = codes[0][1], codes[1][1]
    if old != new:
        assert c.post("/api/auth/reset", json={"login": "ana@example.com", "code": old, "password": NEW, "confirm": NEW}).status_code == 400
    assert c.post("/api/auth/reset", json={"login": "ana@example.com", "code": new, "password": NEW, "confirm": NEW}).status_code == 200


def test_expired_code_is_refused(make_user, codes, app):
    make_user("Ana Reyes")
    c = Client(app)
    c.post("/api/auth/forgot", json={"login": "ana@example.com"})
    with app.app_context():
        row = PasswordReset.query.one()
        row.expires_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
        db.session.commit()
    r = c.post("/api/auth/reset", json={"login": "ana@example.com", "code": codes[0][1], "password": NEW, "confirm": NEW})
    assert r.status_code == 400


def test_weak_new_password_is_refused(make_user, codes, app):
    make_user("Ana Reyes")
    c = Client(app)
    c.post("/api/auth/forgot", json={"login": "ana@example.com"})
    r = c.post("/api/auth/reset", json={"login": "ana@example.com", "code": codes[0][1], "password": "short", "confirm": "short"})
    assert r.status_code == 400 and "password" in r.json["errors"]


def test_without_a_mail_server_the_code_goes_to_the_console(make_user, app, capsys, monkeypatch):
    monkeypatch.delenv("MAIL_SERVER", raising=False)
    make_user("Ana Reyes")
    r = Client(app).post("/api/auth/forgot", json={"login": "ana@example.com"})
    assert r.json["delivery"] == "console"
    assert "Password reset code for user" in capsys.readouterr().out


def test_asking_for_codes_is_rate_limited(make_user, codes, app):
    app.config["RATE_LIMITS"] = True
    make_user("Ana Reyes")
    c = Client(app)
    for _ in range(limits.RULES["reset"][0]):
        assert c.post("/api/auth/forgot", json={"login": "ana@example.com"}).status_code == 200
    assert c.post("/api/auth/forgot", json={"login": "ana@example.com"}).status_code == 429


# ---- Sample flood spots ----------------------------------------------------------------
def test_sample_spots_can_be_turned_off(guest, app):
    with app.app_context():
        assert spots_data.sample_spots_on() and len(spots_data.seed_spots()) == 40
        assert jobs.seed_spot_counts()
    assert guest.script("/api/spots.js", "FDA_SAMPLE_SPOTS_ON") is True
    assert app.test_cli_runner().invoke(args=["sample-spots", "off"]).exit_code == 0
    with app.app_context():
        assert not spots_data.sample_spots_on() and spots_data.seed_spots() == [] and jobs.seed_spot_counts() == {}
    assert guest.script("/api/spots.js", "FDA_SAMPLE_SPOTS_ON") is False


def test_seed_spot_positions_match_the_page(app):
    """Banawe cor. Retiro: Santo Domingo's centre moved 20 m north and 40 m east (as core/hazard.js does)."""
    with app.app_context():
        s = next(x for x in spots_data.all_seed_spots() if x["corner"] == "Banawe cor. Retiro")
        lat, lng = agent.barangay_centre("Santo Domingo (Matalahib)")
        assert round(agent.meters(lat, lng, s["lat"], s["lng"])) == 45


def test_import_spots_from_csv(app, tmp_path):
    f = tmp_path / "spots.csv"
    f.write_text("barangay,corner,date,depth,pass,times,source\n"
                 "Culiat,Tandang Sora cor. Visayas,2025-08-01,knee,light-no,3,MMDA advisory\n"
                 "Culiat,Tandang Sora cor. Visayas,2025-09-02,waist,none,1,MMDA advisory\n"
                 "Makati,Somewhere,2025-08-01,knee,all,1,x\n", encoding="utf-8")
    res = app.test_cli_runner().invoke(args=["import-spots", str(f)])
    assert res.exit_code == 0, res.output
    assert "Added 1 new spot(s), updated 1." in res.output and "row 4: unknown barangay" in res.output
    with app.app_context():
        s = FloodSpot.query.one()
        assert (s.times, s.worst_depth, s.last_seen) == (4, "waist", "2025-09-02")


# ---- Rule 1 on the server -------------------------------------------------------------
def test_server_raises_a_possible_flood_when_another_report_is_near(make_user, app):
    ana = make_user("Ana Reyes")
    assert ana.report().status_code == 200                        # #1: a flood warning here
    # The page claims nothing is nearby and keeps it a Possible flood; the server finds #1 within 500 m.
    r = ana.report(prob=0.6, status="possible-flood", startStatus="possible-flood",
                   inputs={"hazard": "none", "rain": None, "rainMm": 0, "spots": 0, "reports": 0})
    rep = r.json["report"]
    assert rep["status"] == "flood-warning" and rep["startStatus"] == "possible-flood"
    assert rep["inputs"]["reports"] == 1 and rep["evidence"] == [1]
    assert rep["reasons"][-1]["key"] == "server"
    with app.app_context():
        d = db.session.get(AgentDecision, 2)
        assert d.result == "flood-warning" and d.inputs["pageStatus"] == "possible-flood" and "N" in d.inputs["raisedBy"]


def test_server_will_not_raise_a_status_the_inputs_do_not_support(make_user):
    ana = make_user("Ana Reyes")
    # Culiat is low hazard, no rain, no other reports: a Possible flood photo stays a Possible flood
    r = ana.report(prob=0.6, status="flood-warning", startStatus="possible-flood",
                   inputs={"hazard": "high", "rain": "red", "rainMm": 40, "spots": 0, "reports": 0})
    # the page's rain is used when the server has no live rain, so red rain still raises it
    assert r.json["report"]["status"] == "flood-warning"
    r = ana.report(prob=0.6, status="flood-warning", startStatus="possible-flood",
                   inputs={"hazard": "high", "rain": None, "rainMm": 0, "spots": 0, "reports": 0}, lat=14.7, lng=121.1)
    rep = r.json["report"]
    assert rep["status"] == "possible-flood" and rep["inputs"]["page"]["status"] == "flood-warning"


def test_live_rain_on_the_server_beats_the_page(make_user, app):
    with app.app_context():
        jobs.remember_rain({d: [0, 0, 0, 0] for d in range(1, 7)})     # dry everywhere
    ana = make_user("Ana Reyes")
    r = ana.report(prob=0.6, status="flood-warning", startStatus="possible-flood", lat=14.7, lng=121.1,
                   inputs={"hazard": "none", "rain": "red", "rainMm": 40, "spots": 0, "reports": 0})   # e.g. a simulated storm
    rep = r.json["report"]
    assert rep["inputs"]["rainSource"] == "live" and rep["inputs"]["rain"] is None and rep["status"] == "possible-flood"


def test_status_must_match_the_probability(make_user):
    r = make_user().report(prob=0.2, status="flood-warning", startStatus="flood-warning")
    assert r.status_code == 400


@pytest.mark.parametrize("start, h, r, s, n, out", [
    ("possible-flood", "none", None, False, False, "possible-flood"),
    ("possible-flood", "high", None, False, False, "flood-warning"),
    ("possible-flood", "low", "orange", False, False, "flood-warning"),
    ("possible-flood", "low", None, False, True, "flood-warning"),
    ("unclear-photo", "medium", "orange", False, False, "possible-flood"),
    ("unclear-photo", "low", "red", True, False, "possible-flood"),
    ("unclear-photo", "high", "yellow", True, True, "unclear-photo"),
    ("no-flood", "high", "red", True, True, "no-flood"),
    ("flood-warning", "none", None, False, False, "flood-warning"),
])
def test_rule1_matches_agent_js(start, h, r, s, n, out):
    assert agent.rule1(start, h, r, s, n)[0] == out
