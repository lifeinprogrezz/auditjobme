// Pins the recruitment-firm / aggregator gate (scripts/recruitment-firms.mjs),
// issue #68 item 3, ported from career-ops portals.yml `recruitment_firms`.
// Contract: exact normalized-name match only — a listed firm never enters the
// pool, and no real employer is ever swallowed by a substring match.
import { describe, expect, it } from "vitest";
import { isRecruitmentFirm, normalizeFirmName, RECRUITMENT_FIRMS } from "../../scripts/recruitment-firms.mjs";

describe("isRecruitmentFirm", () => {
  it("matches listed firms case-insensitively", () => {
    expect(isRecruitmentFirm("Hays")).toBe(true);
    expect(isRecruitmentFirm("hays")).toBe(true);
    expect(isRecruitmentFirm("JOBGETHER")).toBe(true);
    expect(isRecruitmentFirm("Burns Sheehan")).toBe(true);
  });

  it("tolerates legal-suffix drift (Senovo IT ≈ Senovo IT Ltd)", () => {
    expect(isRecruitmentFirm("Senovo IT")).toBe(true);
    expect(isRecruitmentFirm("Senovo IT Ltd")).toBe(true);
    expect(isRecruitmentFirm("Hays Ltd")).toBe(true);
  });

  it("folds diacritics and punctuation (Decskill Espana, StaffGreat)", () => {
    expect(isRecruitmentFirm("Decskill Espana")).toBe(true);
    expect(isRecruitmentFirm("Decskill España")).toBe(true);
    expect(isRecruitmentFirm("StaffGreat.com")).toBe(true);
  });

  it("drops anonymized employers", () => {
    expect(isRecruitmentFirm("Confidential")).toBe(true);
    expect(isRecruitmentFirm("Empresa Confidencial")).toBe(true);
  });

  it("NEVER substring-matches: UPPER is listed, Upper Something is not", () => {
    expect(isRecruitmentFirm("UPPER")).toBe(true);
    expect(isRecruitmentFirm("Upper Deck GmbH")).toBe(false);
    expect(isRecruitmentFirm("La Fosse")).toBe(true);
    expect(isRecruitmentFirm("La Fosse Academy Alumni Club")).toBe(false);
  });

  it("real employers pass", () => {
    expect(isRecruitmentFirm("Spotify")).toBe(false);
    expect(isRecruitmentFirm("Beekeeper")).toBe(false);
    expect(isRecruitmentFirm("Factorial")).toBe(false);
  });

  it("null / empty never match", () => {
    expect(isRecruitmentFirm(null)).toBe(false);
    expect(isRecruitmentFirm("")).toBe(false);
    expect(isRecruitmentFirm("   ")).toBe(false);
  });
});

describe("normalizeFirmName", () => {
  it("lowercases, folds diacritics, strips punctuation and ONE trailing legal suffix", () => {
    expect(normalizeFirmName("Decskill España")).toBe("decskillespana");
    expect(normalizeFirmName("Senovo IT Ltd")).toBe("senovoit");
    expect(normalizeFirmName("My Product Path")).toBe("myproductpath");
  });
});

describe("RECRUITMENT_FIRMS", () => {
  it("every listed entry matches itself (no dead entries)", () => {
    for (const firm of RECRUITMENT_FIRMS) {
      expect(isRecruitmentFirm(firm)).toBe(true);
    }
  });
});
