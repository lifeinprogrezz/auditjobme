// Audit progress (issue #159) — the pure stage-to-copy mapping.
//
// The generator page draws its own seven-row stage list. The Apply page has room
// for one line, so it needs the same seven statuses reduced to a bar fraction and
// a sentence. That reduction lives here, pure and pinned by
// src/test/audit-progress.test.ts, so the two surfaces cannot drift and the copy
// is testable without rendering anything.
//
// It follows the rule ScoringProgress already set: a bar always carries a real
// fraction of a real count, and nothing here is estimated.
import { AUDIT_STAGES, type AuditStageStatus } from "./runAudit";

export type AuditProgressView = {
  /** 0 to 1, the share of stages finished. */
  fraction: number;
  /** What is happening right now. */
  headline: string;
  /** The honest count beside it. */
  detail: string;
};

/** What the bar should say for these stage statuses, or null when a run has not
 *  started and there is nothing to report. */
export function auditProgressOf(
  statuses: readonly AuditStageStatus[],
  stages: readonly string[] = AUDIT_STAGES,
): AuditProgressView | null {
  if (statuses.length === 0) return null;
  const total = stages.length;
  const done = statuses.filter((s) => s === "done").length;
  const fraction = total > 0 ? Math.min(done, total) / total : 0;
  const detail = `${Math.min(done, total)} of ${total} done`;
  if (done >= total) return { fraction: 1, headline: "Your audit is ready", detail };
  const activeIndex = statuses.findIndex((s) => s === "active");
  const index = activeIndex >= 0 ? activeIndex : done;
  return { fraction, headline: stages[Math.min(index, total - 1)] ?? stages[0], detail };
}
