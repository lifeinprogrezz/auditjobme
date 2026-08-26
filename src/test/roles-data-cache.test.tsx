// Pins the two halves of issue #152 (spec items E6 + F1): Settings must open
// instantly on a second visit, and a tab focus must not reload anything.
//
// The bug had two causes and this file pins one guard for each.
//   1. `useRolesData` keyed its load effect on the Supabase `user` OBJECT.
//      supabase-js (autoRefreshToken + persistSession) emits a NEW session — and
//      so a new User object — on every tab focus, so the whole set of reads ran
//      again each time the person came back to the tab.
//   2. Every read lived in component state, so navigating to /settings remounted
//      the hook and re-fetched the map artifact, applications, saved, dismissed,
//      connections and the profile. Settings gates on `profileChecked`, so the
//      person saw "Loading your profile…" on every single visit.
//
// Both guards count REAL fetches, not renders: a regression in either direction
// shows up as an extra read, which is the thing the person actually felt.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";

// ── Auth: the ONE thing the hook must not depend on by identity.
let currentUser: { id: string } | null = null;
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({
    user: currentUser as unknown as User | null,
    session: null,
    loading: false,
    signInWithGoogle: async () => {},
    signOut: async () => {},
  }),
  AUTH_BYPASSED: false,
}));

// ── The public map artifact.
const fetchDataplane = vi.fn();
vi.mock("@/lib/dataplane", () => ({
  fetchDataplane: (...args: unknown[]) => fetchDataplane(...args),
}));

// ── A minimal PostgREST stand-in. Counts one hit per `from(table)`, which is
// exactly one network read per table in these flows.
const reads: Record<string, number> = {};
const rowsByTable: Record<string, Record<string, unknown>[]> = {
  applications: [],
  saved_jobs: [],
  dismissed_jobs: [],
  connections: [],
  scores: [],
  score_batches: [],
  profiles: [
    {
      target_seniority: "senior",
      target_cities: ["Barcelona"],
      open_to_remote: true,
      citizenship: "ES",
      eu_work_authorized: true,
      languages: ["English"],
      cv_text: "a stored curriculum vitae",
      target_roles: ["product"],
      target_sectors: [],
      updated_at: "2026-08-01T00:00:00.000Z",
    },
  ],
};

function builderFor(table: string) {
  const rows = rowsByTable[table] ?? [];
  const result = { data: rows, error: null };
  const builder: Record<string, unknown> = {
    eq: () => builder,
    in: () => builder,
    limit: () => Promise.resolve(result),
    range: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    update: () => builder,
    upsert: () => Promise.resolve({ error: null }),
    insert: () => Promise.resolve({ error: null }),
    delete: () => builder,
    then: (res: (v: typeof result) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      reads[table] = (reads[table] ?? 0) + 1;
      return { select: () => builderFor(table), update: () => builderFor(table) };
    },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("@/components/ui/sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("@/lib/cvParse", () => ({
  parseAndSaveCv: async () => null,
  ensureCvStructured: async () => null,
  CV_STRUCTURED_CLEAR: {},
  isMissingCvStructuredColumn: () => false,
}));

// Imported after the mocks so the hook picks them up.
const { useRolesData } = await import("@/hooks/useRolesData");

const ARTIFACT = {
  version: 1,
  generated_at: "2026-08-26T05:00:00.000Z",
  counts: { jobs: 1, companies: 1, offices: 0 },
  jobs: [
    {
      id: "job-1",
      company: "Acme",
      title: "Product Manager",
      url: "https://example.invalid/jobs/1",
      location: "Barcelona, Spain",
      remote: false,
      source: "greenhouse",
      seniority: "mid",
      posted_at: "2026-08-20T00:00:00.000Z",
      first_seen_at: "2026-08-20T00:00:00.000Z",
      company_id: "acme",
      extraction: null,
      role_family: "product",
      workplace: "onsite",
      has_jd: true,
    },
  ],
  companies: [
    {
      slug: "acme",
      logo_domain: "acme.example",
      lat: null,
      lng: null,
      website: null,
      sector: "software",
      stage: null,
      headcount_bucket: null,
      hq_city: null,
      hq_country: null,
      linkedin_url: null,
      description: null,
      founded_year: null,
      uk_sponsor_status: null,
    },
  ],
  offices: [],
};

/** The SHARED reads — the map artifact plus the five own-row tables Settings and
 *  the map both need. score_batches is deliberately outside this set: it is the
 *  score poll's own one-row phase check (#149), which is meant to run per mount. */
const counts = (): Record<string, number> => {
  const { score_batches: _pollPhase, ...shared } = reads;
  return { dataplane: fetchDataplane.mock.calls.length, ...shared };
};

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** Let every queued fetch and its state commit settle. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe("useRolesData caches its reads (issue #152)", () => {
  beforeEach(() => {
    localStorage.clear();
    for (const k of Object.keys(reads)) delete reads[k];
    fetchDataplane.mockReset().mockResolvedValue(ARTIFACT);
    currentUser = { id: "user-1" };
  });

  it("a NEW user object with the same id re-runs nothing", async () => {
    const client = makeClient();
    const { result, rerender } = renderHook(() => useRolesData(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.profileChecked).toBe(true));
    await settle();
    const before = counts();
    expect(before.profiles).toBe(1);

    // Exactly what supabase-js does on a tab focus: same person, new object.
    const previous = currentUser;
    currentUser = { id: "user-1" };
    expect(currentUser).not.toBe(previous);
    rerender();
    await settle();

    expect(counts()).toEqual(before);
    expect(result.current.profileChecked).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("a different user id DOES load that person's own rows", async () => {
    const client = makeClient();
    const { result, rerender } = renderHook(() => useRolesData(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.profileChecked).toBe(true));
    await settle();
    const before = counts();

    currentUser = { id: "user-2" };
    rerender();
    await waitFor(() => expect(counts().profiles).toBe(before.profiles + 1));
    // The shared public pool is not re-fetched for the second person.
    expect(counts().dataplane).toBe(before.dataplane);
  });

  it("leaving Settings and coming back shows no loading gate", async () => {
    const client = makeClient();
    const first = renderHook(() => useRolesData(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(first.result.current.profileChecked).toBe(true));
    await settle();
    const before = counts();
    first.unmount();

    // Same QueryClient, exactly like navigating to another route and back.
    const second = renderHook(() => useRolesData(), { wrapper: wrapperFor(client) });
    // FIRST render, nothing awaited: this is the assertion Settings gates on.
    expect(second.result.current.profileChecked).toBe(true);
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.cvText).toBe("a stored curriculum vitae");
    await settle();
    expect(counts()).toEqual(before);
  });

  it("signed out, nothing personal is read and the profile gate stays shut", async () => {
    currentUser = null;
    const client = makeClient();
    const { result } = renderHook(() => useRolesData(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await settle();
    expect(counts().profiles).toBeUndefined();
    expect(result.current.profileChecked).toBe(false);
    expect(result.current.jobs).toHaveLength(1);
  });
});
