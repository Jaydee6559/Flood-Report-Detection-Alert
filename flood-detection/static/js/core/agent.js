/**
 * The intelligent agent
 *
 * A model-based reflex agent (CS 403). It does not look at the photo itself.
 * Five inputs (percepts):
 *   P  photo probability from the classifier (0 to 1)
 *   H  hazard zone at the pin (none/low/medium/high)         -> FDA.hazard
 *   R  PAGASA-style rain level now (null/yellow/orange/red)  -> FDA.rain
 *   S  recurring flood spot within spotMeters                -> FDA.hazard
 *   N  recent flood reports within reportMeters              -> the saved reports
 * Two rules:
 *   Rule 1  checkPhoto()  P sets the starting status; H, R, S and N can raise it one level. Every reason is returned.
 *   Rule 2  areaRisk()    R with H and S rate a barangay High, Elevated or Low. Runs every 15 min (core/areas.js).
 *
 * Everything the agent decides is in this file and in FDA.agent.config, so it
 * can be explained, tested and tuned without touching any page.
 * (A Python version for the Flask backend should follow the same rules.)
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});

  var config = {
    // Starting cut-offs from the concept paper. The final values come from the validation set
    // (precision and recall at each threshold) once the model is trained.
    floodAt: 0.80,      // probability at or above this → Flood warning
    possibleAt: 0.50,   // at or above this → Possible flood
    unclearAt: 0.30,    // at or above this (but under possibleAt) → Unclear photo; below → No flood
    recentMin: 60,      // a report older than this "may be outdated"
    nearMeters: 300,    // "same area" radius (used for the report list and duplicates)
    spotMeters: 200,    // S: a logged recurring flood spot this close counts
    reportMeters: 500,  // N: other flood reports this close ...
    reportMin: 120,     // ... and this recent (minutes) count
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
     * Gather the five inputs for a place.
     * percept: {prob, loc:{barangay,lat,lng}, reports, now?, hazard?, rain?, spots?}  (hazard/rain/spots are looked up when left out)
     */
    inputs: function (percept) {
      var now = percept.now || Date.now(), loc = percept.loc, here = loc.lat != null ? loc : null;
      var hz = percept.hazard;
      if (hz == null) {
        var at = here && FDA.hazard ? FDA.hazard.at(here.lat, here.lng) : null;
        hz = at ? at.hazard : FDA.hazard ? FDA.hazard.of(loc.barangay) : "none";
      }
      var rain = percept.rain !== undefined ? percept.rain : (FDA.rain ? FDA.rain.levelFor(loc.barangay, 0) : null);
      var mm = percept.rainMm != null ? percept.rainMm : (FDA.rain ? FDA.rain.mmFor(loc.barangay, 0) : 0);
      var spots = percept.spots || (here && FDA.hazard ? FDA.hazard.spotsNear(here, config.spotMeters) : []);
      spots = spots.map(function (s) { return { spot: s, meters: here ? Math.round(FDA.geo.distance(here, s)) : null }; })
        .sort(function (a, b) { return (a.meters || 0) - (b.meters || 0); });
      var reports = percept.reports.filter(function (r) {
        if (r.removed || r.dupOf || r.id === percept.exceptId) return false;
        if (r.status !== "flood-warning" && r.status !== "possible-flood") return false;
        if (ageMin(r, now) > config.reportMin) return false;
        return (here && r.lat != null && FDA.geo.distance(here, r) <= config.reportMeters) || (!here && r.barangay === loc.barangay);
      }).sort(function (a, b) { return b.ts - a.ts; });
      return { H: hz, R: rain, mm: mm, S: spots, N: reports };
    },

    /**
     * Rule 1: check a photo.
     *   P 0.80+        Flood warning
     *   P 0.50–0.79    Possible flood; raised to Flood warning when R is orange/red, or N ≥ 1, or H is high
     *   P 0.30–0.49    Unclear photo;  raised to Possible flood when R ≥ orange and (H ≥ medium or S)
     *   P under 0.30   No flood;       only adds "risk is high here" when R ≥ orange and H ≥ medium
     * @returns {{status, startStatus, prob, note, recommendation, evidence:number[], dupCandidate, reasons:Array, inputs}}
     * Each reason: {key:"P|H|R|S|N", title, detail, effect:"start"|"raise"|"support"|"info"|"none"}
     */
    checkPhoto: function (percept) {
      var now = percept.now || Date.now(), prob = percept.prob, loc = percept.loc;
      var inp = FDA.agent.inputs(percept);
      var start = statusFromProbability(prob), status = start;
      var rainHigh = inp.R === "orange" || inp.R === "red";
      var hzHigh = inp.H === "high", hzMed = inp.H === "high" || inp.H === "medium";
      var hasS = inp.S.length > 0, hasN = inp.N.length > 0;
      var raise = { H: false, R: false, S: false, N: false }, riskNote = false;

      if (start === "possible-flood" && (rainHigh || hasN || hzHigh)) {
        status = "flood-warning"; raise.R = rainHigh; raise.N = hasN; raise.H = hzHigh; raise.S = hasS;   // a spot backs it up too
      } else if (start === "unclear-photo" && rainHigh && (hzMed || hasS)) {
        status = "possible-flood"; raise.R = true; raise.H = hzMed; raise.S = hasS;
      } else if (start === "no-flood" && rainHigh && hzMed) {
        riskNote = true;
      }
      var raised = status !== start;
      var changeable = start === "possible-flood" || start === "unclear-photo";

      function eff(on, present) { return raised ? (raise[on] ? "raise" : "info") : present ? (changeable ? "info" : "support") : "none"; }
      var model = percept.source === "tfjs" ? "MobileNetV2" : "Demo estimate (trained model not loaded)";
      var bandText = { "flood-warning": "0.80 or more", "possible-flood": "0.50–0.79", "unclear-photo": "0.30–0.49", "no-flood": "under 0.30" }[start];
      var reasons = [
        { key: "P", title: "Photo: " + Math.round(prob * 100) + "% flood probability", detail: model + " · starts as " + RECOMMENDATIONS[start].label + " (" + bandText + ")", effect: "start" }
      ];
      reasons.push({ key: "H", title: (inp.H === "none" ? "No flood hazard zone" : FDA.hazard.label(inp.H).replace(" hazard", " hazard zone")) + (loc.barangay ? "" : ""),
        detail: (loc.barangay ? loc.barangay + " · " : "") + "hazard map at this pin" + (FDA.hazard && FDA.hazard.isSample ? " (sample levels)" : ""), effect: eff("H", hzMed) });
      reasons.push({ key: "R", title: inp.R ? FDA.rain.names[inp.R] + " rain · " + inp.mm + " mm/h now" : "No rainfall warning level · " + inp.mm + " mm/h now",
        detail: (FDA.rain && FDA.rain.mode() === "live" ? "Open-Meteo" : FDA.rain && FDA.rain.mode() === "simulated" ? "Simulated demo rain" : "Sample rain (live data unavailable)") + " · PAGASA levels: yellow 7.5, orange 15, red 30 mm/h", effect: eff("R", rainHigh) });
      reasons.push({ key: "S", title: hasS ? "Recurring flood spot " + inp.S[0].meters + " m away" : "No recurring flood spot within " + config.spotMeters + " m",
        detail: hasS ? inp.S[0].spot.corner + " · flooded " + inp.S[0].spot.times + " times" + (inp.S.length > 1 ? " · " + (inp.S.length - 1) + " more nearby" : "") : "From the flood-spot log (QCDRRMO / MMDA sightings)", effect: eff("S", hasS) });
      reasons.push({ key: "N", title: hasN ? inp.N.length + " report" + (inp.N.length > 1 ? "s" : "") + " within " + config.reportMeters + " m in the last " + (config.reportMin / 60) + " h" : "No other reports within " + config.reportMeters + " m in the last " + (config.reportMin / 60) + " h",
        detail: hasN ? inp.N.slice(0, 3).map(function (r) { return "#" + r.id + " " + clock(r.ts); }).join(" · ") : "This would be the first report here", effect: eff("N", hasN) });

      // Plain-language summary
      var names = [];
      if (raised) {
        if (raise.H) names.push("hazard"); if (raise.R) names.push("rain"); if (raise.S) names.push("a recurring spot");
        if (raise.N) names.push(inp.N.length + " nearby report" + (inp.N.length > 1 ? "s" : ""));
      }
      var summary = raised ? "Photo alone said " + RECOMMENDATIONS[start].label + "; " + names.join(", ").replace(/, ([^,]*)$/, " and $1") + " raised it to " + RECOMMENDATIONS[status].label + "."
        : riskNote ? "The photo does not show a flood, but rain is heavy and this is a " + inp.H + "-hazard area, so risk is high here."
          : start === "flood-warning" ? "The photo clearly shows flooding." + (hasN ? " " + inp.N.length + " recent report" + (inp.N.length > 1 ? "s" : "") + " nearby agree." : " No other recent reports nearby yet.")
            : start === "possible-flood" ? "The photo may show water on the street. Hazard, rain, recurring spots and nearby reports did not add more evidence."
              : start === "unclear-photo" ? "The model is not sure about this photo."
                : "The model does not see a flood in this photo.";

      var dup = null;
      if (loc.lat != null) {
        percept.reports.some(function (r) {
          if (r.removed || r.dupOf || r.id === percept.exceptId) return false;
          if (ageMin(r, now) <= config.duplicateMin && r.lat != null && FDA.geo.distance(loc, r) <= config.duplicateMeters) { dup = r.id; return true; }
          return false;
        });
      }

      return {
        status: status, startStatus: start, prob: prob, note: summary,
        recommendation: (raised ? summary + " " : riskNote ? summary + " " : "") + RECOMMENDATIONS[status].long,
        evidence: inp.N.map(function (r) { return r.id; }), dupCandidate: dup, reasons: reasons,
        inputs: { hazard: inp.H, rain: inp.R, rainMm: inp.mm, spots: inp.S.length, reports: inp.N.length }
      };
    },

    /** Same as checkPhoto (older name, kept so existing callers keep working). */
    evaluate: function (percept) { return FDA.agent.checkPhoto(percept); },

    /**
     * Rule 2: area risk for one barangay, no photo needed.
     *   High      R orange/red and (H medium/high or a recurring spot)
     *   Elevated  R yellow and (H medium/high or a spot); or R orange/red with low hazard and no spot
     *   Low       anything else
     * @param {{hazard:string, rain:(null|"yellow"|"orange"|"red"), mm?:number, spots:number, reports?:number, rainLabel?:string}} o
     * @returns {{level:"high"|"elevated"|"low", reasons:Array, text:string}}
     */
    areaRisk: function (o) {
      var rank = { yellow: 1, orange: 2, red: 3 }[o.rain] || 0;
      var hzMed = o.hazard === "high" || o.hazard === "medium", hasS = o.spots > 0;
      var level = "low";
      if (rank >= 2 && (hzMed || hasS)) level = "high";
      else if ((rank === 1 && (hzMed || hasS)) || rank >= 2) level = "elevated";
      var reasons = [];
      reasons.push({ key: "H", title: o.hazard === "none" ? "No flood hazard zone" : FDA.hazard.label(o.hazard).replace(" hazard", " hazard zone"), detail: "Hazard map for this barangay", tag: hzMed ? "+ " + o.hazard : "", on: hzMed });
      reasons.push({ key: "R", title: o.rain ? FDA.rain.names[o.rain] + " rain" + (o.rainLabel ? " in " + o.rainLabel : "") : "No rainfall warning level", detail: (o.mm != null ? o.mm + " mm/h" : "") + (o.mm != null ? " · " : "") + "PAGASA levels: yellow 7.5–15, orange 15–30, red over 30 mm/h", tag: o.rain ? "+ " + o.rain : "", on: !!o.rain });
      reasons.push({ key: "S", title: hasS ? o.spots + " recurring flood spot" + (o.spots > 1 ? "s" : "") : "No recurring flood spots logged", detail: hasS ? "Floods in most heavy-rain events" : "Flood-spot log (QCDRRMO / MMDA)", tag: hasS ? "+ spots" : "", on: hasS });
      if (o.reports != null) reasons.push({ key: "N", title: o.reports + " flood report" + (o.reports === 1 ? "" : "s") + " in the last 2 h", detail: "From community reports (information only)", tag: o.reports ? "+ " + o.reports : "", on: o.reports > 0 });
      var text = { high: "High · flooding likely", elevated: "Elevated · watch this area", low: "Low" }[level];
      return { level: level, reasons: reasons, text: text };
    },
    areaLabel: function (level) { return { high: "High", elevated: "Elevated", low: "Low" }[level] || level; },

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
