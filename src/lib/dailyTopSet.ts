// Storage-layer helpers for the frozen "top matches" set (issue #155). Pure key/parse
// logic lives here so useDailyTopSet.ts stays a thin IO wrapper; localStorage itself
// is DOM, so it's called from the hook, not from src/lib/product.ts (that file is
// pinned no-DOM by product.test.ts).
import type { DailyTopSetSnapshot } from "@/lib/product";

/** Per-user, per-day key — a stale day or another account on a shared device must
 *  never read back someone else's frozen set. */
export function dailyTopSetStorageKey(userId: string, day: string): string {
  return `northgoing.dailyTopSet.${userId}.${day}`;
}

/** True when a daily_top_sets read/write failed only because migration
 *  20260827120000 hasn't landed yet. Same shape as isMissingRubricColumn /
 *  isMissingCvStructuredColumn: PGRST205 = PostgREST schema-cache miss (unknown
 *  table), 42P01 = Postgres undefined_table. Pure. */
export function isMissingDailyTopSetsTable(
  err: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!err) return false;
  const msg = err.message ?? "";
  if (!msg.includes("daily_top_sets")) return false;
  return err.code === "PGRST205" || err.code === "42P01" || /schema cache|does not exist/i.test(msg);
}

/** Read today's frozen set back from localStorage. Any parse/storage failure (private
 *  mode, quota, corrupt value) reads as "no snapshot yet" rather than throwing — the
 *  caller just re-freezes. */
export function readLocalDailyTopSet(userId: string, day: string): DailyTopSetSnapshot | null {
  try {
    const raw = localStorage.getItem(dailyTopSetStorageKey(userId, day));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { jobIds?: unknown };
    if (!Array.isArray(parsed.jobIds)) return null;
    const jobIds = parsed.jobIds.filter((id): id is string => typeof id === "string");
    return { day, jobIds };
  } catch {
    return null;
  }
}

/** Persist today's freeze to localStorage. Best-effort: a write failure costs the
 *  fallback, never the render — the set just re-freezes on the next visit. */
export function writeLocalDailyTopSet(userId: string, snapshot: DailyTopSetSnapshot): void {
  try {
    localStorage.setItem(
      dailyTopSetStorageKey(userId, snapshot.day),
      JSON.stringify({ jobIds: snapshot.jobIds }),
    );
  } catch {
    /* ignore — localStorage unavailable */
  }
}
