#!/usr/bin/env node
/**
 * verify-smoke — walk the parts of the canonical user path that exist today and assert
 * they render. Invoked by the /verify skill (.claude/commands/verify.md) after build+test.
 *
 * The canonical path (v1 design spec): land → sign up → onboard → digest → open role →
 * apply bundle → mark applied → track. Auth + the product flow past sign-in don't exist
 * yet, so this asserts the public surface and leaves CANONICAL-PATH TODO markers for each
 * step as it lands. Extend the CHECKS array when a new route ships.
 *
 * Usage: node scripts/verify-smoke.mjs [baseURL]   (default http://localhost:8080)
 * Exit 0 = all checks pass, 1 = any failure. Assumes a dev/preview server is already up.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:8080";

// Each check: navigate to path, assert the page contains expectText (case-insensitive).
// `soft` checks log a warning but don't fail the run (routes that may legitimately 404
// until the feature ships).
const CHECKS = [
  { path: "/", expect: "the application nobody ignores", name: "landing hero" },
  { path: "/", expect: "get your audit", name: "landing CTA" },
  { path: "/privacy", expect: "privacy", name: "privacy page" },
  { path: "/terms", expect: "free usage", name: "terms (free model)" },
  { path: "/nonexistent-route-xyz", expect: "404", name: "404 fallback", soft: true },
  // CANONICAL-PATH TODO (add as features land):
  //  - onboarding form renders (role/seniority/locations)
  //  - digest table renders for a seeded test user
  //  - role page renders the apply bundle
  //  - tracker reflects a manual "applied" mark
];

// Use the full chromium build (new headless mode) rather than the separate
// headless-shell binary, so the smoke walk doesn't depend on an exact shell build
// being installed — `npx playwright install chromium` is enough.
const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage();
let failed = 0;

for (const c of CHECKS) {
  try {
    const res = await page.goto(BASE + c.path, { waitUntil: "networkidle", timeout: 15000 });
    const body = (await page.content()).toLowerCase();
    const ok = body.includes(c.expect.toLowerCase());
    const status = res?.status() ?? 0;
    if (ok) {
      console.log(`  PASS  ${c.name.padEnd(24)} (${c.path} → ${status})`);
    } else if (c.soft) {
      console.log(`  WARN  ${c.name.padEnd(24)} (${c.path} → ${status}, missing "${c.expect}") [soft]`);
    } else {
      console.log(`  FAIL  ${c.name.padEnd(24)} (${c.path} → ${status}, missing "${c.expect}")`);
      failed++;
    }
  } catch (e) {
    if (c.soft) {
      console.log(`  WARN  ${c.name.padEnd(24)} (${c.path} errored: ${e.message}) [soft]`);
    } else {
      console.log(`  FAIL  ${c.name.padEnd(24)} (${c.path} errored: ${e.message})`);
      failed++;
    }
  }
}

await browser.close();
console.log(failed === 0 ? "\nsmoke: all hard checks passed" : `\nsmoke: ${failed} hard check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
