// Issue #157 / LOCKED decision 7 — the auto-confirm branch of api/inbound-email.ts.
// confirmGmailForwarding is the exact function the handler awaits before deciding
// whether to stamp inbound_tokens.gmail_confirmed_at: it returns true on success
// (the handler then writes the stamp) and false on any failure (the handler leaves
// the column null and the manual "Confirm forwarding in Gmail" button in Settings
// stays the fallback). fetchImpl is injected, same shape as scripts/liveness-lib.mjs
// checkUrl, so this needs no live network and no Supabase client.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { confirmGmailForwarding } from "../../api/inbound-email";
import { isGmailConfirmPage, isGmailConfirmSuccess } from "@/lib/inbound";

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

// The link the CURRENT Gmail actually sends lives on mail-settings.google.com, and
// that host does not redirect to mail.google.com. The landing check used to demand
// mail.google.com exactly, so every current-account confirm link was fetched and
// then silently rejected: auto-confirm could not fire at all (acceptance panel,
// 2026-08-27). One CONFIRM_HOSTS list now feeds extractor, guard and landing check.
describe("confirmGmailForwarding on the mail-settings host", () => {
  const MS_URL = "https://mail-settings.google.com/mail/vf-%5BANGjdJ-AzkPg8TYF11%5D-8JA0s_VWEX";

  it("accepts a confirmation that lands on mail-settings.google.com", async () => {
    const fetchImpl = fakeFetch(200, "Confirmation Success!", MS_URL);
    await expect(confirmGmailForwarding(MS_URL, fetchImpl)).resolves.toBe(true);
  });

  it("still refuses a consent interstitial that never lands on a confirmation host", async () => {
    const fetchImpl = fakeFetch(
      200,
      "Choose an account",
      "https://accounts.google.com/signin?continue=" + encodeURIComponent(MS_URL),
    );
    await expect(confirmGmailForwarding(MS_URL, fetchImpl)).resolves.toBe(false);
  });
});

// The GET does not confirm anything. Gmail answers the vf- link with a page that
// ASKS — "Please confirm forwarding mail of X to Y" plus a Confirm button — and
// that page is a 200 carrying none of the reject words, so the old check read it
// as a confirmation: inbound_emails logged "link stored; auto-confirmed" and
// gmail_confirmed_at was stamped while Gmail's Settings still showed "Verify"
// next to the address (Rober's live account, 2026-08-27). Pressing Confirm is a
// POST to the same url — `<form action="" method="post">`, one submit input, no
// hidden fields — verified by hand against the live link before this was written.
// The two fixtures are the real pages, with the address redacted.
const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "src/test/fixtures", name), "utf8");
const CONFIRM_PAGE = fixture("gmail-confirm-page.html");
const SUCCESS_PAGE = fixture("gmail-confirm-success.html");

describe("confirmGmailForwarding presses the Confirm button (real Gmail pages)", () => {
  function recordingFetch(pages: string[]) {
    const calls: { url: string; method?: string; body?: unknown; headers?: unknown }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body, headers: init?.headers });
      const text = pages[Math.min(calls.length - 1, pages.length - 1)];
      return { status: 200, url, text: async () => text } as unknown as Response;
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("does NOT report success on the un-clicked confirm page alone — the live bug", () => {
    expect(isGmailConfirmSuccess(200, CONFIRM_PAGE)).toBe(false);
    expect(isGmailConfirmPage(CONFIRM_PAGE)).toBe(true);
  });

  it("reads the page Gmail returns AFTER the button as success", () => {
    expect(isGmailConfirmSuccess(200, SUCCESS_PAGE)).toBe(true);
    expect(isGmailConfirmPage(SUCCESS_PAGE)).toBe(false);
  });

  it("GETs the link, then POSTs the same url, and resolves true on the success page", async () => {
    const { impl, calls } = recordingFetch([CONFIRM_PAGE, SUCCESS_PAGE]);
    await expect(confirmGmailForwarding(VF_URL, impl)).resolves.toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe("GET");
    expect(calls[1].method).toBe("POST");
    expect(calls[1].url).toBe(VF_URL);
    expect(calls[1].body).toBe("");
    expect(calls[1].headers).toMatchObject({ "content-type": "application/x-www-form-urlencoded" });
  });

  it("resolves false when the POST comes back as the confirm page again — nothing was confirmed", async () => {
    const { impl, calls } = recordingFetch([CONFIRM_PAGE, CONFIRM_PAGE]);
    await expect(confirmGmailForwarding(VF_URL, impl)).resolves.toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("never POSTs to a page that is not Gmail's confirm form", async () => {
    const { impl, calls } = recordingFetch(["<html>Sign in to continue to Gmail.</html>"]);
    await expect(confirmGmailForwarding(VF_URL, impl)).resolves.toBe(false);
    expect(calls).toHaveLength(1);
  });
});
