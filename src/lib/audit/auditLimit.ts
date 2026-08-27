// The free-audit gate (issue #159) — the audit is the expensive call (Sonnet plus
// web search), so it keeps the two-free limit it has always had. What moved here
// is only the arithmetic and the copy: the Apply page and the standalone
// generator now read the same numbers instead of each keeping their own.
//
// WHERE THIS IS ENFORCED: here, and only here. There is no per-user audit cap
// behind it — supabase/functions/anthropic-proxy/cap.ts holds ONE global monthly
// spend cap and allowlists kinds ("NO per-user caps at launch"), and the audits
// table has no insert limit, only count_audits_by_fingerprint to read. So this
// gate is client-side, the repo is public, and anyone who wants a third audit can
// have one; the global cap is what bounds the bill. Treat it as a courtesy limit,
// not a control. The one thing it must do is hold for an ordinary user: the Apply
// button stays disabled and generateAudit returns while the allowance is still
// loading, or a click in that window buys an audit the gate would have refused.
// Pinned by src/test/audit-limit.test.ts and src/test/audit-apply-step.test.ts.

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
