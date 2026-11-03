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
 * Saved routes and travel schedules are on the server (routes_api.py): app.js
 * loads /api/my.js, which sets window.FDA_MY = {routes, schedules} for the
 * signed-in person. Change them only through the FDA.store helpers below
 * (saveRoute, deleteRoute, saveSchedule, ...), which send the change to the
 * server and then update db.routes / db.schedules.
 *
 * Notifications and settings still live in this browser's localStorage under
 * one key, until the next step moves them to the database.
 */
(function () {
  "use strict";

  var FDA = (window.FDA = window.FDA || {});
  var KEY = "fda.demo.v3";
  var VERSION = 6;
  var FROM_SERVER = { reports: 1, routes: 1, schedules: 1 };   // never written to localStorage
  var db = null;

  function empty() {
    return {
      version: VERSION,
      users: [],          // the signed-in account is copied here by core/auth.js
      notifications: [],
      settings: {},
      meta: { nextNotice: 1 }
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
      db.version = 5;
    }
    if (db && db.version === 5) {
      // Step 5: routes and schedules moved to the server. The ones saved in this browser are
      // kept aside and sent to the server once, the next time their owner is signed in.
      var old = { routes: db.routes || [], schedules: db.schedules || [] };
      if (old.routes.length) db.pendingImport = old;
      delete db.routes; delete db.schedules;
      if (db.meta) { delete db.meta.nextRoute; delete db.meta.nextSchedule; }
      db.version = VERSION;
    }
    if (!db || db.version !== VERSION) db = empty();
    var mine = window.FDA_MY || {};
    db.reports = window.FDA_REPORTS || [];
    db.routes = mine.routes || [];
    db.schedules = mine.schedules || [];
    FDA.store.save();
    if (db.pendingImport) setTimeout(importOld, 0);
  }

  /** Send the routes and schedules this browser saved before step 5 to the server, then reload. */
  function importOld() {
    var me = window.FDA_ME, p = db.pendingImport;
    if (!me || !p || !FDA.api || !FDA.api.available()) return;   // try again when the owner is signed in
    var routes = p.routes.filter(function (r) { return r.userId === me.id; });
    if (!routes.length) return;
    var ids = routes.map(function (r) { return r.id; });
    var schedules = p.schedules.filter(function (s) { return s.userId === me.id && ids.indexOf(s.routeId) >= 0; });
    FDA.api.post("/api/my/import", { routes: routes, schedules: schedules }).then(function (res) {
      if (!res.ok) return;
      p.routes = p.routes.filter(function (r) { return r.userId !== me.id; });
      p.schedules = p.schedules.filter(function (s) { return s.userId !== me.id; });
      if (!p.routes.length) delete db.pendingImport;
      FDA.store.save();
      if (res.data.routes) location.reload();   // show the imported routes
    }, function () { /* offline: try again next time */ });
  }

  /** POST to the server; resolves with the reply data, rejects with an Error whose message can be shown. */
  function send(url, body) {
    return FDA.api.post(url, body || {}).then(function (res) {
      if (res.ok) return res.data;
      throw new Error(res.status === 401 ? "Please sign in again." : res.data.error || "That could not be saved. Please try again.");
    }, function () { throw new Error("The server can't be reached, so nothing was saved. Check your connection and try again."); });
  }

  /** Replace or add an item in a list by id, keeping the same object so pages holding it see the change. */
  function put(list, item) {
    var cur = list.filter(function (x) { return x.id === item.id; })[0];
    if (cur) { Object.keys(cur).forEach(function (k) { if (!(k in item)) delete cur[k]; }); Object.assign(cur, item); return cur; }
    list.push(item);
    return item;
  }

  /** What a route sends to the server (the server checks every value). */
  function routeBody(r) {
    return { name: r.name, start: r.start, end: r.end, startPoint: r.startPoint, endPoint: r.endPoint, geometry: r.geometry,
      segments: r.segments, distanceM: r.distanceM, vias: r.vias, mode: r.mode };
  }

  FDA.store = {
    /** The whole data object. Change notifications/settings, then call save(). Reports, routes and schedules come from the server. */
    db: function () { if (!db) load(); return db; },
    save: function () {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(db, function (k, v) { return this === db && FROM_SERVER[k] ? undefined : v; }));
        return true;
      } catch (e) { FDA.store.lastError = e; return false; }
    },
    /** Put a report the server sent back (new, or after a moderator action) into db.reports. Returns the stored object. */
    putReport: function (rep) {
      var list = FDA.store.db().reports, cur = list.filter(function (x) { return x.id === rep.id; })[0];
      if (cur) return put(list, rep);
      list.unshift(rep);
      return rep;
    },

    /* ---- Routes and schedules: each returns a Promise of the saved item (rejects with a readable Error) ---- */
    /** A new route (no id) or changes to a saved one. */
    saveRoute: function (route) {
      var url = route.id ? "/api/routes/" + route.id : "/api/routes";
      return send(url, routeBody(route)).then(function (data) { return put(FDA.store.db().routes, data.route); });
    },
    setRouteAlert: function (route, on) {
      return send("/api/routes/" + route.id + "/alert", { alert: !!on }).then(function (data) { return put(FDA.store.db().routes, data.route); });
    },
    /** Also removes the route's schedules. */
    deleteRoute: function (route) {
      return send("/api/routes/" + route.id + "/delete").then(function () {
        var d = FDA.store.db();
        d.routes = d.routes.filter(function (r) { return r.id !== route.id; });
        d.schedules = d.schedules.filter(function (s) { return s.routeId !== route.id; });
      });
    },
    /** s: {id?, routeId, days, time, before} */
    saveSchedule: function (s) {
      var url = s.id ? "/api/schedules/" + s.id : "/api/schedules";
      return send(url, { routeId: s.routeId, days: s.days, time: s.time, before: s.before }).then(function (data) { return put(FDA.store.db().schedules, data.schedule); });
    },
    setScheduleEnabled: function (s, on) {
      return send("/api/schedules/" + s.id + "/enabled", { enabled: !!on }).then(function (data) { return put(FDA.store.db().schedules, data.schedule); });
    },
    /** The page ran today's check for this schedule. */
    markChecked: function (s) {
      return send("/api/schedules/" + s.id + "/checked").then(function (data) { return put(FDA.store.db().schedules, data.schedule); });
    },
    deleteSchedule: function (s) {
      return send("/api/schedules/" + s.id + "/delete").then(function () {
        var d = FDA.store.db();
        d.schedules = d.schedules.filter(function (x) { return x.id !== s.id; });
      });
    },

    /** Throw away this browser's data (notifications, settings...). Reports, routes and schedules stay on the server. */
    reset: function () { try { window.localStorage.removeItem(KEY); } catch (e) {} db = null; load(); },
    nextId: function (name) { var m = FDA.store.db().meta; var id = m[name] || 1; m[name] = id + 1; return id; }
  };
})();
