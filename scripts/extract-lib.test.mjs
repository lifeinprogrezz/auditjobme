// Offline unit tests for the pure JD-extraction logic (scripts/extract-lib.mjs).
// No network, no DB. Run: node --test scripts/extract-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXTRACTION_VERSION,
  EXTRACTION_SCHEMA,
  jdHash,
  parseSalary,
  heuristicExtract,
  buildExtractionMessages,
  parseExtraction,
  mergeExtraction,
} from "./extract-lib.mjs";

test("EXTRACTION_VERSION is a stable string", () => {
  assert.equal(typeof EXTRACTION_VERSION, "string");
  assert.ok(EXTRACTION_VERSION.length > 0);
});

test("jdHash — determinism, difference, whitespace-invariance, base36", () => {
  assert.equal(jdHash("hello world"), jdHash("hello world")); // deterministic
  assert.notEqual(jdHash("hello world"), jdHash("hello worle")); // sensitive to edits
  assert.equal(jdHash("  hello world  "), jdHash("hello world")); // trimmed
  assert.notEqual(jdHash("abc"), jdHash("abd"));
  assert.match(jdHash("A long-ish job description body 123"), /^[0-9a-z]+$/); // base36
  assert.equal(jdHash(""), jdHash("   ")); // empty == whitespace-only
});

test("heuristicExtract — YoE near 'experience'", () => {
  const h = heuristicExtract("You have 5+ years of product experience building things.");
  assert.equal(h.yoe_min, 5);
});

test("heuristicExtract — takes the MIN plausible YoE, ignores out-of-range", () => {
  // 30 years is implausible (>20) and dropped; 3 and 8 qualify → min 3.
  const h = heuristicExtract("At least 3 years of experience; 8 years of experience preferred; company is 30 years old.");
  assert.equal(h.yoe_min, 3);
});

test("heuristicExtract — a bare number of years with no 'experience' nearby is null", () => {
  const h = heuristicExtract("The team ships every 2 years.");
  assert.equal(h.yoe_min, null);
});

test("heuristicExtract — symbol-attached salary with no period word", () => {
  const h = heuristicExtract("Compensation: Starting at £45,000 for this role.");
  assert.equal(h.salary_min, 45000);
  assert.equal(h.salary_currency, "GBP");
  assert.equal(h.salary_period, "year");
});

test("parseSalary — explicit EUR range, per year", () => {
  const s = parseSalary("Salary band is €60,000 - €70,000 per year plus equity.");
  assert.equal(s.salary_min, 60000);
  assert.equal(s.salary_max, 70000);
  assert.equal(s.salary_currency, "EUR");
  assert.equal(s.salary_period, "year");
});

test("parseSalary — monthly figure is annualised ×12", () => {
  const s = parseSalary("We pay 5000 EUR/month for this position.");
  assert.equal(s.salary_min, 60000);
  assert.equal(s.salary_period, "year");
});

test("parseSalary — a small perk is below the 20K gate → null", () => {
  const s = parseSalary("Plus a £1,000 annual training allowance.");
  assert.equal(s.salary_min, null);
  assert.equal(s.salary_max, null);
});

test("heuristicExtract — remote policy from unambiguous keywords", () => {
  assert.equal(heuristicExtract("This is a fully remote, globally distributed team.").remote_policy, "remote");
  assert.equal(heuristicExtract("Hybrid role, 3 days in office per week.").remote_policy, "hybrid");
  assert.equal(heuristicExtract("This is an on-site only position in Berlin.").remote_policy, "onsite");
  assert.equal(heuristicExtract("We build great products for our users.").remote_policy, null);
});

test("heuristicExtract — a signal-free string yields all nulls", () => {
  const h = heuristicExtract("We are looking for a passionate teammate to join us.");
  assert.deepEqual(h, {
    yoe_min: null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    remote_policy: null,
  });
});

test("buildExtractionMessages — system prompt + capped user body with hints", () => {
  const heur = heuristicExtract("You need 4 years of experience. £50,000 per year.");
  const { system, user } = buildExtractionMessages("x".repeat(5000), heur);
  assert.match(system, /Extract ONLY facts EXPLICITLY stated/);
  assert.match(system, /English is the implicit default/);
  assert.match(user, /"yoe_min":4/); // heuristic hint fed in
  // jd_text is capped at 3000 chars: the 5000-char body must NOT pass through whole.
  assert.ok(user.includes("x".repeat(3000)), "capped jd_text (3000 chars) not present");
  assert.ok(!user.includes("x".repeat(3001)), "jd_text was not capped at 3000 chars");
});

test("parseExtraction — prose-wrapped JSON blob (string) is recovered + coerced", () => {
  const blob =
    'Sure! Here is the extraction:\n{"yoe_min": 3, "languages_required": ["German"], ' +
    '"salary_min": null, "salary_max": null, "salary_currency": null, "salary_period": null, ' +
    '"visa_sponsorship": "offered", "geo_eligibility": "EU", "is_product_role": true, ' +
    '"remote_policy": "hybrid", "onsite_days_per_week": 2, "customer_type": "B2B", ' +
    '"company_stage": "series_b"}\nHope that helps!';
  const out = parseExtraction(blob);
  assert.equal(out.yoe_min, 3);
  assert.deepEqual(out.languages_required, ["German"]);
  assert.equal(out.visa_sponsorship, "offered");
  assert.equal(out.geo_eligibility, "eu"); // enum lower-cased
  assert.equal(out.is_product_role, true);
  assert.equal(out.remote_policy, "hybrid");
  assert.equal(out.onsite_days_per_week, 2);
  assert.equal(out.customer_type, "b2b");
  assert.equal(out.company_stage, "series_b");
});

test("parseExtraction — Anthropic-shaped response object", () => {
  const api = { content: [{ type: "text", text: '{"yoe_min": 7, "customer_type": "marketplace"}' }] };
  const out = parseExtraction(api);
  assert.equal(out.yoe_min, 7);
  assert.equal(out.customer_type, "marketplace");
  assert.equal(out.geo_eligibility, null); // absent → null
});

test("parseExtraction — invalid enum values coerce to null", () => {
  const out = parseExtraction('{"geo_eligibility": "mars", "remote_policy": "sometimes"}');
  assert.equal(out.geo_eligibility, null);
  assert.equal(out.remote_policy, null);
});

test("parseExtraction — garbage and null return {}", () => {
  assert.deepEqual(parseExtraction("lol no json here"), {});
  assert.deepEqual(parseExtraction("{ not valid json"), {});
  assert.deepEqual(parseExtraction(null), {});
  assert.deepEqual(parseExtraction(undefined), {});
  assert.deepEqual(parseExtraction({ content: [{ type: "text", text: "no braces" }] }), {});
});

test("mergeExtraction — heuristic wins salary + yoe_min; LLM fills the rest", () => {
  const heur = { yoe_min: 5, salary_min: 45000, salary_max: null, salary_currency: "GBP", salary_period: "year", remote_policy: "remote" };
  const llm = {
    yoe_min: 3,
    salary_min: 99000,
    salary_currency: "USD",
    languages_required: ["French"],
    visa_sponsorship: "not_offered",
    geo_eligibility: "uk",
    is_product_role: true,
    remote_policy: "hybrid",
    onsite_days_per_week: null,
    customer_type: "b2c",
    company_stage: "seed",
  };
  const m = mergeExtraction(heur, llm);
  assert.equal(m.yoe_min, 5); // heuristic wins
  assert.equal(m.salary_min, 45000); // heuristic wins
  assert.equal(m.salary_currency, "GBP"); // heuristic wins
  assert.equal(m.remote_policy, "hybrid"); // LLM wins for remote_policy
  assert.deepEqual(m.languages_required, ["French"]);
  assert.equal(m.visa_sponsorship, "not_offered");
  assert.equal(m.geo_eligibility, "uk");
  assert.equal(m.customer_type, "b2c");
  assert.equal(m.company_stage, "seed");
});

test("mergeExtraction — LLM fills salary/yoe when heuristic is null", () => {
  const heur = { yoe_min: null, salary_min: null, salary_max: null, salary_currency: null, salary_period: null, remote_policy: null };
  const llm = { yoe_min: 4, salary_min: 70000, salary_max: 80000, salary_currency: "EUR", salary_period: "year", remote_policy: "onsite" };
  const m = mergeExtraction(heur, llm);
  assert.equal(m.yoe_min, 4);
  assert.equal(m.salary_min, 70000);
  assert.equal(m.remote_policy, "onsite"); // LLM used; heuristic had none
});

test("mergeExtraction — heuristic-only (empty LLM) yields the full nullable shape", () => {
  const heur = heuristicExtract("Fully remote team. 6+ years of experience required.");
  const m = mergeExtraction(heur, {});
  assert.equal(m.yoe_min, 6);
  assert.equal(m.remote_policy, "remote"); // heuristic fallback
  assert.equal(m.customer_type, null);
  assert.equal(m.geo_eligibility, null);
  // shape totality: all schema keys present
  for (const key of EXTRACTION_SCHEMA.required) assert.ok(key in m, `missing key ${key}`);
});
