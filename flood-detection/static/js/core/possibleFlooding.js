/**
 * Possible flooding per barangay (rain forecast x flood hazard map)
 *
 * Rule-based and deliberately simple. Edit RULES below to change the result.
 *   Rain   one city-wide forecast (core/weather.js): the peak mm/hour from now to the next 24 hours,
 *          classed with the same cut-offs as the weather risk badge (low / moderate / high / severe).
 *          The forecast grid is too coarse to tell one barangay from another, so every barangay gets the same rain.
 *   Hazard the barangay's level from the 2016 LiPAD 100-year map (qc-flood-hazard.js):
 *          high / moderate / low, "below-threshold" (covered, but no class reaches 20%), or "unknown".
 *   "unknown" hazard always gives "unknown", never "low". Nothing is guessed.
 *
 * This is an estimate, NOT a prediction and NOT an official warning.
 *
 *   FDA.possibleFlooding.load()    -> Promise<result>   (fires window event "fda:possibleflooding")
 *   FDA.possibleFlooding.state()   -> "loading" | "ready" | "error"
 *   FDA.possibleFlooding.get()     -> null | { at, stale, rain, byName, top, highest, count }
 *   FDA.possibleFlooding.error()   -> readable message when state is "error"
 *   FDA.possibleFlooding.levelFor(rainLevel, hazard) -> "low" | "moderate" | "high" | "severe" | "unknown"
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});

  var LEVELS = ["low", "moderate", "high", "severe"];
  var LABEL = { low: "Low", moderate: "Moderate", high: "High", severe: "Severe", unknown: "Unknown" };
  var HOURS = 24;       // look this many hours ahead of now for the peak rain
  var LIST_SIZE = 10;   // barangays shown in the "highest level now" list

  /* Rule table: RULES[rain level][hazard] = possible-flooding level.
     Hazards not listed here (or "unknown") give "unknown". */
  var RULES = {
    severe:   { high: "severe",   moderate: "high",     low: "moderate", "below-threshold": "moderate" },
    high:     { high: "high",     moderate: "moderate", low: "moderate", "below-threshold": "low" },
    moderate: { high: "moderate", moderate: "moderate", low: "low",      "below-threshold": "low" },
    low:      { high: "low",      moderate: "low",      low: "low",      "below-threshold": "low" }
  };

  var RAIN_WORDS = { low: "Light or no rain", moderate: "Moderate rain", high: "Heavy rain", severe: "Very heavy rain" };
  var HAZARD_WORDS = {
    high: "a high flood hazard area", moderate: "a moderate flood hazard area", low: "a low flood hazard area",
    "below-threshold": "an area with little mapped flood hazard", unknown: "an area with no usable hazard data"
  };

  var status = "loading", message = "", result = null, loading = null, started = false;

  function levelFor(rain, hazard) {
    var row = RULES[rain];
    return (row && row[hazard]) || "unknown";
  }

  function reason(rain, hazard, level) {
    if (level === "unknown") return "The flood hazard of this barangay is unknown, so no level is shown.";
    return RAIN_WORDS[rain] + " forecast and " + HAZARD_WORDS[hazard] + ".";
  }

  /** Rain facts from the weather snapshot: now, and the peak and total over now + the next HOURS hours. */
  function rainFrom(w) {
    var hours = w.hourly.slice(0, HOURS + 1);
    var peak = hours.reduce(function (b, x) { return x.mm > b.mm ? x : b; }, hours[0] || { time: null, mm: 0 });
    var total = Math.round(hours.reduce(function (s, x) { return s + x.mm; }, 0) * 10) / 10;
    return { level: FDA.weather.riskOf(peak.mm), peakMm: peak.mm, peakAt: peak.time, nowMm: w.now.mm, nextMm: total };
  }

  function compute() {
    var w = FDA.weather.get(), data = window.FDA_QC_HAZARD;
    if (!data || !data.features) { status = "error"; message = "The flood hazard data is missing, so possible flooding cannot be worked out."; result = null; return; }
    if (!w) {
      status = FDA.weather.state() === "error" ? "error" : "loading";
      message = status === "error" ? "The rain forecast could not be loaded, so possible flooding cannot be worked out." : "";
      result = null; return;
    }
    var rain = rainFrom(w), byName = {}, all = [];
    data.features.forEach(function (f) {
      var p = f.properties, level = levelFor(rain.level, p.risk);
      var row = { name: p.name, district: p.district, hazard: p.risk, level: level, reason: reason(rain.level, p.risk, level), high: p.high, moderate: p.moderate, low: p.low };
      byName[p.name] = row; all.push(row);
    });
    var best = -1;
    all.forEach(function (r) { var i = LEVELS.indexOf(r.level); if (i > best) best = i; });
    var highest = best >= 0 ? LEVELS[best] : null;
    var top = best >= 1 ? all.filter(function (r) { return r.level === highest; })
      .sort(function (a, b) { return b.high - a.high || a.name.localeCompare(b.name); }).slice(0, LIST_SIZE) : [];
    var count = best >= 1 ? all.filter(function (r) { return r.level === highest; }).length : 0;
    status = "ready"; message = "";
    result = { at: w.at, stale: !!w.stale, rain: rain, byName: byName, top: top, highest: highest, count: count };
  }

  function announce() { try { window.dispatchEvent(new CustomEvent("fda:possibleflooding", { detail: result })); } catch (e) { /* old browser */ } }

  function load() {
    if (loading) return loading;
    var hazard = FDA.hazardLayer ? FDA.hazardLayer.load().catch(function () { return null; }) : Promise.resolve(null);
    started = true;
    loading = Promise.all([hazard, FDA.weather.load()]).then(function () { compute(); loading = null; announce(); return result; });
    return loading;
  }

  // The forecast refreshes every 15 minutes: work the levels out again when it does
  window.addEventListener("fda:weather", function () { if (started && !loading) { compute(); announce(); } });

  FDA.possibleFlooding = {
    LEVELS: LEVELS, LABEL: LABEL, RULES: RULES, HOURS: HOURS,
    state: function () { return status; }, error: function () { return message; }, get: function () { return result; },
    levelFor: levelFor, load: load
  };
})();
