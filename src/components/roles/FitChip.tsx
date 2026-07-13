// FitChip — the SINGLE score presentation across every post-CV surface
// (design direction 2026-07-12 §3.1). Ink numeral on a subliminal bucket wash,
// tier word folded in ("4.6 · Strong"), radius 4, NO glow / gradient object.
// Replaces all three legacy render paths: the rail-card `.score` gradient pill,
// the detail-hero `.dhs` gradient block, and /today's bare colored numeral.
//
// One implementation, consumed everywhere. Styling lives in ONE global block,
// src/styles/fitchip.css, driven by the shared `--score-*` tokens (inherited
// from :root into both the page world and the `.roles-theme` map scope) plus a
// per-context `--fc-ink` / `--fc-muted` ink so the numeral reads charcoal on
// paper and pale-ink on the map without a second CSS copy.
import { useEffect, useRef, useState } from "react";
import { scoreBucket, type ScoreBucket } from "@/lib/roles";
import { prefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/** Locked tier words (design direction §3.1): great Strong · mid Fair · low Weak. */
const TIER_WORD: Record<ScoreBucket, string> = { great: "Strong", mid: "Fair", low: "Weak" };

export type FitChipSize = "sm" | "md" | "lg";

export type FitChipProps = {
  /** The 0–5 fit score, or null while it is still being computed (pending). */
  score: number | null;
  /** sm = list rows / today / tooltips · md = rail cards · lg = detail hero. */
  size?: FitChipSize;
  /** Fold the tier word in ("4.6 · Strong"); CSS hides it in narrow contexts. */
  showTier?: boolean;
  /**
   * Count the numeral up 0→score for the post-CV score-reveal moment: fires once
   * when `reveal` flips false→true, or when the score first lands (null→number)
   * while reveal is on. A mount that is already revealed with a value, or
   * reduced-motion, renders the final value with no animation.
   */
  reveal?: boolean;
};

/** Numeral that survives the pending→scored transition so the reveal count-up
 *  can play (power2.out, 900ms). Renders an em-dash while the score is null.
 *
 *  The initial display is ALWAYS the real value (never 0): a mount never
 *  animates — only a live pending→scored / reveal transition does, and that path
 *  drives the count-up from ~0 via requestAnimationFrame below. Seeding 0 here
 *  painted a one-frame "0.0" on any already-revealed mount (a filter change or
 *  show-more after the reveal already fired) — the banked D1 nit. */
function FitNumeral({ value, reveal }: { value: number | null; reveal: boolean }) {
  const [display, setDisplay] = useState<number | null>(value);
  const prevReveal = useRef(reveal);
  const prevValue = useRef(value);
  useEffect(() => {
    const wasReveal = prevReveal.current;
    const wasValue = prevValue.current;
    prevReveal.current = reveal;
    prevValue.current = value;
    if (value == null) {
      setDisplay(null);
      return;
    }
    const revealJustOn = reveal && !wasReveal;
    const valueJustLanded = wasValue == null && reveal;
    if ((revealJustOn || valueJustLanded) && !prefersReducedMotion()) {
      let raf = 0;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 900);
        setDisplay(value * (1 - (1 - t) * (1 - t)));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    setDisplay(value);
  }, [value, reveal]);
  return (
    <span className="fitchip-n" aria-hidden={value == null ? "true" : undefined}>
      {display == null ? "—" : display.toFixed(1)}
    </span>
  );
}

export default function FitChip({ score, size = "md", showTier = true, reveal = false }: FitChipProps) {
  const pending = score == null;
  const bucket: ScoreBucket | null = pending ? null : scoreBucket(score);
  const tier = bucket ? TIER_WORD[bucket] : null;
  return (
    <span
      className={`fitchip fitchip--${size} ${pending ? "fitchip--pending" : `fitchip--${bucket}`}`}
      aria-label={pending ? "Scoring" : `Fit ${score.toFixed(1)} out of 5, ${tier}`}
    >
      <FitNumeral value={score} reveal={reveal} />
      {!pending &&
        (size === "lg" ? (
          <span className="fitchip-x" aria-hidden="true">
            out of 5
          </span>
        ) : (
          showTier && (
            <span className="fitchip-tier" aria-hidden="true">
              {tier}
            </span>
          )
        ))}
    </span>
  );
}
