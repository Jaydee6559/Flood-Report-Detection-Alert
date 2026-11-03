/**
 * Data store
 *
 * Reports come from the Flask server (reports_api.py): app.js loads
 * /api/reports.js before this file, which sets window.FDA_REPORTS. They are
 * kept in memory only, never in localStorage, and new reports and moderator
 * actions are sent to the server (see pages/report.js and pages/moderation.js).
 *
 * Confirmations, comments and flags are on the server too (community_api.py):
 * each report carries its counts and the viewer's own vote (myVote, myFlag), and
 * the report details page loads its comments from /api/reports/<id>/comments.
 *
 * Everything else the pages save (routes, schedules, notifications, settings)
 * still lives in this browser's localStorage under one key, until the next
 * steps move it to the database.
 */
(function () {
  "use strict";

  var FDA = (window.FDA = window.FDA || {});
  var KEY = "fda.demo.v3";
  var VERSION = 5;
  var db = null;

  function empty() {
    return {
      version: VERSION,
      users: [],          // the signed-in account is copied here by core/auth.js
      routes: [],
      schedules: [],
      notifications: [],
      settings: {},
      meta: { nextRoute: 1, nextSchedule: 1, nextNotice: 1 }
    };
  }

  function load() {
    var raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { /* storage blocked: keep in memory */ }
    if (raw) {
      try { db = JSON.parse(raw); } catch (e) { db = null; }
    }
    if (db && (db.version === 3 || db.version === 4)) {
      // Steps 3 and 4: reports, comments and confirmations moved to the server. What this browser
      // still had of them is dropped; routes, schedules, notifications and settings are kept.
      delete db.reports; delete db.comments; delete db.votes; delete db.voteTs;
      db.meta = db.meta || {};
      delete db.meta.nextReport; delete db.meta.nextComment; delete db.meta.seededAt;
      db.version = VERSION;
    }
    if (!db || db.version !== VERSION) db = empty();
    db.reports = window.FDA_REPORTS || [];
    FDA.store.save();
  }

  FDA.store = {
    /** The whole data object. Change it, then call save(). db.reports is the server's list (saving it does nothing). */
    db: function () { if (!db) load(); return db; },
    save: function () {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(db, function (k, v) { return this === db && k === "reports" ? undefined : v; }));
        return true;
      } catch (e) { FDA.store.lastError = e; return false; }
    },
    /** Put a report the server sent back (new, or after a moderator action) into db.reports. Returns the stored object. */
    putReport: function (rep) {
      var list = FDA.store.db().reports, cur = list.filter(function (x) { return x.id === rep.id; })[0];
      if (cur) { Object.keys(cur).forEach(function (k) { if (!(k in rep)) delete cur[k]; }); Object.assign(cur, rep); return cur; }
      list.unshift(rep);
      return rep;
    },
    /** Throw away this browser's data (routes, schedules, notifications...). Reports and comments stay on the server. */
    reset: function () { try { window.localStorage.removeItem(KEY); } catch (e) {} db = null; load(); },
    nextId: function (name) { var m = FDA.store.db().meta; var id = m[name] || 1; m[name] = id + 1; return id; }
  };
})();
