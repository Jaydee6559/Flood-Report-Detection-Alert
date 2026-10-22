/**
 * Weather report
 *
 * Live forecast from Open-Meteo (free, no API key): https://open-meteo.com
 * The agent adds a flood-risk outlook by combining the forecast rain with the
 * recent flood reports in the same area.
 *
 * The "rainfall warning" bar is worked out from the forecast using PAGASA's
 * rainfall levels (yellow 7.5, orange 15, red 30 mm/h). It is an estimate,
 * NOT an official PAGASA advisory. If the forecast cannot be loaded, the
 * sample data in the page stays and is labelled as such.
 */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, $$ = FDA.ui.$$, esc = FDA.ui.esc;
  var db = FDA.store.db(), user = FDA.auth.current();

  /* Areas in the drop-down: the user's home barangay, the whole city, then each district.
     (The forecast grid is a few km wide, so districts are as fine as it gets.) */
  var CITY = FDA.geo.cityNames()[0], CC = FDA.geo.cities[CITY];
  var AREAS = {};
  if (user && user.homeBarangay && user.homeCity === CITY) {
    var hp = FDA.geo.point(CITY, user.homeBarangay);
    AREAS[user.homeBarangay + ", " + CITY] = { lat: hp.lat, lng: hp.lng, city: CITY, barangay: user.homeBarangay, short: user.homeBarangay };
  }
  AREAS[CITY + " (whole city)"] = { lat: CC.lat, lng: CC.lng, city: CITY, short: CITY };
  FDA.geo.districts(CITY).forEach(function (d) {
    AREAS[d.name + ", " + CITY] = { lat: d.lat, lng: d.lng, city: CITY, district: d.id, short: d.name };
  });
  var area = $("#area"), areaName = Object.keys(AREAS)[0], custom = null;
  area.innerHTML = "";
  Object.keys(AREAS).forEach(function (k) { area.appendChild(new Option(k, k)); });

  var ICONS = {
    rain: '<path d="M7 14.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 7.5a3.5 3.5 0 0 1 .5 7z"/><path d="M9 18v2M15 18v2"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 11a3.5 3.5 0 0 1 .5 7z"/>',
    partly: '<circle cx="8.5" cy="8.5" r="2.8"/><path d="M8.5 2.5v1.2M2.5 8.5h1.2M4.3 4.3l.9.9M12.7 4.3l-.9.9"/><path d="M9 19a3.5 3.5 0 0 1-.4-7 4.7 4.7 0 0 1 9 1.4 3 3 0 0 1 .4 5.6z"/>',
    storm: '<path d="M7 14.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 7.5a3.5 3.5 0 0 1 .5 7z"/><path d="m12.5 12-2.5 4h3.5l-2.5 4"/>',
    sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'
  };
  function describe(code, mm) {
    if (code >= 95) return { text: "Thunderstorm", icon: "storm" };
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82) || (code >= 51 && code <= 57)) {
      var t = mm >= 7.5 || code === 65 || code === 82 ? "Heavy rain" : mm >= 2.5 || code === 63 || code === 81 ? "Rain" : "Light rain";
      return { text: t, icon: "rain" };
    }
    if (code === 45 || code === 48) return { text: "Foggy", icon: "cloud" };
    if (code === 3) return { text: "Cloudy", icon: "cloud" };
    if (code === 0) return { text: "Clear", icon: "sun" };
    return { text: "Partly cloudy", icon: "partly" };
  }
  function band(mm) { return mm >= 15 ? "intense" : mm >= 7.5 ? "heavy" : mm >= 2.5 ? "moderate" : "light"; }
  function compass(deg) { return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8]; }
  function hourLabel(iso) { return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric" }); }
  function svgInto(el, name) { el.innerHTML = ICONS[name]; }

  /* ---------- Forecast fetch with a short-lived cache ---------- */
  var cacheKey = function (lat, lng) { return "fda.wx." + lat.toFixed(2) + "," + lng.toFixed(2); };
  function getForecast(lat, lng) {
    var key = cacheKey(lat, lng), cached = null;
    try { cached = JSON.parse(localStorage.getItem(key)); } catch (e) { /* ignore */ }
    if (cached && Date.now() - cached.at < 15 * 60000) return Promise.resolve(cached);
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lng +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m" +
      "&hourly=precipitation,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max" +
      "&timezone=Asia%2FManila&forecast_days=7";
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("Forecast service returned " + r.status); return r.json(); }).then(function (data) {
      var out = { at: Date.now(), data: data };
      try { localStorage.setItem(key, JSON.stringify(out)); } catch (e) { /* ignore */ }
      return out;
    }).catch(function (err) { if (cached) { cached.stale = true; return cached; } throw err; });
  }

  /* ---------- Draw ---------- */
  function inArea(r, a) {
    if (r.city !== a.city || a === custom) return r.city === a.city;
    if (a.barangay) return r.barangay === a.barangay;
    if (a.district) return FDA.geo.districtOf(r.city, r.barangay) === a.district;
    return true;
  }
  function current() { return custom || AREAS[areaName]; }

  function recentWarnings(a) {
    var now = Date.now();
    return db.reports.filter(function (r) {
      return !r.removed && !r.dupOf && r.status === "flood-warning" && now - r.ts <= 2 * 3600000 && inArea(r, a);
    });
  }

  function draw(res) {
    var d = res.data, a = current(), cur = d.current;
    var nowIdx = d.hourly.time.findIndex(function (t) { return t.slice(0, 13) === cur.time.slice(0, 13); }); if (nowIdx < 0) nowIdx = 0;
    var mm12 = d.hourly.precipitation.slice(nowIdx, nowIdx + 12).map(function (v) { return Math.round(v * 10) / 10; });
    var next6 = mm12.slice(0, 6).reduce(function (s, v) { return s + v; }, 0);
    var peak = Math.max.apply(null, mm12.slice(0, 6)), peakAt = d.hourly.time[nowIdx + mm12.slice(0, 6).indexOf(peak)];
    var warns = recentWarnings(a);
    var level = FDA.agent.outlook({ next6mm: next6, peakMm: peak, warnings: warns.length });
    var rain = FDA.agent.rainLevel(peak);

    /* heading */
    var sub = $(".page-subtitle");
    sub.innerHTML = "Updated " + FDA.ui.clock(res.at) + (res.stale ? " (offline copy)" : "") + " · forecast by <a class=\"link\" href=\"https://open-meteo.com/\" target=\"_blank\" rel=\"noopener\">Open-Meteo</a>";

    /* advisory (estimated warning level, not official) */
    var adv = $(".advisory"), bar = $(".advisory-bar");
    var names = { red: "Red", orange: "Orange", yellow: "Yellow" };
    adv.hidden = bar.hidden = !rain;
    if (rain) {
      $(".advisory__title").textContent = names[rain] + " rainfall level expected · " + a.short;
      $(".advisory__text").textContent = "Forecast peaks near " + peak + " mm/h around " + hourLabel(peakAt) + ". This is an estimate from forecast data, not an official PAGASA advisory.";
      $(".advisory-bar__inner span").textContent = names[rain] + " rainfall level expected";
      $(".advisory-bar__note").textContent = "Forecast estimate";
    }

    /* right now */
    var code = describe(cur.weather_code, cur.precipitation);
    $(".now-card .eyebrow").textContent = "Right now · " + a.short;
    svgInto($(".now-card__icon"), code.icon);
    $(".now-card__temp").textContent = Math.round(cur.temperature_2m) + "°";
    $(".now-card__condition").textContent = code.text;
    $(".now-card__feels").textContent = "Feels like " + Math.round(cur.apparent_temperature) + "°";
    $(".now-card__mobile-line").textContent = "Humidity " + Math.round(cur.relative_humidity_2m) + "% · Wind " + Math.round(cur.wind_speed_10m) + " km/h " + compass(cur.wind_direction_10m);
    var chance = d.hourly.precipitation_probability[nowIdx];
    var stats = $$(".now-card__stats strong");
    stats[0].textContent = (Math.round(cur.precipitation * 10) / 10) + " mm/h"; stats[1].textContent = Math.round(cur.relative_humidity_2m) + "%";
    stats[2].textContent = Math.round(cur.wind_speed_10m) + " km/h " + compass(cur.wind_direction_10m); stats[3].textContent = (chance == null ? "–" : chance + "%");

    /* agent outlook */
    var out = $(".outlook"), words = { high: "High flood risk", moderate: "Moderate flood risk", low: "Low flood risk" };
    out.className = "card outlook outlook--" + level;
    var tag = $(".outlook__tag"), head = $(".outlook__head"), icon = head.querySelector("svg");
    head.textContent = ""; head.appendChild(icon); head.append(" " + words[level] + " · next 6 hours "); head.appendChild(tag);
    var lines = $$(".outlook__line span", out);
    lines[0].innerHTML = "About <strong>" + Math.round(next6) + " mm</strong> of rain expected in the next 6 hours" + (peak >= 2.5 ? "; heaviest around " + hourLabel(peakAt) + "." : ".");
    lines[1].innerHTML = "<strong>" + warns.length + " flood warning" + (warns.length === 1 ? "" : "s") + "</strong> reported in " + esc(a.short) + " in the last 2 hours.";
    var callout = $(".outlook .callout");
    callout.className = "callout callout--" + (level === "high" ? "danger" : level === "moderate" ? "warning" : "success");
    var street = warns[0] ? warns[0].street : null;
    callout.textContent = level === "high" ? "Avoid low streets" + (street ? " like " + street : "") + ". Check reports before you travel."
      : level === "moderate" ? "Rain may flood low areas. Check reports before you travel."
        : "No flooding expected from rain right now. Reports can still change quickly.";

    /* hourly bars */
    var bars = $(".rain-chart__bars");
    bars.innerHTML = mm12.map(function (v, i) {
      var t = d.hourly.time[nowIdx + i];
      return '<div class="rain-bar rain-bar--' + band(v) + (i === 0 ? " rain-bar--now" : "") + (i >= 8 ? " rain-bar--extra" : "") + '" style="--mm: ' + Math.min(v, 30) + '"><span class="rain-bar__value">' + v + '</span><span class="rain-bar__fill"></span><span class="rain-bar__label">' + (i === 0 ? "Now" : hourLabel(t)) + "</span></div>";
    }).join("");
    $(".rain-chart").setAttribute("aria-label", "Hourly rainfall in mm per hour: " + mm12.map(function (v, i) { return v + " " + (i === 0 ? "now" : "at " + hourLabel(d.hourly.time[nowIdx + i])); }).join(", ") + ".");

    /* 7 days */
    $("#forecast-title + span, .forecast-card__head span").textContent = a.short;
    $(".forecast-list").innerHTML = d.daily.time.map(function (day, i) {
      var dt = new Date(day + "T12:00:00"), c = d.daily.precipitation_probability_max[i], mmSum = Math.round(d.daily.precipitation_sum[i]);
      var ic = describe(d.daily.weather_code[i], mmSum > 20 ? 8 : mmSum > 5 ? 3 : 0).icon;
      return '<li class="forecast-row' + (i === 0 || i >= 4 ? " forecast-row--extra" : "") + '"><span class="forecast-row__day">' + (i === 0 ? "Today" : dt.toLocaleDateString("en-PH", { weekday: "short" })) + "<small>" + dt.toLocaleDateString("en-PH", { month: "short", day: "numeric" }) + "</small></span>" +
        '<svg class="icon icon--md forecast-row__icon" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[ic] + '</svg><span class="forecast-row__bar" style="--value: ' + c + '%" aria-hidden="true"></span><span class="forecast-row__chance">' + c + '%</span><span class="forecast-row__mm">' + mmSum + ' mm</span><span class="forecast-row__temp">' + Math.round(d.daily.temperature_2m_min[i]) + "° / " + Math.round(d.daily.temperature_2m_max[i]) + "°</span></li>";
    }).join("");
  }

  /* ---------- Weather on my routes (rain at the next departure) ---------- */
  var routeCard = $(".route-weather");
  var routeIcon = $(".route-weather__icon").innerHTML;
  function nextDeparture(s) {
    var now = new Date();
    for (var add = 0; add < 7; add++) {
      var d = new Date(now); d.setDate(now.getDate() + add);
      if (s.days.indexOf(d.getDay()) < 0) continue;
      var p = s.time.split(":"); d.setHours(+p[0], +p[1], 0, 0);
      if (d > now) return d;
    }
    return null;
  }
  function drawRoutes() {
    if (!user) { routeCard.innerHTML = '<li class="text-small text-muted" style="padding:8px 0"><a class="link" href="auth/login.html?next=weather.html">Sign in</a> to see the rain forecast on your saved routes.</li>'; return; }
    var routes = db.routes.filter(function (r) { return r.userId === user.id; });
    if (!routes.length) { routeCard.innerHTML = '<li class="text-small text-muted" style="padding:8px 0">No saved routes yet. <a class="link" href="routes.html">Add a route</a> and a travel schedule.</li>'; return; }
    var jobs = routes.map(function (r) {
      var s = db.schedules.filter(function (x) { return x.routeId === r.id && x.enabled; })[0];
      var dep = s && nextDeparture(s), p = FDA.geo.resolve(r.start) || current();
      if (!dep) return Promise.resolve({ r: r });
      return getForecast(p.lat, p.lng).then(function (res) {
        var idx = res.data.hourly.time.indexOf(dep.getFullYear() + "-" + ("0" + (dep.getMonth() + 1)).slice(-2) + "-" + ("0" + dep.getDate()).slice(-2) + "T" + ("0" + dep.getHours()).slice(-2) + ":00");
        return { r: r, dep: dep, mm: idx >= 0 ? res.data.hourly.precipitation[idx] : null, chance: idx >= 0 ? res.data.hourly.precipitation_probability[idx] : null };
      }).catch(function () { return { r: r, dep: dep, mm: null }; });
    });
    Promise.all(jobs).then(function (rows) {
      routeCard.innerHTML = rows.map(function (x) {
        var text, badge;
        if (!x.dep) { text = "No travel schedule yet"; badge = ""; }
        else if (x.mm == null) { text = x.dep.toLocaleDateString("en-PH", { weekday: "short" }) + " " + FDA.ui.clock(x.dep) + " · forecast unavailable"; badge = ""; }
        else {
          var b = band(x.mm), none = x.mm < 0.2;
          text = x.dep.toLocaleDateString("en-PH", { weekday: "short" }) + " " + FDA.ui.clock(x.dep) + " · " + x.mm + " mm/h, " + x.chance + "%";
          badge = '<span class="badge badge--rain-' + (none ? "none" : b === "intense" ? "heavy" : b) + '">' + (none ? "Dry" : b === "intense" ? "Intense rain" : b === "heavy" ? "Heavy rain" : b === "moderate" ? "Moderate rain" : "Light rain") + "</span>";
        }
        return '<li class="route-weather__item"><span class="route-weather__icon">' + routeIcon + '</span><span class="route-weather__text"><strong>' + esc(x.r.name) + "</strong><small>" + text + "</small></span>" + badge + "</li>";
      }).join("");
    });
  }

  /* ---------- Quezon City weather card (core/weather.js) ---------- */
  FDA.weather.mount($("#wx-card"));

  /* ---------- Load ---------- */
  function load() {
    var a = current();
    return getForecast(a.lat, a.lng).then(function (res) { draw(res); drawRoutes(); })
      .catch(function () {
        $(".page-subtitle").innerHTML = "Live forecast could not be loaded, so the page shows <strong>sample data</strong>. <span class=\"badge badge--sample\">SAMPLE DATA</span>";
        drawRoutes();
      });
  }

  area.addEventListener("change", function () { custom = null; areaName = area.value; load(); });
  $(".weather-controls .btn").addEventListener("click", function () {
    var b = this; b.disabled = true;
    FDA.geo.locate().then(function (p) {
      var n = FDA.geo.nearest(p.lat, p.lng);
      custom = { lat: p.lat, lng: p.lng, city: n ? n.city : "", short: n && n.meters < 8000 ? n.barangay : "Your location" };
      var opt = $("option[data-mine]", area) || new Option("My location", "__mine"); opt.dataset.mine = "1"; area.appendChild(opt); area.value = "__mine";
      return load();
    }).catch(function (err) { FDA.ui.toast(err.message, "error"); }).then(function () { b.disabled = false; });
  });

  /* ---------- Rain by district (the R input of the agent) ---------- */
  (function districtCard() {
    var anchor = $(".forecast-card"); if (!anchor) return;
    var card = document.createElement("section");
    card.className = "card card--padded district-card"; card.setAttribute("aria-labelledby", "district-rain-title");
    anchor.insertAdjacentElement("beforebegin", card);
    function draw() {
      var LV = { yellow: "Yellow", orange: "Orange", red: "Red" }, by = FDA.areas.compute(0).byName, snap = FDA.rain.get();
      var rows = FDA.geo.districts("Quezon City").map(function (d) {
        var mm = FDA.rain.mm(d.id, 0), lvl = FDA.rain.level(d.id, 0), hi = 0, el = 0;
        Object.keys(by).forEach(function (n) { if (by[n].district === d.id) { if (by[n].level === "high") hi++; else if (by[n].level === "elevated") el++; } });
        var pct = Math.max(2, Math.min(100, Math.round(mm / 40 * 100))); // bar is 0 to 40 mm/h
        return '<li class="district-row">' +
          '<span class="district-row__name">District ' + d.id + '<small><span class="text-risk-high">' + hi + " high</span> · " + el + " elevated</small></span>" +
          '<span class="district-row__rain"><strong>' + mm + ' mm/h</strong><span class="badge badge--lvl-' + (lvl || "none") + '">' + (lvl ? LV[lvl] : "No level") + "</span></span>" +
          '<span class="district-row__bar district-row__bar--' + (lvl || "none") + '" role="img" aria-label="' + mm + ' millimetres per hour" style="--value:' + pct + '%"></span></li>';
      }).join("");
      card.innerHTML = '<div class="district-card__head"><h2 class="card__title" id="district-rain-title">Rain by district now</h2><span class="text-xs text-muted">Barangays at risk shown under each district</span></div>' +
        '<ul class="district-list">' + rows + "</ul>" +
        '<p class="district-card__scale text-xs text-muted"><span><i class="dot dot--yellow"></i>Yellow 7.5–15</span><span><i class="dot dot--orange"></i>Orange 15–30</span><span><i class="dot dot--red"></i>Red over 30 mm/h</span></p>' +
        '<p class="text-muted text-xs district-card__note">' + ({ live: "Live from Open-Meteo.", simulated: "Demo storm (simulated).", sample: "Sample rain: live data could not be loaded." }[snap.source]) +
        ' Levels are an estimate using PAGASA\'s thresholds, not an official warning. <a class="link" href="map.html">Open the flood map</a></p>';
    }
    draw(); window.addEventListener("fda:rain", draw); FDA.rain.load();
  })();

  load();
  setInterval(load, 30 * 60000); // forecast refreshes every 30 minutes while the page is open
})();
