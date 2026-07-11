// Dataplane assembly tests. No network, no DB. Run: node --test scripts/dataplane-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataplane, DATAPLANE_VERSION } from "./dataplane-lib.mjs";

const JOBS = [
  { id: "b", company: "Beta", title: "PM", url: "https://b", location: "Berlin", company_id: "2" },
  { id: "a", company: "Alpha", title: "PM", url: "https://a", location: "Madrid", company_id: "1" },
];
const COMPANIES = [
  { slug: "beta", lat: 52.5, lng: 13.4 },
  { slug: "alpha", lat: 40.4, lng: -3.7 },
];
const OFFICES = [
  { company_slug: "beta", lat: 48.1, lng: 11.6 },
  { company_slug: "alpha", lat: 41.4, lng: 2.2 },
  { company_slug: "alpha", lat: 40.4, lng: -3.7 },
];
const AT = "2026-07-11T05:30:00.000Z";

test("assembles the artifact with version, timestamp, and counts", () => {
  const { json, counts } = buildDataplane(JOBS, COMPANIES, OFFICES, AT);
  const parsed = JSON.parse(json);
  assert.equal(parsed.version, DATAPLANE_VERSION);
  assert.equal(parsed.generated_at, AT);
  assert.deepEqual(parsed.counts, { jobs: 2, companies: 2, offices: 3 });
  assert.deepEqual(counts, parsed.counts);
});

test("is deterministic: same input rows in any order produce identical bytes", () => {
  const a = buildDataplane(JOBS, COMPANIES, OFFICES, AT);
  const b = buildDataplane(
    [...JOBS].reverse(),
    [...COMPANIES].reverse(),
    [...OFFICES].reverse(),
    AT,
  );
  assert.equal(a.json, b.json);
  assert.equal(a.ndjson, b.ndjson);
});

test("ndjson has one parseable job per line, sorted by id", () => {
  const { ndjson } = buildDataplane(JOBS, COMPANIES, OFFICES, AT);
  const lines = ndjson.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((j) => j.id), ["a", "b"]);
});

test("does not mutate its inputs", () => {
  const jobsCopy = JSON.parse(JSON.stringify(JOBS));
  buildDataplane(JOBS, COMPANIES, OFFICES, AT);
  assert.deepEqual(JOBS, jobsCopy);
});

test("empty pools produce a valid, empty artifact", () => {
  const { json, ndjson } = buildDataplane([], [], [], AT);
  const parsed = JSON.parse(json);
  assert.deepEqual(parsed.counts, { jobs: 0, companies: 0, offices: 0 });
  assert.equal(ndjson, "");
});
