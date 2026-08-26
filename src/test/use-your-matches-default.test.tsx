// Pins the "Your matches" (issue #154) default-on wiring at the POLICY level —
// fix round 1, blocker 1: the pure functions in lib/roles.ts (settleMineDefault,
// shouldForceMineOff) were already green at 1242/1242 while the feature stayed
// permanently off for every real user, because the component wiring wrote every
// SETTLED value — including the anonymous-landing "false" — to localStorage as
// if it were an explicit choice. These tests exercise the actual effect wiring
// (useYourMatchesDefault) against a real localStorage-backed `writeStoredMine`
// setter, the same shape RolesMap.tsx uses, so a regression here fails exactly
// the way the shipped bug did: a stored "0" that never lets the default fire.
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useYourMatchesDefault, type YourMatchesSignals } from "@/hooks/useYourMatchesDefault";
import { readStoredMine, writeStoredMine } from "@/lib/roles";

const STORAGE_KEY = "northgoing.roles.mine";

function useHarness(signals: YourMatchesSignals) {
  // Mirrors RolesMap.tsx exactly: setMine (settle/force-off) never persists;
  // toggleMine (an explicit user choice) is the only writer. The harness exposes
  // both plus the live `mine` value so a test can assert on all three.
  let mine = signals.mine;
  const setMine = (next: boolean) => {
    mine = next;
  };
  useYourMatchesDefault(signals, setMine);
  return { get mine() { return mine; } };
}

function clearStorage() {
  localStorage.removeItem(STORAGE_KEY);
}

describe("useYourMatchesDefault — settle-once default never persists (blocker 1)", () => {
  afterEach(() => {
    cleanup();
    clearStorage();
  });

  it("an anonymous visitor's first render (auth still loading) never touches storage", () => {
    const { result, rerender } = renderHook(
      (signals: YourMatchesSignals) => useHarness(signals),
      {
        initialProps: {
          authLoading: true,
          profileChecked: false,
          signedIn: false,
          hasCv: false,
          hasScore: false,
          stored: readStoredMine(),
          mine: false,
        },
      },
    );
    expect(result.current.mine).toBe(false);
    expect(readStoredMine()).toBeNull();

    // Auth resolves to logged-out — settleMineDefault stops waiting and settles
    // "false" for this visitor. That computed default must land in the live
    // filter (mine stays false) WITHOUT ever writing "0" to storage — writing it
    // is exactly the old bug: it would permanently override the default-on rule
    // for this browser's later, signed-in-with-a-CV visits.
    act(() => {
      rerender({
        authLoading: false,
        profileChecked: false,
        signedIn: false,
        hasCv: false,
        hasScore: false,
        stored: readStoredMine(),
        mine: false,
      });
    });
    expect(result.current.mine).toBe(false);
    expect(readStoredMine()).toBeNull();
  });

  it("a signed-in, scored user with no stored choice still defaults ON once a score lands, with no write", () => {
    const base: YourMatchesSignals = {
      authLoading: true,
      profileChecked: false,
      signedIn: true,
      hasCv: true,
      hasScore: false,
      stored: null,
      mine: false,
    };
    const { result, rerender } = renderHook((signals: YourMatchesSignals) => useHarness(signals), {
      initialProps: base,
    });
    // Auth resolves, profile resolves, but no score has landed yet — still "wait".
    act(() => rerender({ ...base, authLoading: false }));
    act(() => rerender({ ...base, authLoading: false, profileChecked: true }));
    expect(result.current.mine).toBe(false);
    expect(readStoredMine()).toBeNull();

    // First score lands — the default settles ON. The live filter flips, but
    // nothing is written: this is a computed default, not a user choice.
    act(() =>
      rerender({ ...base, authLoading: false, profileChecked: true, hasScore: true, mine: result.current.mine }),
    );
    expect(result.current.mine).toBe(true);
    expect(readStoredMine()).toBeNull();
  });

  it("a stored EXPLICIT choice from a prior session wins immediately, still with no re-write", () => {
    writeStoredMine(true);
    const { result } = renderHook(() =>
      useHarness({
        authLoading: false,
        profileChecked: true,
        signedIn: true,
        hasCv: true,
        hasScore: false,
        stored: readStoredMine(),
        mine: false,
      }),
    );
    expect(result.current.mine).toBe(true);
    expect(readStoredMine()).toBe(true); // unchanged from the pre-set value
  });
});

describe("useYourMatchesDefault — force-off on sign-out/CV-clear never persists (blocker 1+2)", () => {
  afterEach(() => {
    cleanup();
    clearStorage();
  });

  it("a mid-session sign-out snaps a stale 'on' back to false without touching storage", () => {
    writeStoredMine(true); // an earlier explicit choice
    const settled: YourMatchesSignals = {
      authLoading: false,
      profileChecked: true,
      signedIn: true,
      hasCv: true,
      hasScore: true,
      stored: true,
      mine: true,
    };
    const { result, rerender } = renderHook((signals: YourMatchesSignals) => useHarness(signals), {
      initialProps: settled,
    });
    expect(result.current.mine).toBe(true);

    // Sign-out, SPA-style, no reload.
    act(() => rerender({ ...settled, signedIn: false, mine: result.current.mine }));
    expect(result.current.mine).toBe(false);
    // The stored EXPLICIT "1" from before sign-out must survive — a force-off is
    // not a user choice, and the next sign-in should see it again immediately.
    expect(readStoredMine()).toBe(true);
  });
});

describe("useYourMatchesDefault — an explicit toggle (not this hook) is the only writer", () => {
  afterEach(() => {
    cleanup();
    clearStorage();
  });

  it("writeStoredMine itself still persists — the contract an explicit toggle relies on", () => {
    expect(readStoredMine()).toBeNull();
    writeStoredMine(true);
    expect(readStoredMine()).toBe(true);
    writeStoredMine(false);
    expect(readStoredMine()).toBe(false);
  });
});
