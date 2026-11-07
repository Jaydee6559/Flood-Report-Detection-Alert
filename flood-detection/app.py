"""Flood Detection & Alert: Flask app (pages, the photo classifier and the database).

First time:
    pip install -r requirements.txt
    flask --app app init-db                       (creates instance/flood.db, empty)
    flask --app app create-user --moderator       (the first moderator account)
    flask --app app set-password                  (set someone's password by hand; people can also use "Forgot password?")
    flask --app app sample-spots off              (stop counting the 40 SAMPLE flood spots once real ones are in)
    flask --app app import-spots spots.csv        (add real flood sightings from a CSV file)
Run:
    flask --app app run --debug                   (then open http://127.0.0.1:5000)

"Forgot password?" sends a 6-digit code by email when MAIL_SERVER is set (also MAIL_PORT, MAIL_USERNAME,
MAIL_PASSWORD, MAIL_FROM, MAIL_USE_TLS); without it, the code is printed in this server's console.

The trained model goes in  models/flood_model.keras  (see models/README.md).
Without it, or without TensorFlow installed, the site still runs and the
report page falls back to the demo estimate.
The tables are in database.py and described in DATABASE.md; accounts are in accounts.py,
flood reports in reports_api.py, confirmations, comments and flags in community_api.py,
saved routes and travel schedules in routes_api.py, notifications in notifications_api.py,
the flood-spot log in spots_api.py, rate limits in limits.py, timed jobs in jobs.py.
"""
import io
import os
import threading

import click
from flask import Flask, abort, jsonify, render_template, request

import accounts
import community_api
import jobs
import notifications_api
import reports_api
import routes_api
import spots_api
import spots_data
from database import FloodSpot, NotificationSettings, User, add_missing_columns, db

app = Flask(__name__)  # templates/ and static/ sit next to this file
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # photos up to 10 MB


# ---- Database ---------------------------------------------------------------
# SQLite file in the instance/ folder (not committed). Photos go in uploads/ (not committed).
os.makedirs(app.instance_path, exist_ok=True)
# FDA_DEMO=1 switches to the sample data (instance/demo.db, uploads/demo/; made by  flask seed-demo ).
DEMO = os.environ.get("FDA_DEMO") == "1"
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
    "DATABASE_URL", "sqlite:///" + os.path.join(app.instance_path, "demo.db" if DEMO else "flood.db"))
app.config["UPLOAD_FOLDER"] = os.environ.get(
    "UPLOAD_FOLDER", os.path.join(app.root_path, "uploads", "demo") if DEMO else os.path.join(app.root_path, "uploads"))
db.init_app(app)
with app.app_context():
    add_missing_columns()   # an older flood.db gets the newer columns; nothing is deleted
    db.create_all()         # ... and any newer tables (e.g. reminders); existing tables and rows are not touched


def _secret_key():
    """Signs the session cookie. From FLASK_SECRET_KEY, or a random key saved once in instance/secret_key (not committed)."""
    if os.environ.get("FLASK_SECRET_KEY"):
        return os.environ["FLASK_SECRET_KEY"]
    path = os.path.join(app.instance_path, "secret_key")
    if not os.path.isfile(path):
        with open(path, "w") as f:
            f.write(os.urandom(32).hex())
    with open(path) as f:
        return f.read().strip()


# ---- Accounts (Module 1): Flask-Login sessions, CSRF protection --------------
app.config["SECRET_KEY"] = _secret_key()
accounts.init_app(app)

# ---- Flood reports (Modules 5-8, 13): saved in the database, photos in uploads/ --
reports_api.init_app(app)
# ---- Community (Modules 9, 13): confirmations, comments, flags ---------------
community_api.init_app(app)
# ---- Routes and travel schedules (Modules 10-11) -----------------------------
routes_api.init_app(app)
# ---- Notifications, their settings and watched barangays (Module 12) ---------
notifications_api.init_app(app)
# ---- The flood-spot log (Modules 3, 13) ---------------------------------------
spots_api.init_app(app)
# ---- Timed jobs: pre-departure checks once a minute, even with no page open --
jobs.start(app)


@app.cli.command("init-db")
@click.option("--reset", is_flag=True, help="Delete ALL data and start again with empty tables.")
def init_db(reset):
    """Create the tables (an empty database). Safe to run again: existing data is kept."""
    if reset:
        click.confirm("This deletes every account, report and comment. Continue?", abort=True)
        db.drop_all()
    db.create_all()
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    click.echo("Database ready: " + app.config["SQLALCHEMY_DATABASE_URI"])


@app.cli.command("create-user")
@click.option("--name", prompt="Full name")
@click.option("--login", prompt="Email or mobile number")
@click.password_option("--password", prompt="Password")
@click.option("--moderator", is_flag=True, help="Give the account the moderator role.")
def create_user(name, login, password, moderator):
    """Add an account from the command line (moderators are created this way)."""
    if not accounts.login_is_valid(login):
        raise click.ClickException("Enter a valid email or a mobile number like 0917 123 4567.")
    if not accounts.password_is_strong(password):
        raise click.ClickException("Use at least 8 characters, a number, and upper and lower case letters.")
    login = accounts.norm_login(login)
    if User.query.filter_by(login=login).first():
        raise click.ClickException("That email or number is already registered.")
    user = User(name=name.strip(), login=login, role="moderator" if moderator else "user")
    user.set_password(password)
    user.settings = NotificationSettings()
    db.session.add(user)
    db.session.commit()
    click.echo("Created %s #%d: %s" % (user.role, user.id, user.login))


@app.cli.command("set-password")
@click.option("--login", prompt="Email or mobile number of the account")
@click.password_option("--password", prompt="New password")
def set_password(login, password):
    """Set someone's password by hand. Asks for the new password; nothing is shown."""
    user = User.query.filter_by(login=accounts.norm_login(login)).first()
    if user is None:
        raise click.ClickException("No account with that email or number.")
    if not accounts.password_is_strong(password):
        raise click.ClickException("Use at least 8 characters, a number, and upper and lower case letters.")
    user.set_password(password)
    db.session.commit()
    click.echo("New password set for %s #%d (%s). Tell them to sign in with it." % (user.role, user.id, user.login))


@app.cli.command("sample-spots")
@click.argument("state", required=False, type=click.Choice(["on", "off"]))
def sample_spots(state):
    """Turn the 40 SAMPLE flood spots (static/data/flood-spots.js) on or off. With no argument, show which it is."""
    if state:
        spots_data.set_sample_spots(state == "on")
    on = spots_data.sample_spots_on()
    click.echo("Sample flood spots are %s. Real spots in the log: %d." % ("ON (they count as recurring spots)" if on else "OFF (only real sightings count)",
                                                                         FloodSpot.query.count()))
    if state and os.environ.get("FDA_SAMPLE_SPOTS") in ("0", "1"):
        click.echo("Note: FDA_SAMPLE_SPOTS=%s is set in the environment and overrides this." % os.environ["FDA_SAMPLE_SPOTS"])


@app.cli.command("import-spots")
@click.argument("csv_file", type=click.Path(exists=True, dir_okay=False))
def import_spots(csv_file):
    """Add real flood sightings from a CSV file to the flood-spot log.

    Columns (first row = names): barangay, corner, date (YYYY-MM-DD), depth (gutter|tire|knee|waist),
    and optionally street, pass (all|light-no|none), times, lat, lng, source, url.
    Without lat/lng the spot is put at the barangay's centre. The same barangay + corner again adds to its count.
    """
    import csv
    import re
    from agent import barangay_centre
    from database import DEPTHS, PASSABLE
    added = updated = 0
    problems = []
    with open(csv_file, newline="", encoding="utf-8-sig") as f:
        for n, row in enumerate(csv.DictReader(f), start=2):
            row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
            b, corner, date, depth = row.get("barangay", ""), " ".join(row.get("corner", "").split())[:120], row.get("date", ""), row.get("depth", "").lower()
            passable, times = row.get("pass", "").lower() or "all", row.get("times", "") or "1"
            bad = (None if b in accounts.barangay_districts() else "unknown barangay %r" % b) \
                or (None if corner else "no corner") \
                or (None if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) else "date must be YYYY-MM-DD") \
                or (None if depth in DEPTHS else "depth must be one of " + ", ".join(DEPTHS)) \
                or (None if passable in PASSABLE else "pass must be one of " + ", ".join(PASSABLE)) \
                or (None if times.isdigit() and int(times) >= 1 else "times must be a whole number")
            try:
                lat, lng = (float(row["lat"]), float(row["lng"])) if row.get("lat") and row.get("lng") else barangay_centre(b) or (None, None)
                if not bad and not (spots_api.QC_BOUNDS[0] <= lat <= spots_api.QC_BOUNDS[1] and spots_api.QC_BOUNDS[2] <= lng <= spots_api.QC_BOUNDS[3]):
                    bad = "lat/lng is outside Quezon City"
            except (TypeError, ValueError):
                bad = bad or "lat/lng must be numbers"
            if bad:
                problems.append("row %d: %s" % (n, bad))
                continue
            same = next((s for s in FloodSpot.query.filter_by(barangay=b) if s.corner.lower() == corner.lower()), None)
            if same is not None:
                same.times += int(times)
                same.last_seen = max(same.last_seen or "", date)
                if spots_api.DEPTH_RANK[depth] > spots_api.DEPTH_RANK.get(same.worst_depth, -1):
                    same.worst_depth = depth
                updated += 1
            else:
                db.session.add(FloodSpot(barangay=b, corner=corner, street=row.get("street", "")[:120] or re.split(r" cor\.? ", corner, flags=re.I)[0],
                                         times=int(times), worst_depth=depth, passable=passable, last_seen=date, lat=lat, lng=lng,
                                         source=row.get("source", "")[:120] or "Imported", source_url=row.get("url", "")[:300] or None))
                db.session.flush()
                added += 1
    db.session.commit()
    click.echo("Added %d new spot(s), updated %d." % (added, updated))
    for p in problems:
        click.echo("  skipped " + p)
    if added and spots_data.sample_spots_on():
        click.echo("The SAMPLE spots still count too. Run  flask --app app sample-spots off  to use only real sightings.")


@app.cli.command("seed-demo")
def seed_demo():
    """Build the sample data (instance/demo.db) from scratch: 15 users, 20 reports with real QC flood photos, and more.
    Run it with FDA_DEMO=1 set; it never touches the real database."""
    import demo_seed
    if not app.config["SQLALCHEMY_DATABASE_URI"].replace("\\", "/").endswith("/demo.db"):
        raise click.ClickException("This would replace the database in use. Set FDA_DEMO=1 first "
                                   "(PowerShell: $env:FDA_DEMO = \"1\"), then run this again.")
    if get_model() is None:
        raise click.ClickException("The trained model is needed to check the demo photos: " + str(_model["error"]))
    click.echo("Checking 20 photos with the model and running the agent...")
    counts = demo_seed.seed(app, photo_probability, echo=click.echo)
    demo_seed.write_credits(os.path.join(app.root_path, "demo", "CREDITS.md"))
    click.echo("Demo data ready: " + ", ".join("%d %s" % (v, k) for k, v in counts.items()))
    click.echo("Sign in as moderator@example.com or maria.santos@example.com (any demo user), password %s" % demo_seed.PASSWORD)


# ---- Image classifier (Module 6) ---------------------------------------------
# MobileNetV2 fine-tuned on Flood10K. The model has one sigmoid output, P(flood),
# and does its own [-1, 1] scaling (a Rescaling layer), so it is given raw
# 0-255 RGB pixels at 224 x 224. Do not scale the pixels here as well.
MODEL_PATH = os.environ.get("FLOOD_MODEL", os.path.join(app.root_path, "models", "flood_model.keras"))
IMG_SIZE = (224, 224)
_model = {"net": None, "error": None, "loaded": False}
_model_lock = threading.Lock()


def get_model():
    """Load the model once, on first use. Returns None (and remembers why) if it cannot be loaded."""
    with _model_lock:
        if not _model["loaded"]:
            _model["loaded"] = True
            if not os.path.isfile(MODEL_PATH):
                _model["error"] = "Model file not found: " + MODEL_PATH
            else:
                try:
                    import tensorflow as tf  # imported here so the site runs without TensorFlow
                    _model["net"] = tf.keras.models.load_model(MODEL_PATH)
                except Exception as exc:  # TensorFlow missing, wrong version, damaged file...
                    _model["error"] = "Could not load the model: %s" % exc
                    app.logger.error(_model["error"])
        return _model["net"]


def prepare_photo(data):
    """Bytes of an uploaded photo -> a (1, 224, 224, 3) float32 array of 0-255 RGB pixels."""
    import numpy as np
    from PIL import Image, ImageOps

    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)  # phone photos are often stored sideways
    img = img.convert("RGB").resize(IMG_SIZE, Image.BILINEAR)
    return np.asarray(img, dtype="float32")[None, ...]


def photo_probability(data):
    """P(flood) for the bytes of a photo, from the trained model; None when the model is not loaded."""
    net = get_model()
    if net is None:
        return None
    return min(1.0, max(0.0, float(net.predict(prepare_photo(data), verbose=0).ravel()[0])))


app.config.setdefault("PHOTO_CHECK", photo_probability)   # reports_api re-checks every new report with it


@app.get("/api/model-status")
def model_status():
    net = get_model()
    return jsonify(ready=net is not None, error=None if net is not None else _model["error"])


@app.post("/api/classify")
def classify():
    """Form field 'photo' (an image file) -> {"prob": P(flood) from 0 to 1, "source": "server"}."""
    net = get_model()
    if net is None:
        return jsonify(error=_model["error"]), 503
    photo = request.files.get("photo")
    if photo is None:
        return jsonify(error="Send the image as the form field 'photo'."), 400
    try:
        x = prepare_photo(photo.read())
    except Exception:
        return jsonify(error="That file could not be read as a photo."), 400
    prob = float(net.predict(x, verbose=0).ravel()[0])
    return jsonify(prob=min(1.0, max(0.0, prob)), source="server")


# ---- Public pages -----------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/weather")
def weather():
    return render_template("weather.html")


@app.route("/reports")
def reports():
    return render_template("reports.html")


@app.route("/reports/<int:report_id>")
def report_details(report_id):
    return render_template("report-details.html", report_id=report_id)


@app.route("/report")
def report():
    return render_template("report.html")


@app.route("/result")
def result():
    return render_template("result.html")


@app.route("/map")
def map_view():
    return render_template("map.html")


@app.route("/areas")
def areas():
    return render_template("areas.html")


# ---- Signed-in pages --------------------------------------------------------
@app.route("/routes")
def routes():
    return render_template("routes.html")


@app.route("/schedules")
def schedules():
    return render_template("schedules.html")


@app.route("/notifications")
def notifications():
    return render_template("notifications.html")


# ---- Moderator area ---------------------------------------------------------
@app.route("/moderation")
def moderation():
    return render_template("moderation.html")


# ---- Accounts ---------------------------------------------------------------
@app.route("/auth/login")
def login():
    return render_template("auth/login.html")


@app.route("/auth/register")
def register():
    return render_template("auth/register.html")


# ---- The pages link to each other with ".html" names (so they also open from disk) ----
# Serve those links too: /map.html, /areas.html, /auth/login.html ...
@app.route("/<path:page>.html")
def html_page(page):
    path = os.path.normpath(os.path.join(app.root_path, "templates", page + ".html"))
    if not path.startswith(os.path.join(app.root_path, "templates") + os.sep) or not os.path.isfile(path):
        abort(404)
    return render_template(page + ".html")


if __name__ == "__main__":
    os.environ.setdefault("FDA_JOBS", "1")
    jobs.start(app)
    app.run(debug=True, use_reloader=False)
