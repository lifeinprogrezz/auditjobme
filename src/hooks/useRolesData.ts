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

/**
 * Data plane for the /roles page. Mirrors Digest's load/score/apply flow with one
 * improvement: the initial fetch omits jd_text (heavy), pulling it only for the
 * ≤40 rows about to be scored.
 */
export function useRolesData() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<RoleJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [profile, setProfile] = useState<ScoreableProfile | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const activeRef = useRef(true);
  const scoringRef = useRef(false);

  async function scoreBatch(batch: RoleJob[], prof: ScoreableProfile, userId: string) {
    if (batch.length === 0 || scoringRef.current) return;
    scoringRef.current = true;
    setScoring(true);
    const { data: jdRows } = await supabase
      .from("jobs")
      .select("id, jd_text")
      .in("id", batch.map((j) => j.id));
    const jdById: Record<string, string | null> = {};
    (jdRows ?? []).forEach((r) => (jdById[r.id] = r.jd_text));
    for (const j of batch) {
      if (!activeRef.current) break;
      const result = await scoreJob(prof, { ...j, jd_text: jdById[j.id] ?? null });
      if (!result || !activeRef.current) continue;
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
      if (!activeRef.current) break;
      setJobs((prev) =>
        prev
          .map((x) => (x.id === j.id ? { ...x, score: result.score, reason: result.reason } : x))
          .sort(byScore),
      );
    }
    scoringRef.current = false;
    if (activeRef.current) setScoring(false);
  }

  useEffect(() => {
    activeRef.current = true;
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: jobsData } = await supabase
        .from("jobs")
        .select("id, company, title, url, location, remote, source, seniority, posted_at")
        .eq("is_live", true);
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
      const merged = ((jobsData ?? []) as JobsRow[]).map((row) => {
        const j = enrich(row);
        return {
          ...j,
          score: scoreByJob[j.id]?.score ?? null,
          reason: scoreByJob[j.id]?.reason ?? null,
        };
      });
      merged.sort(byScore);
      if (!activeRef.current) return;
      setJobs(merged);
      setLoading(false);

      const { data: appsData } = await supabase.from("applications").select("job_id").eq("user_id", user.id);
      if (activeRef.current) setApplied(new Set((appsData ?? []).map((a) => a.job_id)));

      const { data: prof } = await supabase
        .from("profiles")
        .select("target_seniority, target_cities, open_to_remote, citizenship, eu_work_authorized, languages, cv_text")
        .eq("id", user.id)
        .maybeSingle();
      if (!activeRef.current) return;
      if (prof) setProfile(prof as ScoreableProfile);
      if (!prof) return;
      await scoreBatch(
        merged.filter((j) => j.score == null).slice(0, 40),
        prof as ScoreableProfile,
        user.id,
      );
    }
    load();
    return () => {
      activeRef.current = false;
    };
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
    if (!user || !profile || scoringRef.current) return;
    scoreBatch(jobs.filter((j) => j.score == null).slice(0, 40), profile, user.id);
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
