// Pins the UK sponsor matcher (scripts/sponsor-lib.mjs), ported from career-ops's
// sponsor-match.test.mjs and re-pointed at the app's 'licensed'|'unmatched'|null
// vocabulary. FAIL-OPEN contract: only a confident register hit is 'licensed';
// an ambiguous single token or missing register data is null (never asserted).
import { describe, expect, it } from "vitest";
import {
  classifySponsor,
  normSponsor,
  isUkRole,
  buildSponsorsFromCsv,
} from "../../scripts/sponsor-lib.mjs";

// Fixture register: how the verified sponsors normalize, plus an unrelated co.
const swNames = ["checkout", "fresha sv", "plaid financial", "funding circle", "bloomberg", "acme widgets"];
const sponsors = { swSet: new Set(swNames), swNames };
const aliases: Record<string, string> = {
  fresha: "Fresha.com SV Ltd",
  plaid: "Plaid Financial Ltd",
  "checkout com": "Checkout Ltd",
  "funding circle": "Funding Circle Ltd",
  bloomberg: "Bloomberg LP",
};

describe("classifySponsor", () => {
  it("resolves the verified sponsors to 'licensed' (exact + alias + suffix strip)", () => {
    expect(classifySponsor("Fresha", sponsors, aliases)).toBe("licensed"); // alias
    expect(classifySponsor("Plaid", sponsors, aliases)).toBe("licensed"); // alias
    expect(classifySponsor("Checkout.com", sponsors, aliases)).toBe("licensed"); // exact
    expect(classifySponsor("Funding Circle", sponsors, aliases)).toBe("licensed"); // exact
    expect(classifySponsor("Funding Circle UK", sponsors, aliases)).toBe("licensed"); // uk stripped → exact
    expect(classifySponsor("Bloomberg", sponsors, aliases)).toBe("licensed"); // exact, LP stripped
  });

  it("marks a real multi-token name absent from the register 'unmatched'", () => {
    expect(classifySponsor("Zzq Nonexistent Ltd", sponsors, aliases)).toBe("unmatched");
  });

  it("returns null (uncertain) for a bare single ambiguous token", () => {
    expect(classifySponsor("Make", sponsors, aliases)).toBeNull();
  });

  it("FAIL-OPEN: null register data → null, even for a fake company", () => {
    expect(classifySponsor("Anything", null, aliases)).toBeNull();
    expect(classifySponsor("Zzq Nonexistent Ltd", null, aliases)).toBeNull();
  });

  it("does a safe multi-token prefix match (short display name → longer register entry)", () => {
    const s = { swSet: new Set(["acme financial services"]), swNames: ["acme financial services"] };
    expect(classifySponsor("Acme Financial", s, {})).toBe("licensed"); // query is a prefix of the register entry
    expect(classifySponsor("Acme Widgets", s, {})).toBe("unmatched"); // multi-token, genuinely absent
  });
});

describe("normSponsor", () => {
  it("strips legal suffixes and punctuation", () => {
    expect(normSponsor("Checkout Ltd")).toBe("checkout");
    expect(normSponsor("Fresha.com SV Ltd")).toBe("fresha sv");
  });
});

describe("isUkRole", () => {
  it("is true for UK locations/titles, false otherwise", () => {
    expect(isUkRole("London", "PM")).toBe(true);
    expect(isUkRole("Manchester, United Kingdom", "PM")).toBe(true);
    expect(isUkRole("Barcelona", "PM")).toBe(false);
    expect(isUkRole("Remote (EU)", "PM")).toBe(false);
    expect(isUkRole("", "Product Manager, UK")).toBe(true);
  });
});

describe("buildSponsorsFromCsv", () => {
  it("keeps only Skilled-Worker rows, normalized", () => {
    const csv = [
      "Organisation Name,Town/City,County,Type & Rating,Route",
      "Checkout Ltd,London,,Worker (A rating),Skilled Worker",
      "Some Charity,Leeds,,Worker (A rating),Charity Worker",
      '"Bloomberg, LP",London,,Worker (A rating),Skilled Worker',
    ].join("\n");
    const s = buildSponsorsFromCsv(csv);
    expect(s.swSet.has("checkout")).toBe(true);
    expect(s.swSet.has("bloomberg")).toBe(true);
    expect(s.swSet.has("some charity")).toBe(false); // not a Skilled-Worker route
    expect(s.count).toBe(3);
  });
});
