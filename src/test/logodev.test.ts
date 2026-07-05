import { describe, it, expect, vi, afterEach } from "vitest";
import { domainFor, logoUrl } from "@/lib/logodev";

describe("domainFor", () => {
  it("derives the domain from big-tech scraper sources", () => {
    expect(domainFor("Google", "google")).toBe("google.com");
    expect(domainFor("Meta Platforms", "meta")).toBe("meta.com");
    expect(domainFor("Amazon EU SARL", "amazon")).toBe("amazon.com");
    expect(domainFor("Microsoft Ireland", "microsoft")).toBe("microsoft.com");
    expect(domainFor("Apple", "apple")).toBe("apple.com");
  });

  it("source wins over the name map", () => {
    expect(domainFor("Spotify", "apple")).toBe("apple.com");
  });

  it("resolves curated company names case-insensitively", () => {
    expect(domainFor("Factorial", "greenhouse")).toBe("factorial.co");
    expect(domainFor("REVOLUT", null)).toBe("revolut.com");
    expect(domainFor("  Deliveroo  ", "lever")).toBe("deliveroo.co.uk");
    expect(domainFor("Booking.com", null)).toBe("booking.com");
    expect(domainFor("Scalable Capital", null)).toBe("scalable.capital");
  });

  it("strips trailing legal suffixes before lookup", () => {
    expect(domainFor("Personio GmbH", null)).toBe("personio.com");
    expect(domainFor("Klarna AB", "greenhouse")).toBe("klarna.com");
    expect(domainFor("Mollie B.V.", null)).toBe("mollie.com");
    expect(domainFor("Wise Ltd", null)).toBe("wise.com");
    expect(domainFor("Typeform SL", null)).toBe("typeform.com");
    expect(domainFor("Qonto SAS", null)).toBe("qonto.com");
    expect(domainFor("Zalando SE", null)).toBe("zalando.com");
    expect(domainFor("Miro, Inc.", null)).toBe("miro.com");
  });

  it("returns null for unknown companies (never guesses a domain)", () => {
    expect(domainFor("Some Random Startup", "greenhouse")).toBeNull();
    expect(domainFor("Acme GmbH", null)).toBeNull();
    expect(domainFor("", null)).toBeNull();
  });

  it("never resolves inherited Object members as domains", () => {
    expect(domainFor("Constructor", null)).toBeNull();
    expect(domainFor("__proto__", null)).toBeNull();
    expect(domainFor("hasOwnProperty", null)).toBeNull();
    expect(domainFor("valueOf", "constructor")).toBeNull();
  });
});

describe("logoUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("builds the Logo.dev URL when a token is configured", () => {
    vi.stubEnv("VITE_LOGODEV_TOKEN", "pk_test_123");
    expect(logoUrl("personio.com")).toBe(
      "https://img.logo.dev/personio.com?token=pk_test_123&size=96&format=png&theme=dark&retina=true&fallback=404",
    );
  });

  it("returns null when the token is empty or missing", () => {
    vi.stubEnv("VITE_LOGODEV_TOKEN", "");
    expect(logoUrl("personio.com")).toBeNull();
  });
});
