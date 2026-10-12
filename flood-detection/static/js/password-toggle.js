/**
 * Show / hide password
 *
 * Works on any button with the attribute `data-password-toggle`.
 * The button's `aria-controls` must hold the id of the password input.
 *
 * Example:
 *   <input id="password" type="password">
 *   <button type="button" data-password-toggle aria-controls="password" aria-pressed="false">…</button>
 */
(function () {
  "use strict";

  function setupToggle(button) {
    var input = document.getElementById(button.getAttribute("aria-controls"));
    if (!input) {
      return;
    }

    button.addEventListener("click", function () {
      var willShow = input.type === "password";

      input.type = willShow ? "text" : "password";
      button.classList.toggle("is-visible", willShow);
      button.setAttribute("aria-pressed", String(willShow));
      button.setAttribute("aria-label", willShow ? "Hide password" : "Show password");
    });
  }

  document.querySelectorAll("[data-password-toggle]").forEach(setupToggle);
})();
