/**
 * Area risk for all 142 barangays (Rule 2) plus the 15-minute job around it
 *
 *   FDA.areas.compute(hours)   -> {byName, counts, rain}  Rule 2 for every barangay, at now (0) or +1..+3 h
 *   FDA.areas.get(name, hours) -> one barangay's {level, text, reasons, hazard, rain, mm, spots, reports, district}
 *   FDA.areas.refresh()        -> loads rain, runs Rule 2, logs changes in db.decisions, sends area rain alerts
 *
 * The browser runs this job every 15 minutes while a page is open. With the Flask backend this moves
 * to APScheduler and the same code becomes agent.py. Later, a small rain-to-flood model trained on the
 * decision log replaces the fixed table inside FDA.agent.areaRisk.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});
  var CITY = "Quezon City", TWO_H = 2 * 3600000;

  function db() { var d = FDA.store.db(); d.decisions = d.decisions || []; d.watch = d.watch || {}; d.areaState = d.areaState || {}; return d; }

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

    /** Barangays a user wants alerts for: their home barangay plus any they switched on. */
    watched: function (userId) {
      var u = FDA.store.db().users.filter(function (x) { return x.id === userId; })[0], list = (db().watch[userId] || []).slice();
      if (u && u.homeBarangay && list.indexOf(u.homeBarangay) < 0) list.unshift(u.homeBarangay);
      return list;
    },
    isWatching: function (userId, name) { return (db().watch[userId] || []).indexOf(name) >= 0; },
    setWatching: function (userId, name, on) {
      var w = db().watch[userId] = db().watch[userId] || [];
      var i = w.indexOf(name);
      if (on && i < 0) w.push(name); if (!on && i >= 0) w.splice(i, 1);
      FDA.store.save();
    },

    /** Add a line to the agent_decisions log (kept to the latest 500). It is the training data for the learning phase. */
    logDecision: function (entry) {
      var d = db(); entry.ts = Date.now(); d.decisions.push(entry);
      if (d.decisions.length > 500) d.decisions.splice(0, d.decisions.length - 500);
      FDA.store.save();
    },

    refresh: function () {
      return FDA.rain.load().then(function () {
        var res = FDAareas.compute(0), d = db(), changed = false;
        FDA.hazard.barangays().forEach(function (b) {
          var r = res.byName[b.name], before = d.areaState[b.name];
          if (before === r.level) return;
          d.areaState[b.name] = r.level; changed = true;
          if (before !== undefined || r.level !== "low") {
            d.decisions.push({ ts: Date.now(), kind: "area", barangay: b.name, level: r.level, hazard: r.hazard, rain: r.rain, mm: r.mm, spots: r.spots, reports: r.reports, rainMode: FDA.rain.mode() });
          }
          // Area rain alert: the barangay just became High for anyone who watches it
          if (r.level === "high" && FDA.notify) {
            d.users.forEach(function (u) {
              if (FDAareas.watched(u.id).indexOf(b.name) < 0) return;
              FDA.notify.push(u.id, { kind: "area", key: "area:" + b.name + ":" + Date.now(),
                title: FDA.rain.names[r.rain] + " rain over District " + r.district + " · " + (u.homeBarangay === b.name ? "your home barangay" : b.name) + " is high risk",
                text: r.mm + " mm/h now · " + b.name + " is a " + r.hazard + "-hazard zone with " + r.spots + " recurring flood spot" + (r.spots === 1 ? "" : "s"),
                href: "areas.html?b=" + encodeURIComponent(b.name), cta: "See area risk →" });
            });
          }
        });
        if (d.decisions.length > 500) d.decisions.splice(0, d.decisions.length - 500);
        if (changed) FDA.store.save();
        return res;
      });
    }
  };
})();
