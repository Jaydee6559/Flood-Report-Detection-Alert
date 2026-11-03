"""Accounts (Module 1): register, sign in, sign out, and who is signed in.

Flask-Login keeps the session (a signed cookie); Werkzeug hashes the passwords;
Flask-WTF checks a CSRF token on every POST, sent by the pages in the
X-CSRFToken header (static/js/core/api.js).

The pages learn who is signed in from  /api/auth/me.js , a tiny script that
static/js/app.js loads before everything else. It sets
    window.FDA_ME   = {...the user...} or null (a guest)
    window.FDA_CSRF = "...token..."

Guests can view everything; reporting, confirming, commenting and flagging
need an account. Moderators are created with  flask --app app create-user --moderator .
"""
import json
import os
import re

from flask import Blueprint, Response, current_app, jsonify, request
from flask_login import LoginManager, current_user, login_user, logout_user
from flask_wtf.csrf import CSRFError, CSRFProtect, generate_csrf

import limits
from database import NotificationSettings, User, db

bp = Blueprint("accounts", __name__)
login_manager = LoginManager()
csrf = CSRFProtect()

CITY = "Quezon City"
MSG_BAD_LOGIN = "That email/number or password is not right."


# ---- Rules shared with the register page (static/js/core/auth.js) -------------
def norm_login(value):
    """Email -> lower case. Mobile -> digits only, 09xx and +639xx are the same (stored as 639xx)."""
    v = str(value or "").strip().lower()
    if re.fullmatch(r"[+\d][\d\s-]{8,}", v):
        v = re.sub(r"\D", "", v)
        if v.startswith("0"):
            v = "63" + v[1:]
    return v


def login_is_valid(value):
    v = str(value or "").strip()
    return bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", v) or re.fullmatch(r"(\+?63|0)9\d{9}", re.sub(r"[\s-]", "", v)))


def password_is_strong(pw):
    return len(pw) >= 8 and re.search(r"\d", pw) and re.search(r"[a-z]", pw) and re.search(r"[A-Z]", pw)


_barangays = None


def barangay_districts():
    """{barangay name: district number} for Quezon City, from static/data/locations.json."""
    global _barangays
    if _barangays is None:
        path = os.path.join(current_app.root_path, "static", "data", "locations.json")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        city = next(c for c in data["cities"] if c["name"] == CITY)
        _barangays = {b["name"]: b["district"] for b in city["barangays"]}
    return _barangays


def public(user):
    """What the pages may see about a user. The id is "u<number>", as the browser data uses."""
    if user is None:
        return None
    return {
        "id": "u%d" % user.id, "dbId": user.id, "name": user.name, "login": user.login, "role": user.role,
        "homeCity": CITY if user.home_barangay else "", "homeBarangay": user.home_barangay or "",
        "homeDistrict": user.home_district,
    }


def me():
    return current_user if current_user.is_authenticated else None


# ---- Flask-Login --------------------------------------------------------------
@login_manager.user_loader
def load_user(user_id):
    try:
        return db.session.get(User, int(user_id))
    except (TypeError, ValueError):
        return None


@login_manager.unauthorized_handler
def unauthorized():
    return jsonify(error="Please sign in first."), 401


# ---- Routes -------------------------------------------------------------------
@bp.get("/api/auth/me")
def who_am_i():
    return jsonify(user=public(me()), csrf=generate_csrf())


@bp.get("/api/auth/me.js")
def who_am_i_script():
    body = "window.FDA_ME = %s;\nwindow.FDA_CSRF = %s;\n" % (json.dumps(public(me())), json.dumps(generate_csrf()))
    resp = Response(body, mimetype="application/javascript")
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.post("/api/auth/register")
def register():
    stop = limits.blocked("register", request.remote_addr)
    if stop:
        return stop
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    login = str(data.get("login") or "").strip()
    password = str(data.get("password") or "")
    barangay = str(data.get("barangay") or "").strip()
    errors = {}
    if not name:
        errors["name"] = "Enter your full name."
    elif len(name) > 80:
        errors["name"] = "Use 80 characters or fewer."
    if not login_is_valid(login):
        errors["login"] = "Enter a valid email or a mobile number like 0917 123 4567."
    elif User.query.filter_by(login=norm_login(login)).first():
        errors["login"] = "That email or number is already registered. Try signing in."
    if not password_is_strong(password):
        errors["password"] = "Use at least 8 characters, a number, and upper and lower case letters."
    if password != str(data.get("confirm") or ""):
        errors["confirm"] = "The passwords do not match."
    if barangay and barangay not in barangay_districts():
        errors["barangay"] = "Choose a Quezon City barangay from the list."
    if not data.get("agree"):
        errors["agree"] = "Please agree to the Terms of Use and Privacy Notice to continue."
    if errors:
        return jsonify(ok=False, errors=errors), 400

    user = User(name=name, login=norm_login(login), role="user",
                home_barangay=barangay or None, home_district=barangay_districts().get(barangay))
    user.set_password(password)
    user.settings = NotificationSettings()
    db.session.add(user)
    db.session.commit()
    limits.count("register", request.remote_addr)
    login_user(user, remember=True)
    return jsonify(ok=True, user=public(user), csrf=generate_csrf())


@bp.post("/api/auth/login")
def sign_in():
    data = request.get_json(silent=True) or {}
    ip, login = request.remote_addr, norm_login(data.get("login"))
    stop = limits.blocked("login", (ip, login)) or limits.blocked("login-ip", ip)   # too many wrong passwords
    if stop:
        return stop
    user = User.query.filter_by(login=login).first()
    if user is None or not user.check_password(str(data.get("password") or "")):
        limits.count("login", (ip, login))
        limits.count("login-ip", ip)
        return jsonify(ok=False, error=MSG_BAD_LOGIN), 401
    login_user(user, remember=bool(data.get("remember")))
    return jsonify(ok=True, user=public(user), csrf=generate_csrf())


@bp.post("/api/auth/logout")
def sign_out():
    logout_user()
    return jsonify(ok=True, csrf=generate_csrf())


def csrf_failed(err):
    return jsonify(error="Your session expired. Please try again.", csrf=True), 400


def init_app(app):
    app.config.setdefault("WTF_CSRF_TIME_LIMIT", None)          # token lasts as long as the session
    app.config.setdefault("SESSION_COOKIE_SAMESITE", "Lax")
    app.config.setdefault("REMEMBER_COOKIE_SAMESITE", "Lax")
    app.config.setdefault("REMEMBER_COOKIE_DURATION", 60 * 60 * 24 * 30)   # "Keep me signed in": 30 days
    login_manager.init_app(app)
    csrf.init_app(app)
    app.register_error_handler(CSRFError, csrf_failed)
    app.register_blueprint(bp)
