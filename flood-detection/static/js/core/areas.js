/**
 * Area risk for all 142 barangays (Rule 2) plus the 15-minute job around it
 *
 *   FDA.areas.compute(hours)   -> {byName, counts, rain}  Rule 2 for every barangay, at now (0) or +1..+3 h
 *   FDA.areas.get(name, hours) -> one barangay's {level, text, reasons, hazard, rain, mm, spots, reports, district}
 *   FDA.areas.refresh()        -> loads rain and runs Rule 2 again (pages redraw with it every 15 minutes)
 *
 * The server runs the same Rule 2 every 15 minutes with live rain (jobs.run_area_check): it keeps the area
 * log (agent_decisions, kind "area"; area_state) and sends the area rain alerts, also when no page is open.
 * The only alerts made here are for a "Simulated storm" chosen on the map, which only exists in this browser.
 * Later, a small rain-to-flood model trained on the decision log replaces the fixed table inside FDA.agent.areaRisk.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});
  var CITY = "Quezon City", TWO_H = 2 * 3600000;

  function db() { var d = FDA.store.db(); d.watch = d.watch || []; return d; }
  var simState = {};   // levels seen under a simulated storm (this page only), to tell when a barangay becomes High
  function isMe(userId) { return !!(window.FDA_ME && window.FDA_ME.id === userId); }

  function recentReports(name, now) {
    return FDA.store.db().reports.filter(function (r) {
      return !r.removed && !r.dupOf && r.barangay === name && (r.status === "flood-warning" || r.status === "possible-flood") && now - r.ts <= TWO_H;
    }).length;
  }

  function one(b, hours, now) {
    var d = b.district, mm = FDA.rain.mm(d, hours), lvl = FDA.agent.rainLevel(mm);
    var spots = FDA.hazard.spotsIn(b.name).length, reports = hours === 0 ? recentReports(b.name, now) : null;
    var res = FDA.agent.areaRisk({ hazard: b.hazard, rain: lvl, mm: mm, spots: spots, reports: reports, rainLabel: "District " + d });
    return { name: b.name, district: d, level: res.level, text: res.text, reasons: res.reasons, hazard: b.hazard, rain: lvl, mm: mm, spots: spots, reports: reports || 0 };
  }

  var FDAareas = FDA.areas = {
    compute: function (hours) {
      hours = hours || 0;
      var now = Date.now(), by = {}, counts = { high: 0, elevated: 0, low: 0 };
      FDA.hazard.barangays().forEach(function (b) { var r = one(b, hours, now); by[b.name] = r; counts[r.level]++; });
      return { byName: by, counts: counts, hours: hours, at: now };
    },
    get: function (name, hours) { var b = FDA.hazard.get(name); return b ? one(b, hours || 0, Date.now()) : null; },

    /** Barangays the signed-in person wants alerts for: their home barangay plus any they switched on (saved on the server). */
    watched: function (userId) {
      if (!isMe(userId)) return [];
      var list = db().watch.slice(), home = window.FDA_ME.homeBarangay;
      if (home && list.indexOf(home) < 0) list.unshift(home);
      return list;
    },
    isWatching: function (userId, name) { return isMe(userId) && db().watch.indexOf(name) >= 0; },
    /** "Alert me" on or off. Resolves when the server saved it; rejects with a readable Error. */
    setWatching: function (userId, name, on) {
      if (!isMe(userId)) return Promise.reject(new Error("Please sign in first."));
      return FDA.api.post("/api/watch", { barangay: name, on: !!on }).then(function (res) {
        if (!res.ok) throw new Error(res.data.error || "That could not be saved. Please try again.");
        FDA.store.db().watch = res.data.watch;
      }, function () { throw new Error("The server can't be reached, so nothing was saved."); });
    },

    /** The agent decision log is kept on the server now (agent_decisions); kept so older callers do not break. */
    logDecision: function () {},

    refresh: function () {
      return FDA.rain.load().then(function () {
        var res = FDAareas.compute(0), u = window.FDA_ME;
        if (FDA.rain.mode() !== "simulated") { simState = {}; return res; }   // live rain: the server logs and alerts
        // A simulated storm only exists in this browser, so its alerts are made here, and say they are simulated
        FDA.hazard.barangays().forEach(function (b) {
          var r = res.byName[b.name], before = simState[b.name];
          simState[b.name] = r.level;
          if (before === r.level || r.level !== "high" || !FDA.notify || !u || FDAareas.watched(u.id).indexOf(b.name) < 0) return;
          FDA.notify.push(u.id, { kind: "area", key: "sim-area:" + b.name + ":" + Math.floor(Date.now() / 3600000),
            title: "Simulated storm: " + FDA.rain.names[r.rain] + " rain over District " + r.district + " · " + (u.homeBarangay === b.name ? "your home barangay" : b.name) + " is high risk",
            text: r.mm + " mm/h (simulated) · " + b.name + " is a " + r.hazard + "-hazard zone with " + r.spots + " recurring flood spot" + (r.spots === 1 ? "" : "s"),
            href: "areas.html?b=" + encodeURIComponent(b.name), cta: "See area risk →" });
        });
        return res;
      });
    }
  };
})();
