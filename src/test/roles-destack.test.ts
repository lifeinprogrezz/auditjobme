// Pins deStack (src/hooks/useRolesData.ts), issue #153: companies that share
// one exact office coordinate used to stack into a single pin, so only the
// topmost logo was visible. Measured on production: 8 London and 6 Berlin
// companies hidden, with sweep_fr / cogna_gb / fyxer all on
// 51.5174844,-0.1126829 and parloa_de / taktile_de / forto all on
// 52.5300343,13.4110442. Pure function, no DOM, no network.
import { describe, expect, it } from "vitest";
import { deStack, deStackRadiusM } from "@/hooks/useRolesData";

const LONDON: [number, number] = [-0.1126829, 51.5174844];
const BERLIN: [number, number] = [13.4110442, 52.5300343];

/** Great-circle-ish distance in metres, good enough at these scales. */
function metresApart(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * 111320;
  const dLng = (b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function mapOf(entries: [string, [number, number] | null][]) {
  return new Map<string, [number, number] | null>(entries);
}

describe("deStackRadiusM", () => {
  it("is about 30 metres at the reference stack of 3", () => {
    expect(deStackRadiusM(3)).toBeCloseTo(30, 6);
  });

  it("grows with the size of the stack", () => {
    expect(deStackRadiusM(8)).toBeGreaterThan(deStackRadiusM(3));
  });

  it("never exceeds 60 metres, however big the stack", () => {
    expect(deStackRadiusM(50)).toBeLessThanOrEqual(60);
    expect(deStackRadiusM(10000)).toBeLessThanOrEqual(60);
  });
});

describe("deStack", () => {
  it("separates the three London companies that shared one coordinate", () => {
    const out = deStack(
      mapOf([
        ["london|sweep_fr", LONDON],
        ["london|cogna_gb", LONDON],
        ["london|fyxer", LONDON],
      ]),
    );
    const pts = [...out.values()] as [number, number][];
    const keys = pts.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`);
    expect(new Set(keys).size).toBe(3);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(metresApart(pts[i], pts[j])).toBeGreaterThan(5);
      }
    }
  });

  it("separates the three Berlin companies that shared one coordinate", () => {
    const out = deStack(
      mapOf([
        ["berlin|parloa_de", BERLIN],
        ["berlin|taktile_de", BERLIN],
        ["berlin|forto", BERLIN],
      ]),
    );
    const keys = [...out.values()].map((p) => `${p![0].toFixed(6)},${p![1].toFixed(6)}`);
    expect(new Set(keys).size).toBe(3);
  });

  it("keeps the first key in sort order on the true coordinate", () => {
    const out = deStack(
      mapOf([
        ["london|sweep_fr", LONDON],
        ["london|cogna_gb", LONDON],
        ["london|fyxer", LONDON],
      ]),
    );
    // "london|cogna_gb" sorts first, so it holds the real address.
    expect(out.get("london|cogna_gb")).toEqual(LONDON);
    expect(out.get("london|fyxer")).not.toEqual(LONDON);
    expect(out.get("london|sweep_fr")).not.toEqual(LONDON);
  });

  it("leaves distinct coordinates untouched", () => {
    const input = mapOf([
      ["london|monzo", LONDON],
      ["berlin|forto", BERLIN],
      ["paris|alan", [2.3522, 48.8566]],
    ]);
    const out = deStack(input);
    for (const [gk, pos] of input) expect(out.get(gk)).toEqual(pos);
  });

  it("leaves unplaced companies null", () => {
    const out = deStack(
      mapOf([
        ["nowhere|a", null],
        ["nowhere|b", null],
        ["london|monzo", LONDON],
      ]),
    );
    expect(out.get("nowhere|a")).toBeNull();
    expect(out.get("nowhere|b")).toBeNull();
  });

  it("does not mutate the map it is given", () => {
    const input = mapOf([
      ["london|sweep_fr", LONDON],
      ["london|cogna_gb", LONDON],
    ]);
    deStack(input);
    expect(input.get("london|sweep_fr")).toEqual(LONDON);
    expect(input.get("london|cogna_gb")).toEqual(LONDON);
  });

  it("is deterministic across runs", () => {
    const build = () =>
      mapOf([
        ["london|sweep_fr", LONDON],
        ["london|cogna_gb", LONDON],
        ["london|fyxer", LONDON],
        ["berlin|parloa_de", BERLIN],
        ["berlin|taktile_de", BERLIN],
      ]);
    expect([...deStack(build()).entries()]).toEqual([...deStack(build()).entries()]);
  });

  it("is order-independent: the same stack fans out the same way whatever the input order", () => {
    const a = deStack(
      mapOf([
        ["london|sweep_fr", LONDON],
        ["london|cogna_gb", LONDON],
        ["london|fyxer", LONDON],
      ]),
    );
    const b = deStack(
      mapOf([
        ["london|fyxer", LONDON],
        ["london|sweep_fr", LONDON],
        ["london|cogna_gb", LONDON],
      ]),
    );
    for (const gk of a.keys()) expect(b.get(gk)).toEqual(a.get(gk));
  });

  it("keeps every moved pin inside the small radius", () => {
    for (const n of [2, 3, 6, 10, 25]) {
      const entries: [string, [number, number] | null][] = [];
      for (let i = 0; i < n; i++) entries.push([`london|co-${i}`, LONDON]);
      const out = deStack(mapOf(entries));
      for (const pos of out.values()) {
        expect(metresApart(LONDON, pos as [number, number])).toBeLessThanOrEqual(60);
      }
    }
  });

  it("a stack of ten still separates into ten readable pins", () => {
    const entries: [string, [number, number] | null][] = [];
    for (let i = 0; i < 10; i++) entries.push([`berlin|co-${i}`, BERLIN]);
    const out = deStack(mapOf(entries));
    const pts = [...out.values()] as [number, number][];
    expect(new Set(pts.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`)).size).toBe(10);
    let closest = Infinity;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        closest = Math.min(closest, metresApart(pts[i], pts[j]));
      }
    }
    expect(closest).toBeGreaterThan(5);
  });

  it("separates two stacks in the same city without mixing them", () => {
    const other: [number, number] = [-0.09, 51.51];
    const out = deStack(
      mapOf([
        ["london|a", LONDON],
        ["london|b", LONDON],
        ["london|c", other],
        ["london|d", other],
      ]),
    );
    expect(metresApart(LONDON, out.get("london|b") as [number, number])).toBeLessThanOrEqual(60);
    expect(metresApart(other, out.get("london|d") as [number, number])).toBeLessThanOrEqual(60);
    expect(out.get("london|a")).toEqual(LONDON);
    expect(out.get("london|c")).toEqual(other);
  });
});
