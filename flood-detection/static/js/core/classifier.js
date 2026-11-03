/**
 * Image classifier
 *
 * Returns the probability (0–1) that a photo shows a flooded street.
 * It tries these in order and uses the first one that works:
 *
 * 1. "server": the Flask app's  POST /api/classify , which runs the trained
 *    MobileNetV2 (models/flood_model.keras). This is the normal setup.
 * 2. "tfjs":   a TensorFlow.js copy of the model at  static/model/model.json ,
 *    for running without Flask (see static/js/README.md).
 * 3. "demo":   a colour-based DEMO estimate so the rest of the app can be tried.
 *    It is NOT the trained model, and the result page says so.
 */
(function () {
  "use strict";
  var FDA = (window.FDA = window.FDA || {});

  var TFJS = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";
  var modelUrl = new URL("../../model/model.json", document.currentScript.src).href;
  var API_STATUS = "/api/model-status", API_CLASSIFY = "/api/classify";
  var state = { mode: "demo", model: null, loading: null };

  function loadScript(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = function () { fail(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }

  function tryServer() {
    return fetch(API_STATUS, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : { ready: false }; })
      .then(function (s) {
        if (!s.ready) {
          if (s.error && window.console) console.warn("Photo classifier not ready on the server: " + s.error);
          throw new Error("server model not ready");
        }
        state.mode = "server";
      });
  }

  function tryTfjs() {
    return fetch(modelUrl, { method: "HEAD" })
      .then(function (r) { if (!r.ok) throw new Error("no model"); return loadScript(TFJS); })
      .then(function () { return window.tf.loadLayersModel(modelUrl); })
      .then(function (m) { state.model = m; state.mode = "tfjs"; });
  }

  function init() {
    if (state.loading) return state.loading;
    // A page opened straight from disk (file://) cannot reach Flask or fetch a model, so it uses the demo estimate.
    if (location.protocol === "file:") { state.loading = Promise.resolve(); return state.loading; }
    state.loading = tryServer()
      .catch(tryTfjs)
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

  /* The photo as a JPEG file for the upload. The report page has already applied the
     phone's rotation when it drew the image, so the server gets it the right way up. */
  function photoBlob(img) {
    var max = 1024, scale = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return new Promise(function (ok, fail) {
      c.toBlob(function (b) { b ? ok(b) : fail(new Error("Could not prepare the photo.")); }, "image/jpeg", 0.9);
    });
  }

  function predictServer(img) {
    return photoBlob(img).then(function (blob) {
      var form = new FormData();
      form.append("photo", blob, "photo.jpg");
      return fetch(API_CLASSIFY, { method: "POST", body: form });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok || typeof body.prob !== "number") throw new Error(body.error || "The photo check failed (" + r.status + ").");
        return { prob: Math.min(1, Math.max(0, body.prob)), source: "server" };
      });
    });
  }

  function predictTfjs(img) {
    var tf = window.tf;
    var out = tf.tidy(function () {
      // The TF.js copy gets the same raw 0-255 pixels as the server: the model does its own scaling.
      var x = tf.browser.fromPixels(img).resizeBilinear([224, 224]).toFloat().expandDims(0);
      return state.model.predict(x);
    });
    return out.data().then(function (arr) {
      out.dispose();
      var p = arr.length > 1 ? arr[FDA.classifier.floodIndex] : arr[0];
      return { prob: Math.min(1, Math.max(0, p)), source: "tfjs" };
    });
  }

  FDA.classifier = {
    /** "server" or "tfjs" when the trained model is used, otherwise "demo". */
    mode: function () { return state.mode; },
    /** True when a result's source is the trained model (not the demo estimate). */
    isTrained: function (source) { return source === "server" || source === "tfjs"; },
    init: init,
    /** Which output index is "Flood" when the model has two outputs. Match the class order used in training. */
    floodIndex: 1,
    /** @param {HTMLImageElement} img  @returns {Promise<{prob:number, source:string}>} */
    predict: function (img) {
      return init().then(function () {
        if (state.mode === "server") {
          return predictServer(img).catch(function (err) {
            // Flask went away or failed on this photo: say so, and use the demo estimate rather than block the report.
            if (window.console) console.warn("Server photo check failed, using the demo estimate: " + err.message);
            if (FDA.ui && FDA.ui.toast) FDA.ui.toast("The photo checker is not reachable, so this result is a demo estimate.", "error");
            return { prob: demoProbability(img), source: "demo" };
          });
        }
        if (state.mode === "tfjs") return predictTfjs(img);
        return { prob: demoProbability(img), source: "demo" };
      });
    }
  };
})();
