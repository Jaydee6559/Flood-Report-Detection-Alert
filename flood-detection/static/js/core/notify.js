/**
 * In-app notifications, saved on the server (notifications_api.py)
 *
 * kinds:  route    – a report appeared along a saved route        (made by the server when the report is saved)
 *         report   – confirmations, comments and moderator actions on your reports   (made by the server)
 *         schedule – result of a pre-departure check, a schedule was set, "Remind me"   (made by this page, for you)
 *         area     – rain alert: a barangay you watch (home barangay by default) became High risk (Rule 2, this page)
 *
 * The page can only make notifications for the signed-in person themself; anything for
 * someone else is made on the server when it happens, so it reaches them on any device.
 * Each kind can be switched off in Notification settings (saved on the server too).
 * While a page is open it asks the server for new notifications once a minute.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});
  var DEFAULTS = { route: true, schedule: true, reports: true, clear: false, area: true };
  var POLL_MS = 60000;

  function me() { return window.FDA_ME || null; }
  function list() { return FDA.store.db().notifications; }
  function online() { return !!(me() && FDA.api && FDA.api.available()); }

  /** Put a notification from the server into the list (same id = replace). */
  function put(n) {
    var all = list(), i = -1;
    all.forEach(function (x, k) { if (x.id === n.id) i = k; });
    if (i >= 0) all[i] = n; else all.unshift(n);
  }

  function changed() {
    if (FDA.layout && FDA.layout.refresh) FDA.layout.refresh();
    try { document.dispatchEvent(new CustomEvent("fda:notifications")); } catch (e) { /* old browser */ }
  }

  FDA.notify = {
    /** The signed-in person's settings: {route, area, schedule, reports, clear}. */
    settings: function () {
      var d = FDA.store.db();
      d.settings = Object.assign({}, DEFAULTS, d.settings || {});
      return d.settings;
    },
    /** Turn one kind on or off. Resolves with the saved settings; rejects with a readable Error. */
    saveSetting: function (key, on) {
      var body = {}; body[key] = !!on;
      return FDA.api.post("/api/notifications/settings", body).then(function (res) {
        if (!res.ok) throw new Error(res.data.error || "The setting could not be saved. Please try again.");
        FDA.store.db().settings = res.data.settings;
        return res.data.settings;
      }, function () { throw new Error("The server can't be reached, so the setting was not saved."); });
    },

    /**
     * A notification for the signed-in person (userId must be their own id; anything else is ignored,
     * because the server makes other people's notifications itself).
     * n: {kind, key?, title, text, href?, cta?, clear?}   The same key refreshes the earlier one.
     */
    push: function (userId, n) {
      var who = me();
      if (!who || userId !== who.id || !online()) return null;
      var s = FDA.notify.settings();
      var allowed = n.kind === "area" ? s.area : n.kind === "route" ? s.route : n.kind === "schedule" ? (n.clear ? s.schedule && s.clear : s.schedule) : s.reports;
      if (!allowed) return null;
      FDA.api.post("/api/notifications", { kind: n.kind, key: n.key || "", title: n.title, text: n.text || "", href: n.href || "", cta: n.cta || "", clear: !!n.clear })
        .then(function (res) { if (res.ok && res.data.notification) { put(res.data.notification); changed(); } }, function () { /* offline: skipped */ });
      return true;
    },

    forUser: function (userId) {
      return list().filter(function (n) { return n.userId === userId; }).sort(function (a, b) { return b.ts - a.ts; });
    },
    unread: function (userId) { return FDA.notify.forUser(userId).filter(function (n) { return !n.read; }).length; },
    markRead: function (id) {
      var n = list().filter(function (x) { return x.id === id; })[0];
      if (!n || n.read) return;
      n.read = true; changed();
      if (online()) FDA.api.post("/api/notifications/read", { ids: [id] }).then(function () {}, function () {});
    },
    markAllRead: function (userId) {
      FDA.notify.forUser(userId).forEach(function (n) { n.read = true; });
      changed();
      if (online()) FDA.api.post("/api/notifications/read", { all: true }).then(function () {}, function () {});
    },

    /** Route alerts for a new report are made on the server when the report is saved (notifications_api.route_alerts). */
    fanOutReport: function () {},

    /** Ask the server for new notifications now (also runs once a minute while a page is open). */
    poll: function () {
      if (!online()) return Promise.resolve();
      return FDA.api.get("/api/notifications").then(function (res) {
        if (!res.ok) return;
        var before = JSON.stringify(list().map(function (n) { return [n.id, n.read, n.ts]; }));
        FDA.store.db().notifications = res.data.notifications || [];
        if (JSON.stringify(list().map(function (n) { return [n.id, n.read, n.ts]; })) !== before) changed();
      }, function () { /* offline: try again next minute */ });
    }
  };

  if (typeof window !== "undefined" && window.setInterval && typeof document !== "undefined") {
    window.setInterval(function () { if (!document.hidden) FDA.notify.poll(); }, POLL_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) FDA.notify.poll(); });
  }
})();
