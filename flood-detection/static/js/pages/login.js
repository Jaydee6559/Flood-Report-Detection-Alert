/** Sign-in page */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$;

  var form = $(".auth__form"), id = $("#email"), pw = $("#password");
  var keep = $('.auth__options input[type="checkbox"]');

  // Where to go after signing in: only our own pages
  var next = FDA.ui.param("next");
  var target = next && /^[a-z-]+\.html(\?[\w=&.-]*)?$/.test(next) ? "../" + next : "../index.html";

  // The prototype has no real accounts yet: show the demo logins
  var hint = document.createElement("p");
  hint.className = "auth__fine-print";
  hint.innerHTML = "Prototype demo: <strong>maria@example.com</strong> / <strong>Flood123</strong> · moderator: <strong>moderator@example.com</strong> / <strong>Moderate123</strong>";
  $(".auth__fine-print").insertAdjacentElement("afterend", hint);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    FDA.ui.fieldError(id, ""); FDA.ui.fieldError(pw, "");
    if (!id.value.trim()) return FDA.ui.fieldError(id, "Enter your email or mobile number.");
    if (!pw.value) return FDA.ui.fieldError(pw, "Enter your password.");

    var res = FDA.auth.login(id.value, pw.value, keep && keep.checked);
    if (!res.ok) return FDA.ui.fieldError(pw, res.error);
    location.href = res.user.role === "moderator" && target === "../index.html" ? "../moderation.html" : target;
  });

  $(".auth__options .link-button").addEventListener("click", function () {
    FDA.ui.dialog({
      title: "Reset your password",
      text: "Password reset by email or SMS needs the server, which is not built yet. For the demo, use the demo logins shown below the form.",
      confirm: "OK", cancel: false
    });
  });
})();
