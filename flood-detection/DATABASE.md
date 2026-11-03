# Database

SQLite through Flask-SQLAlchemy. The tables are defined in `database.py`.
The file lives at `flood-detection/instance/flood.db`, and uploaded photos go in `flood-detection/uploads/`.
Neither is committed to git.

## Setup

From the `flood-detection` folder, with the virtual environment active:

```
pip install -r requirements.txt
flask --app app init-db                    # creates the empty tables (safe to run again)
flask --app app create-user --moderator    # the first moderator (prompts for name, login, password)
```

`flask --app app init-db --reset` deletes everything and starts again with empty tables. It asks first.

## Decisions

- **The database starts empty.** There is no sample data. Report numbers start at **#1** and are never reused.
- **Guests can only view.** Reporting, confirming, commenting and flagging need an account, so those rows always have a `user_id`.
- **Moderators are created by an administrator** with `create-user --moderator`. The register page only makes normal users.
- **Counts are counted, not stored.** "5 say still flooded" = rows in `confirmations`, "reported by 2 users" = rows in `flags`.
  This stops double votes, and every row can become a training label for the learning phase.
- **Photos are files.** `reports.photo_file` is the file name inside `uploads/`.
- **Barangays and the hazard map stay as data files** in `static/data/` (read-only reference data). Tables name a barangay
  exactly as in `locations.json`.
- **Times are UTC.** Convert to Quezon City time (UTC+8) when showing them. `schedules.depart_time` is Quezon City time.

## Tables

| Table | What it holds | Module |
|---|---|---|
| `users` | Accounts: name, login (email or mobile, lower-case, unique), Werkzeug password hash, role (`user` / `moderator`), optional home district and barangay | 1 |
| `notification_settings` | One row per user: on/off for area, route, schedule, report and "all clear" alerts | 12 |
| `watched_barangays` | The "Alert me" list (user + barangay) | 3, 12 |
| `reports` | One flood report: place, photo file, P from MobileNetV2, model source, Rule 1 start status and final status, note, recommendation, reasons and inputs (JSON), possible / confirmed duplicate, moderator review | 5–8, 13 |
| `confirmations` | "Still flooded" / "Not flooded", one per user per report | 9 |
| `comments` | Comments on a report; moderators can remove them | 9, 13 |
| `flags` | A user reporting a report or a comment to moderators, one per user per item | 9, 13 |
| `routes` | Saved routes: start and end, the street route as GeoJSON, segments, points added on the map | 10 |
| `schedules` | Departure days and time for a route, and how long before to check | 11 |
| `notifications` | In-app notifications; `dedupe_key` stops the same alert being sent twice | 12 |
| `agent_decisions` | Every Rule 1 (photo) and Rule 2 (area) decision with its inputs. Never trimmed: it is the training data for the learning phase | 7 |
| `area_state` | Rule 2's latest level per barangay, to detect when an area becomes High | 3, 7 |
| `flood_spots` | The flood-spot log from QCDRRMO / MMDA advisories; the same corner again adds to `times` | 3, 13 |

Allowed values (checked by the database):

| Column | Values |
|---|---|
| `reports.status`, `start_status` | `flood-warning`, `possible-flood`, `unclear-photo`, `no-flood` |
| `reports.review` | empty, `approved`, `duplicate`, `later`, `removed` |
| `confirmations.kind` | `still`, `not` |
| `flags.target` | `report`, `comment` |
| `notifications.kind` | `area`, `route`, `schedule`, `report` |
| `agent_decisions.kind` | `photo`, `area` |
| `area_state.level` | `high`, `elevated`, `low` |
| `flood_spots.worst_depth` | `gutter`, `tire`, `knee`, `waist` (MMDA words) |
| `flood_spots.passable` | `all`, `light-no`, `none` |

## Accounts (connected)

Register, sign-in and sign-out go through `accounts.py` and the `users` table:

| Route | What it does |
|---|---|
| `GET /api/auth/me.js` | A small script for the pages: `window.FDA_ME` (the user, or `null`) and `window.FDA_CSRF` |
| `GET /api/auth/me` | The same as JSON |
| `POST /api/auth/register` | `{name, login, password, confirm, barangay, agree}`. Same rules as the page; signs the new user in |
| `POST /api/auth/login` | `{login, password, remember}`. "Keep me signed in" = a 30-day cookie |
| `POST /api/auth/logout` | Signs out |

Every POST needs the CSRF token in the `X-CSRFToken` header (`static/js/core/api.js` adds it).
Logins are stored normalised: emails in lower case, mobile numbers as `639…` (so `0917…` and `+63917…` are the same account).
The session cookie is signed with `FLASK_SECRET_KEY`, or with a random key saved once in `instance/secret_key`.

## Reports (connected)

Flood reports, their photos and moderator review go through `reports_api.py` and the `reports` table:

| Route | What it does |
|---|---|
| `GET /api/reports.js` | A small script for the pages: `window.FDA_REPORTS`, the last 30 days of reports, newest first. `?id=<n>` also adds that report if it is older |
| `GET /api/reports` | The same as JSON |
| `POST /api/reports` | Signed in. Form field `photo` (the image) and `data` (JSON: place, P, model, Rule 1 status, note, reasons, inputs). Every value is checked: a barangay from `locations.json`, a pin inside Quezon City, P from 0 to 1, a known status. Also writes a `photo` row to `agent_decisions` |
| `POST /api/reports/<id>/review` | Moderators. `{action: "approve" \| "duplicate" \| "later" \| "remove", reason}`; remove needs a reason |
| `GET /uploads/<file>` | Report photos |

- Photos are re-saved as JPEG (at most 1280 px), which also drops EXIF data such as GPS, under a random file name.
- The pages never get a reporter's name or login, only `ownerId` (`u<number>`), to know which reports are your own.
- A removed report is sent to everyone else as just its number, so the pages can say "This report was removed". Its photo,
  place and the moderator's reason are only shown to the reporter and moderators.
- Values the database has no column for are kept in `reports.inputs`: `evidence` (nearby report numbers) and `depthCm`.
- The photo check and Rule 1 still run in the page; the server checks the values but does not re-run them.

## Community (connected)

Confirmations, comments and flags go through `community_api.py` and the `confirmations`, `comments` and `flags` tables:

| Route | What it does |
|---|---|
| `POST /api/reports/<id>/confirm` | Signed in. `{kind: "still" \| "not"}`. One vote per account; the other kind changes it, the same kind again takes it back |
| `POST /api/reports/<id>/flag` | Signed in. `{reason}` (optional). Sends the report to the moderators' "Reported" queue |
| `GET /api/reports/<id>/comments` | The comments, newest first, with the author's short name ("Ana R.") |
| `POST /api/reports/<id>/comments` | Signed in. `{text}`, up to 200 characters |
| `POST /api/comments/<id>/flag` | Signed in. Sends the comment to the moderators' comment queue |
| `GET /api/moderation/comments` | Moderators. Comments with flags made after their last review, and how many were reviewed today |
| `POST /api/comments/<id>/review` | Moderators. `{action: "keep" \| "remove"}` |

- Nobody confirms or flags their own report, or flags their own comment. Flagging twice changes nothing.
- Removed reports can't be confirmed, commented on or flagged, and removed comments are hidden.
- Each report in `/api/reports.js` carries the counts (`still`, `not`, `lastConfirmTs`, `flags`) and the signed-in
  viewer's own `myVote` and `myFlag`.
- `flags` only counts flags made after the moderator's last review, so an approved report, or a kept comment, comes back to
  the queue only if people report it again.

## Not connected yet

Routes, schedules and notifications still save to the browser (`static/js/core/store.js`). Notifications to a reporter
(their report was confirmed, commented on or removed) only appear in the browser where the action happened, until the
notifications step.
If you change a table before then, run `flask --app app init-db --reset`. There is no migration tool yet.
