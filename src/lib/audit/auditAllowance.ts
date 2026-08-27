// Reading the free-audit allowance (issue #159). The maths and the copy are in
// auditLimit.ts and pure; this is only the three reads behind them, so the Apply
// page and the generator ask the same questions in the same order.
//
// The device fingerprint is loaded lazily: it is a heavy dependency, and a page
// that never opens the audit step should never pay for it.
import { supabase } from "@/integrations/supabase/client";
import type { AuditAllowanceInput } from "./auditLimit";

export type AuditAllowance = AuditAllowanceInput & { fingerprint: string | null };

/** What this account and this device have already used. Every failure reads as
 *  zero used, deliberately: nothing behind this re-checks (auditLimit.ts says where
 *  the line really is), so the choice is between locking somebody out of a free
 *  audit and handing out one extra, and the global spend cap makes the extra cheap.
 *
 *  It always RESOLVES. The Apply button is disabled until it does, so a rejection
 *  here would be a dead button, not an open door. */
export async function loadAuditAllowance(user: { id: string; email?: string | null }): Promise<AuditAllowance> {
  let auditCount = 0;
  let isWhitelisted = false;
  try {
    const [{ count }, { data: whitelisted }] = await Promise.all([
      supabase.from("audits").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      user.email
        ? supabase.from("whitelisted_emails").select("id").eq("email", user.email).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    auditCount = count || 0;
    isWhitelisted = !!whitelisted;
  } catch (err) {
    console.warn("Audit allowance read failed:", err);
  }

  let fingerprint: string | null = null;
  let deviceAuditCount = 0;
  try {
    const FingerprintJS = (await import("@fingerprintjs/fingerprintjs")).default;
    const agent = await FingerprintJS.load();
    const result = await agent.get();
    fingerprint = result.visitorId;
    const { data } = await supabase.rpc("count_audits_by_fingerprint", { p_fingerprint: result.visitorId });
    deviceAuditCount = data || 0;
  } catch (err) {
    console.warn("Fingerprint init failed:", err);
  }

  return {
    auditCount,
    deviceAuditCount,
    isWhitelisted,
    fingerprint,
  };
}
