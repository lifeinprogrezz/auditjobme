import { describe, it, expect } from "vitest";
import { KICK_COOLDOWN_MS, bearerToken, createKickLimiter, kickRequestError, priorityJobId, PRIORITY_KICK_COOLDOWN_MS } from "@/lib/scoreKick";

// The kick endpoint spends money on behalf of one user (issue #149). These are
// the two gates in front of that spend: who may call, and how often. Both are
// pure so they can be held to a rule here rather than in production.

describe("bearerToken", () => {
  it("reads the token out of a Bearer header", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("  Bearer abc.def.ghi  ")).toBe("abc.def.ghi");
  });
  it.each([undefined, null, "", "abc.def.ghi", "Basic abc", "Bearer", "Bearer   "])(
    "returns null for %p",
    (header) => {
      expect(bearerToken(header as string | undefined)).toBeNull();
    },
  );
  it("refuses a repeated header rather than picking one", () => {
    expect(bearerToken(["Bearer a", "Bearer b"])).toBeNull();
  });
});

describe("kickRequestError — the anonymous caller can never trigger spend", () => {
  it("passes a POST that carries a token", () => {
    expect(kickRequestError("POST", "jwt")).toBeNull();
    expect(kickRequestError("post", "jwt")).toBeNull();
  });
  it("refuses a request with no token", () => {
    expect(kickRequestError("POST", null)).toEqual({ status: 401, error: "Unauthorized" });
  });
  it.each(["GET", "HEAD", "OPTIONS", undefined])("refuses %p, so a link or a prefetch cannot spend", (method) => {
    expect(kickRequestError(method, "jwt")).toEqual({ status: 405, error: "Method not allowed" });
  });
  it("judges the method before the token", () => {
    expect(kickRequestError("GET", null)?.status).toBe(405);
  });
});

describe("createKickLimiter — one kick per user per cooldown", () => {
  it("allows the first kick and refuses the next one inside the window", () => {
    const limiter = createKickLimiter();
    expect(limiter.take("u1", 0)).toEqual({ allowed: true, retryAfterMs: 0 });
    const second = limiter.take("u1", 30_000);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBe(KICK_COOLDOWN_MS - 30_000);
  });

  it("allows again once the window has passed", () => {
    const limiter = createKickLimiter();
    limiter.take("u1", 0);
    expect(limiter.take("u1", KICK_COOLDOWN_MS).allowed).toBe(true);
  });

  it("measures the window from the last ALLOWED kick, not from a refused one", () => {
    const limiter = createKickLimiter();
    limiter.take("u1", 0);
    limiter.take("u1", 90_000); // refused, must not restart the clock
    expect(limiter.take("u1", KICK_COOLDOWN_MS).allowed).toBe(true);
  });

  it("is per user: one user's kick never refuses another's", () => {
    const limiter = createKickLimiter();
    expect(limiter.take("u1", 0).allowed).toBe(true);
    expect(limiter.take("u2", 0).allowed).toBe(true);
  });

  it("prunes entries that can no longer refuse anything", () => {
    const limiter = createKickLimiter();
    limiter.take("u1", 0);
    limiter.take("u2", 0);
    expect(limiter.size()).toBe(2);
    limiter.take("u3", KICK_COOLDOWN_MS);
    expect(limiter.size()).toBe(1); // u1 and u2 aged out, only u3 is held
  });
});

// A kick that NAMES one role (Rober, 2026-08-28: "the user can ask for score this
// specific role"). The id reaches a database filter, so anything that is not a
// uuid is refused here and the request degrades to an ordinary whole-backlog kick.
describe("priorityJobId", () => {
  it("accepts a uuid, lowercased and trimmed", () => {
    expect(priorityJobId("87A817A9-0FFB-46DB-9D54-8BC2D3DB447E")).toBe(
      "87a817a9-0ffb-46db-9d54-8bc2d3db447e",
    );
    expect(priorityJobId("  87a817a9-0ffb-46db-9d54-8bc2d3db447e  ")).toBe(
      "87a817a9-0ffb-46db-9d54-8bc2d3db447e",
    );
  });

  it("refuses anything that is not a uuid (mutant: pass the raw value through)", () => {
    for (const bad of ["", "not-a-uuid", "1; drop table jobs", "87a817a9", 42, null, undefined, {}]) {
      expect(priorityJobId(bad)).toBeNull();
    }
  });

  it("treats an absent id as an ordinary kick rather than an error", () => {
    expect(priorityJobId(undefined)).toBeNull();
  });
});

describe("PRIORITY_KICK_COOLDOWN_MS", () => {
  it("is shorter than the whole-backlog window, or asking for a second role is refused", () => {
    expect(PRIORITY_KICK_COOLDOWN_MS).toBeLessThan(KICK_COOLDOWN_MS);
    expect(PRIORITY_KICK_COOLDOWN_MS).toBeGreaterThan(0);
  });

  it("lets a second named role through after its own window, on its own limiter", () => {
    const priority = createKickLimiter(PRIORITY_KICK_COOLDOWN_MS);
    expect(priority.take("u1", 0).allowed).toBe(true);
    expect(priority.take("u1", PRIORITY_KICK_COOLDOWN_MS - 1).allowed).toBe(false);
    expect(priority.take("u1", PRIORITY_KICK_COOLDOWN_MS).allowed).toBe(true);
  });
});
