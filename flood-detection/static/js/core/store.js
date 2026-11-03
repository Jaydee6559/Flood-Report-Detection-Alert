/**
 * Data store
 *
 * The prototype has no server yet, so everything the pages save (accounts,
 * reports, comments, routes, schedules, notifications) lives in the browser's
 * localStorage under one key. Every page reads and writes through FDA.store,
 * so when the Flask + SQLite backend exists, this is the one file to swap for
 * calls to the API.
 *
 * First run: the store is filled with SAMPLE reports and comments (#1031–#1043)
 * so the pages are not empty. Accounts are real now (Flask, accounts.py), so there
 * are no sample accounts, routes, schedules or notifications here any more. The
 * sample reports go away when the reports pages move to the database.
 */
(function () {
  "use strict";

  var FDA = (window.FDA = window.FDA || {});
  var KEY = "fda.demo.v3";
  var MIN = 60000;
  var db = null;

  function seed() {
    var now = Date.now();
    var ago = function (m) { return now - m * MIN; };
    var IMG = "../static/img/";

    function report(id, mins, street, barangay, city, lat, lng, prob, status, o) {
      o = o || {};
      return {
        id: id, ownerId: "x" + id, ownerName: "Community reporter",   // sample: not owned by any real account
        ts: ago(mins), city: city, barangay: barangay, street: street, lat: lat, lng: lng,
        desc: o.desc || "", photo: IMG + (o.img || "sample-street-flooded.svg"),
        prob: prob, status: status, note: o.note || "", recommendation: "",
        evidence: o.evidence || [], dupCandidate: o.dup || null, dupOf: null,
        flags: o.flags || 0, removed: false, review: null,
        still: o.still || 0, not: o.not || 0, lastConfirmTs: o.confirmTs || null
      };
    }

    // Barangay centre + an offset in meters (north, east), so nearby reports sit a little apart
    function at(barangay, north, east) {
      var p = FDA.geo.point("Quezon City", barangay);
      return [p.lat + (north || 0) / 110540, p.lng + (east || 0) / (111320 * Math.cos(p.lat * Math.PI / 180))];
    }
    function rep(id, mins, street, barangay, off, prob, status, o) {
      var c = at(barangay, off[0], off[1]);
      return report(id, mins, street, barangay, "Quezon City", c[0], c[1], prob, status, o);
    }

    var reports = [
      rep(1043, 4, "Tandang Sora Ave. cor. Mindanao Ave.", "Culiat", [20, 40], 0.91, "flood-warning", { dup: 1042, evidence: [1042] }),
      rep(1042, 6, "Tandang Sora Ave.", "Culiat", [0, 0], 0.93, "flood-warning", { desc: "Water is visible near the jeepney stop.", still: 5, not: 1, confirmTs: ago(2), evidence: [1031] }),
      rep(1041, 8, "Quirino Hwy.", "Sauyo", [0, 0], 0.92, "flood-warning"),
      rep(1040, 13, "Visayas Ave.", "Vasra", [0, 0], 0.88, "flood-warning"),
      rep(1039, 17, "Commonwealth Ave.", "Batasan Hills", [0, 0], 0.62, "possible-flood", { img: "sample-street-shallow.svg" }),
      rep(1038, 19, "Visayas Ave.", "Vasra", [30, 20], 0.06, "no-flood", { img: "sample-street-dry.svg", dup: 1040 }),
      rep(1037, 30, "Payatas Rd.", "Bagong Silangan", [0, 0], 0.44, "unclear-photo", { img: "sample-street-unclear.svg", flags: 2 }),
      rep(1036, 49, "Commonwealth Ave.", "Batasan Hills", [-40, 60], 0.58, "possible-flood", { img: "sample-street-shallow.svg" }),
      rep(1035, 31, "Visayas Ave.", "Tandang Sora", [0, 0], 0.62, "possible-flood", { img: "sample-street-shallow.svg" }),
      rep(1034, 34, "Mindanao Ave.", "Tandang Sora", [60, 40], 0.44, "unclear-photo", { img: "sample-street-unclear.svg" }),
      rep(1033, 37, "Katipunan Ave.", "Loyola Heights", [0, 0], 0.06, "no-flood", { img: "sample-street-dry.svg" }),
      rep(1031, 71, "Tandang Sora Ave.", "Culiat", [-30, -20], 0.88, "flood-warning")
    ];

    var REC = FDA.agent ? FDA.agent.recommendations : null;
    reports.forEach(function (r) {
      var t = REC && REC[r.status];
      r.note = r.note || (t ? t.short : "");
      r.recommendation = t ? t.long : "";
      if (r.id === 1042) r.note = "Avoid the area. 2 recent reports from Culiat also show flooding.";
    });

    return {
      version: 3,
      users: [],          // the signed-in account is copied here by core/auth.js
      reports: reports,
      comments: [
        { id: 1, reportId: 1042, author: "Jun R.", authorId: null, ts: ago(2), text: "Still knee-deep near the jeepney stop. Jeepneys are turning back.", flags: 0, removed: false },
        { id: 2, reportId: 1042, author: "Mara A.", authorId: null, ts: ago(4), text: "Water is entering the side streets near Mindanao Ave.", flags: 0, removed: false },
        { id: 3, reportId: 1042, author: "Ronnie B.", authorId: null, ts: ago(5), text: "Avoid Tandang Sora Ave. going to Visayas Ave.", flags: 1, flagReason: "Not about this flood", removed: false },
        { id: 4, reportId: 1039, author: "Anonymous", authorId: null, ts: ago(12), text: "Buy cheap phones here: (link)", flags: 3, flagReason: "Spam", removed: false }
      ],
      votes: {},
      routes: [],
      schedules: [],
      notifications: [],
      settings: {},
      meta: { nextReport: 1044, nextComment: 5, nextRoute: 1, nextSchedule: 1, nextNotice: 1, seededAt: now }
    };
  }

  function load() {
    var raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { /* storage blocked: keep in memory */ }
    if (raw) {
      try { db = JSON.parse(raw); } catch (e) { db = null; }
    }
    if (!db || db.version !== 3) {
      db = seed();
      FDA.store.save();
    }
  }

  FDA.store = {
    /** The whole database object. Change it, then call save(). */
    db: function () { if (!db) load(); return db; },
    save: function () {
      try { window.localStorage.setItem(KEY, JSON.stringify(db)); return true; }
      catch (e) { FDA.store.lastError = e; return false; }
    },
    /** Throw everything away and go back to the sample data. */
    reset: function () { try { window.localStorage.removeItem(KEY); } catch (e) {} db = null; load(); },
    nextId: function (name) { var m = FDA.store.db().meta; var id = m[name]; m[name] = id + 1; return id; },
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
