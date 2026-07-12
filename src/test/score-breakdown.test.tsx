import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
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

describe("ScoreBreakdown viz (F1 explainable-score)", () => {
  it("renders one bar per rubric dimension, sized to the subscore", () => {
    const { container } = render(<ScoreBreakdown subscores={subs} evidence={[]} />);
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

  it("renders cited evidence rows with the right +/- direction and quotes", () => {
    const { container } = render(<ScoreBreakdown subscores={[]} evidence={evidence} />);
    const rows = container.querySelectorAll(".dev-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".dev-sign")?.textContent).toBe("+");
    expect(rows[0]).toHaveTextContent("grew GMV to $375M");
    expect(rows[0]).toHaveTextContent("two-sided marketplace");
    // the negative factor shows a down sign and, with both quotes blanked, no citations
    expect(rows[1].querySelector(".dev-sign.down")?.textContent).toBe("−");
    expect(rows[1].querySelector(".dev-cites")).toBeNull();
    // instead it shows the honest empty state (design direction §3.6) — never a
    // fabricated quote.
    expect(rows[1].querySelector(".dev-empty")?.textContent).toBe("— no signal");
  });

  it("renders nothing when there is neither a subscore nor evidence", () => {
    const { container } = render(<ScoreBreakdown subscores={null} evidence={null} />);
    expect(container.firstChild).toBeNull();
  });
});
