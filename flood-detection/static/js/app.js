/**
 * Flood Detection & Alert — app loader
 *
 * Every page includes only this one file:
 *   <script src="../static/js/app.js"></script>              (templates/*.html)
 *   <script src="../../static/js/app.js"></script>           (templates/auth/*.html)
 *
 * It loads the shared core scripts in order, then the script for the
 * current page (static/js/pages/<page-name>.js, if there is one).
 *
 * The scripts are classic scripts (no modules) so the site also works when a
 * page is opened straight from disk (file://), the way the prototype is used.
 */
(function () {
  "use strict";

  var me = document.currentScript;
  var base = me.src.replace(/app\.js(\?.*)?$/, "");
  var page = (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "") || "index";

  // data/locations.js is a copy of data/locations.json (see scripts/build_locations.py)
  var dataDir = base.replace(/js\/$/, "") + "data/";
  var data = ["locations", "barangays", "flood-spots"];   // barangays.js = polygons + hazard; flood-spots.js = recurring spots
  var core = ["geo", "store", "hazard", "agent", "rain", "areas", "classifier", "ui", "auth", "notify", "scheduler", "layout", "mapkit", "streets", "weather", "hazardLayer"];

  var tags = data.map(function (name) {
    return '<script src="' + dataDir + name + '.js"><\/script>';
  }).concat(core.map(function (name) {
    return '<script src="' + base + "core/" + name + '.js"><\/script>';
  }));
  tags.push('<script src="' + base + "pages/" + page + '.js" onerror="void 0"><\/script>');

  // document.write keeps the scripts in order and runs them before DOMContentLoaded.
  document.write(tags.join(""));
})();
