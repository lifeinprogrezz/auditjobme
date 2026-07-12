// Tracker — the application kanban (issue #42). Rebuilds the old list+dropdown draft
// into a real column board (applied → responded → interview → offer → rejected) while
// keeping the existing Supabase write-back. Moves are explicit prev/next controls
// (no drag dependency), each an optimistic update rolled back on error. Ink-glass
// token layer, no inline hex.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/components/ui/sonner";
import AppShell from "@/components/app/AppShell";
import { cn } from "@/lib/utils";
import { TRACKER_COLUMNS as COLUMNS, STATUS_ORDER as ORDER, normStatus, type Status } from "@/lib/tracker";

interface AppRow {
  id: string;
  status: Status;
  applied_at: string;
  job_id: string;
  company: string;
  title: string;
  url: string;
}

export default function Tracker() {
  const { user } = useAuth();
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
      const jobsById: Record<string, { company: string; title: string; url: string }> = {};
      if (ids.length) {
        const { data: jobsData } = await supabase.from("jobs").select("id, company, title, url").in("id", ids);
        (jobsData ?? []).forEach((j) => {
          jobsById[j.id] = { company: j.company, title: j.title, url: j.url };
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
      <AppShell title="Applications">
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  if (apps.length === 0) {
    return (
      <AppShell title="Applications">
        <p className="mt-6 text-sm text-muted-foreground">
          No applications yet. Open a role from Today, prepare it, then mark it applied and it shows up on this board.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Applications">
      <p className="mt-1 text-sm text-muted-foreground">
        Every role you've marked applied. Move a card as things progress.
      </p>
      <div className="mt-8 overflow-x-auto pb-4">
        <div className="flex min-w-max gap-4">
          {COLUMNS.map((col, colIdx) => (
            <section key={col.value} className="w-64 shrink-0" aria-label={col.label}>
              <div className="mb-3 flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold text-foreground">{col.label}</h2>
                <span className="font-mono text-xs text-muted-foreground">{byColumn[col.value].length}</span>
              </div>
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/40 p-2">
                {byColumn[col.value].length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nothing here</p>
                ) : (
                  byColumn[col.value].map((a) => (
                    <article key={a.id} className="rounded-md border border-border bg-card p-3">
                      <div className="text-sm font-semibold">{a.company}</div>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 block truncate text-xs text-foreground underline-offset-2 hover:underline"
                      >
                        {a.title}
                      </a>
                      <div className="mt-2 text-[0.65rem] text-muted-foreground">
                        Applied{" "}
                        {new Date(a.applied_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <button
                          type="button"
                          aria-label="Move back a stage"
                          disabled={colIdx === 0}
                          onClick={() => move(a.id, -1)}
                          className={cn(
                            "rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground",
                            colIdx === 0 && "invisible",
                          )}
                        >
                          ← Back
                        </button>
                        <button
                          type="button"
                          aria-label="Move forward a stage"
                          disabled={colIdx === COLUMNS.length - 1}
                          onClick={() => move(a.id, 1)}
                          className={cn(
                            "rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground",
                            colIdx === COLUMNS.length - 1 && "invisible",
                          )}
                        >
                          Next →
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
