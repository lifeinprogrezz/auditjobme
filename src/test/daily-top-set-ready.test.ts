// Pins useDailyTopSet's `ready` gate (issue #155 fix-round-1, blocker 1): the freeze
// write must be a complete no-op until the caller says every own-row read `top`
// depends on has landed. The freeze is immutable (no UPDATE/DELETE policy on
// daily_top_sets), so this is the one place a wrong freeze can be prevented rather
// than repaired. The formula itself (dailyTopSetReady) is pinned in product.test.ts;
// this file pins that the hook actually WIRES `ready` into the freeze effect.
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";

let currentUser: { id: string } | null = { id: "user-1" };
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: currentUser as unknown as User | null }),
}));

const inserted: Record<string, unknown>[] = [];

function builderFor() {
  const builder: Record<string, unknown> = {
    eq: () => builder,
    // No existing snapshot for today, on any read.
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => builderFor(),
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

const { useDailyTopSet } = await import("@/hooks/useDailyTopSet");

describe("useDailyTopSet ready gate", () => {
  it("never writes a freeze while ready is false, no matter how long it renders", async () => {
    inserted.length = 0;
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) => useDailyTopSet(["j1", "j2", "j3"], ready),
      { initialProps: { ready: false } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    // A few more renders with the same candidates, still not ready — the classic
    // shape of a cold load where the pool resolves well before the own-row reads.
    rerender({ ready: false });
    rerender({ ready: false });
    expect(inserted).toEqual([]);
    expect(result.current.snapshot).toBeNull();
  });

  it("freezes as soon as ready flips true, using the candidates in hand", async () => {
    inserted.length = 0;
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) => useDailyTopSet(["j1", "j2", "j3"], ready),
      { initialProps: { ready: false } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(inserted).toEqual([]);

    rerender({ ready: true });
    await waitFor(() => expect(inserted.length).toBe(1));
    expect(inserted[0].job_ids).toEqual(["j1", "j2", "j3"]);
    await waitFor(() => expect(result.current.snapshot?.jobIds).toEqual(["j1", "j2", "j3"]));
  });
});
