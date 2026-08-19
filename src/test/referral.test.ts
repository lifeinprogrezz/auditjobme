// Pins the client half of referral attribution (issue #78, attribution only — the
// reward half is blocked on #35). Two behaviours matter and both have failure modes
// that would silently lose the referral graph:
//   1. CAPTURE — `?ref={token}` must survive the sign-up flow. Google OAuth lands
//      back on the bare origin, so the token's only way across is localStorage; a
//      capture that drops it, or that accepts junk, breaks attribution or stores
//      garbage the RPC then rejects forever.
//   2. CLAIM — the stashed token fires exactly once against the server RPC: cleared
//      on any settled outcome (claimed or refused), kept ONLY on a transport error
//      so a flaky network retries instead of losing the attribution.
// The database half (server-only writes, one-referrer-per-referee, self-referral and
// stale-account refusals) is pinned in supabase/tests/assert_rls.sql.
import { describe, it, expect } from "vitest";
import {
  REF_STORAGE_KEY,
  captureRefToken,
  refTokenFromSearch,
  inviteLink,
  claimStoredReferral,
  type ClaimRpc,
  type RefStorage,
} from "@/lib/referral";

/** The 32-hex shape the server actually mints (a dashless uuid). Deliberately a
 *  repeated low-entropy pattern: a random-looking fixture trips the gitleaks
 *  secrets scanner, and the repo norm is fixing fixtures, not allowlisting them. */
const TOKEN = "0123456789abcdef0123456789abcdef";

function memStorage(initial: Record<string, string> = {}): RefStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("capture: ?ref survives the sign-up flow via localStorage", () => {
  it("stores a well-formed token from the landing URL", () => {
    const storage = memStorage();
    expect(captureRefToken(`?ref=${TOKEN}`, storage)).toBe(TOKEN);
    expect(storage.map.get(REF_STORAGE_KEY)).toBe(TOKEN);
  });

  it("captures among other query parameters and normalizes case", () => {
    expect(refTokenFromSearch(`?utm_source=x&ref=${TOKEN.toUpperCase()}&y=1`)).toBe(TOKEN);
  });

  it("a later link click overwrites an earlier capture (last invite followed wins)", () => {
    const storage = memStorage({ [REF_STORAGE_KEY]: "a".repeat(32) });
    captureRefToken(`?ref=${TOKEN}`, storage);
    expect(storage.map.get(REF_STORAGE_KEY)).toBe(TOKEN);
  });

  it("ignores absent, empty, and junk tokens — nothing is stored", () => {
    const storage = memStorage();
    for (const search of [
      "",
      "?utm_source=x",
      "?ref=",
      "?ref=short",
      "?ref=<script>alert(1)</script>",
      "?ref=not-hex-chars-here-not-hex-chars!!",
      `?ref=${"a".repeat(65)}`, // longer than any token we would ever mint
    ]) {
      expect(captureRefToken(search, storage)).toBe(null);
    }
    expect(storage.map.size).toBe(0);
  });

  it("swallows storage failures (private mode) instead of breaking the visit", () => {
    const broken: RefStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(captureRefToken(`?ref=${TOKEN}`, broken)).toBe(null);
  });
});

describe("invite link", () => {
  it("always mints against production with the ref parameter", () => {
    expect(inviteLink(TOKEN)).toBe(`https://northgoing.com/?ref=${TOKEN}`);
  });
});

describe("claim: fires once, clears on settled outcomes, retries on transport errors", () => {
  const rpcReturning =
    (data: unknown, error: { message: string } | null = null): ClaimRpc & { calls: { ref_token: string }[] } => {
      const calls: { ref_token: string }[] = [];
      const fn = async (_fn: "claim_referral", args: { ref_token: string }) => {
        calls.push(args);
        return { data, error };
      };
      return Object.assign(fn, { calls });
    };

  it("does nothing when no token is stashed", async () => {
    const rpc = rpcReturning(true);
    expect(await claimStoredReferral(rpc, memStorage())).toBe("none");
    expect(rpc.calls).toHaveLength(0);
  });

  it("hands the stashed token to the server RPC and clears it on success", async () => {
    const storage = memStorage({ [REF_STORAGE_KEY]: TOKEN });
    const rpc = rpcReturning(true);
    expect(await claimStoredReferral(rpc, storage)).toBe("claimed");
    expect(rpc.calls).toEqual([{ ref_token: TOKEN }]);
    expect(storage.map.has(REF_STORAGE_KEY)).toBe(false);
  });

  it("a server refusal (self-referral, stale account, already claimed) also clears — settled is settled", async () => {
    const storage = memStorage({ [REF_STORAGE_KEY]: TOKEN });
    expect(await claimStoredReferral(rpcReturning(false), storage)).toBe("refused");
    expect(storage.map.has(REF_STORAGE_KEY)).toBe(false);
  });

  it("keeps the token for a retry when the RPC errors (flaky network must not lose the attribution)", async () => {
    const storage = memStorage({ [REF_STORAGE_KEY]: TOKEN });
    expect(await claimStoredReferral(rpcReturning(null, { message: "fetch failed" }), storage)).toBe("retry");
    expect(storage.map.get(REF_STORAGE_KEY)).toBe(TOKEN);

    const throwing = (async () => { throw new Error("network"); }) as unknown as ClaimRpc;
    expect(await claimStoredReferral(throwing, storage)).toBe("retry");
    expect(storage.map.get(REF_STORAGE_KEY)).toBe(TOKEN);
  });

  it("discards a corrupted stash without calling the server", async () => {
    const storage = memStorage({ [REF_STORAGE_KEY]: "<not-a-token>" });
    const rpc = rpcReturning(true);
    expect(await claimStoredReferral(rpc, storage)).toBe("none");
    expect(rpc.calls).toHaveLength(0);
    expect(storage.map.has(REF_STORAGE_KEY)).toBe(false);
  });
});
