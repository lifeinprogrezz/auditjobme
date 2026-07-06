// Pins the /roles detail-panel company-context formatters (Rober 2026-07-06):
// funding stage, headcount bucket, and the website-URL fallback that lets the
// panel show a live link for ~any company off the 99%-covered logo domain.
import { describe, expect, it } from "vitest";
import { formatStage, formatHeadcount, websiteUrl } from "@/lib/roles";

describe("formatStage", () => {
  it("maps known funding enums to display labels", () => {
    expect(formatStage("series_a")).toBe("Series A");
    expect(formatStage("series_d")).toBe("Series D");
    expect(formatStage("seed")).toBe("Seed");
    expect(formatStage("pre_seed")).toBe("Pre-seed");
    expect(formatStage("public")).toBe("Public");
  });
  it("is case/space tolerant", () => {
    expect(formatStage("  SERIES_B ")).toBe("Series B");
  });
  it("title-cases an unknown enum instead of dropping it", () => {
    expect(formatStage("mega_round")).toBe("Mega Round");
  });
  it("passes null/empty through", () => {
    expect(formatStage(null)).toBeNull();
    expect(formatStage("")).toBeNull();
    expect(formatStage(undefined)).toBeNull();
  });
});

describe("formatHeadcount", () => {
  it("renders a bucket with an en dash", () => {
    expect(formatHeadcount("51-200")).toBe("51–200");
    expect(formatHeadcount("100-500")).toBe("100–500");
    expect(formatHeadcount("11-50")).toBe("11–50");
  });
  it("tolerates spacing", () => {
    expect(formatHeadcount(" 30 - 100 ")).toBe("30–100");
  });
  it("passes null/empty through", () => {
    expect(formatHeadcount(null)).toBeNull();
    expect(formatHeadcount("")).toBeNull();
  });
});

describe("websiteUrl", () => {
  it("prefers an explicit website", () => {
    expect(websiteUrl("https://www.9fin.com", "9fin.com")).toBe("https://www.9fin.com");
  });
  it("derives from the logo domain when website is absent", () => {
    expect(websiteUrl(null, "deliveroo.com")).toBe("https://deliveroo.com");
    expect(websiteUrl("", "wallapop.com")).toBe("https://wallapop.com");
  });
  it("is null when neither is available", () => {
    expect(websiteUrl(null, null)).toBeNull();
    expect(websiteUrl(undefined, undefined)).toBeNull();
  });
});
