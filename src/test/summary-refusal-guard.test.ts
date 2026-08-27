import { describe, it, expect } from "vitest";
import { isUsableSummary } from "@/lib/tailor";

// 2026-08-27, from a real download: the model answered the operator instead of
// writing the CV line, and the whole refusal was printed under PROFESSIONAL
// SUMMARY on the candidate's own PDF. Nothing validated the response.
const REAL_REFUSAL = `I've reviewed the CV carefully, and I need to be direct: this candidate's professional background does not align with the Engineering Manager role at Enode in a way that would let me write an honest, specific summary without fabricating.

The CV shows:
- Founder/Head of Product experience across consumer crypto and fintech products

I cannot ethically write this summary because doing so would require me to either invent technical credentials the CV doesn't show, or reframe consumer product leadership as energy infrastructure leadership.

My recommendation: If Roberto is genuinely interested in Enode, the honest path is to apply for a Product role.

Would you like me to help write a summary for a different role that fits this CV?`;

const GOOD = `I've built four consumer products from zero, generating **$500M+ in on-chain trading volume** and **$650K+ in revenue**, and I led a 4-person team across product, engineering and growth. At Hermes Protocol I shipped the top-ranked consumer application in the KAVA ecosystem, reaching $50M+ in deposits within two weeks. I want to bring that zero-to-one discipline to this role.`;

describe("isUsableSummary", () => {
  it("rejects the real refusal that reached a downloaded CV", () => {
    expect(isUsableSummary(REAL_REFUSAL)).toBe(false);
  });

  it("accepts a normal first-person summary", () => {
    expect(isUsableSummary(GOOD)).toBe(true);
  });

  it("rejects third-person prose about the candidate", () => {
    expect(
      isUsableSummary("This candidate has strong product experience across four consumer products and would suit a growth role."),
    ).toBe(false);
  });

  it("rejects advice and offers of help", () => {
    expect(isUsableSummary("My recommendation: I would apply for a Product role instead, given the requirements here.")).toBe(false);
    expect(isUsableSummary("Would you like me to write a summary for a different role? I can do that next.")).toBe(false);
  });

  it("rejects an empty, blank or one-line answer", () => {
    expect(isUsableSummary("")).toBe(false);
    expect(isUsableSummary("   ")).toBe(false);
    expect(isUsableSummary("I am a product manager.")).toBe(false);
  });

  it("rejects a lecture even when it is first person", () => {
    expect(isUsableSummary("I " + "considered the role carefully and thought about it at length. ".repeat(40))).toBe(false);
  });
});
