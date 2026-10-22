/**
 * Quezon City weather and flood risk (one point, 14.6760, 121.0437)
 *
 * One Open-Meteo call (free, no key) with current conditions and 48 hours of hourly rain,
 * cached for 15 minutes. Risk is worked out from mm/hour using PAGASA-style rainfall levels:
 *   low < 2.5 · moderate 2.5 to 7.5 · high 7.5 to 15 · severe 15 mm/h or more
 * (7.5 and 15 are PAGASA's yellow and orange levels). This is an estimate from forecast data,
 * NOT an official PAGASA warning. The risk is the worse of rain now and the peak of the next 3 hours.
 *
 *   FDA.weather.load(force) -> Promise<snapshot>   (also fires window event "fda:weather")
 *   FDA.weather.state()     -> "loading" | "ready" | "error"
 *   FDA.weather.get()       -> null | snapshot { at, stale, now, hourly, peak, risk, ... }
 *   FDA.weather.riskOf(mm)  -> "low" | "moderate" | "high" | "severe"
 *   FDA.weather.mount(el)   -> draws the weather card into el and keeps it up to date
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});
  var LAT = 14.6760, LNG = 121.0437, KEY = "fda.weather.v1", TTL = 15 * 60000;
  var ORDER = ["low", "moderate", "high", "severe"];
  var LIMITS = { moderate: 2.5, high: 7.5, severe: 15 };
  var WORDS = { low: "Low", moderate: "Moderate", high: "High", severe: "Severe" };

  var snap = null, status = "loading", loading = null;

  function riskOf(mm) {
    return mm >= LIMITS.severe ? "severe" : mm >= LIMITS.high ? "high" : mm >= LIMITS.moderate ? "moderate" : "low";
  }
  function worse(a, b) { return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b; }
  function r1(v) { return Math.round((v || 0) * 10) / 10; }

  function condition(code, mm) {
    if (code >= 95) return "Thunderstorm";
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82) || (code >= 51 && code <= 57)) {
      return mm >= 7.5 || code === 65 || code === 82 ? "Heavy rain" : mm >= 2.5 || code === 63 || code === 81 ? "Rain" : "Light rain";
    }
    if (code === 45 || code === 48) return "Foggy";
    if (code === 3) return "Cloudy";
    if (code === 0) return "Clear";
    return "Partly cloudy";
  }
  function compass(deg) { return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8]; }

  /** Turns the API answer into what the pages need: now, the next 48 hours, the peak and the risk. */
  function summarise(data, at) {
    var cur = data.current, h = data.hourly;
    var idx = h.time.findIndex(function (t) { return t.slice(0, 13) === cur.time.slice(0, 13); });
    if (idx < 0) idx = 0;
    var hourly = h.time.slice(idx, idx + 48).map(function (t, i) { return { time: t, mm: r1(h.precipitation[idx + i]) }; });
    var nowMm = r1(cur.precipitation);
    var soon = Math.max.apply(null, [nowMm].concat(hourly.slice(0, 4).map(function (x) { return x.mm; })));
    var peak = hourly.reduce(function (b, x) { return x.mm > b.mm ? x : b; }, hourly[0] || { time: cur.time, mm: 0 });
    function sum(n) { return r1(hourly.slice(0, n).reduce(function (s, x) { return s + x.mm; }, 0)); }
    return {
      at: at,
      now: {
        temp: Math.round(cur.temperature_2m), mm: nowMm, code: cur.weather_code,
        condition: condition(cur.weather_code, nowMm),
        wind: Math.round(cur.wind_speed_10m), windDir: compass(cur.wind_direction_10m)
      },
      hourly: hourly,
      next24mm: sum(24), next48mm: sum(48),
      peak: peak, soonMm: soon,
      risk: riskOf(soon),
      peakRisk: riskOf(peak.mm)
    };
  }

  function readCache() {
    try { var c = JSON.parse(localStorage.getItem(KEY)); if (c && c.at && c.data) return c; } catch (e) { /* ignore */ }
    return null;
  }
  function announce() { try { window.dispatchEvent(new CustomEvent("fda:weather", { detail: snap })); } catch (e) { /* old browser */ } }

  function fetchLive() {
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + LAT + "&longitude=" + LNG +
      "&current=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m" +
      "&hourly=precipitation&forecast_days=3&timezone=Asia%2FManila";
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("Weather service returned " + r.status); return r.json(); });
  }

  function load(force) {
    var cached = readCache();
    if (!force && cached && Date.now() - cached.at < TTL) {
      snap = summarise(cached.data, cached.at); status = "ready"; announce(); return Promise.resolve(snap);
    }
    if (loading) return loading;
    if (!snap) { status = "loading"; announce(); }
    loading = fetchLive().then(function (data) {
      var at = Date.now();
      try { localStorage.setItem(KEY, JSON.stringify({ at: at, data: data })); } catch (e) { /* ignore */ }
      snap = summarise(data, at); status = "ready";
    }).catch(function () {
      // Keep an older copy (marked stale) if there is one, otherwise show the error state
      if (cached) { snap = summarise(cached.data, cached.at); snap.stale = true; status = "ready"; }
      else if (snap) { snap.stale = true; }
      else status = "error";
    }).then(function () { loading = null; announce(); return snap; });
    return loading;
  }

  /* ---------- Card ---------- */
  var ICON = {
    rain: '<path d="M7 14.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 7.5a3.5 3.5 0 0 1 .5 7z"/><path d="M9 18v2M15 18v2"/>',
    storm: '<path d="M7 14.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 7.5a3.5 3.5 0 0 1 .5 7z"/><path d="m12.5 12-2.5 4h3.5l-2.5 4"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 11a3.5 3.5 0 0 1 .5 7z"/>',
    sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'
  };
  function iconFor(s) {
    var c = s.now.condition;
    return /storm/i.test(c) ? "storm" : /rain/i.test(c) ? "rain" : c === "Clear" ? "sun" : "cloud";
  }
  function svg(paths, cls) {
    return '<svg class="icon ' + cls + '" viewBox="0 0 24 24" aria-hidden="true">' + paths + "</svg>";
  }
  function hourText(iso) { return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric" }); }
  function dayHour(iso) {
    var d = new Date(iso), today = new Date().toDateString() === d.toDateString();
    return (today ? "" : d.toLocaleDateString("en-PH", { weekday: "short" }) + " ") + hourText(iso);
  }
  function badge(risk) {
    return '<span class="badge badge--wx-' + risk + '">' + FDA.ui.svg("possible-flood") + WORDS[risk] + " flood risk</span>";
  }
  function note() {
    return "Risk is estimated from forecast rain using PAGASA-style levels, not an official PAGASA warning. Forecast by " +
      '<a class="link" href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.';
  }

  function cardHtml() {
    var head = '<div class="wx-card__head"><span class="eyebrow">Weather · Quezon City</span>';
    if (status === "loading" && !snap) {
      return head + '</div><div class="wx-card__state" role="status"><span class="wx-card__spinner" aria-hidden="true"></span>Loading the latest weather…</div>';
    }
    if (!snap) {
      return head + '</div><div class="wx-card__state wx-card__state--error" role="alert">Weather could not be loaded. Check your connection and try again.' +
        '<button class="btn btn--outline btn--sm" type="button" data-wx-retry>Try again</button></div>';
    }
    var s = snap, n = s.now;
    var out = head + '<span class="wx-card__time">' + (s.stale ? "Offline copy from " : "Updated ") + FDA.ui.clock(s.at) + "</span></div>" +
      '<div class="wx-card__main">' + svg(ICON[iconFor(s)], "icon--lg wx-card__icon") +
      '<span class="wx-card__temp">' + n.temp + "°</span>" +
      '<div class="wx-card__cond"><strong>' + FDA.ui.esc(n.condition) + "</strong>" + badge(s.risk) + "</div></div>" +
      '<dl class="wx-card__stats">' +
      "<div><dt>Rain now</dt><dd>" + n.mm + " mm/h</dd></div>" +
      "<div><dt>Wind</dt><dd>" + n.wind + " km/h " + n.windDir + "</dd></div>" +
      "<div><dt>Next 24 h</dt><dd>" + s.next24mm + " mm</dd></div>" +
      "<div><dt>Next 48 h</dt><dd>" + s.next48mm + " mm</dd></div></dl>" +
      '<p class="wx-card__peak">' + (s.peak.mm >= LIMITS.moderate
        ? "Heaviest rain in the next 48 hours: <strong>" + s.peak.mm + " mm/h</strong> around " + dayHour(s.peak.time) + " (" + WORDS[s.peakRisk].toLowerCase() + ")."
        : "No heavy rain expected in the next 48 hours.") + "</p>" +
      '<p class="wx-card__note">' + note() + "</p>";
    return out;
  }

  function mount(el) {
    if (!el) return;
    el.classList.add("wx-card");
    function draw() {
      el.setAttribute("aria-busy", String(status === "loading" && !snap));
      el.innerHTML = cardHtml();
      el.className = "wx-card" + (snap ? " wx-card--" + snap.risk : "");
    }
    el.addEventListener("click", function (e) {
      if (e.target.closest("[data-wx-retry]")) { status = "loading"; draw(); load(true); }
    });
    window.addEventListener("fda:weather", draw);
    draw(); load();
    setInterval(function () { load(true); }, TTL); // refresh every 15 minutes while the page is open
  }

  FDA.weather = {
    LAT: LAT, LNG: LNG, LIMITS: LIMITS, words: WORDS,
    state: function () { return status; },
    get: function () { return snap; },
    riskOf: riskOf, worse: worse, load: load, mount: mount
  };
})();
