// Offline unit tests for the pure workplace classification (scripts/workplace-lib.mjs).
// No network, no DB. Run: node --test scripts/workplace-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { normWorkplace, workplaceFromLocation, workplaceFromJd, resolveWorkplace } from "./workplace-lib.mjs";

test("normWorkplace — maps ATS spellings onto the canonical trio, null otherwise", () => {
  assert.equal(normWorkplace("remote"), "remote");
  assert.equal(normWorkplace("Remote"), "remote");
  assert.equal(normWorkplace("hybrid"), "hybrid");
  assert.equal(normWorkplace("on-site"), "onsite"); // Lever workplaceType spelling
  assert.equal(normWorkplace("onsite"), "onsite");
  assert.equal(normWorkplace("ON_SITE"), "onsite");
  assert.equal(normWorkplace("unspecified"), null); // Lever's null-ish value
  assert.equal(normWorkplace(""), null);
  assert.equal(normWorkplace(null), null);
  assert.equal(normWorkplace(undefined), null);
  assert.equal(normWorkplace("banana"), null);
});

test("workplaceFromLocation — hybrid > onsite > remote precedence, null when silent", () => {
  assert.equal(workplaceFromLocation("Berlin (Hybrid)"), "hybrid");
  assert.equal(workplaceFromLocation("Hybrid - London"), "hybrid");
  assert.equal(workplaceFromLocation("Madrid, On-site"), "onsite");
  assert.equal(workplaceFromLocation("Office-based, Paris"), "onsite");
  assert.equal(workplaceFromLocation("Remote"), "remote");
  assert.equal(workplaceFromLocation("Remote - EMEA"), "remote");
  assert.equal(workplaceFromLocation("Remote (Hybrid optional)"), "hybrid"); // hybrid wins
  assert.equal(workplaceFromLocation("Berlin, Germany"), null);
  assert.equal(workplaceFromLocation(null), null);
});

test("workplaceFromJd — unambiguous JD phrasing only", () => {
  assert.equal(workplaceFromJd("We are a fully remote team across Europe."), "remote");
  assert.equal(workplaceFromJd("This is a remote-first company."), "remote");
  assert.equal(workplaceFromJd("100% remote within the EU."), "remote");
  assert.equal(workplaceFromJd("You can work from anywhere in Europe."), "remote");
  assert.equal(workplaceFromJd("We work a hybrid schedule."), "hybrid");
  assert.equal(workplaceFromJd("2 days per week in the office."), "hybrid");
  assert.equal(workplaceFromJd("3 days a week at our Berlin office."), "hybrid");
  assert.equal(workplaceFromJd("2 days onsite, 3 remote."), "hybrid");
  assert.equal(workplaceFromJd("This is an on-site role in Munich."), "onsite");
  assert.equal(workplaceFromJd("Office-based position, 5 days a week."), "onsite");
  assert.equal(workplaceFromJd("You will work in-office with the team."), "onsite");
  // Ambiguous mentions stay null — "remote" alone can be negated ("no remote work").
  assert.equal(workplaceFromJd("We do not offer remote work."), null);
  assert.equal(workplaceFromJd("Great product role in Berlin."), null);
  assert.equal(workplaceFromJd(null), null);
});

test("resolveWorkplace — structured beats location beats JD", () => {
  assert.equal(resolveWorkplace({ structured: "hybrid", location: "Remote", jdText: "fully remote" }), "hybrid");
  assert.equal(resolveWorkplace({ structured: null, location: "Remote - EU", jdText: "hybrid" }), "remote");
  assert.equal(resolveWorkplace({ location: "Berlin", jdText: "We work a hybrid schedule." }), "hybrid");
  assert.equal(resolveWorkplace({ location: "Berlin", jdText: "Nice role." }), null);
  assert.equal(resolveWorkplace({}), null);
});
