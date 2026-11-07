"""Rate limits: stop one person (or one script) from flooding the site.

    too_many("report", user_id)  ->  a 429 JSON response when the limit is reached, otherwise None (and the try is counted)

Each rule is (how many, in how many seconds). Counts are kept in memory, per server process,
so they reset when the server restarts; that is enough for one Flask server. Set
app.config["RATE_LIMITS"] = False to turn them off (the tests do, except the test of the limits).
"""
import threading
import time
from collections import defaultdict, deque

from flask import current_app, jsonify

RULES = {
    "login": (10, 15 * 60),          # failed sign-ins for one email/number from one address
    "login-ip": (50, 15 * 60),       # failed sign-ins from one address, any account
    "register": (10, 60 * 60),       # new accounts from one address
    "reset": (5, 15 * 60),           # "Forgot password?" codes asked for one email/number
    "reset-ip": (20, 15 * 60),       # ... and from one address, any account
    "reset-code": (10, 15 * 60),     # wrong reset codes typed from one address
    "report": (10, 10 * 60),         # flood reports by one account
    "comment": (20, 10 * 60),
    "confirm": (60, 10 * 60),
    "flag": (30, 60 * 60),
    "notice": (120, 10 * 60),        # notifications a page makes for its own user
}
MESSAGES = {
    "login": "Too many wrong passwords. Wait 15 minutes, then try again.",
    "login-ip": "Too many wrong passwords. Wait 15 minutes, then try again.",
    "register": "Too many new accounts from this connection. Try again later.",
    "reset": "Too many reset codes asked for. Wait 15 minutes, then try again.",
    "reset-ip": "Too many reset codes asked for. Wait 15 minutes, then try again.",
    "reset-code": "Too many wrong codes. Wait 15 minutes, then try again.",
}
DEFAULT_MESSAGE = "You're doing that too often. Wait a few minutes, then try again."

_hits = defaultdict(deque)
_lock = threading.Lock()


def _enabled():
    return current_app.config.get("RATE_LIMITS", True)


def _over(kind, key, count):
    """True when this key already used up the rule. count=True also records this try."""
    limit, window = RULES[kind]
    now = time.monotonic()
    with _lock:
        q = _hits[(kind, key)]
        while q and q[0] <= now - window:
            q.popleft()
        if len(q) >= limit:
            return True
        if count:
            q.append(now)
        return False


def blocked(kind, key):
    """A 429 response if this key is over the limit (without counting a try), else None."""
    if not _enabled() or not _over(kind, key, count=False):
        return None
    return jsonify(ok=False, error=MESSAGES.get(kind, DEFAULT_MESSAGE)), 429


def count(kind, key):
    """Count one try (for example a wrong password)."""
    if _enabled():
        _over(kind, key, count=True)


def too_many(kind, key):
    """Check and count in one go: a 429 response when over the limit, else None."""
    if not _enabled() or not _over(kind, key, count=True):
        return None
    return jsonify(ok=False, error=MESSAGES.get(kind, DEFAULT_MESSAGE)), 429


def reset():
    with _lock:
        _hits.clear()
