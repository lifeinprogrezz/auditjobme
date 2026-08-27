// Pins labels.ts's ROLE_OTHER equal to roles.ts's ROLE_FAMILY_OTHER (issue
// #158 / A4). The two are separate literals ON PURPOSE — labels.ts must stay
// reachable from api/ and roles.ts pulls in browser-only modules (see the
// comment on ROLE_OTHER in labels.ts) — so nothing at the type level catches a
// future edit to either that lets them drift. This test is that catch.
import { describe, it, expect } from "vitest";
import { ROLE_OTHER } from "@/lib/labels";
import { ROLE_FAMILY_OTHER } from "@/lib/roles";

describe("ROLE_OTHER stays in lockstep with roles.ts's ROLE_FAMILY_OTHER", () => {
  it("are the same string", () => {
    expect(ROLE_OTHER).toBe(ROLE_FAMILY_OTHER);
  });
});
