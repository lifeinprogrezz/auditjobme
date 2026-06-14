#!/usr/bin/env node
/**
 * verify-smoke — walk the parts of the canonical user path that exist today and assert
 * they render. Invoked by the /verify skill (.claude/commands/verify.md) after build+test.
 *
 * Public surface always runs. The authed canonical-path walk runs only when E2E creds are
 * present (E2E_TEST_EMAIL + E2E_TEST_PASSWORD env vars): it signs the seeded test user in via
 * the Supabase password grant, injects the session into localStorage, and asserts the auth
 * wall is cleared (onboarding renders). Without creds it's skipped, so /verify still works for
 * anyone. CI provides the creds as repo secrets (E2E_TEST_EMAIL / E2E_TEST_PASSWORD).
 *
 * Canonical path (v1 design spec): land -> sign up -> onboard -> digest -> open role ->
 * apply bundle -> mark applied -> track. Covered so far: public surface + the onboarding gate.
 *
 * Usage: node scripts/verify-smoke.mjs [baseURL]   (default http://localhost:8080)
 * Exit 0 = all hard checks pass, 1 = any failure. Assumes a dev/preview server is already up.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8080";

// Supabase URL + anon key for the authed walk: process.env first, committed .env as fallback
// (the publishable/anon key is public by design). E2E creds come from env only — never committed.
function readEnvFile() {
  try {
    const txt = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const out = {};
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*?)"?\s*$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}
const fileEnv = readEnvFile();
const SUPA_URL = process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY;
const E2E_EMAIL = process.env.E2E_TEST_EMAIL;
const E2E_PW = process.env.E2E_TEST_PASSWORD;

// Each check: navigate to path, assert the page contains expectText (case-insensitive).
// `soft` checks log a warning but don't fail the run (routes that may legitimately 404
// until the feature ships).
const CHECKS = [
  { path: "/", expect: "the application nobody ignores", name: "landing hero" },
  { path: "/", expect: "get your audit", name: "landing CTA" },
  { path: "/privacy", expect: "privacy", name: "privacy page" },
  { path: "/terms", expect: "free usage", name: "terms (free model)" },
  { path: "/nonexistent-route-xyz", expect: "404", name: "404 fallback", soft: true },
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

// --- Authed canonical-path walk: signs the seeded E2E user in and clears the auth wall. ---
// Runs only with creds + Supabase config. The seeded user has no completed onboarding, so the
// gate lands on the onboarding form — that IS the "past sign-in" proof for the canonical path.
if (E2E_EMAIL && E2E_PW && SUPA_URL && ANON) {
  const name = "authed: onboarding gate";
  try {
    const r = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "content-type": "application/json" },
      body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PW }),
    });
    const session = await r.json();
    if (!session.access_token) {
      throw new Error(`password grant failed (${session.error_code || session.msg || r.status})`);
    }
    // supabase-js (browser, persistSession) stores the session JSON under sb-<ref>-auth-token.
    const ref = new URL(SUPA_URL).hostname.split(".")[0];
    const storageKey = `sb-${ref}-auth-token`;
    const ctx = await browser.newContext();
    await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [storageKey, JSON.stringify(session)]);
    const apage = await ctx.newPage();
    await apage.goto(BASE + "/", { waitUntil: "networkidle", timeout: 20000 });
    await apage.waitForTimeout(1500);
    const body = (await apage.content()).toLowerCase();
    const onboarding = body.includes("set up your search"); // onboarding heading
    const landingGone = !body.includes("get your audit"); // unauth landing CTA is gone
    if (onboarding && landingGone) {
      console.log(`  PASS  ${name.padEnd(24)} (signed in via password grant; auth wall cleared → onboarding)`);
    } else {
      console.log(`  FAIL  ${name.padEnd(24)} (onboarding=${onboarding}, landingGone=${landingGone})`);
      failed++;
    }
    await ctx.close();
    // CANONICAL-PATH TODO (need a test user with completed onboarding + seeded scores):
    //  - digest table renders for the seeded test user
    //  - role page renders the apply bundle
    //  - tracker reflects a manual "applied" mark
  } catch (e) {
    console.log(`  FAIL  ${name.padEnd(24)} (${e.message})`);
    failed++;
  }
} else {
  console.log(`  SKIP  authed canonical-path walk (set E2E_TEST_EMAIL + E2E_TEST_PASSWORD to enable)`);
}

await browser.close();
console.log(failed === 0 ? "\nsmoke: all hard checks passed" : `\nsmoke: ${failed} hard check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
