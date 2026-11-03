/** Report a flood: photo, location, details → classifier → agent → saved report */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, $$ = FDA.ui.$$;

  var drop = $(".dropzone");
  var distSel = $("#district"), brgySel = $("#barangay"), street = $("#street"), desc = $("#description");
  var submit = $(".form-actions a.btn--primary");
  var steps = $$(".stepper__item");
  var state = { photo: null, img: null, gps: null };

  FDA.classifier.init(); // start loading the trained model, if there is one

  /* ---------- Location: District -> Barangay -> Street, with a draggable pin ---------- */
  var CITY = "Quezon City", L = null, map = null, pin = null, streetTimer = null;
  function fill(sel, first, items) { sel.innerHTML = ""; sel.appendChild(new Option(first, "")); items.forEach(function (n) { sel.appendChild(n instanceof Option ? n : new Option(n, n)); }); }
  fill(distSel, "Select a district", FDA.geo.districts(CITY).map(function (d) { return new Option("District " + d.id, d.id); }));
  function fillBarangays(district, keep) {
    var list = FDA.geo.barangays(CITY).filter(function (n) { return !district || String(FDA.geo.districtOf(CITY, n)) === String(district); });
    fill(brgySel, "Select a barangay", list);
    if (keep && list.indexOf(keep) >= 0) brgySel.value = keep;
  }
  fillBarangays("");

  function hint() {
    var el = $("#hazard-hint"), p = pin ? pin.getLatLng() : null;
    if (!p || !brgySel.value) { el.hidden = true; return; }
    var at = FDA.hazard.at(p.lat, p.lng), h = at ? at.hazard : FDA.hazard.of(brgySel.value);
    var near = FDA.hazard.spotsNear({ lat: p.lat, lng: p.lng }, FDA.agent.config.spotMeters);
    el.className = "hazard-hint" + (h === "high" ? " hazard-hint--high" : h === "medium" ? " hazard-hint--medium" : "");
    el.innerHTML = FDA.ui.svg("possible-flood") + "<span>" + FDA.ui.esc(brgySel.value) + " is in a <strong>" + FDA.hazard.label(h).toLowerCase() + "</strong> zone (100-year flood hazard map)." +
      (near.length ? " A recurring flood spot is within " + FDA.agent.config.spotMeters + " m (" + FDA.ui.esc(near[0].corner) + ")." : "") + "</span>";
    el.hidden = false;
  }
  function placePin(lat, lng, zoom) {
    if (!map) return;
    if (!pin) {
      pin = L.marker([lat, lng], { draggable: true, title: "Drag me to the flood" }).addTo(map);
      pin.on("dragend", function () { state.gps = null; state.dragged = true; syncFromPin(); });
    } else pin.setLatLng([lat, lng]);
    if (zoom) map.setView([lat, lng], zoom);
    $("#pin-note").textContent = "Drag the pin or tap the map to move it.";
    hint();
  }
  /* when the pin is dropped in another barangay, follow it */
  function syncFromPin() {
    var p = pin.getLatLng(), at = FDA.hazard.at(p.lat, p.lng);
    if (at && at.barangay !== brgySel.value) { distSel.value = at.district || ""; fillBarangays("", at.barangay); brgySel.value = at.barangay; loadStreetNames(); }
    state.pin = { lat: p.lat, lng: p.lng }; hint(); paintSteps();
  }
  function loadStreetNames() {
    var dl = $("#street-names"); dl.innerHTML = "";
    if (!brgySel.value) return;
    var name = brgySel.value;
    FDA.streets.names(name).then(function (list) {
      if (brgySel.value !== name) return;
      dl.innerHTML = list.map(function (n) { return '<option value="' + FDA.ui.esc(n) + '">'; }).join("");
    }).catch(function () { /* street suggestions are optional */ });
  }
  function onBarangay(zoom) {
    state.gps = null; state.pin = null; state.dragged = false;
    if (brgySel.value) { var b = FDA.hazard.get(brgySel.value); if (b) { distSel.value = b.district; placePin(b.lat, b.lng, zoom || 16); state.pin = { lat: b.lat, lng: b.lng }; } }
    loadStreetNames(); hint(); paintSteps();
  }
  distSel.addEventListener("change", function () { fillBarangays(distSel.value); onBarangay(); if (!brgySel.value && pin) { map.removeLayer(pin); pin = null; $("#hazard-hint").hidden = true; } });
  brgySel.addEventListener("change", function () { onBarangay(); });
  $("#street").addEventListener("change", function () {
    // a street we know about moves the pin to it
    var name = brgySel.value, v = this.value.trim(); if (!name || !v) return;
    FDA.streets.load(name).then(function (res) {
      var s = res.streets.filter(function (x) { return x.name.toLowerCase() === v.toLowerCase(); })[0];
      if (s) { var c = FDA.streets.center(s); placePin(c.lat, c.lng, 17); state.gps = null; state.pin = { lat: c.lat, lng: c.lng }; hint(); }
    }).catch(function () { /* optional */ });
  });

  FDA.mapkit.create($("#pin-map"), { center: [14.676, 121.0437], zoom: 12 }).then(function (m) {
    map = m; L = window.L;
    map.on("click", function (e) { if (!brgySel.value) return; placePin(e.latlng.lat, e.latlng.lng); state.gps = null; syncFromPin(); });
    if (brgySel.value) onBarangay();
  }).catch(function () { $("#pin-map").outerHTML = '<p class="text-muted text-sm">The map could not be loaded. The barangay you pick is used for the location.</p>'; $("#pin-note").hidden = true; });

  var user = FDA.auth.current();
  var qb = FDA.ui.param("barangay"), qs = FDA.ui.param("street");
  var startB = qb && FDA.hazard.get(qb) ? qb : user && user.homeBarangay && FDA.hazard.get(user.homeBarangay) ? user.homeBarangay : "";
  if (startB) { var sb = FDA.hazard.get(startB); distSel.value = sb.district; fillBarangays(sb.district, startB); brgySel.value = startB; onBarangay(); }
  if (qs) $("#street").value = qs;

  /* ---------- Stepper follows what is filled in ---------- */
  function paintSteps() {
    var cur = !state.photo ? 0 : !brgySel.value ? 1 : 3;
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

  /** A data: URL (the shrunk photo) as a Blob, to upload it. */
  function dataUrlBlob(url) {
    var parts = url.split(","), bin = atob(parts[1]), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: (/data:([^;]+)/.exec(parts[0]) || [])[1] || "image/jpeg" });
  }

  /** Shrink the photo before it is sent; keeps it sharp enough to classify. */
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
      var at = FDA.hazard.at(pos.lat, pos.lng), near = FDA.geo.nearest(pos.lat, pos.lng);
      if (!at || !near || near.meters > 8000) { FDA.ui.toast("You seem to be outside Quezon City. Please pick the district and barangay.", "error"); return; }
      distSel.value = at.district || ""; fillBarangays("", at.barangay); brgySel.value = at.barangay;
      loadStreetNames(); placePin(pos.lat, pos.lng, 17); state.gps = pos; state.pin = { lat: pos.lat, lng: pos.lng }; hint(); paintSteps();
      FDA.ui.toast("Location set to " + at.barangay + ", " + CITY + ".", "success");
    }).catch(function (err) { FDA.ui.toast(err.message, "error"); })
      .then(function () { locateBtn.disabled = false; });
  });

  /* ---------- Check this photo ---------- */
  var busy = false;
  submit.addEventListener("click", function (e) {
    e.preventDefault();
    if (busy) return;
    var ok = true;
    photoError(""); FDA.ui.fieldError(brgySel, "");
    if (!state.photo) { photoError("Add a photo of the street first."); ok = false; }
    if (!brgySel.value) { FDA.ui.fieldError(brgySel, "Select a barangay."); ok = false; }
    if (!ok) { var bad = $('[aria-invalid="true"]') || drop; bad.scrollIntoView({ behavior: "smooth", block: "center" }); return; }

    busy = true;
    var label = submit.firstChild, oldText = label.textContent;
    label.textContent = "Checking the photo… ";
    submit.setAttribute("aria-busy", "true");

    FDA.classifier.predict(state.img).then(function (out) {
      var db = FDA.store.db();
      var centre = FDA.hazard.get(brgySel.value);   // the barangay centre; a street name is never used to invent a position
      var p = state.gps || state.pin || (centre ? { lat: centre.lat, lng: centre.lng } : FDA.geo.point(CITY, brgySel.value));
      // with no GPS, no street found on the map and no moved pin, the report only knows its barangay
      var approximate = !state.gps && (!state.pin || !centre || FDA.geo.distance(state.pin, { lat: centre.lat, lng: centre.lng }) < 2);
      var loc = { city: CITY, barangay: brgySel.value, street: street.value.trim(), lat: p.lat, lng: p.lng };
      var verdict = FDA.agent.checkPhoto({ prob: out.prob, source: out.source, loc: loc, reports: db.reports });

      // Saved on the server (reports_api.py), which gives the report its number and keeps the photo in uploads/
      var data = {
        barangay: loc.barangay, street: loc.street, lat: loc.lat, lng: loc.lng, location: approximate ? "approximate" : "precise",
        desc: desc.value.trim(), prob: out.prob, depthCm: out.depthCm, model: out.source,
        status: verdict.status, startStatus: verdict.startStatus, note: verdict.note, recommendation: verdict.recommendation,
        evidence: verdict.evidence, dupCandidate: verdict.dupCandidate, reasons: verdict.reasons, inputs: verdict.inputs
      };
      var form = new FormData();
      form.append("photo", dataUrlBlob(state.photo), "photo.jpg");
      form.append("data", JSON.stringify(data));
      return FDA.api.post("/api/reports", form).then(function (res) {
        if (!res.ok) throw new Error(res.status === 401 ? "Please sign in again, then send the report." : res.data.error || "The report could not be saved. Please try again.");
        var report = FDA.store.putReport(res.data.report);
        // the server logged the agent's decision (agent_decisions) when it saved the report
        // route alerts for everyone whose saved route passes near it are made on the server
        location.href = "result.html?id=" + report.id;
      }, function () { throw new Error("The server can't be reached, so the report was not saved. Check your connection and try again."); });
    }).catch(function (err) {
      busy = false; label.textContent = oldText; submit.removeAttribute("aria-busy");
      FDA.ui.toast(err.message || "Something went wrong while checking the photo.", "error");
    });
  });

  paintSteps();
})();
