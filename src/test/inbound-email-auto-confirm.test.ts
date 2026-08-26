// Issue #157 / LOCKED decision 7 — the auto-confirm branch of api/inbound-email.ts.
// confirmGmailForwarding is the exact function the handler awaits before deciding
// whether to stamp inbound_tokens.gmail_confirmed_at: it returns true on success
// (the handler then writes the stamp) and false on any failure (the handler leaves
// the column null and the manual "Confirm forwarding in Gmail" button in Settings
// stays the fallback). fetchImpl is injected, same shape as scripts/liveness-lib.mjs
// checkUrl, so this needs no live network and no Supabase client.
import { describe, it, expect } from "vitest";
import { confirmGmailForwarding } from "../../api/inbound-email";

const VF_URL = "https://mail.google.com/mail/vf-%5BANGjdJ-AzkPg8TYF11%5D-8JA0s_VWEX";

// finalUrl defaults to the same mail.google.com host the request was sent to —
// i.e. a fetch that actually landed on Gmail, the shape every pre-existing test
// here assumes. Tests that need a redirected-away response pass finalUrl explicitly.
function fakeFetch(status: number, text: string, finalUrl: string = VF_URL): typeof fetch {
  return (async () => ({ status, url: finalUrl, text: async () => text }) as unknown as Response) as typeof fetch;
}

describe("confirmGmailForwarding (mocked fetch)", () => {
  it("success: a 200 confirmation page resolves true — the handler sets gmail_confirmed_at on this", async () => {
    const fetchImpl = fakeFetch(200, "<html>Forwarding confirmed. You're all set.</html>");
    expect(await confirmGmailForwarding(VF_URL, fetchImpl)).toBe(true);
  });

  it("failure: a non-200 resolves false — the handler leaves gmail_confirmed_at null", async () => {
    const fetchImpl = fakeFetch(500, "Internal Server Error");
    expect(await confirmGmailForwarding(VF_URL, fetchImpl)).toBe(false);
  });

  it("failure: a 200 whose body reads like Gmail rejected the link resolves false", async () => {
    const fetchImpl = fakeFetch(200, "This confirmation link has expired.");
    expect(await confirmGmailForwarding(VF_URL, fetchImpl)).toBe(false);
  });

  it("failure: a network error (timeout, DNS, abort) resolves false and never throws", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(confirmGmailForwarding(VF_URL, fetchImpl)).resolves.toBe(false);
  });

  it("failure: a 200 Google sign-in/consent interstitial (redirect:'follow' off an unauthenticated request) resolves false even though its body has none of the reject words — the silent-false-positive class #157 flagged", async () => {
    const fetchImpl = fakeFetch(
      200,
      "<html>Sign in to continue to Gmail. Choose an account.</html>",
      "https://accounts.google.com/signin/v2/identifier?service=mail",
    );
    expect(await confirmGmailForwarding(VF_URL, fetchImpl)).toBe(false);
  });

  it("failure: a 200 consent.google.com interstitial resolves false", async () => {
    const fetchImpl = fakeFetch(
      200,
      "<html>Before you continue to Google, review what this app can access.</html>",
      "https://consent.google.com/ml?continue=https://mail.google.com/mail/vf-abc",
    );
    expect(await confirmGmailForwarding(VF_URL, fetchImpl)).toBe(false);
  });

  it("success: a body mentioning 'onerror' in an inline script still resolves true — the reject regex matches only the whole words error/invalid/expired, not substrings", async () => {
    const fetchImpl = fakeFetch(
      200,
      "<html><script>window.onerror = function(){};</script>Forwarding confirmed.</html>",
    );
    expect(await confirmGmailForwarding(VF_URL, fetchImpl)).toBe(true);
  });
});
