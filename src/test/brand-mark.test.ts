// Drift guard for the Northgoing mark (issue #107, direction A "Needle").
//
// The mark exists in two places that CANNOT be generated from each other at
// runtime: public/favicon.svg (a static file the browser and the icon
// rasterizer read) and src/lib/brand.tsx (the React component the app header
// renders). A hand-edit to either one silently ships two different logos —
// the favicon says one thing, the header says another, and nobody notices
// because neither is wrong on its own screen. This test is the only thing
// that makes them one mark.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MARK_NORTH, MARK_SOUTH, MARK_SOUTH_STROKE, MARK_VIEWBOX } from "@/lib/brand";

const favicon = readFileSync(resolve(process.cwd(), "public/favicon.svg"), "utf8");

describe("Northgoing mark", () => {
  it("draws the same north half in the favicon as in the component", () => {
    expect(favicon).toContain(MARK_NORTH);
  });

  it("draws the same south half in the favicon as in the component", () => {
    expect(favicon).toContain(MARK_SOUTH);
  });

  it("shares one coordinate space, so every size scales from the same geometry", () => {
    expect(MARK_VIEWBOX).toBe("0 0 64 64");
    expect(favicon).toContain(`viewBox="${MARK_VIEWBOX}"`);
  });

  it("keeps the south half an outline at the weight the component uses", () => {
    expect(favicon).toContain(`stroke-width="${MARK_SOUTH_STROKE}"`);
  });

  it("carries no hardcoded color, so one mark serves both themes", () => {
    // currentColor is the whole reason a single file works as an ink mark on the
    // light stage and a pale mark on the dark map. A literal hex here would pin
    // it to one theme and break the other.
    expect(favicon).toContain("currentColor");
    expect(favicon).not.toMatch(/(fill|stroke)="#[0-9a-fA-F]{3,8}"/);
  });
});
