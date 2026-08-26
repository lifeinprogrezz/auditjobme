// The free-audit gate (issue #159) — the audit is the expensive call (Sonnet plus
// web search), so it keeps the two-free limit it has always had. What moved here
// is only the arithmetic and the copy: the Apply page and the standalone
// generator now read the same numbers instead of each keeping their own.
//
// Enforcement is NOT here. This is what the button renders; the edge function and
// the database are what actually hold the line (this repo is public).
// Pinned by src/test/audit-limit.test.ts.

/** Free audits per person, and per device. */
export const FREE_AUDIT_LIMIT = 2;

/** What the button says once they are used up. Unchanged wording from the
 *  generator page, so the two surfaces read the same. */
export const AUDIT_LIMIT_REACHED = "Free limit reached";

export type AuditAllowanceInput = {
  /** Audits saved against this account. */
  auditCount: number;
  /** Audits saved from this device, whichever account ran them. */
  deviceAuditCount: number;
  /** Whitelisted people are not gated. */
  isWhitelisted: boolean;
};

/** How many free audits are left. Infinity for a whitelisted account. */
export function auditsRemaining({ auditCount, deviceAuditCount, isWhitelisted }: AuditAllowanceInput): number {
  if (isWhitelisted) return Infinity;
  const used = Math.max(0, auditCount, deviceAuditCount);
  return Math.max(0, FREE_AUDIT_LIMIT - used);
}

/** True when the button must refuse and show AUDIT_LIMIT_REACHED. */
export function atAuditLimit(input: AuditAllowanceInput): boolean {
  return auditsRemaining(input) === 0;
}
