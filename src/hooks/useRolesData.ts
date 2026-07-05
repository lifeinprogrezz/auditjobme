import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/components/ui/sonner";
import { scoreJob, RUBRIC_VERSION, type ScoreableProfile } from "@/lib/score";
import { byScore, type RoleJob } from "@/lib/roles";
import { cityOf, jitteredLngLat } from "@/lib/geo";
import { domainFor } from "@/lib/logodev";

type JobsRow = {
  id: string;
  company: string;
  title: string;
  url: string;
  location: string | null;
  remote: boolean;
  source: string | null;
  seniority: string | null;
  posted_at: string | null;
};

const PAGE = 1000; // PostgREST caps un-ranged selects at 1000 rows — page past it.

function enrich(row: JobsRow): RoleJob {
  const city = cityOf(row.location);
  return {
    ...row,
    score: null,
    reason: null,
    city,
    lngLat: city ? jitteredLngLat(city, row.id) : null,
    domain: domainFor(row.company, row.source),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Data plane for the /roles page. Mirrors Digest's load/score/apply flow with two
 * changes: the initial fetch omits jd_text (heavy; pulled only for the ≤40 rows
 * about to be scored) and pages past PostgREST's 1000-row cap. Scoring only runs
 * for users with a CV — CV-less scores would be cached at this rubric version
 * forever and burn the sponsored budget on results the UI never shows.
 */
export function useRolesData() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<RoleJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [profile, setProfile] = useState<ScoreableProfile | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  // Per-run cancellation: each effect run gets its own id; async loops compare
  // against the current id (a shared boolean would be re-armed by the next run,
  // resurrecting a cancelled loop and leaking user A's scores into user B's view).
  const runRef = useRef(0);
  const scoringRef = useRef(false);

  async function scoreBatch(batch: RoleJob[], prof: ScoreableProfile, userId: string, runId: number) {
    if (batch.length === 0 || scoringRef.current) return;
    scoringRef.current = true;
    setScoring(true);
    try {
      const { data: jdRows, error: jdError } = await supabase
        .from("jobs")
        .select("id, jd_text")
        .in("id", batch.map((j) => j.id));
      // A failed jd fetch must ABORT the batch: scoring JD-blind would cache
      // degraded scores permanently (the null-score filter never revisits them).
      if (jdError || !jdRows) return;
      const jdById: Record<string, string | null> = {};
      jdRows.forEach((r) => (jdById[r.id] = r.jd_text));
      for (const j of batch) {
        if (runRef.current !== runId) return;
        const result = await scoreJob(prof, { ...j, jd_text: jdById[j.id] ?? null });
        if (!result || runRef.current !== runId) continue;
        await supabase.from("scores").upsert(
          {
            user_id: userId,
            job_id: j.id,
            score: result.score,
            rubric_version: RUBRIC_VERSION,
            signals: { reason: result.reason },
          },
          { onConflict: "user_id,job_id,rubric_version" },
        );
        if (runRef.current !== runId) return;
        setJobs((prev) =>
          prev
            .map((x) => (x.id === j.id ? { ...x, score: result.score, reason: result.reason } : x))
            .sort(byScore),
        );
      }
    } finally {
      scoringRef.current = false;
      if (runRef.current === runId) setScoring(false);
    }
  }

  useEffect(() => {
    const runId = ++runRef.current;
    async function load() {
      if (!user) {
        // Sign-out: clear the previous session's personalized state.
        setJobs([]);
        setProfile(null);
        setApplied(new Set());
        setLoading(false);
        return;
      }
      let rows: JobsRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("jobs")
          .select("id, company, title, url, location, remote, source, seniority, posted_at")
          .eq("is_live", true)
          .range(from, from + PAGE - 1);
        if (error || !data) break;
        rows = rows.concat(data as JobsRow[]);
        if (data.length < PAGE) break;
      }
      const { data: scoresData } = await supabase
        .from("scores")
        .select("job_id, score, signals")
        .eq("user_id", user.id)
        .eq("rubric_version", RUBRIC_VERSION);
      const scoreByJob: Record<string, { score: number | null; reason: string | null }> = {};
      (scoresData ?? []).forEach((s) => {
        const sig = s.signals as { reason?: string } | null;
        scoreByJob[s.job_id] = { score: s.score, reason: sig?.reason ?? null };
      });
      const merged = rows.map((row) => {
        const j = enrich(row);
        return {
          ...j,
          score: scoreByJob[j.id]?.score ?? null,
          reason: scoreByJob[j.id]?.reason ?? null,
        };
      });
      merged.sort(byScore);
      if (runRef.current !== runId) return;
      setJobs(merged);
      setLoading(false);

      const { data: appsData } = await supabase.from("applications").select("job_id").eq("user_id", user.id);
      if (runRef.current !== runId) return;
      setApplied(new Set((appsData ?? []).map((a) => a.job_id)));

      const { data: prof } = await supabase
        .from("profiles")
        .select("target_seniority, target_cities, open_to_remote, citizenship, eu_work_authorized, languages, cv_text")
        .eq("id", user.id)
        .maybeSingle();
      if (runRef.current !== runId) return;
      if (prof) setProfile(prof as ScoreableProfile);
      if (!prof?.cv_text?.trim()) return; // no CV → no scoring (see hook doc)
      // If a previous run's batch is still unwinding, wait for it to release.
      while (scoringRef.current && runRef.current === runId) await sleep(250);
      if (runRef.current !== runId) return;
      await scoreBatch(
        merged.filter((j) => j.score == null).slice(0, 40),
        prof as ScoreableProfile,
        user.id,
        runId,
      );
    }
    load();
    return () => {
      // Cancels this run's loops on unmount AND on dep change; the next run's
      // own increment keeps every runId unique.
      runRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const markApplied = async (job: RoleJob) => {
    if (!user) return;
    setApplied((prev) => new Set(prev).add(job.id));
    const { error } = await supabase
      .from("applications")
      .upsert({ user_id: user.id, job_id: job.id }, { onConflict: "user_id,job_id" });
    if (error) {
      setApplied((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
      toast.error("Couldn't mark as applied. Please try again.");
    }
  };

  const scoreMore = () => {
    if (!user || !profile?.cv_text?.trim() || scoringRef.current) return;
    scoreBatch(jobs.filter((j) => j.score == null).slice(0, 40), profile, user.id, runRef.current);
  };

  return {
    jobs,
    loading,
    scoring,
    remaining: jobs.filter((j) => j.score == null).length,
    applied,
    markApplied,
    scoreMore,
    /** Post-CV state: the score reveal keys on a CV being present. */
    scored: Boolean(profile?.cv_text?.trim()),
    signedIn: Boolean(user),
  };
}
