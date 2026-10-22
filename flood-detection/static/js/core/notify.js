/**
 * In-app notifications
 *
 * kinds:  route    – a report appeared along a saved route
 *         schedule – result of a pre-departure check
 *         report   – confirmations, comments and moderator actions on your reports
 *         area     – rain alert: a barangay you watch (home barangay by default) became High risk (Rule 2)
 * Each user can switch kinds off in the Notification settings.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});
  var DEFAULTS = { route: true, schedule: true, reports: true, clear: false, area: true };

  FDA.notify = {
    settings: function (userId) {
      var db = FDA.store.db();
      db.settings[userId] = Object.assign({}, DEFAULTS, db.settings[userId] || {});
      return db.settings[userId];
    },

    /**
     * Add a notification for a user (or refresh the one with the same `key`).
     * n: {kind, key?, title, text, href?, cta?, clear?}
     */
    push: function (userId, n) {
      var db = FDA.store.db(), s = FDA.notify.settings(userId);
      var allowed = n.kind === "area" ? s.area : n.kind === "route" ? s.route : n.kind === "schedule" ? (n.clear ? s.schedule && s.clear : s.schedule) : s.reports;
      if (!allowed) return null;
      var existing = n.key && db.notifications.filter(function (x) { return x.userId === userId && x.key === n.key; })[0];
      if (existing) {
        existing.title = n.title; existing.text = n.text; existing.ts = Date.now(); existing.read = false;
        FDA.store.save(); return existing;
      }
      var item = { id: FDA.store.nextId("nextNotice"), userId: userId, kind: n.kind, key: n.key || "", title: n.title, text: n.text, href: n.href || "", cta: n.cta || "", ts: Date.now(), read: false };
      db.notifications.push(item);
      FDA.store.save();
      return item;
    },

    forUser: function (userId) {
      return FDA.store.db().notifications.filter(function (n) { return n.userId === userId; }).sort(function (a, b) { return b.ts - a.ts; });
    },
    unread: function (userId) { return FDA.notify.forUser(userId).filter(function (n) { return !n.read; }).length; },
    markAllRead: function (userId) { FDA.notify.forUser(userId).forEach(function (n) { n.read = true; }); FDA.store.save(); },

    /** A new report was saved: warn every user whose saved route it touches. */
    fanOutReport: function (report) {
      if (report.status !== "flood-warning" && report.status !== "possible-flood") return;
      FDA.store.db().routes.forEach(function (route) {
        if (!route.alert) return;
        var check = FDA.agent.routeCheck(route, [report]);
        if (!check.items.length || check.level === "clear" || check.level === "unplaced") return;
        FDA.notify.push(route.userId, {
          kind: "route", key: "route:" + report.id + ":" + route.id,
          title: FDA.agent.label(report.status) + " on " + route.name,
          text: (check.items[0].street || report.street) + ", " + (check.items[0].barangay || report.barangay) + " · reported just now",
          href: "routes.html?id=" + route.id, cta: "View route →"
        });
      });
    }
  };
})();
