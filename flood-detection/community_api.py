"""Community (Modules 9, 13): confirmations, comments and flags, saved in the database.

    POST /api/reports/<id>/confirm        (signed in)  {kind: "still" | "not"}; the same kind again takes the vote back
    POST /api/reports/<id>/flag           (signed in)  {reason}: report a report to the moderators
    GET  /api/reports/<id>/comments                    the comments on a report, newest first
    POST /api/reports/<id>/comments       (signed in)  {text}, up to 200 characters
    POST /api/comments/<id>/flag          (signed in)  {reason}: report a comment to the moderators
    GET  /api/moderation/comments         (moderator)  comments waiting for review
    POST /api/comments/<id>/review        (moderator)  {action: "keep" | "remove"}

Rules: one vote and one flag per account per item (the database enforces it),
nobody confirms or flags their own report or comment, and removed reports and
comments can't be confirmed, commented on or flagged.
A comment is waiting for review when it has flags made after its last review,
so a kept comment comes back only if people report it again.
"""
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy.exc import IntegrityError

from database import Comment, Confirmation, Flag, Report, User, db
from reports_api import counts_for, naive_utc, public

bp = Blueprint("community_api", __name__)

COMMENT_MAX = 200
REASON_MAX = 120


def _ms(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def short_name(name):
    """ "Ana Reyes" -> "Ana R." (comments never show a full name or login)."""
    parts = str(name or "").split()
    if not parts:
        return "User"
    return parts[0] + (" " + parts[-1][0] + "." if len(parts) > 1 else "")


def _report_or_error(report_id, for_writing=True):
    r = db.session.get(Report, report_id)
    if r is None or (r.removed and not (current_user.is_authenticated and (current_user.is_moderator or current_user.id == r.user_id))):
        return None, (jsonify(ok=False, error="There is no report with that number."), 404)
    if for_writing and r.removed:
        return None, (jsonify(ok=False, error="This report was removed."), 400)
    return r, None


def _report_json(r):
    return public(r, counts_for([r], current_user)[r.id], current_user)


def _reason(data):
    return str(data.get("reason") or "").strip()[:REASON_MAX] or None


# ---- Confirmations ("still flooded" / "not flooded") ----------------------------
@bp.post("/api/reports/<int:report_id>/confirm")
@login_required
def confirm(report_id):
    r, err = _report_or_error(report_id)
    if err:
        return err
    kind = (request.get_json(silent=True) or {}).get("kind")
    if kind not in ("still", "not"):
        return jsonify(ok=False, error="Choose still flooded or not flooded."), 400
    if r.user_id == current_user.id:
        return jsonify(ok=False, error="You can't confirm your own report."), 400
    mine = Confirmation.query.filter_by(report_id=r.id, user_id=current_user.id).first()
    if mine is not None and mine.kind == kind:
        db.session.delete(mine)                      # tapping the same button again takes the vote back
    elif mine is not None:
        mine.kind = kind
        mine.created_at = datetime.now(timezone.utc)
    else:
        db.session.add(Confirmation(report_id=r.id, user_id=current_user.id, kind=kind))
    try:
        db.session.commit()
    except IntegrityError:                           # a double tap raced another request: keep the first
        db.session.rollback()
    return jsonify(ok=True, report=_report_json(r))


# ---- Flags ----------------------------------------------------------------------------
def _flag(target, target_id, owner_id):
    if owner_id == current_user.id:
        return jsonify(ok=False, error="You can't report your own %s." % target), 400
    if Flag.query.filter_by(target=target, target_id=target_id, user_id=current_user.id).first():
        return None   # already reported: nothing changes
    db.session.add(Flag(target=target, target_id=target_id, user_id=current_user.id, reason=_reason(request.get_json(silent=True) or {})))
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
    return None


@bp.post("/api/reports/<int:report_id>/flag")
@login_required
def flag_report(report_id):
    r, err = _report_or_error(report_id)
    if err:
        return err
    already = Flag.query.filter_by(target="report", target_id=r.id, user_id=current_user.id).first() is not None
    err = _flag("report", r.id, r.user_id)
    if err:
        return err
    return jsonify(ok=True, already=already, report=_report_json(r))


@bp.post("/api/comments/<int:comment_id>/flag")
@login_required
def flag_comment(comment_id):
    c = db.session.get(Comment, comment_id)
    if c is None or c.removed:
        return jsonify(ok=False, error="That comment was removed."), 404
    already = Flag.query.filter_by(target="comment", target_id=c.id, user_id=current_user.id).first() is not None
    err = _flag("comment", c.id, c.user_id)
    if err:
        return err
    return jsonify(ok=True, already=already)


# ---- Comments -------------------------------------------------------------------------
def comment_json(c, flagged_ids=()):
    me = current_user.id if current_user.is_authenticated else None
    return {
        "id": c.id, "reportId": c.report_id, "author": short_name(c.user.name), "authorId": "u%d" % c.user_id,
        "ts": _ms(c.created_at), "text": c.text, "mine": c.user_id == me, "flaggedByMe": c.id in flagged_ids,
    }


@bp.get("/api/reports/<int:report_id>/comments")
def list_comments(report_id):
    r, err = _report_or_error(report_id, for_writing=False)
    if err:
        return err
    rows = Comment.query.filter_by(report_id=r.id, removed=False).order_by(Comment.id.desc()).limit(500).all()
    flagged = set()
    if current_user.is_authenticated and rows:
        flagged = {f.target_id for f in Flag.query.filter(Flag.target == "comment", Flag.user_id == current_user.id,
                                                          Flag.target_id.in_([c.id for c in rows]))}
    return jsonify(ok=True, comments=[comment_json(c, flagged) for c in rows])


@bp.post("/api/reports/<int:report_id>/comments")
@login_required
def add_comment(report_id):
    r, err = _report_or_error(report_id)
    if err:
        return err
    text = " ".join(str((request.get_json(silent=True) or {}).get("text") or "").split())
    if not text:
        return jsonify(ok=False, error="Write a short comment first."), 400
    if len(text) > COMMENT_MAX:
        return jsonify(ok=False, error="Keep comments to %d characters." % COMMENT_MAX), 400
    c = Comment(report_id=r.id, user_id=current_user.id, text=text)
    db.session.add(c)
    db.session.commit()
    return jsonify(ok=True, comment=comment_json(c))


# ---- Moderation of comments ---------------------------------------------------------
@bp.get("/api/moderation/comments")
@login_required
def comment_queue():
    if not current_user.is_moderator:
        return jsonify(ok=False, error="Only moderators can review comments."), 403
    flags = Flag.query.filter_by(target="comment").order_by(Flag.id).all()
    ids = {f.target_id for f in flags}
    comments = {c.id: c for c in Comment.query.filter(Comment.id.in_(ids), Comment.removed.is_(False))} if ids else {}
    pending = {}
    for f in flags:
        c = comments.get(f.target_id)
        if c is None or (c.reviewed_at is not None and naive_utc(f.created_at) <= naive_utc(c.reviewed_at)):
            continue
        p = pending.setdefault(c.id, {"id": c.id, "reportId": c.report_id, "text": c.text, "author": short_name(c.user.name),
                                      "ts": _ms(c.created_at), "flags": 0, "flagReason": None})
        p["flags"] += 1
        p["flagReason"] = f.reason or p["flagReason"]   # the latest reason given
    day_ago = datetime.now(timezone.utc) - timedelta(days=1)
    reviewed = Comment.query.filter(Comment.reviewed_at >= day_ago).count()
    return jsonify(ok=True, comments=sorted(pending.values(), key=lambda p: -p["flags"]), reviewedToday=reviewed)


@bp.post("/api/comments/<int:comment_id>/review")
@login_required
def review_comment(comment_id):
    if not current_user.is_moderator:
        return jsonify(ok=False, error="Only moderators can review comments."), 403
    c = db.session.get(Comment, comment_id)
    if c is None:
        return jsonify(ok=False, error="That comment no longer exists."), 404
    action = (request.get_json(silent=True) or {}).get("action")
    if action not in ("keep", "remove"):
        return jsonify(ok=False, error="Unknown action."), 400
    c.removed = action == "remove"
    c.reviewed_at = datetime.now(timezone.utc)
    db.session.commit()
    return jsonify(ok=True)


def init_app(app):
    app.register_blueprint(bp)
