// Pins the logged-out role detail's "Sign in" button (issue #158 / A1): the
// only call to action used to be "Add your CV to see your fit" — a returning
// visitor who forgot they were signed out had no way back in from the detail,
// only from the map header.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import RolesPanel from "@/components/roles/RolesPanel";
import { EMPTY_FILTERS } from "@/lib/roles";
import type { RoleJob } from "@/lib/roles";

vi.mock("@/lib/logodev", () => ({
  logoUrl: () => null,
  faviconUrls: () => [],
}));

function job(partial: Partial<RoleJob> & { id: string; title: string }): RoleJob {
  return {
    company: "Acme",
    url: "https://example.com",
    location: "Berlin",
    remote: false,
    source: null,
    seniority: null,
    posted_at: null,
    score: null,
    reason: null,
    city: "Berlin",
    lngLat: null,
    domain: null,
    sector: null,
    ...partial,
  } as RoleJob;
}

function renderPanel(overrides: { signedIn: boolean; scored: boolean; onSignIn?: () => void }) {
  const detailJob = job({ id: "1", title: "Product Manager" });
  render(
    <MemoryRouter>
      <RolesPanel
        jobs={[detailJob]}
        allJobs={[detailJob]}
        scored={overrides.scored}
        signedIn={overrides.signedIn}
        loading={false}
        scoring={false}
        remaining={0}
        eligibleCount={0}
        batchPending={false}
        eligibleIds={new Set()}
        detailJob={detailJob}
        applied={new Set()}
        saved={new Set()}
        dismissed={new Set()}
        onToggleDismissed={vi.fn()}
        onOpenDetail={vi.fn()}
        onCloseDetail={vi.fn()}
        onScoreMore={vi.fn()}
        onToggleSaved={vi.fn()}
        onToggleHidden={vi.fn()}
        onAddCv={vi.fn()}
        onSignIn={overrides.onSignIn}
        filters={EMPTY_FILTERS}
        onFilters={vi.fn()}
        onToggleMine={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("RolesPanel detail — Sign in beside Add your CV when logged out", () => {
  afterEach(cleanup);

  it("logged out, no CV → shows Sign in beside Add your CV", () => {
    const onSignIn = vi.fn();
    renderPanel({ signedIn: false, scored: false, onSignIn });
    expect(screen.getByText("Add your CV to see your fit")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("signed in, no CV yet → no Sign in button (already signed in)", () => {
    renderPanel({ signedIn: true, scored: false, onSignIn: vi.fn() });
    expect(screen.getByText("Add your CV to see your fit")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });
});
