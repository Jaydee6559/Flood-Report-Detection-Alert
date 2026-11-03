"""Database tables (Flask-SQLAlchemy + SQLite).

The database starts EMPTY: there is no sample data. Create accounts with the
register page, and moderators with  flask create-user --moderator .

Rules the tables follow:
- Only signed-in users can report, confirm, comment or flag. Guests can only view,
  so every one of those rows has a user_id.
- Counts ("5 say still flooded", "reported by 2 users") are not stored; they are
  counted from the confirmations and flags rows, so nobody can vote twice and every
  row can become a training label later (PDF p. 3, "Learning over time").
- Photos are saved as files in the uploads folder; reports only keep the file name.
- Barangays and the hazard map stay as data files in static/data/ (read-only
  reference data); tables refer to a barangay by its name, as in locations.json.
- All times are UTC.
"""
from datetime import datetime, timezone

from flask_login import UserMixin
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from werkzeug.security import check_password_hash, generate_password_hash


class Base(DeclarativeBase):
    pass


db = SQLAlchemy(model_class=Base)


@event.listens_for(Engine, "connect")
def _sqlite_foreign_keys(dbapi_connection, connection_record):
    """SQLite ignores foreign keys unless asked. Turn them on, so a report can't point to a missing
    user and deleting a report also deletes its confirmations and comments."""
    if type(dbapi_connection).__module__.startswith("sqlite3"):
        cur = dbapi_connection.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


def utcnow():
    return datetime.now(timezone.utc)


# Columns added after the first release. create_all() makes new tables but never changes an
# existing one, so these are added here, once, without touching the rows already saved.
ADDED_COLUMNS = {
    "routes": {"start_place": "JSON", "end_place": "JSON"},
}


def add_missing_columns():
    """Bring an older database up to date by adding the columns in ADDED_COLUMNS (safe to run every start)."""
    from sqlalchemy import inspect, text
    insp = inspect(db.engine)
    names = insp.get_table_names()
    with db.engine.begin() as conn:
        for table, cols in ADDED_COLUMNS.items():
            if table not in names:
                continue      # create_all() will make it with every column
            have = {c["name"] for c in insp.get_columns(table)}
            for col, sql_type in cols.items():
                if col not in have:
                    conn.execute(text('ALTER TABLE "%s" ADD COLUMN "%s" %s' % (table, col, sql_type)))


def _one_of(column, values):
    return CheckConstraint("%s IN (%s)" % (column, ", ".join("'%s'" % v for v in values)), name="ck_%s" % column)


ROLES = ("user", "moderator")
STATUSES = ("flood-warning", "possible-flood", "unclear-photo", "no-flood")   # agent Rule 1 results
REVIEWS = ("approved", "duplicate", "later", "removed")                       # moderator actions
VOTES = ("still", "not")                                                      # "still flooded" / "not flooded"
FLAG_TARGETS = ("report", "comment")
NOTICE_KINDS = ("area", "route", "schedule", "report")
DECISION_KINDS = ("photo", "area")                                           # Rule 1 / Rule 2
AREA_LEVELS = ("high", "elevated", "low")                                    # Rule 2 results
DEPTHS = ("gutter", "tire", "knee", "waist")                                 # MMDA depth words
PASSABLE = ("all", "light-no", "none")


# ---- Accounts (Module 1) ------------------------------------------------------
class User(UserMixin, db.Model):
    __tablename__ = "users"
    __table_args__ = (_one_of("role", ROLES),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    login: Mapped[str] = mapped_column(String(120), unique=True)      # email or mobile number, stored lower-case
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="user")
    home_district: Mapped[int | None]                                  # 1-6, optional
    home_barangay: Mapped[str | None] = mapped_column(String(80))      # optional, gets area rain alerts
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    settings: Mapped["NotificationSettings"] = relationship(back_populates="user", uselist=False, cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    @property
    def is_moderator(self):
        return self.role == "moderator"


class NotificationSettings(db.Model):
    """Which alerts a user wants (Notifications page > Notification settings)."""
    __tablename__ = "notification_settings"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    area: Mapped[bool] = mapped_column(default=True)        # rain / flood risk in my barangays
    route: Mapped[bool] = mapped_column(default=True)       # a report along a saved route
    schedule: Mapped[bool] = mapped_column(default=True)    # pre-departure check results
    reports: Mapped[bool] = mapped_column(default=True)     # confirmations, comments, moderator actions on my reports
    all_clear: Mapped[bool] = mapped_column(default=False)  # also tell me when a check finds nothing

    user: Mapped[User] = relationship(back_populates="settings")


class WatchedBarangay(db.Model):
    """The "Alert me" list on the Flood areas page."""
    __tablename__ = "watched_barangays"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    barangay: Mapped[str] = mapped_column(String(80), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


# ---- Reports and community (Modules 5-9) --------------------------------------
class Report(db.Model):
    __tablename__ = "reports"
    __table_args__ = (
        _one_of("status", STATUSES),
        _one_of("start_status", STATUSES),
        CheckConstraint("review IS NULL OR review IN (%s)" % ", ".join("'%s'" % v for v in REVIEWS), name="ck_review"),
        CheckConstraint("prob >= 0 AND prob <= 1", name="ck_prob"),
        Index("ix_reports_created_at", "created_at"),
        Index("ix_reports_barangay", "barangay"),
        {"sqlite_autoincrement": True},   # report numbers start at 1 and are never reused
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))      # reporting needs an account
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    # where
    barangay: Mapped[str] = mapped_column(String(80))
    street: Mapped[str | None] = mapped_column(String(120))
    lat: Mapped[float]
    lng: Mapped[float]
    location_precise: Mapped[bool] = mapped_column(default=False)    # False = only the barangay centre is known
    description: Mapped[str | None] = mapped_column(String(500))

    # the photo and the model (Module 6)
    photo_file: Mapped[str] = mapped_column(String(255))              # file name inside the uploads folder
    prob: Mapped[float]                                               # P(flood) from MobileNetV2
    model_source: Mapped[str] = mapped_column(String(20))             # "server" (trained model) or "demo"

    # the agent, Rule 1 (Module 7)
    start_status: Mapped[str] = mapped_column(String(20))             # from P alone
    status: Mapped[str] = mapped_column(String(20))                   # after H, R, S and N
    note: Mapped[str | None] = mapped_column(String(200))
    recommendation: Mapped[str | None] = mapped_column(Text)
    reasons: Mapped[list] = mapped_column(db.JSON, default=list)      # every reason shown on the result page
    inputs: Mapped[dict] = mapped_column(db.JSON, default=dict)       # P, H, R, S, N as the agent saw them

    # duplicates and moderation (Module 13)
    dup_candidate_id: Mapped[int | None] = mapped_column(ForeignKey("reports.id"))
    dup_of_id: Mapped[int | None] = mapped_column(ForeignKey("reports.id"))
    review: Mapped[str | None] = mapped_column(String(20))
    remove_reason: Mapped[str | None] = mapped_column(String(200))
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None]

    user: Mapped[User] = relationship(foreign_keys=[user_id])

    @property
    def removed(self):
        return self.review == "removed"


class Confirmation(db.Model):
    """ "Still flooded" / "Not flooded". One per user per report; changing it updates the row."""
    __tablename__ = "confirmations"
    __table_args__ = (UniqueConstraint("report_id", "user_id", name="uq_confirmation"), _one_of("kind", VOTES))

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class Comment(db.Model):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    removed: Mapped[bool] = mapped_column(default=False)
    reviewed_at: Mapped[datetime | None]

    user: Mapped[User] = relationship()


class Flag(db.Model):
    """A user reporting a report or a comment to the moderators. One per user per item."""
    __tablename__ = "flags"
    __table_args__ = (UniqueConstraint("target", "target_id", "user_id", name="uq_flag"), _one_of("target", FLAG_TARGETS))

    id: Mapped[int] = mapped_column(primary_key=True)
    target: Mapped[str] = mapped_column(String(10))          # "report" or "comment"
    target_id: Mapped[int] = mapped_column(index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    reason: Mapped[str | None] = mapped_column(String(120))  # e.g. "Spam", "Not about this flood"
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


# ---- Routes and alerts (Modules 10-12) ----------------------------------------
class Route(db.Model):
    __tablename__ = "routes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    start_label: Mapped[str] = mapped_column(String(120))
    start_lat: Mapped[float]
    start_lng: Mapped[float]
    start_place: Mapped[dict | None] = mapped_column(db.JSON)  # {barangay, street, name}: what the person picked
    end_label: Mapped[str] = mapped_column(String(120))
    end_lat: Mapped[float]
    end_lng: Mapped[float]
    end_place: Mapped[dict | None] = mapped_column(db.JSON)
    geometry: Mapped[list | None] = mapped_column(db.JSON)    # the street route as [[lat, lng], ...]
    segments: Mapped[list | None] = mapped_column(db.JSON)    # streets and barangays along it
    vias: Mapped[list | None] = mapped_column(db.JSON)        # points the user added on the map
    mode: Mapped[str | None] = mapped_column(String(20))      # "snap" (follows streets) or "free" (drawn by hand)
    distance_m: Mapped[float | None]
    alert: Mapped[bool] = mapped_column(default=True)         # route alerts in the app
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Schedule(db.Model):
    __tablename__ = "schedules"
    __table_args__ = (CheckConstraint("check_before_min BETWEEN 0 AND 240", name="ck_check_before"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    route_id: Mapped[int] = mapped_column(ForeignKey("routes.id", ondelete="CASCADE"))
    days: Mapped[str] = mapped_column(String(7))              # weekday digits, 0 = Sunday: "12345" = weekdays
    depart_time: Mapped[str] = mapped_column(String(5))       # "06:45", Quezon City time
    check_before_min: Mapped[int] = mapped_column(default=30)
    enabled: Mapped[bool] = mapped_column(default=True)
    last_check_at: Mapped[datetime | None]

    route: Mapped[Route] = relationship()


class Notification(db.Model):
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("user_id", "dedupe_key", name="uq_notification_key"), _one_of("kind", NOTICE_KINDS))

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    dedupe_key: Mapped[str] = mapped_column(String(120))     # the same alert is never sent twice, e.g. "route:12:3"
    title: Mapped[str] = mapped_column(String(160))
    text: Mapped[str | None] = mapped_column(String(300))
    link: Mapped[str | None] = mapped_column(String(200))
    cta: Mapped[str | None] = mapped_column(String(40))      # link text, e.g. "View route ->"
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    read: Mapped[bool] = mapped_column(default=False)


# ---- Agent log and moderators (Modules 7, 13) ---------------------------------
class AgentDecision(db.Model):
    """Every agent decision with its inputs (the agent_decisions log, PDF p. 3). Never trimmed."""
    __tablename__ = "agent_decisions"
    __table_args__ = (_one_of("kind", DECISION_KINDS), Index("ix_decisions_created_at", "created_at"))

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    kind: Mapped[str] = mapped_column(String(10))             # "photo" (Rule 1) or "area" (Rule 2)
    report_id: Mapped[int | None] = mapped_column(ForeignKey("reports.id", ondelete="SET NULL"))
    barangay: Mapped[str] = mapped_column(String(80))
    prob: Mapped[float | None]                                # Rule 1 only
    start_status: Mapped[str | None] = mapped_column(String(20))
    result: Mapped[str] = mapped_column(String(20))           # Rule 1 status or Rule 2 level
    hazard: Mapped[str | None] = mapped_column(String(20))    # H
    rain_level: Mapped[str | None] = mapped_column(String(20))  # R, PAGASA level
    rain_mm: Mapped[float | None]
    spots: Mapped[int | None]                                 # S, recurring spots nearby
    nearby_reports: Mapped[int | None]                        # N
    inputs: Mapped[dict] = mapped_column(db.JSON, default=dict)   # everything else the agent used


class AreaState(db.Model):
    """Rule 2's latest result per barangay, so the agent can tell when an area BECOMES high."""
    __tablename__ = "area_state"
    __table_args__ = (_one_of("level", AREA_LEVELS),)

    barangay: Mapped[str] = mapped_column(String(80), primary_key=True)
    level: Mapped[str] = mapped_column(String(10))
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class FloodSpot(db.Model):
    """The flood-spot log: recurring spots moderators add from QCDRRMO / MMDA advisories."""
    __tablename__ = "flood_spots"
    __table_args__ = (
        UniqueConstraint("barangay", "corner", name="uq_spot_corner"),   # the same corner again = times + 1
        _one_of("worst_depth", DEPTHS),
        _one_of("passable", PASSABLE),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    barangay: Mapped[str] = mapped_column(String(80), index=True)
    corner: Mapped[str] = mapped_column(String(120))          # as people say it, e.g. "Banawe cor. Retiro"
    street: Mapped[str | None] = mapped_column(String(120))
    times: Mapped[int] = mapped_column(default=1)
    worst_depth: Mapped[str] = mapped_column(String(10))
    passable: Mapped[str] = mapped_column(String(10), default="all")
    last_seen: Mapped[str] = mapped_column(String(10))        # "2025-09-29"
    lat: Mapped[float]
    lng: Mapped[float]
    source: Mapped[str | None] = mapped_column(String(120))   # e.g. "MMDA advisory"
    source_url: Mapped[str | None] = mapped_column(String(300))
    added_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
