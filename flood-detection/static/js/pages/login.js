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

  /* ---------- Forgot password: 1) ask for a code, 2) type the code and a new password ---------- */
  function firstError(data) {
    var e = data.errors || {};
    return e.login || e.code || e.password || e.confirm || data.error || "Something went wrong. Please try again.";
  }
  function offline() {
    FDA.ui.dialog({ title: "Server not reachable", text: "The server can't be reached, so a code can't be sent. Check your connection and try again.", confirm: "OK", cancel: false });
  }

  function askForCode(prefill, problem) {
    if (!FDA.api.available()) return offline();
    FDA.ui.dialog({
      title: "Reset your password",
      text: (problem ? problem + " " : "") + "Enter the email or mobile number you registered with. We'll send a 6-digit code.",
      fields: [{ name: "login", label: "Email or mobile number", value: prefill || "", required: true, autocomplete: "username" }],
      confirm: "Send code"
    }).then(function (v) {
      if (!v) return;
      FDA.api.post("/api/auth/forgot", { login: v.login }).then(function (res) {
        if (!res.ok) return askForCode(v.login, firstError(res.data));
        var where = res.data.delivery === "console"
          ? "Email and SMS are not set up on this server yet, so the code was written in the server's console. Ask the person who runs the site for it."
          : "Check your email (and the spam folder).";
        enterCode(v.login, res.data.message + " " + where);
      }, offline);
    });
  }

  function enterCode(login, info, code) {
    FDA.ui.dialog({
      title: "Enter the code",
      text: info,
      fields: [
        { name: "code", label: "6-digit code", value: code || "", required: true, inputmode: "numeric", autocomplete: "one-time-code" },
        { name: "password", label: "New password (8+ characters, a number, upper and lower case)", type: "password", required: true, autocomplete: "new-password" },
        { name: "confirm", label: "Type the new password again", type: "password", required: true, autocomplete: "new-password" }
      ],
      confirm: "Set new password",
      extra: { label: "Send a new code" }
    }).then(function (v) {
      if (v === "extra") return askForCode(login);
      if (!v) return;
      FDA.api.post("/api/auth/reset", { login: login, code: v.code, password: v.password, confirm: v.confirm }).then(function (res) {
        if (!res.ok) return enterCode(login, firstError(res.data), v.code);
        FDA.ui.toast("Password changed. You're signed in.", "success");
        setTimeout(function () { location.href = res.data.user.role === "moderator" && target === "../map.html" ? "../moderation.html" : target; }, 800);
      }, offline);
    });
  }

  $(".auth__options .link-button").addEventListener("click", function () { askForCode(id.value.trim()); });
})();
