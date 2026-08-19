// Guard: no client-side read of a high-volume table may go un-paged.
//
// PostgREST silently caps an un-ranged select at 1000 rows. It does not error and it
// does not warn — you simply get the first 1000 rows, in no defined order, and the
// application quietly behaves as though the rest do not exist.
//
// This shipped. `useRolesData` fetched `scores` with no `.range()`, so a user holding
// 8,763 scores saw 1,000 of them: roughly 89% of their scored roles rendered as
// unscored, `remaining` never reached zero so the panel counted down forever, the 20s
// poll never stopped, and the Best-fit rail ranked an ARBITRARY 1,000-row sample —
// which is the product's core promise, picked from the wrong set.
//
// The server side already knew: `api/score-backlog.ts` carries
// `const PAGE = 1000; // PostgREST caps un-ranged selects at 1000 rows — page past it`
// and pages correctly. The knowledge existed; only the client was missing it. This test
// exists so that gap cannot reopen.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Tables that can hold more than 1000 rows for ONE user or one page load. */
const HIGH_VOLUME = ["scores", "jobs", "daily_matches", "inbound_emails", "usage_events", "connections"];

/** Reading a bounded slice on purpose is fine; these prove the author thought about it.
 *  `.in(list)` counts: the caller controls the list, so the query is as bounded as the
 *  list is. It is a weaker guarantee than `.range()` — a caller passing 2000 ids still
 *  gets 1000 rows back — so `paging-ok:` exists for cases reviewed and judged safe. */
const BOUNDED = [
  ".range(", ".limit(", ".maybeSingle(", ".single(", "head: true", "count:",
  // `.in(list)` is as bounded as the caller's list.
  ".in(",
  // The paging helper applies .range() itself, so the chain it wraps has none.
  "fetchAllPages",
  // Reviewed and judged bounded by its own filters; the comment says why.
  "paging-ok:",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Find `.from("<table>")` and return the call chain that follows it, so a `.range()`
 * three lines later still counts as bounding the same query.
 */
function selectsOn(src: string, table: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)`, "g");
    let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // Look BEHIND as well as ahead. `fetchAllPages(() => supabase.from(...))` and a
    // `paging-ok:` comment both sit before the `.from(`, so a forward-only window
    // reports them as unbounded — which is how this guard first flagged its own fix.
    const start = Math.max(0, m.index - 300);
    const end = src.indexOf(";", m.index);
    const chain = src.slice(start, end === -1 ? src.length : end + 1);
    if (chain.includes(".select(")) out.push(chain);
  }
  return out;
}

describe("client reads of high-volume tables are bounded", () => {
  const files = [...walk(join(process.cwd(), "src")), ...walk(join(process.cwd(), "api"))];

  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const table of HIGH_VOLUME) {
    it(`every select on "${table}" is paged, limited or single-row`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        const src = readFileSync(file, "utf8");
        for (const chain of selectsOn(src, table)) {
          if (!BOUNDED.some((b) => chain.includes(b))) {
            offenders.push(`${file.replace(process.cwd() + "/", "")}: ${chain.replace(/\s+/g, " ").slice(0, 120)}`);
          }
        }
      }
      expect(
        offenders,
        `unbounded select on "${table}" — PostgREST returns only the first 1000 rows, silently and unordered:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });
  }
});
