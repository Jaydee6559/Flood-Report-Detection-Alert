/** Report a flood: photo, location, details → classifier → agent → saved report */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, $$ = FDA.ui.$$;

  var drop = $(".dropzone");
  var citySel = $("#city"), brgySel = $("#barangay"), street = $("#street"), desc = $("#description");
  var submit = $(".form-actions a.btn--primary");
  var steps = $$(".stepper__item");
  var state = { photo: null, img: null, gps: null };

  FDA.classifier.init(); // start loading the trained model, if there is one

  /* ---------- Location drop-downs ---------- */
  function fill(sel, first, items) { sel.innerHTML = ""; sel.appendChild(new Option(first, "")); items.forEach(function (n) { sel.appendChild(new Option(n, n)); }); }
  fill(citySel, "Select a city", FDA.geo.cityNames());
  fill(brgySel, "Select a barangay", []);
  brgySel.disabled = true;
  citySel.addEventListener("change", function () {
    fill(brgySel, "Select a barangay", FDA.geo.barangays(citySel.value));
    brgySel.disabled = !citySel.value;
    state.gps = null; paintSteps();
  });
  brgySel.addEventListener("change", function () { state.gps = null; paintSteps(); });

  var user = FDA.auth.current();
  if (user && user.homeCity) { citySel.value = user.homeCity; citySel.dispatchEvent(new Event("change")); if (user.homeBarangay) brgySel.value = user.homeBarangay; }

  /* ---------- Stepper follows what is filled in ---------- */
  function paintSteps() {
    var cur = !state.photo ? 0 : !(citySel.value && brgySel.value) ? 1 : 3;
    steps.forEach(function (li, i) {
      li.classList.toggle("stepper__item--current", i === cur);
      if (i === cur) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
  }

  /* ---------- Photo ---------- */
  var chooseInput = fileInput(false), cameraInput = fileInput(true);
  function fileInput(camera) {
    var i = document.createElement("input");
    i.type = "file"; i.accept = "image/jpeg,image/png,image/webp"; i.hidden = true;
    if (camera) i.setAttribute("capture", "environment");
    i.addEventListener("change", function () { if (i.files[0]) takeFile(i.files[0]); i.value = ""; });
    document.body.appendChild(i);
    return i;
  }

  var buttons = $$(".dropzone__actions button");
  buttons[0].addEventListener("click", function () { chooseInput.click(); });
  buttons[1].addEventListener("click", function () { cameraInput.click(); });
  drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("dropzone--over"); });
  drop.addEventListener("dragleave", function () { drop.classList.remove("dropzone--over"); });
  drop.addEventListener("drop", function (e) {
    e.preventDefault(); drop.classList.remove("dropzone--over");
    if (e.dataTransfer.files[0]) takeFile(e.dataTransfer.files[0]);
  });

  function photoError(msg) {
    var el = drop.nextElementSibling;
    if (!el || !el.classList.contains("form-error")) { el = document.createElement("p"); el.className = "form-error"; el.setAttribute("role", "alert"); drop.insertAdjacentElement("afterend", el); }
    el.textContent = msg || ""; el.hidden = !msg;
  }

  /** Shrink the photo so it fits in browser storage; keeps it sharp enough to classify. */
  function shrink(img, max, quality) {
    var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    var c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  }

  function takeFile(file) {
    photoError("");
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return photoError("Please choose a JPG or PNG photo.");
    if (file.size > 12 * 1024 * 1024) return photoError("That photo is over 12 MB. Please choose a smaller one.");
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      state.img = img;
      state.photo = shrink(img, 800, 0.78);
      showPreview();
      paintSteps();
    };
    img.onerror = function () { URL.revokeObjectURL(url); photoError("That file could not be read as a photo."); };
    img.src = url;
  }

  var dropHome = drop.innerHTML;
  function showPreview() {
    drop.innerHTML = '<img class="dropzone__preview" alt="Your photo of the street" src="' + state.photo + '">' +
      '<div class="dropzone__actions"><button class="btn btn--outline btn--sm" type="button" data-act="replace">Choose another photo</button>' +
      '<button class="btn btn--ghost btn--sm" type="button" data-act="remove">Remove</button></div>';
    drop.querySelector("[data-act=replace]").addEventListener("click", function () { chooseInput.click(); });
    drop.querySelector("[data-act=remove]").addEventListener("click", function () {
      state.photo = state.img = null; drop.innerHTML = dropHome;
      var b = $$(".dropzone__actions button", drop);
      b[0].addEventListener("click", function () { chooseInput.click(); });
      b[1].addEventListener("click", function () { cameraInput.click(); });
      paintSteps();
    });
  }

  /* ---------- Use my current location ---------- */
  var locateBtn = $(".form-section__header .btn--soft");
  locateBtn.addEventListener("click", function () {
    locateBtn.disabled = true;
    FDA.geo.locate().then(function (pos) {
      var near = FDA.geo.nearest(pos.lat, pos.lng);
      if (!near || near.meters > 8000) { FDA.ui.toast("You seem to be outside the areas in this prototype. Please pick the city and barangay.", "error"); return; }
      citySel.value = near.city; citySel.dispatchEvent(new Event("change"));
      brgySel.value = near.barangay; state.gps = pos; paintSteps();
      FDA.ui.toast("Location set to " + near.barangay + ", " + near.city + ".", "success");
    }).catch(function (err) { FDA.ui.toast(err.message, "error"); })
      .then(function () { locateBtn.disabled = false; });
  });

  /* ---------- Check this photo ---------- */
  var busy = false;
  submit.addEventListener("click", function (e) {
    e.preventDefault();
    if (busy) return;
    var ok = true;
    photoError(""); FDA.ui.fieldError(citySel, ""); FDA.ui.fieldError(brgySel, "");
    if (!state.photo) { photoError("Add a photo of the street first."); ok = false; }
    if (!citySel.value) { FDA.ui.fieldError(citySel, "Select a city or municipality."); ok = false; }
    if (!brgySel.value) { FDA.ui.fieldError(brgySel, "Select a barangay."); ok = false; }
    if (!ok) { var bad = $('[aria-invalid="true"]') || drop; bad.scrollIntoView({ behavior: "smooth", block: "center" }); return; }

    busy = true;
    var label = submit.firstChild, oldText = label.textContent;
    label.textContent = "Checking the photo… ";
    submit.setAttribute("aria-busy", "true");

    FDA.classifier.predict(state.img).then(function (out) {
      var db = FDA.store.db(), me = FDA.auth.current();
      var p = state.gps || FDA.geo.point(citySel.value, brgySel.value, street.value.trim());
      var loc = { city: citySel.value, barangay: brgySel.value, street: street.value.trim(), lat: p.lat, lng: p.lng };
      var verdict = FDA.agent.evaluate({ prob: out.prob, loc: loc, reports: db.reports });

      var report = {
        id: FDA.store.nextId("nextReport"), ownerId: me ? me.id : FDA.store.deviceId(), ownerName: me ? me.name : "Guest",
        ts: Date.now(), city: loc.city, barangay: loc.barangay, street: loc.street || "Street not given", lat: loc.lat, lng: loc.lng,
        desc: desc.value.trim(), photo: state.photo, prob: out.prob, depthCm: out.depthCm, model: out.source,
        status: verdict.status, note: verdict.note, recommendation: verdict.recommendation, evidence: verdict.evidence,
        dupCandidate: verdict.dupCandidate, dupOf: null, flags: 0, removed: false, review: null, still: 0, not: 0, lastConfirmTs: null
      };
      db.reports.unshift(report);
      if (!FDA.store.save()) { // storage full: retry once with a smaller photo
        report.photo = shrink(state.img, 480, 0.6);
        if (!FDA.store.save()) { db.reports.shift(); throw new Error("Your browser storage is full, so the report could not be saved."); }
      }
      FDA.notify.fanOutReport(report);
      location.href = "result.html?id=" + report.id;
    }).catch(function (err) {
      busy = false; label.textContent = oldText; submit.removeAttribute("aria-busy");
      FDA.ui.toast(err.message || "Something went wrong while checking the photo.", "error");
    });
  });

  paintSteps();
})();
