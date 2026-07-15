// ScoreBreakdown — the F1 explainable-score viz for the /roles detail panel
// (auditjob.me #38). Renders the two-layer score's inner workings: per-dimension
// rubric bars (the v4 subscores the deterministic blend is computed from) and the
// cited cv_line↔jd_phrase evidence rows (grounded before persistence). All styling
// comes from src/styles/roles.css (.roles-theme scope) on the ink-glass token layer;
// score semantics reuse the existing bucket colors (jade / amber / coral).
import { useState } from "react";
import { SUBSCORE_KEYS, type ScoreSubscore, type ScoreEvidence, type SubscoreKey } from "@/lib/scorePrompt";
import { scoreBucket } from "@/lib/roles";

/** Human, abbreviation-expanded labels for the five rubric dimensions. */
const DIM_LABELS: Record<SubscoreKey, string> = {
  seniority: "Seniority",
  geography: "Location",
  work_auth: "Work authorization",
  language: "Language",
  background: "Background & CV",
};

/** great = jade (no suffix), mid = amber, low = coral — the same buckets the pills use. */
function barClass(score: number): string {
  const b = scoreBucket(score);
  return b === "great" ? "dbar-fill" : `dbar-fill s-${b}`;
}

export default function ScoreBreakdown({
  subscores,
  evidence,
}: {
  subscores?: ScoreSubscore[] | null;
  evidence?: ScoreEvidence[] | null;
}) {
  // Order the bars by the rubric's own priority (SUBSCORE_KEYS), keeping only the
  // dimensions the model actually returned.
  const [open, setOpen] = useState(false);
  const byKey = new Map((subscores ?? []).map((s) => [s.key, s.score]));
  const bars = SUBSCORE_KEYS.filter((k) => byKey.has(k)).map((k) => ({
    key: k,
    label: DIM_LABELS[k],
    score: byKey.get(k) as number,
  }));
  // Order the cited factors by impact — most negative first — so a weak-fit role
  // leads with what pulled it down and the list reads in a consistent polarity
  // direction instead of the raw model order (Rober 7-15).
  const rows = (evidence ?? []).filter((e) => e.label).slice().sort((a, b) => a.contribution - b.contribution);

  if (bars.length === 0 && rows.length === 0) return null;

  return (
    <div className="dbreak">
      {/* ONE eyebrow over the whole card (design direction §5.3): the bars +
          evidence list are the same story under the single "What drove it"
          heading, which now toggles the detail open/closed — collapsed by
          default so the panel leads with just the label + summary (Rober 7-15). */}
      <button type="button" className="dbreak-h" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        What drove it
        <svg className="dbreak-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      {open && bars.length > 0 && (
        <>
          <div className="dbars">
            {bars.map((b) => (
              <div key={b.key} className="dbar-row">
                <span className="dbar-k">{b.label}</span>
                <span className="dbar-track">
                  <span
                    className={barClass(b.score)}
                    style={{ width: `${(Math.max(0, Math.min(5, b.score)) / 5) * 100}%` }}
                  />
                </span>
                <span className="dbar-v num">{b.score.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {open && rows.length > 0 && (
        <>
          <ul className="devlist">
            {rows.map((e, i) => {
              const up = e.contribution >= 0;
              return (
                <li key={i} className="dev-row">
                  <span className={"dev-sign" + (up ? "" : " down")} aria-hidden="true">
                    {up ? "+" : "−"}
                  </span>
                  <div className="dev-body">
                    <span className="dev-label">{e.label}</span>
                    {e.cvLine || e.jdPhrase ? (
                      <span className="dev-cites">
                        {e.cvLine && (
                          <span className="dev-cite">
                            <span className="dev-cite-k">Your CV</span>
                            <span className="dev-cite-q">“{e.cvLine}”</span>
                          </span>
                        )}
                        {e.jdPhrase && (
                          <span className="dev-cite">
                            <span className="dev-cite-k">The role</span>
                            <span className="dev-cite-q">“{e.jdPhrase}”</span>
                          </span>
                        )}
                      </span>
                    ) : (
                      // Honest empty state — never fabricate a quote (BRAND.md).
                      <span className="dev-empty">— no signal</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
