/** Create-account page */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, $$ = FDA.ui.$$;

  var form = $(".auth__form");
  var f = { name: $("#full-name"), login: $("#email"), password: $("#password"), confirm: $("#confirm-password"), city: $("#home-city"), barangay: $("#home-barangay") };
  var agree = $(".auth__terms input");

  /* ---------- Home city and barangay ---------- */
  function fillSelect(sel, first, items) {
    sel.innerHTML = "";
    sel.appendChild(new Option(first, ""));
    items.forEach(function (n) { sel.appendChild(new Option(n, n)); });
  }
  fillSelect(f.city, "Select city", FDA.geo.cityNames());
  fillSelect(f.barangay, "Select barangay", []);
  f.barangay.disabled = true;
  f.city.addEventListener("change", function () {
    fillSelect(f.barangay, "Select barangay", FDA.geo.barangays(f.city.value));
    f.barangay.disabled = !f.city.value;
  });

  /* ---------- Password strength and rules ---------- */
  var bars = $$(".password-strength__bar"), label = $(".password-strength__label"), rules = $$(".password-rules li");
  function paintPassword() {
    var pw = f.password.value, s = FDA.auth.strength(pw), r = FDA.auth.rules(pw);
    bars.forEach(function (b, i) { b.classList.toggle("password-strength__bar--filled", i < s.bars); });
    label.textContent = s.label;
    [r.length, r.number, r.case].forEach(function (ok, i) { if (rules[i]) rules[i].classList.toggle("is-met", ok); });
  }
  f.password.addEventListener("input", paintPassword);
  paintPassword();

  /* ---------- Submit ---------- */
  function termsError(msg) {
    var box = $(".auth__terms"), el = box.nextElementSibling;
    if (!el || !el.classList.contains("form-error")) { el = document.createElement("p"); el.className = "form-error"; el.setAttribute("role", "alert"); box.insertAdjacentElement("afterend", el); }
    el.textContent = msg || ""; el.hidden = !msg;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    ["name", "login", "password", "confirm"].forEach(function (k) { FDA.ui.fieldError(f[k], ""); });
    termsError("");

    var res = FDA.auth.register({
      name: f.name.value, login: f.login.value, password: f.password.value, confirm: f.confirm.value,
      city: f.city.value, barangay: f.barangay.value, agree: agree.checked
    });
    if (!res.ok) {
      Object.keys(res.errors).forEach(function (k) { if (k === "agree") termsError(res.errors[k]); else FDA.ui.fieldError(f[k], res.errors[k]); });
      var firstBad = $('[aria-invalid="true"]'); if (firstBad) firstBad.focus();
      return;
    }
    location.href = "../index.html";
  });
})();
