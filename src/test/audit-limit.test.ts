// Pins the free-audit gate (issue #159). The audit is the expensive call, so it
// keeps its two-free limit on the Apply page exactly as on the generator page.
// This is the button's arithmetic and its copy; the server is what enforces it.
import { describe, it, expect } from "vitest";
import { FREE_AUDIT_LIMIT, AUDIT_LIMIT_REACHED, auditsRemaining, atAuditLimit } from "@/lib/audit/auditLimit";

describe("free-audit gate (issue #159)", () => {
  it("is two free audits", () => {
    expect(FREE_AUDIT_LIMIT).toBe(2);
    expect(auditsRemaining({ auditCount: 0, deviceAuditCount: 0, isWhitelisted: false })).toBe(2);
  });

  it("counts down and then stops", () => {
    expect(auditsRemaining({ auditCount: 1, deviceAuditCount: 0, isWhitelisted: false })).toBe(1);
    expect(auditsRemaining({ auditCount: 2, deviceAuditCount: 0, isWhitelisted: false })).toBe(0);
    expect(atAuditLimit({ auditCount: 2, deviceAuditCount: 0, isWhitelisted: false })).toBe(true);
  });

  it("takes the higher of the account and the device, so a new account on a used device is still gated", () => {
    expect(auditsRemaining({ auditCount: 0, deviceAuditCount: 2, isWhitelisted: false })).toBe(0);
    expect(auditsRemaining({ auditCount: 1, deviceAuditCount: 2, isWhitelisted: false })).toBe(0);
  });

  it("never reports a negative allowance", () => {
    expect(auditsRemaining({ auditCount: 9, deviceAuditCount: 9, isWhitelisted: false })).toBe(0);
  });

  it("does not gate a whitelisted account", () => {
    expect(auditsRemaining({ auditCount: 5, deviceAuditCount: 5, isWhitelisted: true })).toBe(Infinity);
    expect(atAuditLimit({ auditCount: 5, deviceAuditCount: 5, isWhitelisted: true })).toBe(false);
  });

  it("keeps the wording the generator page already used", () => {
    expect(AUDIT_LIMIT_REACHED).toBe("Free limit reached");
  });
});
