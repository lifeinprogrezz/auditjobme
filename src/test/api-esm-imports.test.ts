import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// Regression guard (2026-07-07, widened 2026-08-19). Vercel compiles api/*.ts to
// native ESM ("type":"module" in package.json), where Node's loader REQUIRES an
// explicit file extension on every relative import. None of the local gates catch
// a missing one: `vite build` and `vitest` use Vite's resolver (extensionless is
// fine), and `tsc` runs with moduleResolution:"bundler" (also fine). So an
// extensionless import is green through the entire CI pipeline and then crashes
// the deployed function at load with ERR_MODULE_NOT_FOUND.
//
// It has now shipped TWICE, both times the same shape: the api/ function itself
// was clean, but a src/lib/ module it imports was not (api/nightly.ts -> labels,
// 2026-07-07; api/score-backlog.ts -> scorePrefilter -> "./labels", #114).
// Checking only api/*.ts was never enough, because Node follows the whole graph.
// So this walks the ACTUAL import graph from every api/ entrypoint and holds each
// reachable module to the same rule.
//
// Type-only imports are exempt: they are erased before the code ever runs.

const ROOT = process.cwd();

/** One import specifier, plus whether it survives compilation into a real load. */
type Spec = { spec: string; typeOnly: boolean };

/**
 * Every import specifier in a module: `from "x"`, bare `import "x"`, and
 * `import("x")`. A statement is type-only when it reads `import type ...`, or
 * when every named binding it pulls is itself marked `type`.
 */
function importsOf(src: string): Spec[] {
  const out: Spec[] = [];

  const fromRe = /\bimport\s+(type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(src)) !== null) {
    const [, typeKeyword, clause, spec] = m;
    const braces = clause.match(/\{([\s\S]*)\}/);
    const bindings = braces
      ? braces[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const allBindingsAreTypes =
      bindings.length > 0 &&
      bindings.every((s) => /^type\s/.test(s)) &&
      // a default or namespace binding alongside the braces is still a value import
      !/^\s*[A-Za-z_$][\w$]*\s*,/.test(clause) &&
      !/\*\s+as\s/.test(clause);
    out.push({ spec, typeOnly: Boolean(typeKeyword) || allBindingsAreTypes });
  }

  const bareRe = /\bimport\s*\(?\s*["']([^"']+)["']\s*\)?/g;
  while ((m = bareRe.exec(src)) !== null) {
    if (!out.some((o) => o.spec === m![1])) out.push({ spec: m[1], typeOnly: false });
  }
  return out;
}

/** Map an import specifier to a file on disk. ESM specifiers say .js; source is .ts/.tsx. */
function resolveSpec(fromFile: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? join(ROOT, "src", spec.slice(2))
    : resolve(dirname(fromFile), spec);
  const stripped = base.replace(/\.js$/, "");
  for (const cand of [`${stripped}.ts`, `${stripped}.tsx`, base, join(stripped, "index.ts")]) {
    if (existsSync(cand) && cand.endsWith(".ts")) return cand;
    if (existsSync(cand) && cand.endsWith(".tsx")) return cand;
  }
  return null;
}

/** Walk the import graph from the api/ entrypoints: everything Node would actually load. */
function reachableFromApi(): { file: string; offenders: string[] }[] {
  const apiDir = join(ROOT, "api");
  const queue = readdirSync(apiDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(apiDir, f));

  const seen = new Set<string>();
  const results: { file: string; offenders: string[] }[] = [];

  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const src = readFileSync(file, "utf8");
    const offenders: string[] = [];

    for (const { spec, typeOnly } of importsOf(src)) {
      if (typeOnly) continue; // erased at compile time, never loaded
      const isRelative = spec.startsWith(".");
      const isAlias = spec.startsWith("@/");
      if (!isRelative && !isAlias) continue; // bare package, resolved from node_modules

      // The "@/" alias is a bundler convention. Node has never heard of it, so a
      // value import through it is as fatal as a missing extension.
      if (isAlias) offenders.push(`${spec} (path alias, Node cannot resolve it)`);
      else if (!spec.endsWith(".js") && !spec.endsWith(".json")) offenders.push(spec);

      const next = resolveSpec(file, spec);
      if (next && next.startsWith(ROOT) && !next.includes("node_modules")) queue.push(next);
    }

    results.push({ file: relative(ROOT, file), offenders });
  }
  return results;
}

describe("every module the api/ functions load uses runtime-resolvable imports", () => {
  const graph = reachableFromApi();

  it("walks past the api/ entrypoints into the shared lib", () => {
    expect(graph.length).toBeGreaterThan(0);
    // The 2026-07-07 guard stopped at api/. Both real incidents were one hop
    // further in, so a graph that never leaves api/ is a broken guard.
    expect(graph.some((g) => g.file.startsWith("src/"))).toBe(true);
  });

  for (const { file, offenders } of graph) {
    it(`${file}: every relative import is extensioned and alias-free`, () => {
      expect(
        offenders,
        `${file} is loaded by a Vercel function, so Node ESM resolves it literally: ${offenders.join(", ")}`,
      ).toEqual([]);
    });
  }
});
