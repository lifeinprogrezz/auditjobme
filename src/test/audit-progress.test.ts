// Pins the audit progress mapping (issue #159): the seven pipeline stages reduced
// to the one line the Apply page shows while the audit runs. Pure, so the copy and
// the bar fraction are testable without rendering or running anything.
import { describe, it, expect } from "vitest";
import { auditProgressOf } from "@/lib/audit/auditProgress";
import { AUDIT_STAGES, type AuditStageStatus } from "@/lib/audit/runAudit";

const pending = (): AuditStageStatus[] => AUDIT_STAGES.map(() => "pending");

describe("audit progress (issue #159)", () => {
  it("says nothing before a run starts", () => {
    expect(auditProgressOf([])).toBeNull();
  });

  it("opens on the first stage with an empty bar", () => {
    const statuses = pending();
    statuses[0] = "active";
    const view = auditProgressOf(statuses);
    expect(view).not.toBeNull();
    expect(view?.headline).toBe("Parsing your CV");
    expect(view?.fraction).toBe(0);
    expect(view?.detail).toBe("0 of 7 done");
  });

  it("counts finished stages, not started ones", () => {
    const statuses = pending();
    statuses[0] = "done";
    statuses[1] = "done";
    statuses[2] = "active";
    const view = auditProgressOf(statuses);
    expect(view?.headline).toBe("Building diagnosis");
    expect(view?.detail).toBe("2 of 7 done");
    expect(view?.fraction).toBeCloseTo(2 / 7);
  });

  it("names the people stage for what it produces", () => {
    const statuses = pending();
    for (let i = 0; i < 6; i += 1) statuses[i] = "done";
    statuses[6] = "active";
    expect(auditProgressOf(statuses)?.headline).toBe("Finding the people to reach out to");
  });

  it("falls back to the next unfinished stage when none is marked active", () => {
    const statuses = pending();
    statuses[0] = "done";
    expect(auditProgressOf(statuses)?.headline).toBe("Researching the company");
  });

  it("ends full and done", () => {
    const view = auditProgressOf(AUDIT_STAGES.map(() => "done"));
    expect(view?.fraction).toBe(1);
    expect(view?.headline).toBe("Your audit is ready");
    expect(view?.detail).toBe("7 of 7 done");
  });

  it("never writes an em-dash into the copy", () => {
    const statuses = pending();
    statuses[3] = "active";
    const view = auditProgressOf(statuses);
    expect(`${view?.headline} ${view?.detail}`).not.toMatch(/—/);
  });
});
