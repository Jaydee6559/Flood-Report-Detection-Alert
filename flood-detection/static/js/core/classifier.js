/**
 * Image classifier
 *
 * Returns the probability (0–1) that a photo shows a flooded street.
 *
 * 1. If a TensorFlow.js model is found at  static/model/model.json  it is used
 *    (MobileNetV2 trained on Flood10K, converted with tensorflowjs_converter).
 *    See static/js/README.md for the conversion command.
 * 2. Otherwise a DEMO estimate is used so the rest of the app can be tried.
 *    It only looks at colours (smooth, brown/grey/blue ground), it is NOT the
 *    trained model, and the result page says so.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});

  var TFJS = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
  var modelUrl = new URL("../../model/model.json", document.currentScript.src).href;
  var state = { mode: "demo", model: null, loading: null };

  function loadScript(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = function () { fail(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }

  function init() {
    if (state.loading) return state.loading;
    // A page opened straight from disk (file://) cannot fetch a model, so it uses the demo estimate.
    if (location.protocol === "file:") { state.loading = Promise.resolve(); return state.loading; }
    state.loading = fetch(modelUrl, { method: "HEAD" })
      .then(function (r) { if (!r.ok) throw new Error("no model"); return loadScript(TFJS); })
      .then(function () { return window.tf.loadLayersModel(modelUrl); })
      .then(function (m) { state.model = m; state.mode = "tfjs"; })
      .catch(function () { state.mode = "demo"; });
    return state.loading;
  }

  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  /* Demo estimate: share of smooth, muted brown/grey/blue pixels in the lower part of the picture */
  function demoProbability(img) {
    var W = 64, H = 64, c = document.createElement("canvas");
    c.width = W; c.height = H;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    var d = ctx.getImageData(0, 0, W, H).data, hit = 0, total = 0, y, x;
    function lum(i) { return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }
    for (y = Math.floor(H * 0.35); y < H - 1; y++) {
      for (x = 0; x < W - 1; x++) {
        var i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx / 255, s = mx ? (mx - mn) / mx : 0, h = 0;
        if (mx !== mn) {
          if (mx === r) h = 60 * (((g - b) / (mx - mn)) % 6); else if (mx === g) h = 60 * ((b - r) / (mx - mn) + 2); else h = 60 * ((r - g) / (mx - mn) + 4);
          if (h < 0) h += 360;
        }
        var smooth = Math.abs(lum(i) - lum(i + 4)) + Math.abs(lum(i) - lum(i + W * 4)) < 14;
        var tone = (h >= 15 && h <= 65) || (h >= 170 && h <= 255) || s < 0.12;
        if (smooth && tone && s <= 0.65 && v >= 0.22 && v <= 0.88) hit++;
        total++;
      }
    }
    var ratio = total ? hit / total : 0;
    return Math.min(0.97, Math.max(0.03, sigmoid((ratio - 0.45) * 9)));
  }

  FDA.classifier = {
    /** "tfjs" when the trained model is loaded, otherwise "demo". */
    mode: function () { return state.mode; },
    init: init,
    /** Which output index is "Flood" when the model has two outputs. Match the class order used in training. */
    floodIndex: 1,
    /** @param {HTMLImageElement} img  @returns {Promise<{prob:number, source:string}>} */
    predict: function (img) {
      return init().then(function () {
        if (state.mode === "tfjs") {
          var tf = window.tf;
          var out = tf.tidy(function () {
            var x = tf.browser.fromPixels(img).resizeBilinear([224, 224]).toFloat().div(127.5).sub(1).expandDims(0);
            return state.model.predict(x);
          });
          return out.data().then(function (arr) {
            out.dispose();
            var p = arr.length > 1 ? arr[FDA.classifier.floodIndex] : arr[0];
            return { prob: Math.min(1, Math.max(0, p)), source: "tfjs" };
          });
        }
        return { prob: demoProbability(img), source: "demo" };
      });
    }
  };
})();
