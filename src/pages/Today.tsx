// Today — the action-queue home (issue #42), rebuilt as a D-class PAPER page
// (design direction §5.5): opaque `--card` cards on the `--background` stage, the
// two-layer ink page shadow, page grain (via AppShell), the §2 type/spacing tokens,
// FitChip instead of any bare score numeral, theme-matched logos, and secondary row
// CTAs (one-primary law). Consumes the SHARED useRolesData path (server-written
// scores, full signals) — no client-side scoring loop. Honest copy kept verbatim.
//
// Page structure (issues #72 + #73): New (the nightly batch the email just sent,
// read back from daily_matches) → Saved → Your top matches (the whole live scored
// pool, one row per company) → More matches.
import { useMemo, useState } from "react";
import { useRevealOnScroll } from "@/hooks/useRevealOnScroll";
import { useNavigate } from "react-router";
import AppShell from "@/components/app/AppShell";
import PaperLogo from "@/components/app/PaperLogo";
import { Button } from "@/components/ui/button";
import { useRolesData } from "@/hooks/useRolesData";
import { useDailyMatches } from "@/hooks/useDailyMatches";
import {
  buildActionQueue,
  coverageSummary,
  newSectionHeading,
  resolveBatchJobs,
  type QueueEntry,
} from "@/lib/product";
import { geoVerdict, postedAgo, type RoleJob } from "@/lib/roles";
import { warmContactsFor, warmMarkerLabel } from "@/lib/connections";
import { RUBRIC_VERSION } from "@/lib/score";
import { DEV_FIXTURE, devFixtureBatch } from "@/lib/devFixture";
import FitChip from "@/components/roles/FitChip";
import { hasReadableJd, pendingLabelOf, scoreStatusOf } from "@/lib/scorePrefilter";

// §3.3 secondary CTA — the ONE idiom for every list-row action on this page (there is
// no second primary): control type (13/600), radius 10, a hairline ink/20 border that
// deepens to /30 on hover — a color shift only, never the shadcn `hover:bg-accent` fill
// jump. Overrides the stock Button variant so zero unmodified-shadcn boilerplate ships.
const SECONDARY_CTA =
  "rounded-[10px] border border-foreground/20 bg-transparent text-control font-semibold text-foreground hover:border-foreground/30 hover:bg-transparent hover:text-foreground";

// The quiet meta-weight affordance idiom shared by every row-footer control
// (Save / Mark applied / Not interested) and the "+N more" toggle — muted caption
// text, never button chrome (§5.5 "one secondary CTA + meta").
const ROW_META_ACTION =
  "inline-flex items-center gap-1.5 text-caption font-medium text-muted-foreground transition-colors hover:text-foreground";

function GeoBadge({ job }: { job: RoleJob }) {
  const v = geoVerdict(job);
  if (!v.onCard) return null;
  return (
    <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-caption font-medium text-muted-foreground">
      {v.label}
    </span>
  );
}

function locationOf(job: RoleJob): string {
  return job.city ?? job.location ?? (job.remote ? "Remote" : "Location unknown");
}

export default function Today() {
  const navigate = useNavigate();
  const {
    jobs,
    loading,
    scored,
    scoring,
    remaining,
    eligibleIds,
    applied,
    markApplied,
    saved,
    savedJobs,
    toggleSaved,
    dismissed,
    toggleDismissed,
    inFlightCompanies,
    warmIndex,
    scoreMore,
  } = useRolesData();
  const daily = useDailyMatches();
  // Dev-only (VITE_E2E_BYPASS_AUTH under vite dev): daily_matches is an own-row read
  // the mock user can't make, so the New section never rendered and had no live
  // verification coverage. Synthesize tonight's batch over the real pool instead.
  // Folded out of production builds — see lib/devFixture.ts.
  const batch = useMemo(() => {
    if (!DEV_FIXTURE || daily.loading || daily.rows.length > 0) return daily;
    const batchDate = new Date().toISOString().slice(0, 10);
    return { batchDate, rows: devFixtureBatch(jobs, batchDate, RUBRIC_VERSION), loading: false };
  }, [daily, jobs]);
  // Which "+N more from {company}" lists are open, keyed by the row's job id.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const coverage = useMemo(() => coverageSummary(jobs), [jobs]);
  // The nightly batch the email just sent (issue #72 slice 1): the SAME roles, read
  // back from daily_matches, so the email and the app finally tell one story. Applied
  // and dismissed roles drop out — this is a to-do list, not an archive.
  const newJobs = useMemo(
    () =>
      resolveBatchJobs(batch.rows, jobs, {
        appliedIds: applied,
        dismissedIds: dismissed,
        rubricVersion: RUBRIC_VERSION,
      }),
    [batch.rows, jobs, applied, dismissed],
  );
  const newHeading = useMemo(() => newSectionHeading(batch.batchDate), [batch.batchDate]);
  const aq = useMemo(
    () => buildActionQueue(jobs, applied, { dismissedIds: dismissed, inFlightCompanies }),
    [jobs, applied, dismissed, inFlightCompanies],
  );
  // Saved roles and tonight's batch get their own sections; keep them out of the
  // action queue so nothing renders twice on the page (Rober 7-15 review).
  const newIds = useMemo(() => new Set(newJobs.map((j) => j.id)), [newJobs]);
  const queue = useMemo(
    () => aq.queue.filter((e) => !saved.has(e.job.id) && !newIds.has(e.job.id)),
    [aq.queue, saved, newIds],
  );
  // Page structure (Rober 7-16): the 10 best (one per company now) then the rest.
  const top = queue.slice(0, 10);
  const more = queue.slice(10);

  // Infinite reveal (Rober 7-25): the queue is uncapped now, so "More matches"
  // must scroll as deep as the scored pool goes — but 800+ cards mounted at once
  // is a DOM bomb, so reveal in slices as the list end nears the viewport.
  // Scroll-math implementation, NOT IntersectionObserver — the IO version
  // didn't fire in Rober's live session; see useRevealOnScroll.
  const { shown: moreShown, hasMore, sentinelRef } = useRevealOnScroll(more.length);

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

  // ONE row idiom for every section on this page. `rank` numbers the ranked lists;
  // `siblings` carries the company's other actionable roles (issue #73 cap-1/company).
  const renderRow = (
    job: RoleJob,
    opts: { rank?: number | null; showReason?: boolean; more?: RoleJob[] } = {},
  ) => {
    const { rank = null, showReason = false, more: siblings = [] } = opts;
    const ago = postedAgo(job.posted_at);
    const isApplied = applied.has(job.id);
    const isSaved = saved.has(job.id);
    const isOpen = expanded.has(job.id);
    // Warm marker (issue #41): knowing someone changes what you do BEFORE opening
    // Apply, so it belongs on the card. Information only — the rank above and the
    // score chip to the right are untouched by it, deliberately.
    const warmLabel = warmMarkerLabel(warmContactsFor(job.company, warmIndex).length);
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
              <span>{locationOf(job)}</span>
              {ago && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{ago}</span>
                </>
              )}
            </div>
            {warmLabel && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-caption font-medium text-foreground">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                {warmLabel}
              </p>
            )}
            {/* The "why you" line is the ranked sections' earned privilege; the
                More-matches tail stays a scannable index without it, same as
                Saved (Rober 7-16). The full reasoning lives on the prep page. */}
            {showReason && job.reason && (
              <p className="mt-2 line-clamp-2 text-dense text-muted-foreground text-pretty">{job.reason}</p>
            )}
            {/* Cap-1 per company (issue #73 slice 1): the company's other roles are
                offered here instead of taking three of your ten rows. */}
            {siblings.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => toggleExpanded(job.id)}
                  aria-expanded={isOpen}
                  className={ROW_META_ACTION}
                >
                  {isOpen ? "Hide the other roles" : `${siblings.length} more from ${job.company}`}
                </button>
                {isOpen && (
                  <ul className="mt-2 flex flex-col gap-1.5 border-l border-border pl-3">
                    {siblings.map((s) => (
                      <li key={s.id} className="text-caption text-muted-foreground">
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground underline-offset-2 hover:underline"
                        >
                          {s.title}
                        </a>
                        <span aria-hidden="true"> · </span>
                        <span>{locationOf(s)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <FitChip
            score={job.score}
            size="sm"
            pendingLabel={pendingLabelOf(
              scoreStatusOf(job.score, eligibleIds.has(job.id), hasReadableJd(job)),
            )}
          />
        </div>
        {/* Footer: exactly ONE secondary CTA ("Prepare application") plus meta-weight
            affordances — never a second button (design direction §5.5 "one secondary
            CTA + meta" / §3.3 one-primary law). Save, Mark applied and Not interested
            are quiet muted text/check affordances, not bordered buttons. */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <Button
            variant="outline"
            size="sm"
            className={SECONDARY_CTA}
            onClick={() => navigate(`/apply?job=${encodeURIComponent(job.url)}`)}
          >
            Prepare application
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => toggleSaved(job)} aria-pressed={isSaved} className={ROW_META_ACTION}>
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
              <button type="button" onClick={() => markApplied(job)} className={ROW_META_ACTION}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Mark applied
              </button>
            )}
            {/* Not interested (issue #73 slice 4): the role leaves this queue and the
                map rail. Undo it any time from the Dismissed list in Settings. */}
            <button type="button" onClick={() => toggleDismissed(job)} className={ROW_META_ACTION}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              Not interested
            </button>
          </div>
        </div>
      </li>
    );
  };

  const renderSection = (heading: string, entries: QueueEntry[], ranked: boolean) => (
    <section className="mt-8">
      <h2 className="font-display text-section text-foreground">{heading}</h2>
      <ol className="mt-3 flex flex-col gap-4">
        {entries.map((e, i) => renderRow(e.job, { rank: ranked ? i + 1 : null, showReason: ranked, more: e.more }))}
      </ol>
    </section>
  );

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
          Scoring the roles that match your targets · {remaining} to go. New matches drop in as they land.
        </p>
      )}

      {/* New (issue #72 slice 1): the exact roles the nightly email just sent, in the
          same rank order, still actionable. */}
      {newJobs.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-section text-foreground">{newHeading}</h2>
          <p className="mt-1 text-caption text-muted-foreground">
            The roles we emailed you, new since your last batch.
          </p>
          <ol className="mt-3 flex flex-col gap-4">
            {newJobs.map((job, i) => renderRow(job, { rank: i + 1, showReason: true }))}
          </ol>
        </section>
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
                  <div className="text-caption text-muted-foreground">{locationOf(job)}</div>
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
        newJobs.length === 0 && (
          <div className="mt-8 rounded-2xl border border-border bg-card p-6 text-body text-muted-foreground shadow-page text-pretty">
            Nothing left in your queue right now. Everything scored is either applied or below your bar. Fresh roles
            arrive with tomorrow's scan.
          </div>
        )
      ) : (
        <>
          {/* Renamed from "Top 10 to apply today" (issue #72 slice 2): this section
              ranks the whole live scored pool in score order and has nothing to do
              with a posting date. The dated section above is the one that's new. */}
          {renderSection("Your top matches", top, true)}
          {/* No count on the tail (Rober 7-16) — just scroll; slices reveal as
              the sentinel below approaches (Rober 7-25 infinite scroll). */}
          {more.length > 0 && renderSection("More matches", more.slice(0, moreShown), false)}
          {/* Reveal sentinel: while un-revealed tail remains, this quiet marker
              near the list end triggers the next slice. */}
          {hasMore && (
            <div ref={sentinelRef} className="py-6 text-center font-mono text-caption text-muted-foreground" aria-hidden="true">
              …
            </div>
          )}
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
