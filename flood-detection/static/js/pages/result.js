/** Result page: shows what the classifier and the agent decided for one report */
(function () {
  "use strict";
  var FDA = window.FDA, $ = FDA.ui.$, esc = FDA.ui.esc;
  var db = FDA.store.db();

  var id = +FDA.ui.param("id");
  var r = db.reports.filter(function (x) { return x.id === id; })[0];
  if (!r) { location.replace("report.html"); return; }

  var meta = {
    "flood-warning": { head: "Flood warning · Avoid this street", cls: "danger" },
    "possible-flood": { head: "Possible flood · Use caution", cls: "warning" },
    "unclear-photo": { head: "Unclear photo · Please send a clearer one", cls: "neutral" },
    "no-flood": { head: "No flood seen · Check local conditions", cls: "success" }
  }[r.status];

  var panel = $(".result-panel");
  panel.className = panel.className.replace(/\s*result-panel--\S+/g, "") + " result-panel--" + r.status;

  var head = $("#result-status");
  head.className = "result-panel__status result-panel__status--" + r.status;
  var icon = head.querySelector("svg");
  head.innerHTML = ""; head.appendChild(icon);
  icon.outerHTML = FDA.ui.svg(r.status, "md");
  head.insertAdjacentText("beforeend", " " + meta.head);

  var photo = $(".result-panel__photo");
  photo.src = r.photo; photo.alt = "Your submitted street photo"; photo.removeAttribute("width"); photo.removeAttribute("height");

  $(".result-model__label").textContent = r.prob >= FDA.agent.config.possibleAt ? "Flood" : "No flood";
  $(".result-model__value").textContent = Math.round(r.prob * 100) + "% flood probability";
  var bar = $(".result-section .probability");
  bar.outerHTML = FDA.ui.reportProbability(r, true) + FDA.ui.depthBlock(r);
  var dp = FDA.agent.depth(r);
  if (dp) $(".result-model__value").textContent += " · " + dp.label + " (" + dp.range + ")";

  var when = FDA.ui.clock(r.ts);
  var neighbours = r.evidence.map(function (eid) { return db.reports.filter(function (x) { return x.id === eid; })[0]; }).filter(Boolean);
  var facts = $(".result-facts");
  var liSvg = Array.prototype.map.call(facts.querySelectorAll("li"), function (li) { return li.querySelector("svg").outerHTML; });
  facts.innerHTML =
    "<li>" + liSvg[0] + "<span>" + esc(r.note) + (neighbours.length ? " <a class=\"link\" href=\"report-details.html?id=" + neighbours[0].id + "\">See #" + neighbours[0].id + "</a>" : "") + "</span></li>" +
    "<li>" + liSvg[1] + "<span>" + esc(r.street + ", " + r.barangay + ", " + r.city) + "</span></li>" +
    "<li>" + liSvg[2] + "<span>Checked at " + when + "</span></li>";

  var callout = $(".result-panel .callout");
  callout.className = "callout callout--" + meta.cls;
  callout.innerHTML = "<strong>Recommendation:</strong> " + esc(r.recommendation);

  var open = $(".result-actions .btn--primary"); open.href = "report-details.html?id=" + r.id;
  var onMap = $(".result-actions .btn--ghost"); onMap.href = "map.html?id=" + r.id;
  $(".result-actions__saved").lastChild.textContent = " Saved as report #" + r.id;
  $(".breadcrumb [aria-current]").textContent = "Check result";

  // Be honest about which estimate this is
  var badge = $(".page-heading__aside .badge--sample");
  if (r.model === "tfjs") badge.remove();
  else { badge.textContent = "DEMO ESTIMATE"; badge.title = "The trained model is not loaded, so this is a rough colour-based estimate."; }

  if (r.dupCandidate) {
    var dup = db.reports.filter(function (x) { return x.id === r.dupCandidate; })[0];
    if (dup) {
      var p = document.createElement("p");
      p.className = "callout callout--neutral"; p.style.marginTop = "12px";
      p.innerHTML = FDA.ui.svg("duplicate") + " This may be the same flood as <a class=\"link\" href=\"report-details.html?id=" + dup.id + "\">#" + dup.id + "</a> (" + esc(dup.street) + "). A moderator may merge them.";
      $(".result-actions").insertAdjacentElement("beforebegin", p);
    }
  }
})();
