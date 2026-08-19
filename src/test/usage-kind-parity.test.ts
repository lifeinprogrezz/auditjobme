// Guard: every `kind` the proxy will meter must be a kind the database will accept.
//
// These two lists live on opposite sides of a boundary and drifted apart. The proxy's
// ALLOWED_KINDS gained 'answer' when the "Draft answer" feature shipped; the CHECK
// constraint on usage_events did not. The result is silent and expensive:
//
//   1. A "Draft answer" call passes the proxy allowlist and is billed by Anthropic.
//   2. The proxy writes the usage row with kind='answer'.
//   3. The CHECK constraint rejects it.
//   4. Nobody finds out. supabase-js RETURNS errors rather than throwing, so the
//      `try/catch` around the insert never fires, and the returned `error` is not
//      read. The write is swallowed twice over.
//   5. `global_month_spend_usd()` — the $300 fail-closed cap — sums usage_events.
//      Money spent on answers is therefore invisible to the cap that exists to
//      bound it.
//
// Measured 2026-08-19: usage_events held score/extract/enrich/audit/cv/letter and
// ZERO 'answer' rows, while `cv` (5) and `letter` (3) — the sibling buttons on the
// same Apply page, through the same callProxy — had recorded fine.
//
// This is the same shape as the bug fixed in PR #125, where the cap read a TRUNCATED
// ledger. Here it reads an INCOMPLETE one. A cap is only as good as its meter, so the
// two lists are pinned together here rather than trusted to stay in sync.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** The kinds the edge function is willing to meter. */
function proxyKinds(): string[] {
  const src = readFileSync(join(ROOT, "supabase/functions/anthropic-proxy/index.ts"), "utf8");
  const m = src.match(/const ALLOWED_KINDS\s*=\s*\[([^\]]+)\]/);
  if (!m) throw new Error("ALLOWED_KINDS not found in anthropic-proxy/index.ts");
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

/**
 * The kinds the database will accept, read from the LAST migration that redefines the
 * constraint. Migrations are append-only and ordered by filename, so the newest
 * definition wins — the same way Postgres ends up seeing it.
 */
function dbKinds(): string[] {
  const dir = join(ROOT, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let latest: string[] | null = null;
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    // Match the constraint body whether it is written `kind in (...)` or
    // `kind = any (array[...])`.
    const m = sql.match(/constraint\s+usage_events_kind_check\s+check\s*\(\s*kind\s*(?:in|=\s*any\s*\(?\s*array)\s*[[(]([^\])]+)[\])]/i);
    if (m) latest = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  if (!latest) throw new Error("no migration defines usage_events_kind_check");
  return latest;
}

describe("usage_events kind parity between the proxy and the database", () => {
  it("reads both lists", () => {
    expect(proxyKinds().length).toBeGreaterThan(3);
    expect(dbKinds().length).toBeGreaterThan(3);
  });

  it("every kind the proxy meters is accepted by the CHECK constraint", () => {
    const db = new Set(dbKinds());
    const orphans = proxyKinds().filter((k) => !db.has(k));
    expect(
      orphans,
      `the proxy meters kind(s) the database rejects: ${orphans.join(", ")}. ` +
        `Every such call is billed by Anthropic and then silently dropped from usage_events, ` +
        `so the $300 fail-closed cap cannot see the money. Add them to the CHECK constraint ` +
        `in a new migration.`,
    ).toEqual([]);
  });
});
