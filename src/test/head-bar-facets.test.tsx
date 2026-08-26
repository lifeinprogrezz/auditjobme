// Pins the headbar facet row's OPEN behaviour (HeadBar + FilterChip).
//
// The bug this exists to stop coming back (live UI verification, 2026-07-26): the
// row used to close every dropdown on scroll, which raced the browser's own
// scroll-into-view. Clicking a chip the row was clipping — always "UK sponsor" at
// 1920px — mounted the panel, then the focus scroll fired a frame later and closed
// it. The facet read as a dead button that only toggled its own pressed state.
// Rule + code move together: this test moves with HeadBar.tsx / FilterChip.tsx.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import HeadBar from "@/components/roles/HeadBar";
import { EMPTY_FILTERS } from "@/lib/roles";

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null, loading: false, signOut: vi.fn() }),
  AUTH_BYPASSED: false,
}));

const sponsorOptions = [
  { value: "licensed", label: "Licensed UK sponsor", count: 234 },
  { value: "unmatched", label: "Not on the UK register", count: 49 },
];

function renderBar(props: Partial<React.ComponentProps<typeof HeadBar>> = {}) {
  const onFilters = vi.fn();
  const utils = render(
    <MemoryRouter>
      <HeadBar
        scored={false}
        signedIn={false}
        filters={EMPTY_FILTERS}
        onFilters={onFilters}
        roleOptions={[]}
        levelOptions={[]}
        workplaceOptions={[]}
        cityOptions={[]}
        sectorOptions={[]}
        sizeOptions={[]}
        languageOptions={[]}
        freshnessOptions={[{ value: "7", label: "7 days", count: 101 }]}
        sponsorOptions={sponsorOptions}
        onClearAll={vi.fn()}
        onAddCv={vi.fn()}
        onSignIn={vi.fn()}
        onBrand={vi.fn()}
        onToggleMine={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onFilters, ...utils };
}

function openRow() {
  fireEvent.click(screen.getByRole("button", { name: /Filter/i }));
}

const chip = (label: string) => screen.getByText(label).closest(".fchip") as HTMLElement;
const row = () => document.querySelector(".fchips-inner") as HTMLElement;

describe("HeadBar facet row", () => {
  afterEach(cleanup);

  it("UK sponsor opens its options with live counts (the reported no-op)", () => {
    renderBar();
    openRow();
    fireEvent.click(chip("UK sponsor"));
    expect(screen.getByText("Licensed UK sponsor")).toBeInTheDocument();
    expect(screen.getByText("234")).toBeInTheDocument();
  });

  it("scrolling the row keeps the open dropdown mounted", () => {
    renderBar();
    openRow();
    fireEvent.click(chip("UK sponsor"));
    expect(document.querySelector(".fdrop-portal")).not.toBeNull();
    // What the browser does one frame after focusing a clipped chip.
    fireEvent.scroll(row(), { target: { scrollLeft: 364 } });
    expect(document.querySelector(".fdrop-portal")).not.toBeNull();
    expect(screen.getByText("Licensed UK sponsor")).toBeInTheDocument();
  });

  it("ticking an option reports the selection up (the filter actually filters)", () => {
    const { onFilters } = renderBar();
    openRow();
    fireEvent.click(chip("UK sponsor"));
    fireEvent.click(screen.getByText("Licensed UK sponsor").closest("label")!.querySelector("input")!);
    expect(onFilters).toHaveBeenCalledWith(expect.objectContaining({ sponsors: ["licensed"] }));
  });

  it("a click outside still closes it", () => {
    renderBar();
    openRow();
    fireEvent.click(chip("Freshness"));
    expect(document.querySelector(".fdrop-portal")).not.toBeNull();
    fireEvent.click(document.body);
    expect(document.querySelector(".fdrop-portal")).toBeNull();
  });
});

// ── Issue #154: the "Your matches" chip ────────────────────────────────────
describe("HeadBar — Your matches chip", () => {
  afterEach(cleanup);

  it("renders disabled (greyed, inert) for a logged-out visitor", () => {
    renderBar({ signedIn: false, scored: false });
    const btn = screen.getByRole("button", { name: "Your matches" });
    expect(btn).toBeDisabled();
    expect(btn.className).toContain("disabled");
  });

  it("renders disabled for a signed-in visitor with no CV on file", () => {
    renderBar({ signedIn: true, scored: false });
    expect(screen.getByRole("button", { name: "Your matches" })).toBeDisabled();
  });

  it("is enabled and reports the toggle up for a scored user", () => {
    const onToggleMine = vi.fn();
    renderBar({ signedIn: true, scored: true, onToggleMine });
    const btn = screen.getByRole("button", { name: "Your matches" });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onToggleMine).toHaveBeenCalledTimes(1);
  });

  it("shows the active state + dismiss × once the facet is on", () => {
    renderBar({ signedIn: true, scored: true, filters: { ...EMPTY_FILTERS, mine: true } });
    const btn = screen.getByRole("button", { name: /Your matches/ });
    expect(btn.className).toContain("active");
    expect(btn).toHaveTextContent("×");
  });

  // Issue #154 fix round 1, blocker 2: "Your matches" is scope, not a narrowing
  // filter (mirrors RolesMap's isDefaultView, which never counts filters.mine) —
  // so a scored user's RESTING DEFAULT state (mine on, nothing else set) must not
  // show "Clear all" as permanently active.
  it("'Clear all' stays inert when Your matches is the ONLY active thing", () => {
    renderBar({ signedIn: true, scored: true, filters: { ...EMPTY_FILTERS, mine: true } });
    openRow();
    const clearAll = screen.getByRole("button", { name: "Clear all filters" });
    expect(clearAll.className).toContain("disabled");
    expect(clearAll).toHaveAttribute("aria-disabled", "true");
  });

  it("'Clear all' still activates on a real filter even while Your matches is on", () => {
    renderBar({
      signedIn: true,
      scored: true,
      filters: { ...EMPTY_FILTERS, mine: true, cities: ["Berlin"] },
    });
    openRow();
    const clearAll = screen.getByRole("button", { name: "Clear all filters" });
    expect(clearAll.className).not.toContain("disabled");
    expect(clearAll).toHaveAttribute("aria-disabled", "false");
  });
});
