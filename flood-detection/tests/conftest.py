"""Shared setup for the tests. Run from the flood-detection folder:

    pip install -r requirements-dev.txt
    python -m pytest

Every test gets an empty database and an empty uploads folder in a temporary directory, so your
instance/flood.db and uploads/ are never touched. The trained model is not loaded (PHOTO_CHECK is off
unless a test sets a fake one), rate limits are off unless a test turns them on, and the timed jobs
do not start.
"""
import io
import json
import os
import re
import shutil
import sys
import tempfile

import pytest

TMP = tempfile.mkdtemp(prefix="fda-tests-")
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(TMP, "test.db")
os.environ["UPLOAD_FOLDER"] = os.path.join(TMP, "uploads")
os.environ["FLASK_SECRET_KEY"] = "tests-only-secret"
os.environ["FDA_JOBS"] = "0"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app as flask_app  # noqa: E402  (the settings above must come first)
from database import NotificationSettings, User, db  # noqa: E402
import limits  # noqa: E402

PASSWORD = "Flood12345"


@pytest.fixture(autouse=True)
def app():
    flask_app.config.update(TESTING=True, RATE_LIMITS=False, PHOTO_CHECK=None)
    with flask_app.app_context():
        db.drop_all()
        db.create_all()
    shutil.rmtree(os.environ["UPLOAD_FOLDER"], ignore_errors=True)
    os.makedirs(os.environ["UPLOAD_FOLDER"])
    limits.reset()
    yield flask_app


class Client:
    """A browser: keeps its cookies and the CSRF token the server hands out, like static/js/core/api.js."""

    def __init__(self, app):
        self.c = app.test_client()
        page = self.c.get("/api/auth/me.js").get_data(as_text=True)
        self.token = json.loads(re.search(r'FDA_CSRF = (".*?");', page).group(1))

    def get(self, url):
        return self.c.get(url)

    def post(self, url, **kw):
        r = self.c.post(url, headers={"X-CSRFToken": self.token}, **kw)
        if r.is_json and isinstance(r.json, dict) and isinstance(r.json.get("csrf"), str):
            self.token = r.json["csrf"]
        return r

    def script(self, url, name):
        """The value a /api/*.js script sets, e.g. script("/api/my.js", "FDA_MY")."""
        return json.loads(re.search(r"window\.%s = (.*?);\n" % name, self.get(url).get_data(as_text=True)).group(1))

    @property
    def me(self):
        return self.script("/api/auth/me.js", "FDA_ME")

    def notes(self):
        return self.get("/api/notifications").json["notifications"]

    def report(self, **over):
        data = {"barangay": "Culiat", "street": "Tandang Sora Ave.", "lat": 14.666, "lng": 121.054, "location": "precise",
                "desc": "Knee deep", "prob": 0.91, "model": "server", "status": "flood-warning", "startStatus": "flood-warning",
                "note": "The photo clearly shows flooding.", "recommendation": "Avoid the area.",
                "reasons": [{"key": "P", "title": "Photo: 91%", "detail": "x", "effect": "start"}],
                "inputs": {"hazard": "high", "rain": "orange", "rainMm": 18.2, "spots": 1, "reports": 0}}
        data.update(over)
        return self.post("/api/reports", data={"photo": (io.BytesIO(photo()), "photo.jpg"), "data": json.dumps(data)},
                         content_type="multipart/form-data")


def photo(size=(400, 300), exif=False):
    from PIL import Image
    img, out = Image.new("RGB", size, (40, 90, 160)), io.BytesIO()
    if exif:
        e = Image.Exif()
        e[0x010F] = "PhoneMaker"
        img.save(out, "JPEG", exif=e)
    else:
        img.save(out, "JPEG")
    return out.getvalue()


@pytest.fixture
def guest(app):
    return Client(app)


@pytest.fixture
def make_user(app):
    """make_user("Ana Reyes") -> a signed-in Client for a new normal account."""
    def make(name="Ana Reyes", login=None, barangay=""):
        c = Client(app)
        login = login or name.split()[0].lower() + "@example.com"
        r = c.post("/api/auth/register", json={"name": name, "login": login, "password": PASSWORD, "confirm": PASSWORD,
                                                "agree": True, "barangay": barangay})
        assert r.status_code == 200, r.get_data(as_text=True)
        return c
    return make


@pytest.fixture
def moderator(app):
    with app.app_context():
        m = User(name="Mod One", login="mod@example.com", role="moderator")
        m.set_password("Moderate123")
        m.settings = NotificationSettings()
        db.session.add(m)
        db.session.commit()
    c = Client(app)
    assert c.post("/api/auth/login", json={"login": "mod@example.com", "password": "Moderate123"}).status_code == 200
    return c


# A saved route along Tandang Sora Ave., Culiat (used by the routes, notifications and jobs tests)
ROUTE = {"name": "Home to School", "start": "Tandang Sora Ave., Culiat", "end": "Culiat",
         "startPoint": {"barangay": "Culiat", "street": "Tandang Sora Ave.", "lat": 14.668, "lng": 121.050},
         "endPoint": {"barangay": "Culiat", "lat": 14.664, "lng": 121.060},
         "geometry": [[14.668, 121.050], [14.664, 121.060]],
         "segments": [{"street": "Tandang Sora Ave.", "barangay": "Culiat", "lines": [[[14.668, 121.050], [14.664, 121.060]]]}],
         "distanceM": 1150, "vias": [], "mode": "snap"}
