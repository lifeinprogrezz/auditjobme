// Today — the action-queue home (issue #42), rebuilt as a D-class PAPER page
// (design direction §5.5): opaque `--card` cards on the `--background` stage, the
// two-layer ink page shadow, page grain (via AppShell), the §2 type/spacing tokens,
// FitChip instead of any bare score numeral, theme-matched logos, and secondary row
// CTAs (one-primary law). Consumes the SHARED useRolesData path (server-written
// scores, full signals) — no client-side scoring loop. Honest copy kept verbatim.
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "@/components/app/AppShell";
import PaperLogo from "@/components/app/PaperLogo";
import { Button } from "@/components/ui/button";
import { useRolesData } from "@/hooks/useRolesData";
import { buildActionQueue, coverageSummary } from "@/lib/product";
import { geoVerdict, postedAgo, type RoleJob } from "@/lib/roles";
import FitChip from "@/components/roles/FitChip";

// §3.3 secondary CTA — the ONE idiom for every list-row action on this page (there is
// no second primary): control type (13/600), radius 10, a hairline ink/20 border that
// deepens to /30 on hover — a color shift only, never the shadcn `hover:bg-accent` fill
// jump. Overrides the stock Button variant so zero unmodified-shadcn boilerplate ships.
const SECONDARY_CTA =
  "rounded-[10px] border border-foreground/20 bg-transparent text-control font-semibold text-foreground hover:border-foreground/30 hover:bg-transparent hover:text-foreground";

function GeoBadge({ job }: { job: RoleJob }) {
  const v = geoVerdict(job);
  if (!v.onCard) return null;
  return (
    <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-caption font-medium text-muted-foreground">
      {v.label}
    </span>
  );
}

export default function Today() {
  const navigate = useNavigate();
  const { jobs, loading, scored, scoring, remaining, applied, markApplied, scoreMore } = useRolesData();

  const coverage = useMemo(() => coverageSummary(jobs), [jobs]);
  const aq = useMemo(() => buildActionQueue(jobs, applied), [jobs, applied]);

  const coverageLine = (
    <p className="mt-1 text-body text-muted-foreground text-pretty">
      Scanning {coverage.roles.toLocaleString()} live roles from {coverage.companies.toLocaleString()} companies
      across {coverage.sources.toLocaleString()} job sources, refreshed daily. It's a curated pool, not the whole
      internet.
    </p>
  );

  if (loading) {
    return (
      <AppShell title="Today">
        <p className="mt-6 text-body text-muted-foreground">Loading your roles…</p>
      </AppShell>
    );
  }

  if (!scored) {
    return (
      <AppShell title="Today">
        {coverageLine}
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-page">
          <h2 className="font-display text-section">See which roles fit you</h2>
          <p className="mt-2 text-body text-muted-foreground text-pretty">
            Add your CV on the map and we'll score every live role against your background overnight. Your matches
            show up right here.
          </p>
          <Button className="mt-5" onClick={() => navigate("/")}>
            Add your CV on the map
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Today">
      <p className="mt-1 text-body text-muted-foreground">
        <span className="font-medium text-foreground">{aq.scored.toLocaleString()}</span> roles scored against your
        profile.{" "}
        <span className="font-medium text-foreground">{aq.worthApplying.toLocaleString()}</span> look worth applying.
      </p>
      {coverageLine}

      {/* Status = whisper (design direction §3.4): an inline mono system line, never
          a filled banner — no fill, no border, no score hue. */}
      {scoring && (
        <p className="mt-6 font-mono text-caption text-muted-foreground" role="status" aria-live="polite">
          Scoring the pool against your profile · {remaining} to go. New matches drop in as they land.
        </p>
      )}

      {aq.queue.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 text-body text-muted-foreground shadow-page text-pretty">
          Nothing left in your queue right now. Everything scored is either applied or below your bar. Fresh roles
          arrive with tomorrow's scan.
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-4">
          {aq.queue.map((job) => {
            const ago = postedAgo(job.posted_at);
            const isApplied = applied.has(job.id);
            return (
              <li
                key={job.id}
                className="rounded-2xl border border-border bg-card p-6 shadow-page transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-px hover:border-foreground/20 hover:shadow-page-lift"
              >
                <div className="flex items-start gap-4">
                  <PaperLogo domain={job.domain} company={job.company} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-micro uppercase text-muted-foreground">{job.company}</span>
                      <GeoBadge job={job} />
                    </div>
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 block truncate font-display text-title text-foreground underline-offset-2 hover:underline text-balance"
                    >
                      {job.title}
                    </a>
                    <div className="mt-1 flex items-center gap-2 text-caption text-muted-foreground">
                      <span>{job.city ?? job.location ?? (job.remote ? "Remote" : "Location unknown")}</span>
                      {ago && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{ago}</span>
                        </>
                      )}
                    </div>
                    {job.reason && (
                      <p className="mt-2 line-clamp-2 text-dense text-muted-foreground text-pretty">{job.reason}</p>
                    )}
                  </div>
                  <FitChip score={job.score} size="sm" />
                </div>
                {/* Footer: exactly ONE secondary CTA ("Prepare application") plus a
                    meta-weight applied affordance — never a second button (design
                    direction §5.5 "one secondary CTA + meta" / §3.3 one-primary law).
                    "Mark applied" is a quiet muted text/check affordance, not a
                    bordered button. */}
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className={SECONDARY_CTA}
                    onClick={() => navigate(`/apply?job=${encodeURIComponent(job.url)}`)}
                  >
                    Prepare application
                  </Button>
                  {isApplied ? (
                    <span className="inline-flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      Applied
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => markApplied(job)}
                      className="inline-flex items-center gap-1.5 text-caption font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      Mark applied
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {scored && remaining > 0 && !scoring && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" size="sm" className={SECONDARY_CTA} onClick={scoreMore}>
            Check for new scores
          </Button>
        </div>
      )}
    </AppShell>
  );
}
