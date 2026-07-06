import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/components/ui/sonner";
import { scoreJob, RUBRIC_VERSION, type ScoreableProfile } from "@/lib/score";
import { applyLandedScores, byScore, type RoleJob } from "@/lib/roles";
import { cityOf, coordsOf } from "@/lib/geo";
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
  company_id: string | null;
};

const PAGE = 1000; // PostgREST caps un-ranged selects at 1000 rows — page past it.

/**
 * City + map-position + logo-domain enrichment. Same-city jobs get a stable
 * per-city index (sorted by id) that places them on a deterministic sunflower
 * disc over the city — the logo cloud you see when a city cluster opens.
 */
type CompanyDim = {
  logo_domain: string | null; lat: number | null; lng: number | null;
  website: string | null; sector: string | null; stage: string | null;
  headcount_bucket: string | null; hq_city: string | null; hq_country: string | null;
  linkedin_url: string | null; description: string | null; founded_year: number | null;
};

// ONE position per company-in-a-city (not per role): every role of a company in
// a city shares the same point, so the map shows one logo per company and the
// panel shows that company's roles on click (startupmap's model). A company's
// street office is used only when it sits within ~40km of the job's own city
// centroid — a Barcelona role must never snap to the company's Paris HQ.
const OFFICE_SNAP_DEG = 0.5;
const normName = (s: string) => s.trim().toLowerCase();

// From a company's candidate office coords, pick the one NEAREST the job's city
// centroid, within ~55km. Distance (not city-name) matching means a company with
// offices in Barcelona + London + Edinburgh lands each city's role on the right
// office, robust to name spelling (München vs Munich).
function officeFor(centroid: [number, number], coords: [number, number][]): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = OFFICE_SNAP_DEG * OFFICE_SNAP_DEG;
  for (const [lng, lat] of coords) {
    const dLng = (lng - centroid[0]) * Math.cos((lat * Math.PI) / 180);
    const dLat = lat - centroid[1];
    const d = dLng * dLng + dLat * dLat;
    if (d <= bestD) {
      bestD = d;
      best = [lng, lat];
    }
  }
  return best;
}

// Companies without a street office fan out on a SMALL golden-angle disc around
// the city centroid — capped at ~0.85km so pins never reach the sea (the old
// per-role sunflower spread ~6km and dropped logos in the Mediterranean/port).
const CO_DISC_DEG = 0.0085;
function centroidPlace(centroid: [number, number], idx: number, n: number): [number, number] {
  const a = idx * 2.399963; // golden angle; idx is the company's stable rank in the city
  const r = CO_DISC_DEG * Math.sqrt((idx + 0.5) / Math.max(n, 1));
  return [
    centroid[0] + (r * Math.cos(a)) / Math.cos((centroid[1] * Math.PI) / 180),
    centroid[1] + r * Math.sin(a),
  ];
}

function enrichAll(
  rows: JobsRow[],
  dims: Map<string, CompanyDim>,
  officesBySlug: Map<string, [number, number][]>,
): RoleJob[] {
  const cityById = new Map<string, string | null>();
  const companiesByCity = new Map<string, Set<string>>(); // city -> set of normalized company names
  for (const r of rows) {
    const city = cityOf(r.location);
    cityById.set(r.id, city);
    if (city) {
      const set = companiesByCity.get(city) ?? new Set<string>();
      set.add(normName(r.company));
      companiesByCity.set(city, set);
    }
  }
  // Stable per-company rank within each city (sorted) → deterministic disc slot.
  const coIdx = new Map<string, number>(); // `${city}|${co}` -> idx
  const coCount = new Map<string, number>(); // city -> distinct company count
  for (const [city, set] of companiesByCity) {
    const arr = [...set].sort();
    coCount.set(city, arr.length);
    arr.forEach((cn, i) => coIdx.set(`${city}|${cn}`, i));
  }
  const posByGroup = new Map<string, [number, number] | null>(); // `${city}|${co}` -> shared point
  const posFor = (city: string | null, r: JobsRow): [number, number] | null => {
    if (!city) return null;
    const gk = `${city}|${normName(r.company)}`;
    const cached = posByGroup.get(gk);
    if (cached !== undefined) return cached;
    const centroid = coordsOf(city);
    let pos: [number, number] | null = null;
    if (centroid) {
      // Candidate offices: the company's per-city offices (company_offices) plus
      // its single companies.lat/lng, all treated as candidates — the nearest one
      // within snap wins, so the Barcelona role lands on the Barcelona office.
      const cands: [number, number][] = r.company_id ? [...(officesBySlug.get(r.company_id) ?? [])] : [];
      const dim = r.company_id ? dims.get(r.company_id) : undefined;
      if (dim && dim.lat != null && dim.lng != null) cands.push([dim.lng, dim.lat]);
      pos = officeFor(centroid, cands) ?? centroidPlace(centroid, coIdx.get(gk) ?? 0, coCount.get(city) ?? 1);
    }
    posByGroup.set(gk, pos);
    return pos;
  };
  return rows.map((r) => {
    const city = cityById.get(r.id) ?? null;
    const dim = r.company_id ? dims.get(r.company_id) : undefined;
    return {
      ...r,
      score: null,
      reason: null,
      city,
      lngLat: posFor(city, r),
      // companies.logo_domain (engine-verified website) wins; name-guess is the
      // fallback for rows not yet linked to the companies dimension.
      domain: dim?.logo_domain ?? domainFor(r.company, r.source),
      // Company context for the detail panel (null when the co isn't enriched yet).
      website: dim?.website ?? null,
      sector: dim?.sector ?? null,
      stage: dim?.stage ?? null,
      headcount: dim?.headcount_bucket ?? null,
      hqCity: dim?.hq_city ?? null,
      hqCountry: dim?.hq_country ?? null,
      linkedin: dim?.linkedin_url ?? null,
      description: dim?.description ?? null,
      foundedYear: dim?.founded_year ?? null,
    };
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Landed scores reach the UI at most this often during a pass (#26): every
// setJobs re-tiles the whole map source, so per-landing updates (~40/pass)
// churned the globe while the user browsed.
const SCORE_FLUSH_MS = 2000;

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
      // Batched flushes (#26): a per-landing setJobs + re-sort fired a full map
      // re-index up to 40x per pass, and every re-sort remapped supercluster ids
      // wholesale (marker churn mid-gesture). Landed scores now reach the UI at
      // most every SCORE_FLUSH_MS with row order STABLE; the byScore sort runs
      // once, when the pass completes. Cancelled runs never flush (stale scores
      // must not leak into the next user's view).
      const pending = new Map<string, { score: number; reason: string | null; fitBullets: string[] }>();
      let landedAny = false;
      let lastFlush = Date.now();
      const flush = (sort: boolean) => {
        if (pending.size === 0 && !sort) return;
        const landed = new Map(pending);
        pending.clear();
        setJobs((prev) => applyLandedScores(prev, landed, sort));
      };
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
            signals: { reason: result.reason, fit_bullets: result.fitBullets },
          },
          { onConflict: "user_id,job_id,rubric_version" },
        );
        if (runRef.current !== runId) return;
        pending.set(j.id, { score: result.score, reason: result.reason, fitBullets: result.fitBullets });
        landedAny = true;
        if (Date.now() - lastFlush >= SCORE_FLUSH_MS) {
          flush(false);
          lastFlush = Date.now();
        }
      }
      if (landedAny) flush(true);
    } finally {
      scoringRef.current = false;
      if (runRef.current === runId) setScoring(false);
    }
  }

  useEffect(() => {
    const runId = ++runRef.current;
    async function load() {
      // Jobs are public postings (anon SELECT on is_live rows, migration
      // 20260705121000) — fetch them signed-in or not. Everything personalized
      // below stays behind the user check.
      let rows: JobsRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("jobs")
          .select("id, company, title, url, location, remote, source, seniority, posted_at, company_id")
          .eq("is_live", true)
          .range(from, from + PAGE - 1);
        if (error || !data) break;
        rows = rows.concat(data as JobsRow[]);
        if (data.length < PAGE) break;
      }
      // Companies dimension (anon-readable, ~550 rows): real logo domains beat
      // the name-guess, street office coords beat the sunflower scatter.
      // Failure degrades to guess + centroid, never blocks.
      const dims = new Map<string, CompanyDim>();
      const { data: cos } = await supabase
        .from("companies")
        .select(
          "slug, logo_domain, lat, lng, website, sector, stage, headcount_bucket, hq_city, hq_country, linkedin_url, description, founded_year",
        );
      (cos ?? []).forEach((c) =>
        dims.set(c.slug, {
          logo_domain: c.logo_domain, lat: c.lat, lng: c.lng,
          website: c.website, sector: c.sector, stage: c.stage,
          headcount_bucket: c.headcount_bucket, hq_city: c.hq_city, hq_country: c.hq_country,
          linkedin_url: c.linkedin_url, description: c.description, founded_year: c.founded_year,
        }),
      );
      // Per-city offices: a company hiring in several cities gets each pin on the
      // right office (distance-matched). Empty until seeded — degrades to the
      // single companies coord, never blocks.
      const officesBySlug = new Map<string, [number, number][]>();
      const { data: offs } = await supabase.from("company_offices").select("company_slug, lat, lng");
      (offs ?? []).forEach((o) => {
        const arr = officesBySlug.get(o.company_slug) ?? [];
        arr.push([o.lng, o.lat]);
        officesBySlug.set(o.company_slug, arr);
      });
      if (!user) {
        if (runRef.current !== runId) return;
        // Anonymous browse (or sign-out: clears the previous session's state).
        setJobs(enrichAll(rows, dims, officesBySlug).sort(byScore));
        setProfile(null);
        setApplied(new Set());
        setLoading(false);
        return;
      }
      const { data: scoresData } = await supabase
        .from("scores")
        .select("job_id, score, signals")
        .eq("user_id", user.id)
        .eq("rubric_version", RUBRIC_VERSION);
      const scoreByJob: Record<
        string,
        { score: number | null; reason: string | null; fitBullets: string[] | null }
      > = {};
      (scoresData ?? []).forEach((s) => {
        const sig = s.signals as { reason?: string; fit_bullets?: string[] } | null;
        scoreByJob[s.job_id] = {
          score: s.score,
          reason: sig?.reason ?? null,
          fitBullets: sig?.fit_bullets ?? null,
        };
      });
      const merged = enrichAll(rows, dims, officesBySlug).map((j) => ({
        ...j,
        score: scoreByJob[j.id]?.score ?? null,
        reason: scoreByJob[j.id]?.reason ?? null,
        fitBullets: scoreByJob[j.id]?.fitBullets ?? null,
      }));
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
