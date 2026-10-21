/**
 * The intelligent agent
 *
 * A model-based reflex agent (CS 403). It does not look at the photo itself:
 *   percept  = the classifier's flood probability + where the photo was taken
 *   state    = the recent reports the agent already knows about
 *   rules    = the thresholds below
 *   action   = a status, a recommendation and a short note
 *
 * Everything the agent decides is in this file and in FDA.agent.config, so it
 * can be explained, tested and tuned without touching any page.
 * (A Python version for the Flask backend should follow the same rules.)
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});

  var config = {
    floodAt: 0.75,      // probability at or above this → Flood warning
    possibleAt: 0.50,   // at or above this → Possible flood
    unclearAt: 0.35,    // at or above this (but under possibleAt) → Unclear photo; below → No flood
    recentMin: 60,      // a report older than this "may be outdated"
    nearMeters: 300,    // "same area" radius
    corroborate: 2,     // recent warnings nearby that can lift a doubtful photo to Possible flood
    duplicateMeters: 200,
    duplicateMin: 30,
    onRouteMeters: 300,
    nearRouteMeters: 800
  };

  var DEPTH_BANDS = [
    { label: "Ankle-deep", range: "about 5–15 cm", advice: "Walkable with care. Most vehicles can pass slowly. Watch for open drains." },
    { label: "Half-knee deep", range: "about 15–30 cm", advice: "Risky on foot. Motorcycles and small cars should avoid it." },
    { label: "Knee-deep", range: "about 30–50 cm", advice: "Not passable for motorcycles or small cars. Avoid walking through it." },
    { label: "Waist-deep or more", range: "50 cm or more", advice: "Dangerous. Do not walk or drive through. Find another route." }
  ];

  var RECOMMENDATIONS = {
    "flood-warning": { label: "Flood warning", short: "Avoid the area", long: "Do not walk or drive through floodwater. Use another route if you can." },
    "possible-flood": { label: "Possible flood", short: "Use caution", long: "Use caution. Water may be rising; avoid low areas." },
    "unclear-photo": { label: "Unclear photo", short: "New photo requested", long: "The photo is unclear. Please send a clearer photo of the street." },
    "no-flood": { label: "No flood", short: "Review local conditions", long: "No flood seen. Review local conditions before travel." }
  };

  function statusFromProbability(p) {
    if (p >= config.floodAt) return "flood-warning";
    if (p >= config.possibleAt) return "possible-flood";
    if (p >= config.unclearAt) return "unclear-photo";
    return "no-flood";
  }

  function ageMin(r, now) { return ((now || Date.now()) - r.ts) / 60000; }
  function isRecent(r, now) { return ageMin(r, now) <= config.recentMin; }
  function clock(ts) { return new Date(ts).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }); }

  /** Reports in the same barangay, or within nearMeters, that are recent and still visible. */
  function neighbours(loc, reports, now, exceptId) {
    return reports.filter(function (r) {
      if (r.removed || r.id === exceptId || r.dupOf || !isRecent(r, now)) return false;
      if (loc.barangay && r.barangay === loc.barangay && r.city === loc.city) return true;
      return loc.lat != null && FDA.geo.distance(loc, r) <= config.nearMeters;
    });
  }

  FDA.agent = {
    config: config,
    /**
     * How deep the water looks, as a band people can picture.
     * Uses r.depthCm when a depth model supplied one. Until then it is a ROUGH GUESS worked out from
     * how confident the flood model is (more confident = more obvious, deeper water), so the pages label it an estimate.
     * @param {{prob:number, status:string, depthCm?:number}} r
     * @returns {null | {cm:number, level:number, label:string, range:string, advice:string, source:"model"|"estimate"}}
     */
    depth: function (r) {
      if (r.status !== "flood-warning" && r.status !== "possible-flood") return null;
      var measured = typeof r.depthCm === "number" && isFinite(r.depthCm);
      var cm = measured ? r.depthCm
        : r.prob < config.floodAt ? 10 + (r.prob - config.possibleAt) / (config.floodAt - config.possibleAt) * 5   // possible flood: 10-15 cm
        : 15 + Math.min(1, (r.prob - config.floodAt) / (1 - config.floodAt)) * 45;                                // flood warning: 15-60 cm
      var i = cm < 15 ? 0 : cm < 30 ? 1 : cm < 50 ? 2 : 3;
      var b = DEPTH_BANDS[i];
      return { cm: Math.round(cm), level: i + 1, label: b.label, range: b.range, advice: b.advice, source: measured ? "model" : "estimate" };
    },
    recommendations: RECOMMENDATIONS,
    statusFromProbability: statusFromProbability,
    isRecent: isRecent,
    label: function (status) { return RECOMMENDATIONS[status].label; },

    /**
     * Decide what to tell the user about a new photo.
     * @param {{prob:number, loc:{city,barangay,street,lat,lng}, reports:Array, now?:number}} percept
     * @returns {{status, prob, note, recommendation, evidence:number[], dupCandidate:number|null}}
     */
    evaluate: function (percept) {
      var now = percept.now || Date.now();
      var loc = percept.loc, prob = percept.prob;
      var near = neighbours(loc, percept.reports, now);
      var warnings = near.filter(function (r) { return r.status === "flood-warning"; });
      var status = statusFromProbability(prob);
      var note = "";

      if (status === "possible-flood" && warnings.length >= 1) {
        status = "flood-warning";
        note = "The photo suggests a flood and " + warnings.length + " recent report" + (warnings.length > 1 ? "s" : "") + " from " + loc.barangay + " back it up.";
      } else if ((status === "no-flood" || status === "unclear-photo") && warnings.length >= config.corroborate) {
        status = "possible-flood";
        note = "The photo does not show a clear flood, but " + warnings.length + " recent reports from " + loc.barangay + " do.";
      } else if (status === "flood-warning" && warnings.length) {
        note = warnings.length + " recent report" + (warnings.length > 1 ? "s" : "") + " from " + loc.barangay + " also show flooding (" +
          warnings.slice(0, 3).map(function (r) { return clock(r.ts); }).join(", ") + ").";
      } else if (status === "flood-warning") {
        note = "No other recent reports from " + loc.barangay + " yet. This is the first.";
      } else if (status === "possible-flood") {
        note = "The photo may show water on the street. No other recent reports from " + loc.barangay + ".";
      } else if (status === "unclear-photo") {
        note = "The model is not sure about this photo.";
      } else {
        note = "The model does not see a flood in this photo.";
      }

      var dup = null;
      if (loc.lat != null) {
        near.concat(percept.reports.filter(function (r) { return !r.removed && !r.dupOf; })).some(function (r) {
          if (ageMin(r, now) <= config.duplicateMin && FDA.geo.distance(loc, r) <= config.duplicateMeters) { dup = r.id; return true; }
          return false;
        });
      }

      return {
        status: status, prob: prob, note: note,
        recommendation: RECOMMENDATIONS[status].long,
        evidence: warnings.map(function (r) { return r.id; }),
        dupCandidate: dup
      };
    },

    /**
     * Check a saved route against the reports.
     * @returns {{warnings:Array, possible:Array, near:Array, level:"warning"|"possible"|"clear"}}
     * Each item: {report, meters, where:"On route"|"Near route"}
     */
    routeCheck: function (route, reports, now) {
      now = now || Date.now();
      var a = FDA.geo.resolve(route.start), b = FDA.geo.resolve(route.end);
      var items = [];
      reports.forEach(function (r) {
        if (r.removed || r.dupOf) return;
        var meters = null;
        if (a && b) meters = FDA.geo.toSegment(r, a, b);
        else if (a || b) meters = FDA.geo.distance(r, a || b);
        var txt = (route.start + " " + route.end).toLowerCase();
        var sameText = txt.indexOf(String(r.barangay).toLowerCase()) >= 0 || txt.indexOf(String(r.street).toLowerCase()) >= 0;
        if (meters === null && !sameText) return;
        if (meters === null) meters = config.onRouteMeters;
        if (meters > config.nearRouteMeters) return;
        items.push({ report: r, meters: meters, where: meters <= config.onRouteMeters ? "On route" : "Near route", recent: isRecent(r, now) });
      });
      items.sort(function (x, y) { return y.report.ts - x.report.ts; });
      var live = items.filter(function (i) { return i.recent && i.report.status !== "no-flood" && i.report.status !== "unclear-photo"; });
      var warnings = live.filter(function (i) { return i.report.status === "flood-warning" && i.where === "On route"; });
      var possible = live.filter(function (i) { return i.report.status === "possible-flood" || (i.report.status === "flood-warning" && i.where === "Near route"); });
      return { items: items, warnings: warnings, possible: possible, level: warnings.length ? "warning" : possible.length ? "possible" : "clear", resolved: !!(a || b) };
    },

    /** Flood-risk outlook for the weather page: forecast rain + recent warnings in the area. */
    outlook: function (opts) {
      var next6 = opts.next6mm, peak = opts.peakMm, warnings = opts.warnings;
      var level = "low";
      if (next6 >= 50 || peak >= 30 || (peak >= 15 && warnings >= 2)) level = "high";
      else if (next6 >= 20 || peak >= 7.5 || warnings >= 1) level = "moderate";
      return level;
    },

    /** PAGASA-style rainfall warning level from mm per hour (yellow 7.5–15, orange 15–30, red 30+). */
    rainLevel: function (mmPerHour) {
      if (mmPerHour >= 30) return "red";
      if (mmPerHour >= 15) return "orange";
      if (mmPerHour >= 7.5) return "yellow";
      return null;
    }
  };
})();
