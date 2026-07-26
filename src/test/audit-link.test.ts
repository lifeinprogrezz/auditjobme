import { describe, it, expect } from "vitest";
import { auditHref } from "@/lib/auditLink";

describe("auditHref", () => {
  it("builds an /audit deep link carrying the job URL", () => {
    expect(auditHref("https://boards.greenhouse.io/acme/jobs/123")).toBe(
      "/audit?job=https%3A%2F%2Fboards.greenhouse.io%2Facme%2Fjobs%2F123",
    );
  });

  it("percent-encodes query characters so a second query param never leaks through", () => {
    const href = auditHref("https://example.com/roles?utm_source=li&ref=abc");
    expect(href).toBe("/audit?job=https%3A%2F%2Fexample.com%2Froles%3Futm_source%3Dli%26ref%3Dabc");
    // Exactly one "?" — the job URL's own query string is fully encoded, not spliced in raw.
    expect(href.split("?").length).toBe(2);
  });
});
