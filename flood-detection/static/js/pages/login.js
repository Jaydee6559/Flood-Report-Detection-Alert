/** Sign-in page (accounts are on the Flask server) */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$;

  var form = $(".auth__form"), id = $("#email"), pw = $("#password");
  var keep = $('.auth__options input[type="checkbox"]');
  var submit = form.querySelector('[type="submit"]');

  // Where to go after signing in: only our own pages
  var next = FDA.ui.param("next");
  var target = next && /^[a-z-]+\.html(\?[\w=&.-]*)?$/.test(next) ? "../" + next : "../map.html";

  // Already signed in: go straight on (a non-moderator is never sent back to the moderation page)
  var already = FDA.auth.current();
  if (already) {
    location.replace(/^\.\.\/moderation\.html/.test(target) && already.role !== "moderator" ? "../map.html" : target);
    return;
  }

  if (next) {
    var note = document.createElement("p");
    note.className = "callout callout--neutral"; note.setAttribute("role", "status");
    note.textContent = "Please sign in to open " + next.replace(/\.html.*$/, "").replace(/-/g, " ") + ". Anyone can view the map and reports, but this needs an account.";
    form.insertAdjacentElement("beforebegin", note);
  }
  if (!FDA.api.available()) {
    var off = document.createElement("p");
    off.className = "callout callout--neutral"; off.setAttribute("role", "status");
    off.textContent = "This page was opened from a file, so signing in is not available. Start the server (flask --app app run) and open http://127.0.0.1:5000.";
    form.insertAdjacentElement("beforebegin", off);
  }

  var busy = false;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    FDA.ui.fieldError(id, ""); FDA.ui.fieldError(pw, "");
    if (!id.value.trim()) return FDA.ui.fieldError(id, "Enter your email or mobile number.");
    if (!pw.value) return FDA.ui.fieldError(pw, "Enter your password.");

    busy = true; submit.disabled = true; submit.setAttribute("aria-busy", "true");
    FDA.auth.login(id.value, pw.value, keep && keep.checked).then(function (res) {
      busy = false; submit.disabled = false; submit.removeAttribute("aria-busy");
      if (!res.ok) return FDA.ui.fieldError(pw, res.error);
      location.href = res.user.role === "moderator" && target === "../map.html" ? "../moderation.html" : target;
    });
  });

  $(".auth__options .link-button").addEventListener("click", function () {
    FDA.ui.dialog({
      title: "Reset your password",
      text: "Password reset by email or SMS is not available yet. Ask a moderator to set a new password for you.",
      confirm: "OK", cancel: false
    });
  });
})();
