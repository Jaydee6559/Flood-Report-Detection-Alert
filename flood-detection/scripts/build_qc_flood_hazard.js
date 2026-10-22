#!/usr/bin/env node
/**
 * Build static/data/qc-flood-hazard.geojson (+ qc-flood-hazard.js) for the flood hazard layer.
 *
 * Hazard source: UP DREAM / Phil-LiDAR 1 (LiPAD), City of Quezon City 100 Year Flood Hazard Map (2016),
 *   481.2 mm rainfall scenario. Shapefile ph137404000_fh100yr_30m_10m (UTM 51N, EPSG:32651) in scripts/source/.
 *   Attribute "Var": 1 = Low, 2 = Medium (shown as "Moderate"), 3 = High.
 *   Var 0, -1 and -2 are NOT hazard classes (see the "Var codes" report this script prints).
 * Boundaries: static/data/barangays.geojson (faeldon/philippines-json-maps, see build_barangays.py).
 *
 * Method (all areas are measured in UTM metres, no packages needed):
 *   1. Read the shapefile and rasterize every Var onto a 10 m grid in UTM 51N (even-odd fill, so holes work).
 *   2. Where classes overlap, the highest class (3 > 2 > 1) wins for that cell.
 *   3. Project each barangay polygon to UTM and count its cells per class.
 *   4. A barangay's risk is the highest class covering at least RISK_SHARE of its covered area.
 *      It is "unknown" when too little of it is covered by the data (never "safe"). When it is covered
 *      but no single class reaches RISK_SHARE it is "below-threshold" (the percentages still show in the popup).
 *   5. Barangay outlines are written back in WGS84 lon/lat for Leaflet (they come from barangays.geojson already).
 *
 * Usage (from the flood-detection folder):   node scripts/build_qc_flood_hazard.js
 *   Optional:  node scripts/build_qc_flood_hazard.js path/to/shapefile.shp
 */
"use strict";
var fs = require("fs"), path = require("path");

var HERE = path.resolve(__dirname, "..");
var SRC = process.argv[2] || path.join(HERE, "scripts", "source", "ph137404000_fh100yr_30m_10m.shp");
var BARANGAYS = path.join(HERE, "static", "data", "barangays.geojson");
var OUT = path.join(HERE, "static", "data", "qc-flood-hazard");

var SOURCE_TEXT = "UP DREAM / Phil-LiDAR 1, City of Quezon 100 Year Flood Hazard Map (2016), 481.2 mm rainfall scenario";
var CELL = 10;             // grid size in metres
var RISK_SHARE = 0.20;     // a class must cover at least this share of the assessed area to name the barangay
var MIN_COVERAGE = 0.50;   // below this share of the barangay covered by the data (Var 0-3) the risk is "unknown"
var NAMES = { 1: "low", 2: "moderate", 3: "high" };

/* ---------- Shapefile (polygons) and dbf ---------- */
function readShapefile(shpPath) {
  var base = shpPath.replace(/\.shp$/i, "");
  var shp = fs.readFileSync(base + ".shp"), dbf = fs.readFileSync(base + ".dbf");
  var nRec = dbf.readUInt32LE(4), hLen = dbf.readUInt16LE(8), rLen = dbf.readUInt16LE(10), fields = [], off = 1;
  for (var o = 32; dbf[o] !== 0x0d; o += 32) {
    var f = { name: dbf.toString("latin1", o, o + 11).replace(/\0/g, ""), len: dbf[o + 16], off: off }; off += f.len; fields.push(f);
  }
  var out = [], pos = 100, i = 0;
  while (pos < shp.length && i < nRec) {
    var r = pos + 8, type = shp.readInt32LE(r);
    var rec = dbf.toString("latin1", hLen + i * rLen + 1, hLen + (i + 1) * rLen), attrs = {};
    fields.forEach(function (f) { attrs[f.name] = rec.substr(f.off - 1, f.len).trim(); });
    var rings = [];
    if (type === 5) {
      var np = shp.readInt32LE(r + 36), nv = shp.readInt32LE(r + 40), pStart = r + 44, vStart = pStart + 4 * np, parts = [];
      for (var p = 0; p < np; p++) parts.push(shp.readInt32LE(pStart + 4 * p));
      parts.push(nv);
      for (p = 0; p < np; p++) {
        var ring = new Float64Array((parts[p + 1] - parts[p]) * 2);
        for (var v = parts[p], k = 0; v < parts[p + 1]; v++, k += 2) {
          ring[k] = shp.readDoubleLE(vStart + 16 * v); ring[k + 1] = shp.readDoubleLE(vStart + 16 * v + 8);
        }
        rings.push(ring);
      }
    }
    out.push({ attrs: attrs, rings: rings });
    pos += 8 + shp.readInt32BE(pos + 4) * 2; i++;
  }
  return out;
}

/* ---------- WGS84 lon/lat -> UTM 51N metres (Snyder, transverse Mercator) ---------- */
function toUTM(lon, lat) {
  var a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, lon0 = 123 * Math.PI / 180;
  var e2 = f * (2 - f), ep2 = e2 / (1 - e2), phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
  var s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  var N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = (lam - lon0) * c;
  var e4 = e2 * e2, e6 = e4 * e2;
  var M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi) +
    (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi));
  var x = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120) + 500000;
  var y = k0 * (M + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
  return [x, y];
}

/* ---------- Even-odd scanline fill on the grid ---------- */
// Grid cell (col,row) has its centre at (X0 + (col+.5)*CELL, Y0 + (row+.5)*CELL).
function Grid(bbox) {
  this.x0 = Math.floor(bbox[0] / CELL) * CELL; this.y0 = Math.floor(bbox[1] / CELL) * CELL;
  this.w = Math.ceil((bbox[2] - this.x0) / CELL) + 1; this.h = Math.ceil((bbox[3] - this.y0) / CELL) + 1;
}
/** Calls span(row, colFrom, colTo) (inclusive) for each filled run. rings = arrays of flat [x,y,x,y...]. */
function fill(grid, rings, span) {
  var rows = new Map();
  rings.forEach(function (ring) {
    var n = ring.length / 2;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xa = ring[2 * j], ya = ring[2 * j + 1], xb = ring[2 * i], yb = ring[2 * i + 1];
      if (ya === yb) continue;
      var lo = Math.min(ya, yb), hi = Math.max(ya, yb);
      var r0 = Math.max(0, Math.ceil((lo - grid.y0) / CELL - 0.5)), r1 = Math.min(grid.h - 1, Math.ceil((hi - grid.y0) / CELL - 0.5) - 1);
      for (var r = r0; r <= r1; r++) {
        var yc = grid.y0 + (r + 0.5) * CELL, x = xa + (yc - ya) * (xb - xa) / (yb - ya);
        var list = rows.get(r); if (!list) rows.set(r, list = []); list.push(x);
      }
    }
  });
  rows.forEach(function (xs, r) {
    xs.sort(function (a, b) { return a - b; });
    for (var k = 0; k + 1 < xs.length; k += 2) {
      var c0 = Math.max(0, Math.ceil((xs[k] - grid.x0) / CELL - 0.5)), c1 = Math.min(grid.w - 1, Math.ceil((xs[k + 1] - grid.x0) / CELL - 0.5) - 1);
      if (c1 >= c0) span(r, c0, c1);
    }
  });
}

function run() {
  if (!fs.existsSync(SRC)) { console.error("Shapefile not found: " + SRC + "\nPut the .shp/.dbf/.shx/.prj files in flood-detection/scripts/source/."); process.exit(1); }
  var prj = fs.existsSync(SRC.replace(/\.shp$/i, ".prj")) ? fs.readFileSync(SRC.replace(/\.shp$/i, ".prj"), "utf8") : "";
  if (prj && !/UTM zone 51N|32651/.test(prj)) { console.error("The .prj is not WGS 84 / UTM zone 51N (EPSG:32651). Use the UTM 51N version of the file."); process.exit(1); }

  console.log("Reading " + path.basename(SRC) + " ...");
  var recs = readShapefile(SRC), vars = {};
  var bb = [Infinity, Infinity, -Infinity, -Infinity];
  recs.forEach(function (r) {
    r.var = +r.attrs.Var; vars[r.var] = (vars[r.var] || 0) + 1;
    r.rings.forEach(function (g) { for (var i = 0; i < g.length; i += 2) { if (g[i] < bb[0]) bb[0] = g[i]; if (g[i + 1] < bb[1]) bb[1] = g[i + 1]; if (g[i] > bb[2]) bb[2] = g[i]; if (g[i + 1] > bb[3]) bb[3] = g[i + 1]; } });
  });
  var grid = new Grid(bb), size = grid.w * grid.h;
  console.log("Grid " + grid.w + " x " + grid.h + " cells of " + CELL + " m (" + (size / 1e6).toFixed(1) + " M cells)");

  // present[var] = 1 where that Var covers the cell
  var present = {};
  recs.forEach(function (r) {
    var m = present[r.var] || (present[r.var] = new Uint8Array(size));
    fill(grid, r.rings, function (row, c0, c1) { for (var c = c0; c <= c1; c++) m[row * grid.w + c] = 1; });
  });
  function has(v, idx) { return present[v] && present[v][idx]; }
  // Highest hazard class per cell: 3 > 2 > 1; 0 = covered by Var 0 only; 4 = nothing in Var 0-3
  var cls = new Uint8Array(size);
  for (var i = 0; i < size; i++) cls[i] = has(3, i) ? 3 : has(2, i) ? 2 : has(1, i) ? 1 : has(0, i) ? 0 : 4;

  /* Var code report: what each code covers, in km2, and how it overlaps the others */
  var km2 = CELL * CELL / 1e6, report = {};
  [-2, -1, 0, 1, 2, 3].forEach(function (v) {
    if (!present[v]) return;
    var n = 0, over = { "-2": 0, "-1": 0, "0": 0, "1": 0, "2": 0, "3": 0 };
    for (var k = 0; k < size; k++) if (present[v][k]) { n++; [-2, -1, 0, 1, 2, 3].forEach(function (u) { if (u !== v && has(u, k)) over[u]++; }); }
    report[v] = { km2: +(n * km2).toFixed(2), overlapKm2: Object.keys(over).filter(function (u) { return over[u]; }).reduce(function (o, u) { o[u] = +(over[u] * km2).toFixed(2); return o; }, {}) };
  });
  console.log("\nVar codes (records: " + JSON.stringify(vars) + ")");
  Object.keys(report).forEach(function (v) { console.log("  Var " + v + ": " + report[v].km2 + " km2, overlaps " + JSON.stringify(report[v].overlapKm2)); });

  /* Barangays */
  var gj = JSON.parse(fs.readFileSync(BARANGAYS, "utf8")), rowsOut = [];
  gj.features.forEach(function (f) {
    var polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates, rings = [];
    polys.forEach(function (poly) { poly.forEach(function (ring) {
      var flat = new Float64Array(ring.length * 2);
      ring.forEach(function (pt, i) { var u = toUTM(pt[0], pt[1]); flat[2 * i] = u[0]; flat[2 * i + 1] = u[1]; });
      rings.push(flat);
    }); });
    var count = [0, 0, 0, 0, 0], total = 0; // index = class 0..3, 4 = not covered
    fill(grid, rings, function (row, c0, c1) { for (var c = c0; c <= c1; c++) { count[cls[row * grid.w + c]]++; total++; } });
    var covered = count[0] + count[1] + count[2] + count[3], p = f.properties;
    var pct = function (n) { return covered ? Math.round(n / covered * 1000) / 10 : 0; };
    var risk = "unknown", why = "";
    if (!total) why = "no cells";
    else if (covered / total < MIN_COVERAGE) why = "only " + Math.round(covered / total * 100) + "% of the barangay is covered by the data";
    else {
      risk = "below-threshold";
      for (var v = 3; v >= 1; v--) if (count[v] / covered >= RISK_SHARE) { risk = NAMES[v]; break; }
      if (risk === "below-threshold") why = "no class reaches " + RISK_SHARE * 100 + "% of the covered area";
    }
    var props = { name: p.name, district: p.district, risk: risk, source: SOURCE_TEXT, low: pct(count[1]), moderate: pct(count[2]), high: pct(count[3]),
      coverage: total ? Math.round(covered / total * 1000) / 10 : 0 };
    if (p.approx) props.approx = true;
    if (why) props.note = why;
    rowsOut.push({ type: "Feature", properties: props, geometry: f.geometry });
  });

  var out = { type: "FeatureCollection", riskShare: RISK_SHARE, _about: "Quezon City flood hazard per barangay. " + SOURCE_TEXT + ". Built by scripts/build_qc_flood_hazard.js. Risk = highest class covering at least " + RISK_SHARE * 100 + "% of the covered area; 'unknown' = too little covered by the data (never safe); 'below-threshold' = covered but no class reaches that share.", features: rowsOut };
  var json = JSON.stringify(out);
  fs.writeFileSync(OUT + ".geojson", json);
  fs.writeFileSync(OUT + ".js", "/* Generated by scripts/build_qc_flood_hazard.js from qc-flood-hazard.geojson. Do not edit by hand. */\nwindow.FDA_QC_HAZARD = " + json + ";\n");

  var tally = {}; rowsOut.forEach(function (f) { tally[f.properties.risk] = (tally[f.properties.risk] || 0) + 1; });
  console.log("\nBarangays: " + rowsOut.length + "  " + JSON.stringify(tally));
  console.log("Unknown (too little coverage): " + (rowsOut.filter(function (f) { return f.properties.risk === "unknown"; }).map(function (f) {
    return "\n  " + f.properties.name + " (D" + f.properties.district + ", " + f.properties.coverage + "% covered): " + f.properties.note;
  }).join("") || "none"));
  console.log("Below threshold (covered, no class reaches " + RISK_SHARE * 100 + "%): " + rowsOut.filter(function (f) { return f.properties.risk === "below-threshold"; }).map(function (f) { return f.properties.name; }).join(", "));
  console.log("Approximate boundary: " + rowsOut.filter(function (f) { return f.properties.approx; }).map(function (f) { return f.properties.name + " -> " + f.properties.risk; }).join(", "));
  console.log("\nWrote qc-flood-hazard.geojson (" + (fs.statSync(OUT + ".geojson").size / 1024).toFixed(1) + " KB) and qc-flood-hazard.js");
}

if (require.main === module) run();

module.exports = { readShapefile: readShapefile, toUTM: toUTM, Grid: Grid, fill: fill, CELL: CELL };
