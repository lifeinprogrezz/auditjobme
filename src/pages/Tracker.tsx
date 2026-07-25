// Tracker — the application board (issue #42), rebuilt as a D-class PAPER board
// (design direction §6.2): quiet `--secondary` column wells (radius 16, no border
// wall), compact paper tiles (radius 10, the ink page shadow on hover), the §2
// type/spacing tokens, theme-matched 24px logos as the only colour, and stage
// identity carried by COLUMN POSITION + a micro eyebrow — never stage hues
// (monochrome, resolution #5). Moves stay explicit prev/next controls (restyled
// as secondary icon buttons), each an optimistic update rolled back on error;
// dnd-kit drag is a scoped follow-up (the move controls already satisfy the §6.2
// "move updates exactly one row's position" acceptance, and keep the board
// keyboard-accessible). Keeps the existing Supabase write-back.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/components/ui/sonner";
import AppShell from "@/components/app/AppShell";
import PaperLogo from "@/components/app/PaperLogo";
import { cn } from "@/lib/utils";
import { domainFor } from "@/lib/logodev";
import { TRACKER_COLUMNS as COLUMNS, STATUS_ORDER as ORDER, normStatus, type Status } from "@/lib/tracker";

interface AppRow {
  id: string;
  status: Status;
  applied_at: string;
  job_id: string;
  company: string;
  title: string;
  url: string;
  source: string | null;
  /** Real logo domain from the companies row (the name-guess misses many brands). */
  logo_domain: string | null;
}

/** Days since the application was marked applied — staleness is the signal
 *  (design direction §6.2), spelled out as "Applied 3d ago" so the number can't
 *  be read as posted-age (Rober 7-16). The exact date rides along as a hover title. */
function appliedAgo(iso: string): string {
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return d === 0 ? "Applied today" : `Applied ${d}d ago`;
}

function Chevron({ dir }: { dir: -1 | 1 }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === -1 ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
}

export default function Tracker() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: appsData } = await supabase
        .from("applications")
        .select("id, status, applied_at, job_id")
        .eq("user_id", user.id)
        .order("applied_at", { ascending: false });
      const ids = (appsData ?? []).map((a) => a.job_id);
      const jobsById: Record<
        string,
        { company: string; title: string; url: string; source: string | null; logo_domain: string | null }
      > = {};
      if (ids.length) {
        const { data: jobsData } = await supabase
          .from("jobs")
          .select("id, company, title, url, source, companies:company_id (logo_domain)")
          .in("id", ids);
        (jobsData ?? []).forEach((j) => {
          jobsById[j.id] = {
            company: j.company,
            title: j.title,
            url: j.url,
            source: j.source,
            logo_domain: (j.companies as { logo_domain: string | null } | null)?.logo_domain ?? null,
          };
        });
      }
      // Drop rows whose DB status isn't one of our columns instead of coercing them to
      // "applied" (issue #54) — a fabricated stage would misplace the card. Warn once so
      // an unexpected value is visible in the console rather than swallowed.
      const unknownStatuses = new Set<string>();
      const rows: AppRow[] = [];
      for (const a of appsData ?? []) {
        const status = normStatus(a.status);
        if (status === null) {
          unknownStatuses.add(a.status);
          continue;
        }
        rows.push({
          id: a.id,
          status,
          applied_at: a.applied_at,
          job_id: a.job_id,
          company: jobsById[a.job_id]?.company ?? "Unknown",
          title: jobsById[a.job_id]?.title ?? "Unknown role",
          url: jobsById[a.job_id]?.url ?? "#",
          source: jobsById[a.job_id]?.source ?? null,
          logo_domain: jobsById[a.job_id]?.logo_domain ?? null,
        });
      }
      if (unknownStatuses.size > 0) {
        console.warn(
          `Tracker: hid ${unknownStatuses.size} application(s) with an unrecognised status: ${[...unknownStatuses].join(", ")}`,
        );
      }
      if (active) {
        setApps(rows);
        setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [user]);

  const byColumn = useMemo(() => {
    const map: Record<Status, AppRow[]> = { applied: [], responded: [], interview: [], offer: [], rejected: [] };
    for (const a of apps) map[a.status].push(a);
    return map;
  }, [apps]);

  const move = async (id: string, dir: -1 | 1) => {
    const row = apps.find((a) => a.id === id);
    if (!row) return;
    const idx = ORDER.indexOf(row.status);
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= ORDER.length) return;
    const next = ORDER[nextIdx];
    const prev = row.status;
    setApps((cur) => cur.map((a) => (a.id === id ? { ...a, status: next } : a)));
    const { error } = await supabase.from("applications").update({ status: next }).eq("id", id);
    if (error) {
      setApps((cur) => cur.map((a) => (a.id === id ? { ...a, status: prev } : a)));
      toast.error("Couldn't move that application. Please try again.");
    }
  };

  if (loading) {
    return (
      <AppShell>
        <p className="text-body text-muted-foreground">Loading your board…</p>
      </AppShell>
    );
  }

  if (apps.length === 0) {
    // First-class empty state (§6.2): a designed paper card, not raw text.
    return (
      <AppShell>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-page">
          <p className="text-body text-muted-foreground text-pretty">
            No applications yet. Open a role from Today, prepare it, then mark it applied and it shows up on this board.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Same opening idiom as Today (Rober 7-16): no h1 + tagline — one
          outcome-first line, then the board. */}
      <p className="text-body text-muted-foreground">
        <span className="font-semibold text-foreground">Everything you've applied to</span>, in one place. Move a
        card as things progress.
      </p>
      {/* The board breaks OUT of the prose reading column (§6.2 / jj rule 7): a
          full-bleed scroll region so all five stage columns get real width instead
          of clipping in the ~720px cage — the prose above stays in the column.
          Overflow scrolls with a themed thin scrollbar (.tracker-scroll), never the
          native grey OS track. The AppShell root's overflow-x-clip stops the 100vw
          bleed from adding a horizontal page scrollbar. */}
      <div className="mt-8" style={{ width: "100vw", marginInline: "calc(50% - 50vw)" }}>
        <div className="tracker-scroll overflow-x-auto px-4 pb-4 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-max gap-4">
            {COLUMNS.map((col, colIdx) => (
            <section key={col.value} className="w-64 shrink-0" aria-label={col.label}>
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="font-display text-micro uppercase text-muted-foreground">{col.label}</h2>
                <span className="font-mono text-caption tabular-nums text-muted-foreground">
                  {byColumn[col.value].length}
                </span>
              </div>
              {/* Quiet paper well — no border wall; position + eyebrow carry the stage. */}
              <div className="flex min-h-24 flex-col gap-2 rounded-2xl bg-secondary p-2">
                {byColumn[col.value].length === 0 ? (
                  <p className="px-2 py-6 text-center text-caption text-muted-foreground">Nothing here</p>
                ) : (
                  byColumn[col.value].map((a) => (
                    <article
                      key={a.id}
                      className="rounded-[10px] border border-border bg-card p-3 transition-shadow duration-150 hover:shadow-page-lift"
                    >
                      <div className="flex items-start gap-2.5">
                        <PaperLogo domain={a.logo_domain ?? domainFor(a.company, a.source)} company={a.company} size={24} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-caption font-medium text-muted-foreground">{a.company}</div>
                          {/* The role name stays INSIDE the product — it opens the prep
                              page (Rober 7-16); the posting is reachable from the prep
                              header title. No ↗ clutter on the card. */}
                          <button
                            type="button"
                            onClick={() => navigate(`/apply?job=${encodeURIComponent(a.url)}`)}
                            className="mt-0.5 block w-full min-w-0 truncate text-left text-control font-semibold text-foreground underline-offset-2 hover:underline"
                          >
                            {a.title}
                          </button>
                        </div>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between">
                        <span
                          className="font-mono text-caption tabular-nums text-muted-foreground"
                          title={`Applied ${new Date(a.applied_at).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}`}
                        >
                          {appliedAgo(a.applied_at)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label="Move back a stage"
                            disabled={colIdx === 0}
                            onClick={() => move(a.id, -1)}
                            className={cn(
                              "grid h-7 w-7 place-items-center rounded-[10px] border border-foreground/20 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
                              colIdx === 0 && "invisible",
                            )}
                          >
                            <Chevron dir={-1} />
                          </button>
                          <button
                            type="button"
                            aria-label="Move forward a stage"
                            disabled={colIdx === COLUMNS.length - 1}
                            onClick={() => move(a.id, 1)}
                            className={cn(
                              "grid h-7 w-7 place-items-center rounded-[10px] border border-foreground/20 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
                              colIdx === COLUMNS.length - 1 && "invisible",
                            )}
                          >
                            <Chevron dir={1} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
