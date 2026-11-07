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
import secrets
from datetime import datetime, timedelta, timezone

from flask import Blueprint, Response, current_app, jsonify, request
from flask_login import LoginManager, current_user, login_user, logout_user
from flask_wtf.csrf import CSRFError, CSRFProtect, generate_csrf
from werkzeug.security import check_password_hash, generate_password_hash

import limits
from database import NotificationSettings, PasswordReset, User, db

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


# ---- "Forgot password?" --------------------------------------------------------
# 1. POST /api/auth/forgot {login}: a 6-digit code goes to the account's email (SMTP, see send_reset_code).
#    The answer is the same whether or not the account exists, so nobody can test which logins are registered.
# 2. POST /api/auth/reset {login, code, password, confirm}: a right code sets the new password and signs in.
RESET_MINUTES = 15
RESET_TRIES = 5
MSG_RESET_SENT = "If that email or number has an account, a 6-digit code is on its way. It works for %d minutes." % RESET_MINUTES
MSG_BAD_CODE = "That code is not right, or it has expired. Ask for a new one."


def mail_ready():
    return bool(current_app.config.get("MAIL_SERVER") or os.environ.get("MAIL_SERVER"))


def _mail_setting(name, default=None):
    return current_app.config.get(name) or os.environ.get(name) or default


def send_reset_code(user, code):
    """Send the code. By email when MAIL_SERVER is set and the login is an email; otherwise
    (no mail server, or a mobile number: there is no SMS service yet) it is printed in the server
    console, so whoever runs the server can pass it on. Returns "email" or "console"."""
    sender = current_app.config.get("RESET_SENDER")          # tests put a fake one here
    if sender:
        return sender(user, code)
    text = ("Your Flood Detection & Alert password reset code is %s.\n\nIt works for %d minutes. "
            "If you did not ask for it, ignore this message; your password has not changed." % (code, RESET_MINUTES))
    if mail_ready() and "@" in user.login:
        import smtplib
        from email.message import EmailMessage
        msg = EmailMessage()
        msg["Subject"] = "Your password reset code"
        msg["From"] = _mail_setting("MAIL_FROM", _mail_setting("MAIL_USERNAME", "no-reply@localhost"))
        msg["To"] = user.login
        msg.set_content(text)
        port = int(_mail_setting("MAIL_PORT", 587))
        with smtplib.SMTP(_mail_setting("MAIL_SERVER"), port, timeout=20) as smtp:
            if port != 25 and str(_mail_setting("MAIL_USE_TLS", "1")) != "0":
                smtp.starttls()
            if _mail_setting("MAIL_USERNAME"):
                smtp.login(_mail_setting("MAIL_USERNAME"), _mail_setting("MAIL_PASSWORD", ""))
            smtp.send_message(msg)
        return "email"
    print(" * Password reset code for %s #%d (%s): %s  (valid %d min; set MAIL_SERVER to send it by email)"
          % (user.role, user.id, user.login, code, RESET_MINUTES), flush=True)
    return "console"


def _aware(dt):
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


@bp.post("/api/auth/forgot")
def forgot_password():
    data = request.get_json(silent=True) or {}
    login, ip = str(data.get("login") or "").strip(), request.remote_addr
    if not login_is_valid(login):
        return jsonify(ok=False, errors={"login": "Enter a valid email or a mobile number like 0917 123 4567."}), 400
    login = norm_login(login)
    stop = limits.too_many("reset", login) or limits.too_many("reset-ip", ip)
    if stop:
        return stop
    user = User.query.filter_by(login=login).first()
    if user is not None:
        PasswordReset.query.filter_by(user_id=user.id, used=False).update({"used": True})   # only the newest code works
        code = "%06d" % secrets.randbelow(1000000)
        db.session.add(PasswordReset(user_id=user.id, code_hash=generate_password_hash(code),
                                     expires_at=datetime.now(timezone.utc) + timedelta(minutes=RESET_MINUTES)))
        db.session.commit()
        try:
            send_reset_code(user, code)
        except Exception:
            current_app.logger.exception("The reset code could not be sent")
            return jsonify(ok=False, error="The code could not be sent right now. Please try again later."), 503
    # The same answer either way. Where the code went depends only on the server's settings, not on the account.
    where = "email" if mail_ready() else "console"
    return jsonify(ok=True, message=MSG_RESET_SENT, delivery=where)


@bp.post("/api/auth/reset")
def reset_password():
    data = request.get_json(silent=True) or {}
    ip, login = request.remote_addr, norm_login(data.get("login"))
    code, password = re.sub(r"\D", "", str(data.get("code") or "")), str(data.get("password") or "")
    stop = limits.blocked("reset-code", ip)
    if stop:
        return stop
    errors = {}
    if not password_is_strong(password):
        errors["password"] = "Use at least 8 characters, a number, and upper and lower case letters."
    if password != str(data.get("confirm") or ""):
        errors["confirm"] = "The passwords do not match."
    if len(code) != 6:
        errors["code"] = "Enter the 6-digit code."
    if errors:
        return jsonify(ok=False, errors=errors), 400
    user = User.query.filter_by(login=login).first()
    row = None if user is None else PasswordReset.query.filter_by(user_id=user.id, used=False).order_by(PasswordReset.id.desc()).first()
    now = datetime.now(timezone.utc)
    if row is None or _aware(row.expires_at) < now or row.tries >= RESET_TRIES or not check_password_hash(row.code_hash, code):
        if row is not None:
            row.tries += 1
            if row.tries >= RESET_TRIES:
                row.used = True               # too many wrong tries: this code is finished
            db.session.commit()
        limits.count("reset-code", ip)
        return jsonify(ok=False, errors={"code": MSG_BAD_CODE}), 400
    row.used = True
    user.set_password(password)
    db.session.commit()
    login_user(user, remember=False)
    return jsonify(ok=True, user=public(user), csrf=generate_csrf())


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
