import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import ScoreBreakdown from "@/components/roles/ScoreBreakdown";
import type { ScoreSubscore, ScoreEvidence } from "@/lib/scorePrompt";

const subs: ScoreSubscore[] = [
  { key: "seniority", score: 4.5 },
  { key: "geography", score: 2.0 },
  { key: "work_auth", score: 5 },
  { key: "language", score: 3 },
  { key: "background", score: 4.8 },
];
const evidence: ScoreEvidence[] = [
  { label: "Marketplace experience", cvLine: "grew GMV to $375M", jdPhrase: "two-sided marketplace", contribution: 0.9 },
  { label: "Seniority gap", cvLine: "", jdPhrase: "", contribution: -0.4 },
];

/** The "What drove it" detail is collapsed by default (Rober 7-15) — click to open. */
function expand(container: HTMLElement) {
  fireEvent.click(container.querySelector(".dbreak-h") as HTMLButtonElement);
}

describe("ScoreBreakdown viz (F1 explainable-score)", () => {
  it("keeps the breakdown collapsed until the What-drove-it toggle is clicked", () => {
    const { container } = render(<ScoreBreakdown subscores={subs} evidence={evidence} />);
    // Collapsed by default: the toggle is there, the detail is not.
    expect(container.querySelector(".dbreak-h")).not.toBeNull();
    expect(container.querySelectorAll(".dbar-row")).toHaveLength(0);
    expect(container.querySelectorAll(".dev-row")).toHaveLength(0);
    expand(container);
    expect(container.querySelectorAll(".dbar-row")).toHaveLength(5);
    expect(container.querySelectorAll(".dev-row")).toHaveLength(2);
  });

  it("renders one bar per rubric dimension, sized to the subscore", () => {
    const { container } = render(<ScoreBreakdown subscores={subs} evidence={[]} />);
    expand(container);
    const bars = container.querySelectorAll(".dbar-row");
    expect(bars).toHaveLength(5);
    // dimensions render in rubric priority order (seniority first, background last)
    expect(bars[0].querySelector(".dbar-k")?.textContent).toBe("Seniority");
    expect(bars[4].querySelector(".dbar-k")?.textContent).toBe("Background & CV");
    // geography=2.0/5 → 40% width; jade bucket for background (4.8 ≥ 4) has no suffix
    const geoFill = bars[1].querySelector(".dbar-fill") as HTMLElement;
    expect(geoFill.style.width).toBe("40%");
    expect(geoFill.className).toContain("s-low"); // 2.0 < 3 → coral
    expect((bars[4].querySelector(".dbar-fill") as HTMLElement).className).not.toContain("s-");
  });

  it("orders cited evidence most-negative-first, with the right +/- direction and quotes", () => {
    const { container } = render(<ScoreBreakdown subscores={[]} evidence={evidence} />);
    expand(container);
    const rows = container.querySelectorAll(".dev-row");
    expect(rows).toHaveLength(2);
    // Impact order (Rober 7-15): the negative factor (-0.4) sorts ABOVE the positive (0.9),
    // so a weak-fit role leads with what pulled it down.
    expect(rows[0].querySelector(".dev-sign.down")?.textContent).toBe("−");
    // with both quotes blanked it shows the honest empty state, never a fabricated quote
    expect(rows[0].querySelector(".dev-cites")).toBeNull();
    expect(rows[0].querySelector(".dev-empty")?.textContent).toBe("— no signal");
    // the positive marketplace factor now renders second, with both quotes
    expect(rows[1].querySelector(".dev-sign")?.textContent).toBe("+");
    expect(rows[1]).toHaveTextContent("grew GMV to $375M");
    expect(rows[1]).toHaveTextContent("two-sided marketplace");
  });

  it("renders nothing when there is neither a subscore nor evidence", () => {
    const { container } = render(<ScoreBreakdown subscores={null} evidence={null} />);
    expect(container.firstChild).toBeNull();
  });
});
