// Scoring progress (issue #149, spec items A7 + C2) — one component, two homes.
//
// It replaces the plain "N to go" whisper in the map rail and the one-sentence
// version on the Today tab, so both read the same phase off the same numbers and
// cannot drift. The phase rules and every string live in src/lib/scoringProgress.ts
// (pure, pinned by src/test/scoring-progress.test.ts); this file is the timers and
// the two class sets.
//
// Three things it deliberately does NOT do:
//   - no spinner-only state: a bar always carries a real fraction of a real count;
//   - no invented estimate: the time left comes from the pace measured in front of
//     this viewer, and renders as nothing at all until that pace is measurable;
//   - no new aesthetics: the rail reuses the .pprog typography from roles.css, the
//     page reuses the Today caption tokens.
import { useEffect, useRef, useState } from "react";
import {
  DONE_VISIBLE_MS,
  estimateRemainingMs,
  formatRemaining,
  scoringProgressOf,
} from "@/lib/scoringProgress";

/** How often the component re-reads the clock. The phase can change with time
 *  alone (quiet long enough = collecting; done long enough = hidden), so a poll
 *  tick of its own is what keeps those honest between the 20 s score polls. */
const TICK_MS = 1_000;

type Variant = "rail" | "page";

export type ScoringProgressProps = {
  /** "rail" = the map panel header (roles.css, glass). "page" = Today (tokens). */
  variant: Variant;
  /** The user has a CV on file. Nothing renders without one. */
  hasCv: boolean;
  /** The map data and the profile have settled, so `total` is a real answer. */
  ready: boolean;
  /** Roles in the paid slice (the #114 prefilter), as the client counts them. */
  total: number;
  /** Roles in that slice that already hold a score. */
  scored: number;
  /** The user has a score_batches row still in `submitted` (own-row select). */
  batchPending: boolean;
};

const CLASSES: Record<Variant, { root: string; track: string; fill: string; label: string }> = {
  rail: {
    root: "sprog",
    track: "sprog-track",
    fill: "sprog-fill",
    label: "sprog-label num",
  },
  page: {
    root: "mt-3 flex items-center gap-3",
    track: "h-1 w-28 shrink-0 overflow-hidden rounded-full bg-foreground/10",
    fill: "h-full rounded-full bg-foreground/45 transition-[width] duration-500",
    label: "font-mono text-caption text-muted-foreground",
  },
};

export function ScoringProgress({
  variant,
  hasCv,
  ready,
  total,
  scored,
  batchPending,
}: ScoringProgressProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Where this viewer's session started, so the pace is measured from what they
  // have actually watched. A page opened halfway through a pass projects from its
  // own window rather than from a rate it never saw.
  const startRef = useRef<{ at: number; scored: number } | null>(null);
  // When a score last landed. Seeded at mount: "quiet since you got here" is the
  // same question as "quiet since the last score" for a viewer who has seen none.
  const lastLandedAtRef = useRef<number | null>(null);
  // Only announce completion to somebody who watched it happen.
  const sawIncompleteRef = useRef(false);
  const [doneAt, setDoneAt] = useState<number | null>(null);

  useEffect(() => {
    if (!hasCv) {
      startRef.current = null;
      lastLandedAtRef.current = null;
      sawIncompleteRef.current = false;
      setDoneAt(null);
      return;
    }
    const now = Date.now();
    if (startRef.current === null) startRef.current = { at: now, scored };
    const previous = lastLandedAtRef.current;
    if (previous === null) lastLandedAtRef.current = now;
  }, [hasCv, scored]);

  // A landing resets the quiet clock. Split from the effect above so the mount
  // seed cannot be mistaken for a landing.
  const previousScoredRef = useRef(scored);
  useEffect(() => {
    if (scored > previousScoredRef.current) lastLandedAtRef.current = Date.now();
    previousScoredRef.current = scored;
  }, [scored]);

  const complete = total > 0 && scored >= total;
  useEffect(() => {
    if (!hasCv || total <= 0) return;
    if (!complete) {
      sawIncompleteRef.current = true;
      setDoneAt(null);
      return;
    }
    if (sawIncompleteRef.current) setDoneAt((at) => at ?? Date.now());
  }, [hasCv, total, complete]);

  const ticking = hasCv && (!complete || doneAt !== null);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [ticking]);

  if (!hasCv) return null;
  // Already finished when this viewer arrived: there is no progress to report.
  if (complete && doneAt === null) return null;
  if (complete && doneAt !== null && nowMs - doneAt >= DONE_VISIBLE_MS) return null;

  const view = scoringProgressOf({
    hasCv,
    ready,
    total,
    scored,
    batchPending,
    sinceLastScoreMs: nowMs - (lastLandedAtRef.current ?? nowMs),
  });
  if (!view) return null;

  // The estimate belongs to the synchronous phase only. A submitted batch has no
  // latency guarantee from the provider, so projecting one would be a guess.
  // The rail keeps it off too: that header is one compact line beside the title.
  const remainingMs =
    variant === "page" && view.phase === "scoring" && startRef.current
      ? estimateRemainingMs({
          landed: scored - startRef.current.scored,
          elapsedMs: nowMs - startRef.current.at,
          remaining: view.total - view.scored,
        })
      : null;

  const parts = [view.headline, view.detail, remainingMs === null ? null : formatRemaining(remainingMs)];
  const classes = CLASSES[variant];
  return (
    <div className={classes.root} role="status" aria-live="polite">
      <div className={classes.track} aria-hidden="true">
        <div className={classes.fill} style={{ width: `${Math.round(view.fraction * 100)}%` }} />
      </div>
      <span className={classes.label}>{parts.filter(Boolean).join(" · ")}</span>
    </div>
  );
}

export default ScoringProgress;
