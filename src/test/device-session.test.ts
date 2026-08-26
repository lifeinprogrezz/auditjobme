// Pins the returning-user device memory (sign-in shortcut, Rober 7-13): the
// "this device has held a session before" flag (stamped by AuthProvider on
// every session; no longer gates the CV modal's sign-in line — issue #158 / A1
// dropped that gate so a brand-new visitor sees it too) and the pure post-OAuth
// gate that keeps a CV mandatory for every signed-in user regardless of which
// door they entered through.
import { describe, it, expect, beforeEach } from "vitest";
import {
  SESSION_SEEN_KEY,
  markSessionSeen,
  hasSeenSession,
  shouldPromptCv,
} from "@/lib/deviceSession";

describe("session-seen device flag", () => {
  beforeEach(() => localStorage.clear());

  it("fresh device → hasSeenSession is false", () => {
    expect(hasSeenSession()).toBe(false);
  });

  it("markSessionSeen → hasSeenSession is true", () => {
    markSessionSeen();
    expect(hasSeenSession()).toBe(true);
    expect(localStorage.getItem(SESSION_SEEN_KEY)).not.toBeNull();
  });

  it("survives a sign-out (flag is independent of auth storage)", () => {
    markSessionSeen();
    // Sign-out clears supabase's own keys, never ours — simulate that.
    localStorage.removeItem("sb-anything-auth-token");
    expect(hasSeenSession()).toBe(true);
  });

  it("garbage in the slot reads as false, not a throw", () => {
    localStorage.setItem(SESSION_SEEN_KEY, "");
    expect(hasSeenSession()).toBe(false);
  });
});

describe("shouldPromptCv (post-sign-in CV gate)", () => {
  const base = { signedIn: true, profileChecked: true, hasCv: false, stashPending: false };

  it("signed in, profile checked, no CV, no stash → prompt", () => {
    expect(shouldPromptCv(base)).toBe(true);
  });

  it("anonymous → never prompts (the front door already IS the CV modal)", () => {
    expect(shouldPromptCv({ ...base, signedIn: false })).toBe(false);
  });

  it("profile not yet loaded → no prompt (avoids a flash mid-load)", () => {
    expect(shouldPromptCv({ ...base, profileChecked: false })).toBe(false);
  });

  it("CV on file → no prompt", () => {
    expect(shouldPromptCv({ ...base, hasCv: true })).toBe(false);
  });

  it("stash pending from the pre-redirect drop → no prompt (handoff will fill it)", () => {
    expect(shouldPromptCv({ ...base, stashPending: true })).toBe(false);
  });
});
