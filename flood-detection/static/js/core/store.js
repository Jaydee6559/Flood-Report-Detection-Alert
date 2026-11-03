/**
 * Data store
 *
 * Reports come from the Flask server (reports_api.py): app.js loads
 * /api/reports.js before this file, which sets window.FDA_REPORTS. They are
 * kept in memory only, never in localStorage, and new reports and moderator
 * actions are sent to the server (see pages/report.js and pages/moderation.js).
 *
 * Everything else the pages save (comments, confirmations, routes, schedules,
 * notifications, settings) still lives in this browser's localStorage under one
 * key, until the next steps move it to the database.
 *
 * Confirmations ("still flooded" / "not flooded") made in this browser are added
 * on top of the server's counts, so they still show until step 4 moves them.
 */
(function () {
  "use strict";

  var FDA = (window.FDA = window.FDA || {});
  var KEY = "fda.demo.v3";
  var VERSION = 4;
  var db = null;

  function empty() {
    return {
      version: VERSION,
      users: [],          // the signed-in account is copied here by core/auth.js
      comments: [],
      votes: {},          // "reportId|userId" -> "still" | "not"  (this browser only, until step 4)
      voteTs: {},         // reportId -> when this browser last confirmed it
      routes: [],
      schedules: [],
      notifications: [],
      settings: {},
      meta: { nextComment: 1, nextRoute: 1, nextSchedule: 1, nextNotice: 1 }
    };
  }

  /** Add this browser's confirmations on top of the server's counts. */
  function withLocalVotes(r) {
    if (!db || !db.votes) return r;
    Object.keys(db.votes).forEach(function (k) {
      if (+k.split("|")[0] === r.id && (db.votes[k] === "still" || db.votes[k] === "not")) r[db.votes[k]] = (r[db.votes[k]] || 0) + 1;
    });
    var t = db.voteTs && db.voteTs[r.id];
    if (t && (!r.lastConfirmTs || t > r.lastConfirmTs)) r.lastConfirmTs = t;
    return r;
  }

  function load() {
    var raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { /* storage blocked: keep in memory */ }
    if (raw) {
      try { db = JSON.parse(raw); } catch (e) { db = null; }
    }
    if (db && db.version === 3) {
      // Step 3: reports moved to the server. The old sample reports, and the comments and
      // votes that pointed at them, are dropped; routes, schedules and settings are kept.
      delete db.reports;
      db.comments = []; db.votes = {}; db.voteTs = {};
      db.meta = db.meta || {}; db.meta.nextComment = 1; delete db.meta.nextReport; delete db.meta.seededAt;
      db.version = VERSION;
    }
    if (!db || db.version !== VERSION) db = empty();
    db.voteTs = db.voteTs || {};
    db.reports = (window.FDA_REPORTS || []).map(withLocalVotes);
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
      withLocalVotes(rep);
      if (cur) { Object.keys(cur).forEach(function (k) { if (!(k in rep)) delete cur[k]; }); Object.assign(cur, rep); return cur; }
      list.unshift(rep);
      return rep;
    },
    /** Throw away this browser's data (routes, comments, notifications...). Reports stay on the server. */
    reset: function () { try { window.localStorage.removeItem(KEY); } catch (e) {} db = null; load(); },
    nextId: function (name) { var m = FDA.store.db().meta; var id = m[name] || 1; m[name] = id + 1; return id; },
    /** Anonymous id for guests, so one device gets one confirmation per report. */
    deviceId: function () {
      try {
        var id = window.localStorage.getItem("fda.device");
        if (!id) { id = "d" + Math.random().toString(36).slice(2, 10); window.localStorage.setItem("fda.device", id); }
        return id;
      } catch (e) { return "d-session"; }
    }
  };
})();
