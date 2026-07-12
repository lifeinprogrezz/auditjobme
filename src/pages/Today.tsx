// Today — the action-queue home (issue #42). Replaces the pre-map Digest catalog:
// "N roles scored while the pool refreshed, M worth applying", then the ranked queue
// of scored, un-applied roles. Consumes the SHARED useRolesData path (server-written
// scores, full signals) — no client-side scoring loop, so it can't strip subscores/
// evidence the way the old Digest did. Ink-glass token layer, no inline hex.
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { useRolesData } from "@/hooks/useRolesData";
import { buildActionQueue, coverageSummary } from "@/lib/product";
import { fitLabel, geoVerdict, postedAgo, scoreBucket, type RoleJob } from "@/lib/roles";
import { cn } from "@/lib/utils";

const SCORE_TEXT: Record<string, string> = {
  great: "text-score-great-deep",
  mid: "text-score-mid",
  low: "text-score-low",
};

function ScorePill({ score }: { score: number | null }) {
  if (score == null) return <span className="font-mono text-sm text-muted-foreground">—</span>;
  return (
    <span className={cn("font-mono text-lg font-semibold tabular-nums", SCORE_TEXT[scoreBucket(score)])}>
      {score.toFixed(1)}
    </span>
  );
}

function GeoBadge({ job }: { job: RoleJob }) {
  const v = geoVerdict(job);
  if (!v.onCard) return null;
  return (
    <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[0.68rem] font-medium text-secondary-foreground">
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
    <p className="mt-1 text-sm text-muted-foreground">
      Scanning {coverage.roles.toLocaleString()} live roles from {coverage.companies.toLocaleString()} companies
      across {coverage.sources.toLocaleString()} job sources, refreshed daily. It's a curated pool, not the whole
      internet.
    </p>
  );

  if (loading) {
    return (
      <AppShell title="Today">
        <p className="mt-6 text-sm text-muted-foreground">Loading your roles…</p>
      </AppShell>
    );
  }

  if (!scored) {
    return (
      <AppShell title="Today">
        {coverageLine}
        <div className="mt-8 rounded-lg border border-border bg-card p-6">
          <h2 className="font-display text-lg font-semibold">See which roles fit you</h2>
          <p className="mt-2 text-sm text-muted-foreground">
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
      <p className="mt-1 text-base text-muted-foreground">
        <span className="font-medium text-foreground">{aq.scored.toLocaleString()}</span> roles scored against your
        profile.{" "}
        <span className="font-medium text-foreground">{aq.worthApplying.toLocaleString()}</span> look worth applying.
      </p>
      {coverageLine}

      {scoring && (
        <div className="mt-6 rounded-md border border-border bg-secondary px-4 py-2 text-sm text-secondary-foreground" role="status" aria-live="polite">
          Still scoring the pool against your profile… {remaining} to go. New matches drop in as they land.
        </div>
      )}

      {aq.queue.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Nothing left in your queue right now. Everything scored is either applied or below your bar. Fresh roles
          arrive with tomorrow's scan.
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {aq.queue.map((job) => {
            const ago = postedAgo(job.posted_at);
            const isApplied = applied.has(job.id);
            return (
              <li key={job.id} className="rounded-lg border border-border bg-card p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display font-semibold">{job.company}</span>
                      <GeoBadge job={job} />
                    </div>
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 block truncate text-sm text-foreground underline-offset-2 hover:underline"
                    >
                      {job.title}
                    </a>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {job.city ?? job.location ?? (job.remote ? "Remote" : "Location unknown")}
                      {ago ? ` · ${ago}` : ""}
                    </div>
                    {job.reason && <p className="mt-2 text-sm italic text-muted-foreground">{job.reason}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <ScorePill score={job.score} />
                    <span className="text-[0.6rem] uppercase tracking-wide text-muted-foreground">
                      {job.score != null ? fitLabel(job.score) : "fit"}
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => navigate(`/apply?job=${encodeURIComponent(job.url)}`)}>
                    Prepare application
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isApplied}
                    onClick={() => markApplied(job)}
                  >
                    {isApplied ? "Applied" : "Mark applied"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {scored && remaining > 0 && !scoring && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" size="sm" onClick={scoreMore}>
            Check for new scores
          </Button>
        </div>
      )}
    </AppShell>
  );
}
