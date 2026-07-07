import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Regression guard (2026-07-07). Vercel compiles api/*.ts to native ESM
// ("type":"module" in package.json), where Node's loader REQUIRES an explicit
// file extension on every relative import. None of the local gates catch a
// missing one: `vite build` and `vitest` use Vite's resolver (extensionless is
// fine), and `tsc` runs with moduleResolution:"bundler" (also fine). So an
// extensionless relative import in an api/ function is green through the entire
// CI pipeline and then crashes the deployed function at load with
// ERR_MODULE_NOT_FOUND. This test is the only thing that catches that class
// before it ships. It shipped once (api/nightly.ts → "../src/lib/labels").
describe("api/ functions use extensioned ESM relative imports", () => {
  const apiDir = join(process.cwd(), "api");
  const files = readdirSync(apiDir).filter((f) => f.endsWith(".ts"));

  it("finds at least one api function to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // static `from "./x"`, side-effect `import "./x"`, and dynamic `import("./x")`
  const relImport = /(?:\bfrom\s+|\bimport\s*\(?\s*)["'](\.[^"']*)["']/g;

  for (const file of files) {
    it(`${file}: every relative import ends in .js`, () => {
      const src = readFileSync(join(apiDir, file), "utf8");
      const offenders: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = relImport.exec(src)) !== null) {
        const spec = m[1];
        if (!spec.endsWith(".js") && !spec.endsWith(".json")) offenders.push(spec);
      }
      expect(
        offenders,
        `extensionless relative import(s) in api/${file} — Node ESM needs .js: ${offenders.join(", ")}`,
      ).toEqual([]);
    });
  }
});
