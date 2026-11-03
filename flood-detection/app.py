"""Flood Detection & Alert: Flask app (pages, the photo classifier and the database).

First time:
    pip install -r requirements.txt
    flask --app app init-db                       (creates instance/flood.db, empty)
    flask --app app create-user --moderator       (the first moderator account)
Run:
    flask --app app run --debug                   (then open http://127.0.0.1:5000)

The trained model goes in  models/flood_model.keras  (see models/README.md).
Without it, or without TensorFlow installed, the site still runs and the
report page falls back to the demo estimate.
The tables are in database.py and described in DATABASE.md.
"""
import io
import os
import threading

import click
from flask import Flask, abort, jsonify, render_template, request

from database import NotificationSettings, User, db

app = Flask(__name__)  # templates/ and static/ sit next to this file
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # photos up to 10 MB


# ---- Database ---------------------------------------------------------------
# SQLite file in the instance/ folder (not committed). Photos go in uploads/ (not committed).
os.makedirs(app.instance_path, exist_ok=True)
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
    "DATABASE_URL", "sqlite:///" + os.path.join(app.instance_path, "flood.db"))
app.config["UPLOAD_FOLDER"] = os.environ.get("UPLOAD_FOLDER", os.path.join(app.root_path, "uploads"))
db.init_app(app)


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
    login = login.strip().lower()
    if User.query.filter_by(login=login).first():
        raise click.ClickException("That email or number is already registered.")
    user = User(name=name.strip(), login=login, role="moderator" if moderator else "user")
    user.set_password(password)
    user.settings = NotificationSettings()
    db.session.add(user)
    db.session.commit()
    click.echo("Created %s #%d: %s" % (user.role, user.id, user.login))


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
    app.run(debug=True)
