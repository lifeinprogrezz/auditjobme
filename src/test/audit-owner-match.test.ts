// Pins the /a/:username/:slug ownership check (auditjobme#90 follow-up). A
// slug is unique per owner, not globally, so the bug this guards against is
// real: with exactly one candidate audit for a slug, the page used to render
// it without ever checking the :username segment against that audit's owner.
import { describe, it, expect } from "vitest";
import { resolveAuditMatch, slugifyOwner } from "@/lib/auditOwnerMatch";

describe("slugifyOwner", () => {
  it("lowercases and dash-joins, stripping accents", () => {
    expect(slugifyOwner("Rober Quintero")).toBe("rober-quintero");
    expect(slugifyOwner("Ünïcode Ñame")).toBe("unicode-name");
  });
});

describe("resolveAuditMatch", () => {
  const audits = [{ user_id: "owner-1" }];
  const profiles = [{ id: "owner-1", username: "real-owner" }];

  it("matches when the requested username resolves to the audit's actual owner", () => {
    expect(resolveAuditMatch(audits, profiles, "real-owner")).toBe(audits[0]);
  });

  it("never falls back to the sole candidate when the username does not match its owner", () => {
    // This is the exact bug: one audit matched the slug, and the old code
    // rendered it regardless of who :username claimed to be.
    expect(resolveAuditMatch(audits, profiles, "someone-else")).toBeNull();
  });

  it("returns null when no profile resolves to the requested username at all", () => {
    expect(resolveAuditMatch(audits, [], "real-owner")).toBeNull();
  });

  it("falls back to display_name when username is unset", () => {
    const withDisplayName = [{ id: "owner-1", username: null, display_name: "Real Owner" }];
    expect(resolveAuditMatch(audits, withDisplayName, "Real Owner")).toBe(audits[0]);
  });

  it("picks the correct owner among several candidates sharing a slug", () => {
    const multi = [{ user_id: "owner-1" }, { user_id: "owner-2" }];
    const multiProfiles = [
      { id: "owner-1", username: "alice" },
      { id: "owner-2", username: "bob" },
    ];
    expect(resolveAuditMatch(multi, multiProfiles, "bob")).toBe(multi[1]);
    expect(resolveAuditMatch(multi, multiProfiles, "alice")).toBe(multi[0]);
  });
});
