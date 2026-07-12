import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import FitChip from "@/components/roles/FitChip";
import { fitLabel } from "@/lib/roles";

describe("FitChip — the single score presentation (design direction §3.1)", () => {
  it("renders an ink numeral on the great bucket with the folded-in tier word", () => {
    const { container } = render(<FitChip score={4.6} size="md" />);
    const chip = container.querySelector(".fitchip") as HTMLElement;
    expect(chip.className).toContain("fitchip--md");
    expect(chip.className).toContain("fitchip--great");
    expect(chip.querySelector(".fitchip-n")?.textContent).toBe("4.6");
    expect(chip.querySelector(".fitchip-tier")?.textContent).toBe("Strong");
    // No glow/gradient object, no colored numeral — the numeral is the ink slot.
    expect(chip.querySelector(".fitchip-n")).not.toBeNull();
  });

  it("maps buckets to the locked tier words: great Strong · mid Fair · low Weak", () => {
    expect(
      (render(<FitChip score={4.2} />).container.querySelector(".fitchip-tier") as HTMLElement).textContent,
    ).toBe("Strong");
    expect(
      (render(<FitChip score={3.4} />).container.querySelector(".fitchip-tier") as HTMLElement).textContent,
    ).toBe("Fair");
    expect(
      (render(<FitChip score={2.1} />).container.querySelector(".fitchip-tier") as HTMLElement).textContent,
    ).toBe("Weak");
  });

  it("uses the bucket class so the wash follows the score token", () => {
    expect(render(<FitChip score={3.4} />).container.querySelector(".fitchip")?.className).toContain("fitchip--mid");
    expect(render(<FitChip score={2.1} />).container.querySelector(".fitchip")?.className).toContain("fitchip--low");
  });

  it("pending (null score) is a shimmer skeleton: em-dash, pending class, no tier", () => {
    const { container } = render(<FitChip score={null} size="sm" />);
    const chip = container.querySelector(".fitchip") as HTMLElement;
    expect(chip.className).toContain("fitchip--pending");
    expect(chip.className).toContain("fitchip--sm");
    expect(chip.querySelector(".fitchip-n")?.textContent).toBe("—");
    expect(chip.querySelector(".fitchip-tier")).toBeNull();
    expect(chip.className).not.toContain("fitchip--great");
  });

  it("shows the final value on an already-revealed mount, no count-up (banked D1 nit a)", () => {
    // A mount that is already revealed (filter change / show-more after the
    // reveal fired) must paint the real value, never a one-frame "0.0".
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const { container } = render(<FitChip score={4.6} size="md" reveal />);
    expect(container.querySelector(".fitchip-n")?.textContent).toBe("4.6");
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  it("fires the count-up only on a live pending→scored reveal transition", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const { container, rerender } = render(<FitChip score={null} reveal={false} />);
    expect(container.querySelector(".fitchip-n")?.textContent).toBe("—");
    expect(raf).not.toHaveBeenCalled();
    // Score lands and the reveal flips on in the same update → count-up plays.
    rerender(<FitChip score={4.6} reveal />);
    expect(raf).toHaveBeenCalled();
    raf.mockRestore();
  });

  it("hides the tier word when showTier is false, and the lg hero shows 'out of 5'", () => {
    expect(render(<FitChip score={4.6} showTier={false} />).container.querySelector(".fitchip-tier")).toBeNull();
    const lg = render(<FitChip score={4.6} size="lg" />).container;
    expect(lg.querySelector(".fitchip")?.className).toContain("fitchip--lg");
    expect(lg.querySelector(".fitchip-x")?.textContent).toBe("out of 5");
    // The lg block folds "out of 5" in, never a "/5" glyph inside the numeral.
    expect(lg.querySelector(".fitchip-n")?.textContent).toBe("4.6");
  });
});

describe("fitLabel — the locked copy matrix (design direction §3.5)", () => {
  it("great Strong fit · mid Fair fit · low Weak fit", () => {
    expect(fitLabel(4.5)).toBe("Strong fit");
    expect(fitLabel(4.0)).toBe("Strong fit");
    expect(fitLabel(3.2)).toBe("Fair fit");
    expect(fitLabel(2.0)).toBe("Weak fit");
  });
});
