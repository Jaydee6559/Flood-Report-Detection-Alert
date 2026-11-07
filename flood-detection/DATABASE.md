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
flask --app app set-password               # set someone's password by hand (prompts); people can also use "Forgot password?"
flask --app app sample-spots off           # stop counting the 40 SAMPLE flood spots (on / off / no argument = show)
flask --app app import-spots spots.csv     # add real flood sightings: barangay, corner, date, depth [, street, pass, times, lat, lng, source, url]
```

`flask --app app init-db --reset` deletes everything and starts again with empty tables. It asks first.
Columns added in later steps are added to an existing `flood.db` automatically when the app starts, so you don't need to reset.

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
| `password_resets` | "Forgot password?" codes: user, hashed code, expiry, wrong tries, used | 1 |
| `notification_settings` | One row per user: on/off for area, route, schedule, report and "all clear" alerts | 12 |
| `watched_barangays` | The "Alert me" list (user + barangay) | 3, 12 |
| `reports` | One flood report: place, photo file, P from MobileNetV2, model source, Rule 1 start status and final status, note, recommendation, reasons and inputs (JSON), possible / confirmed duplicate, moderator review | 5–8, 13 |
| `confirmations` | "Still flooded" / "Not flooded", one per user per report | 9 |
| `comments` | Comments on a report; moderators can remove them | 9, 13 |
| `flags` | A user reporting a report or a comment to moderators, one per user per item | 9, 13 |
| `routes` | Saved routes: start and end (label, position, the place picked), the street route as `[[lat, lng], ...]`, segments, points added on the map | 10 |
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
| `POST /api/auth/forgot` | `{login}`. Makes a 6-digit code (valid 15 min, 5 tries) and emails it when `MAIL_SERVER` is set, otherwise prints it in the server console. The same answer whether or not the account exists |
| `POST /api/auth/reset` | `{login, code, password, confirm}`. A right code sets the new password and signs in; the code then stops working |

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
| `POST /api/reports/<id>/delete` | The reporter only. Deletes the report, its photo, comments, confirmations, flags and the notifications about it. The `agent_decisions` row stays, with `report_id` empty |
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

## Routes and schedules (connected)

Saved routes and travel schedules go through `routes_api.py` and the `routes` and `schedules` tables. Everyone only ever
sees and changes their own.

| Route | What it does |
|---|---|
| `GET /api/my.js` | A small script for the pages: `window.FDA_MY = {routes, schedules}` of the signed-in person (empty for a guest) |
| `POST /api/routes` | A new route: name, start and end (label, position and the barangay / street / landmark picked), the street line, its streets, points added on the map, snap or freehand, distance |
| `POST /api/routes/<id>` | Save changes. Moving the start or end makes today's schedule check run again |
| `POST /api/routes/<id>/alert` | `{alert: true \| false}` |
| `POST /api/routes/<id>/delete` | Also deletes the route's schedules |
| `POST /api/schedules` | `{routeId, days: [0-6, 0 = Sunday], time: "06:45", before: 15 \| 30 \| 45 \| 60}` |
| `POST /api/schedules/<id>` | Save changes (today's check runs again) |
| `POST /api/schedules/<id>/enabled` | `{enabled: true \| false}` |
| `POST /api/schedules/<id>/checked` | The page ran today's pre-departure check |
| `POST /api/schedules/<id>/delete` | |
| `POST /api/my/import` | Once: the routes and schedules a browser saved before this step |

- Positions must be inside Metro Manila. A route can have up to 30 added points; a person up to 50 routes and 100 schedules.
- `routes.start_place` and `routes.end_place` were added in this step. **An older `flood.db` gets them automatically** when
  the app starts (`add_missing_columns()` in `database.py`); nothing is deleted.
- The first time someone opens the site signed in after this step, the routes and schedules saved in that browser are
  sent to the server once, then the page reloads.
- The pre-departure check still runs in the page while a page is open (`core/scheduler.js`); the server remembers that
  it ran today, so another page or device doesn't run it again.

## Notifications (connected)

Notifications, notification settings and the "Alert me" barangays go through `notifications_api.py` and the
`notifications`, `notification_settings` and `watched_barangays` tables.

**Notifications for other people are made on the server when the thing happens**, so they reach that person on any device:

| What happened | Who is told | Key |
|---|---|---|
| A new "still flooded" on a report | The reporter: "confirmed N times" (one notification, refreshed) | `confirm:<report>` |
| A comment on a report | The reporter (not for their own comments) | `comment:<report>:<comment>` |
| A moderator merged or removed a report | The reporter, with the reason | `dup:<report>`, `removed:<report>` |
| A new flood warning / possible flood with a precise location | Everyone with route alerts on whose saved route passes within 800 m | `route:<report>:<route>` |

**Notifications for yourself are made by the page** (a schedule was set, the pre-departure check, an area rain alert,
"Remind me") and sent with `POST /api/notifications`. The page can't make one for anyone else.

| Route | What it does |
|---|---|
| `GET /api/notifications` | Your latest 200 and the unread count. Open pages ask once a minute, so new ones show without a reload |
| `POST /api/notifications` | `{kind, key, title, text, href, cta, clear}`, for yourself only. Links must be to one of our pages |
| `POST /api/notifications/read` | `{ids: [...]}` or `{all: true}` |
| `POST /api/notifications/settings` | `{route, area, schedule, reports, clear}` (on / off) |
| `POST /api/watch` | `{barangay, on}`: the "Alert me" list on the Flood areas page |

- The same key again refreshes the earlier notification (new text, unread again) instead of adding another.
- A kind that is switched off is not saved at all.
- `/api/my.js` also carries `notifications`, `settings` and `watch`, so pages start with them.

## Flood-spot log (connected)

The moderators' flood-spot log goes through `spots_api.py` and the `flood_spots` table, so every page uses the same
recurring spots for the agent's S input.

| Route | What it does |
|---|---|
| `GET /api/spots.js` | `window.FDA_SPOTS_LOG`, for everyone (app.js loads it). The seed spots in `static/data/flood-spots.js` are added on top |
| `POST /api/spots` | Moderators. `{barangay, corner, street?, date, depth, pass, url?, lat, lng}`. The same barangay + corner again is one more time: `times + 1`, the worst depth, the latest date |
| `POST /api/spots/<id>/delete` | Moderators |

A moderator's sightings saved in the browser before this are sent to the server once, the next time they sign in.

## Agent dashboard

`GET /api/moderation/stats` (moderators) sums up the last 30 days for the "How the agent did" card on the moderation page:
reports per status, how many were raised a step and by which input (hazard, rain, spots, nearby reports), what moderators
did with them, the community's still / not-flooded votes, and which photo check was used.

## Server photo re-check

When the trained model is loaded, the server runs it on every new report's photo (`PHOTO_CHECK` in `app.py`). The report
is refused if the page's starting status is not the band the server's probability gives; otherwise the server's probability
is saved (the page's is kept in `inputs.pageProb`). Without the model, the page's value is saved as before.

## Rate limits

`limits.py` stops one account or connection from flooding the site (counted in memory per server process):

| What | Limit |
|---|---|
| Wrong passwords | 10 per email/number and 50 per connection, per 15 minutes |
| New accounts | 10 per connection per hour |
| Reports | 10 per account per 10 minutes (only saved reports count) |
| Comments / confirmations / flags | 20 / 60 per 10 minutes, 30 per hour |

Over the limit, the server answers 429 with a message the pages show. `app.config["RATE_LIMITS"] = False` turns them off.

## Timed jobs

`jobs.py` runs on the server, so alerts go out even when nobody has the site open. It starts with `flask run`; the
terminal shows "Timed jobs on: …". `FDA_JOBS=0` turns it off.

| Job | How often | What it does |
|---|---|---|
| Pre-departure check | every minute | The same check as `core/scheduler.js` (same notification keys and day format, so a check an open page already ran is not sent twice) |
| Reminders | every minute | "Remind me" reminders that are due become notifications (`reminders` table) |
| Area rain check (Rule 2) | every 15 minutes | Live rain from Open-Meteo for the 6 districts, Rule 2 for all 142 barangays (hazard level, recurring spots, recent reports). A level change is saved in `area_state` and logged in `agent_decisions` (kind `area`); a barangay that becomes **High** alerts everyone who watches it or lives there. With no live rain it skips that run: the server never uses made-up rain |

`POST /api/reminders` `{at (ms), title, text, href}` saves a reminder (signed in; within the next 7 days; up to 20 waiting).

A "Simulated storm" chosen on the map only exists in that browser, so its area alerts are made by the page and say
"Simulated storm". Reminders a browser saved before this are sent to the server once; its old area log is dropped
(the server's `agent_decisions` is the log now).

The `reminders` table is new. The app creates missing tables when it starts, so an older `flood.db` needs no reset.

## Tests

```
pip install -r requirements-dev.txt
python -m pytest
```

The tests (`tests/`) use a temporary database and uploads folder, so `instance/flood.db` and `uploads/` are never touched.
They cover accounts, reports, community, routes and schedules, notifications, the flood-spot log, the photo re-check,
the rate limits, the agent dashboard and the server's pre-departure check.
