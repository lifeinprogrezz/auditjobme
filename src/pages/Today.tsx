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
  const { jobs, loading, scored, scoring, remaining, applied, markApplied, saved, savedJobs, toggleSaved, scoreMore } =
    useRolesData();

  const coverage = useMemo(() => coverageSummary(jobs), [jobs]);
  const aq = useMemo(() => buildActionQueue(jobs, applied), [jobs, applied]);
  // Saved roles get their own section; keep them out of the action queue so a
  // saved-but-not-applied role doesn't render twice on the page (Rober 7-15 review).
  const queue = useMemo(() => aq.queue.filter((j) => !saved.has(j.id)), [aq.queue, saved]);
  // Page structure (Rober 7-16): Saved → the 10 to apply TODAY (ranked) → the rest.
  const top = queue.slice(0, 10);
  const more = queue.slice(10);

  const coverageLine = (
    <p className="text-body text-muted-foreground text-pretty">
      The roles worth your time, refreshed every morning from{" "}
      {coverage.roles.toLocaleString()} live openings across {coverage.companies.toLocaleString()} companies. A
      curated pool, not the whole internet.
    </p>
  );

  if (loading) {
    return (
      <AppShell>
        <p className="text-body text-muted-foreground">Loading your roles…</p>
      </AppShell>
    );
  }

  if (!scored) {
    return (
      <AppShell>
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
    <AppShell>
      {/* No h1, no tagline (Rober 7-16, direction 1): the nav already says where you
          are. One outcome-first opening line — no stats parade — then straight into
          the sections. */}
      <p className="text-body text-muted-foreground">
        <span className="font-semibold text-foreground">Your matches for today</span>, refreshed every morning.
      </p>
      {scoring && (
        <p className="mt-3 font-mono text-caption text-muted-foreground" role="status" aria-live="polite">
          Scoring the pool against your profile · {remaining} to go. New matches drop in as they land.
        </p>
      )}

      {savedJobs.length > 0 && (
        <section className="mt-8">
          {/* Section headings carry the page's wayfinding — full display size in ink,
              not micro-caps whispers (Rober 7-16: they were too hard to find). */}
          <h2 className="font-display text-section text-foreground">Saved</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {/* The CARD opens the prep page (Rober 7-16); only the role title itself
                links out to the posting. The inner link/button opt out via closest(). */}
            {savedJobs.map((job) => (
              <li
                key={job.id}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a,button")) return;
                  navigate(`/apply?job=${encodeURIComponent(job.url)}`);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || (e.target as HTMLElement).closest("a,button")) return;
                  navigate(`/apply?job=${encodeURIComponent(job.url)}`);
                }}
                className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-page transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-px hover:border-foreground/20 hover:shadow-page-lift"
              >
                <PaperLogo domain={job.domain} company={job.company} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-micro uppercase text-muted-foreground">{job.company}</div>
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate font-display text-body text-foreground underline-offset-2 hover:underline"
                  >
                    {job.title}
                  </a>
                  <div className="text-caption text-muted-foreground">
                    {job.city ?? job.location ?? (job.remote ? "Remote" : "Location unknown")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleSaved(job)}
                  aria-label="Remove from saved"
                  className="inline-flex shrink-0 items-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {queue.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 text-body text-muted-foreground shadow-page text-pretty">
          Nothing left in your queue right now. Everything scored is either applied or below your bar. Fresh roles
          arrive with tomorrow's scan.
        </div>
      ) : (
        <>
          {[
            { heading: `Top ${Math.min(10, queue.length)} to apply today`, items: top, ranked: true },
            // No count on the tail (Rober 7-16) — just scroll to the end.
            ...(more.length > 0 ? [{ heading: "More matches", items: more, ranked: false }] : []),
          ].map((sec) => (
            <section key={sec.heading} className="mt-8">
              <h2 className="font-display text-section text-foreground">{sec.heading}</h2>
              <ol className="mt-3 flex flex-col gap-4">
                {sec.items.map((job, i) => {
            const rank = sec.ranked ? i + 1 : null;
            const ago = postedAgo(job.posted_at);
            const isApplied = applied.has(job.id);
            const isSaved = saved.has(job.id);
            return (
              <li
                key={job.id}
                className="rounded-2xl border border-border bg-card p-6 shadow-page transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-px hover:border-foreground/20 hover:shadow-page-lift"
              >
                <div className="flex items-start gap-4">
                  {rank != null && (
                    <span className="w-5 shrink-0 pt-2.5 text-right font-mono text-caption tabular-nums text-muted-foreground" aria-hidden="true">
                      {rank}
                    </span>
                  )}
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
                    {/* The "why you" line is the Top 10's earned privilege; the
                        More-matches tail stays a scannable index without it, same as
                        Saved (Rober 7-16). The full reasoning lives on the prep page. */}
                    {sec.ranked && job.reason && (
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
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleSaved(job)}
                      aria-pressed={isSaved}
                      className="inline-flex items-center gap-1.5 text-caption font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                        <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
                      </svg>
                      {isSaved ? "Saved" : "Save"}
                    </button>
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
                </div>
              </li>
            );
                })}
              </ol>
            </section>
          ))}
        </>
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
