"""Accounts (step 2): register, sign in, CSRF, password hashing, the admin commands."""
from conftest import PASSWORD, Client
from database import User, db


def test_guest_is_nobody(guest):
    assert guest.me is None
    assert guest.get("/api/auth/me").json["user"] is None


def test_post_without_csrf_token_is_refused(app):
    assert app.test_client().post("/api/auth/login", json={}).status_code == 400


def test_register_normalises_the_mobile_number_and_signs_in(guest):
    r = guest.post("/api/auth/register", json={"name": "Test User", "login": "0917 123 4567", "password": PASSWORD,
                                               "confirm": PASSWORD, "barangay": "Culiat", "agree": True})
    assert r.status_code == 200
    assert r.json["user"]["login"] == "639171234567"
    assert r.json["user"]["homeDistrict"] == 6
    assert guest.me["name"] == "Test User"


def test_the_same_number_written_differently_is_refused(make_user, guest):
    make_user("Ana Reyes", login="09171234567")
    r = guest.post("/api/auth/register", json={"name": "X", "login": "+639171234567", "password": PASSWORD,
                                               "confirm": PASSWORD, "agree": True})
    assert r.status_code == 400 and "login" in r.json["errors"]


def test_register_checks_every_field(guest):
    r = guest.post("/api/auth/register", json={"name": "", "login": "nope", "password": "short", "confirm": "x", "barangay": "Makati"})
    assert set(r.json["errors"]) == {"name", "login", "password", "confirm", "barangay", "agree"}


def test_wrong_password_then_right_one(make_user, app):
    make_user("Ana Reyes", login="ana@example.com")
    c = Client(app)
    r = c.post("/api/auth/login", json={"login": "ana@example.com", "password": "nope"})
    assert r.status_code == 401 and r.json["error"] == "That email/number or password is not right."
    assert c.post("/api/auth/login", json={"login": "ANA@example.com", "password": PASSWORD}).status_code == 200


def test_passwords_are_hashed(make_user, app):
    make_user("Ana Reyes")
    with app.app_context():
        h = User.query.one().password_hash
    assert PASSWORD not in h and h.split(":")[0] in ("scrypt", "pbkdf2")


def test_sign_out(make_user):
    c = make_user("Ana Reyes")
    c.post("/api/auth/logout")
    assert c.me is None


def test_create_user_and_set_password_commands(app):
    run = app.test_cli_runner()
    r = run.invoke(args=["create-user", "--name", "Mod", "--login", "mod2@example.com", "--password", "weak", "--moderator"])
    assert r.exit_code != 0 and "8 characters" in r.output
    r = run.invoke(args=["create-user", "--name", "Mod", "--login", "mod2@example.com", "--password", "Moderate123", "--moderator"])
    assert r.exit_code == 0 and "moderator" in r.output

    r = run.invoke(args=["set-password", "--login", "nobody@example.com", "--password", "NewPass123"])
    assert r.exit_code != 0 and "No account" in r.output
    r = run.invoke(args=["set-password", "--login", "MOD2@example.com", "--password", "NewPass123"])
    assert r.exit_code == 0
    c = Client(app)
    assert c.post("/api/auth/login", json={"login": "mod2@example.com", "password": "Moderate123"}).status_code == 401
    assert c.post("/api/auth/login", json={"login": "mod2@example.com", "password": "NewPass123"}).status_code == 200
