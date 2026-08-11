// Issue #78 — referral ATTRIBUTION only (the reward half is blocked on #35; nothing
// here grants anything). Pure logic for the client half of the loop:
//
//   1. Landing capture: `auditjob.me/?ref={token}` stashes the token in localStorage,
//      because Google OAuth redirects back to the bare origin — the query string does
//      not survive the sign-up flow, localStorage does.
//   2. Post-sign-in claim: once a session exists, the stashed token is handed to the
//      server-side claim_referral() RPC and cleared. The RPC derives everything
//      (referrer from the token, referee from auth.uid(), signed_up_at from the
//      account) and refuses non-fresh accounts, self-referrals and repeat claims —
//      the client can only ever hand over the token it saw, never write the table
//      (see supabase/migrations/20260812007800_referral_attribution.sql).
//
// No React, no supabase imports — storage and the RPC arrive as arguments, pinned by
// src/test/referral.test.ts. Rule + code move together.

/** Query parameter carrying the invite token. */
export const REF_PARAM = "ref";

/** localStorage key the token waits under between landing and sign-in. */
export const REF_STORAGE_KEY = "aj_ref_token";

/** Server tokens are 32 lowercase hex chars (a dashless uuid). The range tolerates a
 *  future length change without accepting junk, script, or somebody's essay. */
export const REF_TOKEN_RE = /^[a-f0-9]{16,64}$/;

/** The origin invite links are minted against — links are for sharing, so they always
 *  point at production regardless of where the Settings page is running. */
export const INVITE_ORIGIN = "https://auditjob.me";

/** The shareable invite link for a token. */
export function inviteLink(token: string): string {
  return `${INVITE_ORIGIN}/?${REF_PARAM}=${token}`;
}

/** Minimal slice of Storage the capture needs (injectable for tests). */
export type RefStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Extract a well-formed invite token from a location search string, else null. */
export function refTokenFromSearch(search: string): string | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get(REF_PARAM);
  } catch {
    return null;
  }
  if (!raw) return null;
  const token = raw.trim().toLowerCase();
  return REF_TOKEN_RE.test(token) ? token : null;
}

/**
 * Stash a landing-page invite token for the post-sign-in claim. Last link clicked
 * wins (a fresh visit reflects the invite actually followed); a malformed or absent
 * token changes nothing. Storage failures (private mode) are swallowed — attribution
 * is best-effort, never in the way of the visit itself.
 */
export function captureRefToken(search: string, storage: RefStorage): string | null {
  const token = refTokenFromSearch(search);
  if (!token) return null;
  try {
    storage.setItem(REF_STORAGE_KEY, token);
  } catch {
    return null;
  }
  return token;
}

/** The RPC slice claimStoredReferral needs (injectable for tests). */
export type ClaimRpc = (
  fn: "claim_referral",
  args: { ref_token: string },
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/**
 * If a captured token is waiting, hand it to the server-side claim and clear it.
 * The token is cleared on any DEFINITIVE outcome (claimed, or refused by the
 * server's own rules) and kept only on a transport error, so a flaky network gets
 * a retry on the next visit while a settled claim never re-fires.
 *
 * Returns what happened, for the test pin; callers treat it as fire-and-forget.
 */
export async function claimStoredReferral(
  rpc: ClaimRpc,
  storage: RefStorage,
): Promise<"claimed" | "refused" | "retry" | "none"> {
  let token: string | null;
  try {
    token = storage.getItem(REF_STORAGE_KEY);
  } catch {
    return "none";
  }
  if (!token || !REF_TOKEN_RE.test(token)) {
    if (token) try { storage.removeItem(REF_STORAGE_KEY); } catch { /* ignore */ }
    return "none";
  }
  try {
    const { data, error } = await rpc("claim_referral", { ref_token: token });
    if (error) return "retry";
    try { storage.removeItem(REF_STORAGE_KEY); } catch { /* ignore */ }
    return data === true ? "claimed" : "refused";
  } catch {
    return "retry";
  }
}
