// The read side of the nightly email (issue #72 slice 1). `daily_matches` is what
// the nightly worker writes and emails; until now NO app surface read it, so the
// email and the app told two different stories. /today's "New" section reads the
// latest batch back and stamps `seen_at`, which had no writer at all.
//
// Deliberately its OWN hook, not another branch of useRolesData: only /today needs
// this query, and the map + settings pages should not pay for it. Pure selection
// logic lives in lib/product.ts (selectLatestBatch), pinned by product.test.ts.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { selectLatestBatch, type DailyMatchRow } from "@/lib/product";
import { isMissingRubricColumn } from "@/lib/nightly";

export type DailyMatches = {
  /** batch_date of the most recent nightly batch; null when there is none yet. */
  batchDate: string | null;
  /** That batch's rows, rank-ordered (best first). */
  rows: DailyMatchRow[];
  loading: boolean;
};

export function useDailyMatches(): DailyMatches {
  const { user } = useAuth();
  const [state, setState] = useState<DailyMatches>({ batchDate: null, rows: [], loading: true });

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setState({ batchDate: null, rows: [], loading: false });
      return;
    }
    (async () => {
      // Own-row SELECT under RLS; the table is small (<= NIGHTLY_TOP_N per night).
      let sel = await supabase
        .from("daily_matches")
        .select("job_url, batch_date, rank, seen_at, score, reason, rubric_version")
        .eq("user_id", user.id)
        .order("batch_date", { ascending: false })
        .limit(200);
      // Pre-F7 schema (migration 20260712123000 not applied): retry without the
      // stamp rather than losing the section. Rows then carry no rubric_version, so
      // resolveBatchJobs simply won't reuse the emailed score. Same degrade shape
      // the nightly worker already uses.
      if (isMissingRubricColumn(sel.error)) {
        sel = (await supabase
          .from("daily_matches")
          .select("job_url, batch_date, rank, seen_at, score, reason")
          .eq("user_id", user.id)
          .order("batch_date", { ascending: false })
          .limit(200)) as typeof sel;
      }
      const { data, error } = sel;
      if (cancelled) return;
      // A read failure means we simply have no batch to show. Never invent one.
      const latest = selectLatestBatch((error ? [] : (data ?? [])) as DailyMatchRow[]);
      setState({ batchDate: latest.batchDate, rows: latest.rows, loading: false });

      // Stamp seen_at on the rows the user is now looking at. The column-level
      // GRANT in migration 20260707130000 allows exactly this one client write and
      // nothing else. Best effort: a failure costs a stamp, never the render.
      if (latest.batchDate && latest.rows.some((r) => r.seen_at == null)) {
        await supabase
          .from("daily_matches")
          .update({ seen_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .eq("batch_date", latest.batchDate)
          .is("seen_at", null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return state;
}
