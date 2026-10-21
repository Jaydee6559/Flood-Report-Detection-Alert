/**
 * Travel-schedule checks
 *
 * Before each saved departure the agent checks the reports along the route and
 * leaves an in-app notification. A real server would run this on a timer
 * (APScheduler); the prototype runs it whenever a page is open: on load, then
 * once a minute.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});

  function ymd(d) { return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function at(time, base) { var p = time.split(":"); var d = new Date(base); d.setHours(+p[0], +p[1], 0, 0); return d; }
  function fmt(d) { return d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }); }

  var DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  FDA.scheduler = {
    dayNames: DAY,
    describeDays: function (days) {
      var d = days.slice().sort();
      if (d.length === 7) return "Every day";
      if (d.join() === "1,2,3,4,5") return "Weekdays";
      if (d.join() === "0,6") return "Weekends";
      var order = [1, 2, 3, 4, 5, 6, 0];
      return order.filter(function (x) { return d.indexOf(x) >= 0; }).map(function (x) { return DAY[x]; }).join(", ");
    },
    clockText: function (time) { return fmt(at(time, new Date())); },
    checkTimeText: function (s) { return fmt(new Date(at(s.time, new Date()).getTime() - s.before * 60000)); },

    /** Run one schedule's check now and notify. Returns the route check result. */
    runCheck: function (s, routeOverride) {
      var db = FDA.store.db();
      var route = routeOverride || db.routes.filter(function (r) { return r.id === s.routeId; })[0];
      if (!route) return null;
      var result = FDA.agent.routeCheck(route, db.reports.filter(function (r) { return !r.removed; }));
      var dep = FDA.scheduler.clockText(s.time), chk = FDA.scheduler.checkTimeText(s);
      var top = result.warnings[0] || result.possible[0];
      if (top) {
        FDA.notify.push(s.userId, {
          kind: "schedule", key: "check:" + s.id + ":" + ymd(new Date()),
          title: (result.warnings.length ? "Flood warning" : "Possible flood") + " before your " + dep + " trip · " + route.name,
          text: top.report.street + ", " + top.report.barangay + " · reported " + FDA.ui.timeAgo(top.report.ts),
          href: "routes.html?id=" + route.id, cta: "View on route →"
        });
      } else {
        FDA.notify.push(s.userId, {
          kind: "schedule", clear: true, key: "clear:" + s.id + ":" + ymd(new Date()),
          title: "No recent reports on " + route.name, text: "Checked " + chk + " before your " + dep + " trip", href: "", cta: ""
        });
      }
      return result;
    },

    /** Check every schedule that is due today and has not run yet. */
    runDue: function () {
      var user = FDA.auth.current();
      if (!user) return;
      var db = FDA.store.db(), now = new Date(), changed = false;
      db.schedules.forEach(function (s) {
        if (s.userId !== user.id || !s.enabled || s.days.indexOf(now.getDay()) < 0 || s.lastCheck === ymd(now)) return;
        var dep = at(s.time, now), due = new Date(dep.getTime() - s.before * 60000);
        if (now < due) return;
        s.lastCheck = ymd(now);
        changed = true;
        if (now.getTime() <= dep.getTime() + 60 * 60000) FDA.scheduler.runCheck(s); // skip stale checks after the trip
      });
      // one-off reminders set with "Remind me"
      (db.reminders || []).forEach(function (m) {
        if (m.userId === user.id && !m.done && m.at <= now.getTime()) {
          m.done = true; changed = true;
          FDA.notify.push(user.id, { kind: "schedule", title: m.title, text: m.text, href: "routes.html", cta: "View routes →" });
        }
      });
      if (changed) FDA.store.save();
    }
  };
})();
