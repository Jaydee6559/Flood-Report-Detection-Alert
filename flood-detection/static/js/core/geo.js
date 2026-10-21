/**
 * Places and distances
 *
 * The cities, districts, barangays and landmarks come from
 * static/data/locations.json (edit that file, then run
 * `python3 scripts/build_locations.py`, which writes the locations.js copy
 * that the pages actually load; see the README for why).
 *
 * Right now the list is Quezon City only: 6 districts, 142 barangays.
 * Coordinates are approximate centres, good enough for the drop-downs,
 * "use my current location", the flood map and route matching.
 *
 * TODO (backend): replace with a real geocoder for street-level addresses.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});

  var DATA = window.FDA_LOCATIONS;
  if (!DATA || !DATA.cities) {
    if (window.console) console.error("static/data/locations.js is missing. Run: python3 scripts/build_locations.py");
    DATA = { cities: [], landmarks: [] };
  }

  /* CITIES[name] = { lat, lng, districts: {id: {name, lat, lng}}, barangays: {name: [lat, lng]}, districtOf: {barangay: id} } */
  var CITIES = {};
  DATA.cities.forEach(function (c) {
    var city = { lat: c.center.lat, lng: c.center.lng, region: c.region || "", districts: {}, barangays: {}, districtOf: {}, approx: {} };
    (c.districts || []).forEach(function (d) { city.districts[d.id] = { id: d.id, name: d.name, lat: d.center.lat, lng: d.center.lng }; });
    c.barangays.forEach(function (b) {
      city.barangays[b.name] = [b.lat, b.lng];
      city.districtOf[b.name] = b.district;
      if (b.approx) city.approx[b.name] = true;
    });
    CITIES[c.name] = city;
  });

  /* Places people type into the route form that are not barangays */
  var LANDMARKS = (DATA.landmarks || []).map(function (l) {
    var city = DATA.cities[0] ? DATA.cities[0].name : "";
    return { name: l.name, names: [l.name].concat(l.aliases || []), city: l.city || city, barangay: l.barangay || null, lat: l.lat, lng: l.lng };
  });

  function norm(s) {
    return String(s || "").toLowerCase()
      .replace(/ñ/g, "n").replace(/[^a-z0-9 ]/g, " ")
      .replace(/\b(brgy|barangay|bgy)\b/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  /* Normalised names, built once, longest first so "North Fairview" wins over "Fairview" */
  var INDEX = [];
  Object.keys(CITIES).forEach(function (city) {
    Object.keys(CITIES[city].barangays).forEach(function (name) {
      INDEX.push({ key: norm(name), name: name, city: city });
    });
  });
  INDEX.sort(function (a, b) { return b.key.length - a.key.length; });

  var R = 6371000, rad = Math.PI / 180;

  /** Distance in meters between two {lat,lng} points. */
  function distance(a, b) {
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /** Distance in meters from point p to the segment a–b (flat-earth maths, fine at city scale). */
  function toSegment(p, a, b) {
    var k = Math.cos(p.lat * rad);
    var ax = a.lng * k, ay = a.lat, bx = b.lng * k, by = b.lat, px = p.lng * k, py = p.lat;
    var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    var t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    var q = { lat: ay + t * dy, lng: (ax + t * dx) / k };
    return distance(p, q);
  }

  FDA.geo = {
    cities: CITIES,
    distance: distance,
    toSegment: toSegment,
    cityNames: function () { return Object.keys(CITIES); },

    /** Barangay names of a city, A to Z. */
    barangays: function (city) { return CITIES[city] ? Object.keys(CITIES[city].barangays).sort(function (a, b) { return a.localeCompare(b, "en"); }) : []; },

    /** [{id, name, lat, lng}] for a city's districts. */
    districts: function (city) {
      var c = CITIES[city];
      return c ? Object.keys(c.districts).map(function (id) { return c.districts[id]; }) : [];
    },

    /** District number (1 to 6) of a barangay, or null. */
    districtOf: function (city, barangay) {
      var c = CITIES[city];
      return c && c.districtOf[barangay] ? c.districtOf[barangay] : null;
    },

    landmarks: function () { return LANDMARKS.slice(); },

    /** Coordinates for a city + barangay (+ street), or the city centre. */
    point: function (city, barangay, street) {
      var c = CITIES[city], b = c && c.barangays[barangay], p;
      if (b) p = { lat: b[0], lng: b[1] }; else if (c) p = { lat: c.lat, lng: c.lng }; else return null;
      if (street) { // spread reports on different streets a little, the same street always lands on the same spot
        var h = 0; for (var i = 0; i < street.length; i++) h = (h * 31 + street.charCodeAt(i)) % 997;
        p = { lat: p.lat + ((h % 13) - 6) * 0.00022, lng: p.lng + (((h >> 2) % 13) - 6) * 0.00022 };
      }
      return p;
    },

    /**
     * Find a place from free text such as "Culiat", "Brgy. Tandang Sora, Quezon City",
     * "UP Diliman" or "District 5". Landmarks first, then barangays, then districts, then the city.
     */
    resolve: function (text) {
      var t = norm(text);
      if (!t) return null;
      var i, j, k, c, city, d;

      for (i = 0; i < LANDMARKS.length; i++) {
        for (j = 0; j < LANDMARKS[i].names.length; j++) {
          k = norm(LANDMARKS[i].names[j]);
          if (k && (t === k || t.indexOf(k) >= 0)) return { name: LANDMARKS[i].name, lat: LANDMARKS[i].lat, lng: LANDMARKS[i].lng, city: LANDMARKS[i].city, barangay: LANDMARKS[i].barangay };
        }
      }
      // whole words only, so "central" does not match inside another word
      var padded = " " + t + " ";
      for (i = 0; i < INDEX.length; i++) {
        if (padded.indexOf(" " + INDEX[i].key + " ") >= 0) {
          c = CITIES[INDEX[i].city].barangays[INDEX[i].name];
          return { name: INDEX[i].name, lat: c[0], lng: c[1], city: INDEX[i].city, barangay: INDEX[i].name };
        }
      }
      // partial typing: "tandang" finds Tandang Sora (3+ letters, must start the name)
      if (t.length >= 3) {
        for (i = INDEX.length - 1; i >= 0; i--) {
          if (INDEX[i].key.indexOf(t) === 0) {
            c = CITIES[INDEX[i].city].barangays[INDEX[i].name];
            return { name: INDEX[i].name, lat: c[0], lng: c[1], city: INDEX[i].city, barangay: INDEX[i].name };
          }
        }
      }
      d = /\bdistrict (\d)\b/.exec(t);
      if (d) {
        for (city in CITIES) if (CITIES[city].districts[d[1]]) {
          var dd = CITIES[city].districts[d[1]];
          return { name: dd.name + ", " + city, lat: dd.lat, lng: dd.lng, city: city, district: dd.id };
        }
      }
      for (city in CITIES) if (t.indexOf(norm(city)) >= 0 || t === norm(city).replace(/ city$/, "")) return { name: city, lat: CITIES[city].lat, lng: CITIES[city].lng, city: city };
      return null;
    },

    /** Closest known barangay to a GPS position. */
    nearest: function (lat, lng) {
      var best = null, p = { lat: lat, lng: lng };
      Object.keys(CITIES).forEach(function (city) {
        Object.keys(CITIES[city].barangays).forEach(function (name) {
          var b = CITIES[city].barangays[name], d = distance(p, { lat: b[0], lng: b[1] });
          if (!best || d < best.meters) best = { city: city, barangay: name, lat: b[0], lng: b[1], meters: d };
        });
      });
      return best;
    },

    /** Ask the browser for the current position. Resolves with {lat,lng} or rejects with a readable message. */
    locate: function () {
      return new Promise(function (resolve, reject) {
        if (!navigator.geolocation) return reject(new Error("This browser cannot share your location."));
        navigator.geolocation.getCurrentPosition(
          function (pos) { resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
          function (err) { reject(new Error(err && err.code === 1 ? "Location permission was denied." : "Could not get your location.")); },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      });
    }
  };
})();
