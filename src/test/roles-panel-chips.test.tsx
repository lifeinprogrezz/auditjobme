// Pins the "narrowing chips under the heading" row (issue #154 fix round 1,
// blocker 3): every headbar facet mirrors into a removable chip in the panel
// EXCEPT Role and Language, which activeChips (RolesPanel.tsx) never listed —
// so the issue's own worked example ("Your matches — Product x") never
// rendered ("Product" there = the "product" role_family, whose display label
// is "Product Manager" — see ROLE_FAMILY_LABELS in scorePrompt.ts). Rule +
// code move together: this test moves with RolesPanel.tsx.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import RolesPanel from "@/components/roles/RolesPanel";
import { EMPTY_FILTERS, type RolesFilters } from "@/lib/roles";

vi.mock("@/lib/logodev", () => ({
  logoUrl: () => null,
  faviconUrls: () => [],
}));

function renderPanel(filters: RolesFilters) {
  const onFilters = vi.fn();
  render(
    <MemoryRouter>
      <RolesPanel
        jobs={[]}
        allJobs={[]}
        scored={false}
        signedIn={false}
        loading={false}
        scoring={false}
        remaining={0}
        eligibleCount={0}
        batchPending={false}
        eligibleIds={new Set()}
        detailJob={null}
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
        filters={filters}
        onFilters={onFilters}
        onToggleMine={vi.fn()}
      />
    </MemoryRouter>,
  );
  return { onFilters };
}

describe("RolesPanel activeChips — Role + Language facets (issue #154 blocker 3)", () => {
  afterEach(cleanup);

  it("renders a chip for a selected Role facet, with the Title-Case label", () => {
    renderPanel({ ...EMPTY_FILTERS, roles: ["product"] });
    expect(screen.getByText("Product Manager")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove Product Manager filter/i })).toBeInTheDocument();
  });

  it("falls back to 'Other' for the unlabelled-family bucket", () => {
    renderPanel({ ...EMPTY_FILTERS, roles: ["other"] });
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("renders a chip for a selected Language facet", () => {
    renderPanel({ ...EMPTY_FILTERS, languages: ["German"] });
    expect(screen.getByText("German")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove German filter/i })).toBeInTheDocument();
  });

  it("removing a Role chip clears only that value from filters.roles", () => {
    const { onFilters } = renderPanel({ ...EMPTY_FILTERS, roles: ["product", "sales"] });
    screen.getByRole("button", { name: /Remove Product Manager filter/i }).click();
    expect(onFilters).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ["sales"] }),
    );
  });
});

// Issue #154 fix round 1, blocker 2: "Clear all" (inside the panel's own chip row,
// distinct from the headbar's) must preserve "Your matches" — it is scope, not a
// narrowing filter — instead of silently turning it off.
describe("RolesPanel clearAllFilters — preserves 'Your matches' (issue #154 blocker 2)", () => {
  afterEach(cleanup);

  it("keeps filters.mine=true when 'Clear all' is pressed inside the panel", () => {
    const { onFilters } = renderPanel({ ...EMPTY_FILTERS, mine: true, cities: ["Berlin"], sizes: ["51-200"] });
    screen.getByRole("button", { name: "Clear all" }).click();
    expect(onFilters).toHaveBeenCalledWith(expect.objectContaining({ mine: true, cities: [], sizes: [] }));
  });
});
