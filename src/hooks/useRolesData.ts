import { startTransition, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/components/ui/sonner";
import { RUBRIC_VERSION, type ScoreableProfile } from "@/lib/score";
import type { ScoreSubscore, ScoreEvidence } from "@/lib/scorePrompt";
import { applyLandedScores, byScore, type RoleJob, type RoleExtraction } from "@/lib/roles";
import { hashCv, readCvStash, clearCvStash } from "@/lib/labels";
import { shouldPromptCv } from "@/lib/deviceSession";
import { cityOf, coordsOf } from "@/lib/geo";
import { domainFor } from "@/lib/logodev";
import { fetchDataplane, type DataplaneCompany, type DataplaneOffice } from "@/lib/dataplane";
import { createScoreBuffer, type ScoreBuffer } from "@/lib/scoreCoalescer";

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
  extraction: RoleExtraction | null;
  role_family: string | null;
  workplace: string | null;
};

const PAGE = 1000; // PostgREST caps un-ranged selects at 1000 rows — page past it.

/** The profile-view slice (issue #43): the labels a returning user picked plus
 *  when their CV was last written. Kept separate from ScoreableProfile, which
 *  is the exact shape shared with the nightly scoring worker — display-only
 *  fields have no business in that contract. */
export type ProfileMeta = {
  targetRoles: string[];
  targetSectors: string[];
  cvUpdatedAt: string | null;
};

/** Shape of the scores.signals jsonb the /roles surface reads (v4). subscores +
 *  evidence feed the score-breakdown viz; both absent on pre-v4 rows. */
type ScoreSignals = {
  reason?: string;
  fit_bullets?: string[];
  subscores?: ScoreSubscore[];
  evidence?: ScoreEvidence[];
} | null;

/** A single landed score as merged into the jobs array — the value type buffered by
 *  the score coalescer (issue #54) and consumed by applyLandedScores. */
type LandedScore = {
  score: number;
  reason: string | null;
  fitBullets: string[] | null;
  subscores: ScoreSubscore[] | null;
  evidence: ScoreEvidence[] | null;
};

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
  uk_sponsor_status: string | null;
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
      ukSponsorStatus: dim?.uk_sponsor_status ?? null,
    };
  });
}

// The server-side backlog worker (api/score-backlog.ts, issue #33) is the only
// scorer now; the page POLLS landed scores at this cadence while any visible
// role is unscored, so the map fills in live without the page doing the paying.
const SCORE_POLL_MS = 20_000;

/**
 * Data plane for the /roles page. The initial fetch omits jd_text (heavy) and
 * pages past PostgREST's 1000-row cap. Scoring is SERVER-SIDE (the backlog
 * worker, issue #33): this hook only reads `scores`, polling while unscored
 * roles remain so results land in front of the user — leaving the page never
 * stops a pass.
 */
export function useRolesData() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<RoleJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ScoreableProfile | null>(null);
  const [profileMeta, setProfileMeta] = useState<ProfileMeta | null>(null);
  // True once THIS session's profile row has been fetched AND any pre-redirect
  // CV stash handed off — the earliest moment `needsCv` can be trusted without
  // flashing the CV modal at a user whose CV is still in flight.
  const [profileChecked, setProfileChecked] = useState(false);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  // Per-run cancellation: each effect run gets its own id; async loops compare
  // against the current id (a shared boolean would be re-armed by the next run,
  // resurrecting a cancelled loop and leaking user A's scores into user B's view).
  const runRef = useRef(0);

  // Score-arrival coalescer (issue #54). Each poll pushes its landed-score snapshot
  // here instead of committing directly; the buffer merges snapshots that bunch up
  // (initial-load handoff + a manual "check now" + a poll can fire in the same tick)
  // into ONE commit, and startTransition marks that commit non-urgent so the heavy
  // derived-list rebuild (Today queue + map facets/markers) yields to clicks instead
  // of stalling the main thread. Cancelled on the run boundary below so a batch
  // buffered for user A never lands in user B's freshly-loaded view.
  const scoreBufferRef = useRef<ScoreBuffer<LandedScore> | null>(null);
  if (scoreBufferRef.current === null) {
    scoreBufferRef.current = createScoreBuffer<LandedScore>((merged) =>
      startTransition(() => setJobs((prev) => applyLandedScores(prev, merged, true))),
    );
  }

  /** Pull the user's landed scores and merge them into the map (sorted). The
   *  server worker writes them continuously; this is the read side of the poll. */
  async function refreshScores(userId: string, runId: number) {
    const { data } = await supabase
      .from("scores")
      .select("job_id, score, signals")
      .eq("user_id", userId)
      .eq("rubric_version", RUBRIC_VERSION);
    if (!data || runRef.current !== runId) return;
    const landed = new Map<string, LandedScore>(
      data.map((s) => {
        const sig = s.signals as ScoreSignals;
        return [
          s.job_id as string,
          {
            score: Number(s.score),
            reason: sig?.reason ?? null,
            fitBullets: sig?.fit_bullets ?? [],
            subscores: sig?.subscores ?? null,
            evidence: sig?.evidence ?? null,
          },
        ] as const;
      }),
    );
    if (landed.size > 0) scoreBufferRef.current?.push(landed);
  }

  /**
   * Write a submitted/stashed CV + labels to the profile, then reveal + score
   * in-session (Phase A). Mirrors the re-upload handling: a changed cv_hash
   * clears the stale scores (in the DB and locally) so the new CV re-scores; the
   * same hash re-scores nothing. Reads/writes the new profile columns defensively
   * so a pre-migration prod never crashes here — a failed write just surfaces a
   * toast and no reveal. Returns true on success.
   */
  async function applyCv(
    userId: string,
    payload: { cv_text: string; cv_hash: string; target_roles: string[]; target_sectors: string[] },
    jobsSnapshot: RoleJob[],
  ): Promise<boolean> {
    const cvText = payload.cv_text.trim();
    if (!cvText) return false;
    // Prior hash (score-cache key) + the stored text. A missing cv_hash column
    // pre-migration returns an error, not a throw — treat it as "no stored hash".
    const { data: hd, error: he } = await supabase
      .from("profiles")
      .select("cv_text, cv_hash")
      .eq("id", userId)
      .maybeSingle();
    const storedHash = he ? null : ((hd?.cv_hash as string | null) ?? null);
    const storedCvText = he ? null : ((hd?.cv_text as string | null) ?? null);
    // A non-null stored hash is the fast dirty-check; when it's null (a legacy CV
    // set via the old Onboarding/Profile flow left cv_hash NULL) fall back to the
    // actual text so re-dropping the SAME CV doesn't wipe the score cache.
    const changed =
      storedHash != null ? payload.cv_hash !== storedHash : storedCvText?.trim() !== cvText;

    // profiles has no updated_at trigger (checked: only the row's INSERT default
    // sets it) — stamp it explicitly so the profile view's "uploaded" date reflects
    // THIS write, not the user's original sign-up time.
    const nowIso = new Date().toISOString();
    const { error: upErr } = await supabase
      .from("profiles")
      .update({
        cv_text: cvText,
        cv_hash: payload.cv_hash,
        target_roles: payload.target_roles,
        target_sectors: payload.target_sectors,
        onboarded_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", userId);
    if (upErr) {
      // Expected before the Phase-A migration is applied (unknown columns); the
      // /roles page still works, only the CV-submit flow is blocked until then.
      toast.error("Couldn't save your CV. Please try again.");
      return false;
    }

    if (changed) {
      // Clear stale scores from the old CV (DB + local) so they re-score fresh.
      await supabase.from("scores").delete().eq("user_id", userId);
      // New pass ⇒ new completion email (issue #33): reset the exactly-once
      // stamp the backlog worker checks. Separate best-effort update so a
      // pre-migration prod (column missing) can't block the CV write above.
      await supabase.from("profiles").update({ scores_ready_notified_at: null }).eq("id", userId);
    }

    // Fresh scoreable profile — OLD columns only, so this read is pre-migration safe.
    const { data: fresh } = await supabase
      .from("profiles")
      .select("target_seniority, target_cities, open_to_remote, citizenship, eu_work_authorized, languages, cv_text")
      .eq("id", userId)
      .maybeSingle();
    const prof = (fresh ?? {
      target_seniority: null,
      target_cities: null,
      open_to_remote: null,
      citizenship: null,
      eu_work_authorized: null,
      languages: null,
      cv_text: cvText,
    }) as ScoreableProfile;

    if (changed) {
      setJobs(
        jobsSnapshot.map((j) => ({ ...j, score: null, reason: null, fitBullets: null, subscores: null, evidence: null })),
      );
    }
    // Flip `scored` false→true → the CSS reveal + FitChip count-up fire
    // in-session. This flip is what reveals the map, so success resolves HERE.
    // Scores arrive from the SERVER worker (issue #33) — the poll effect
    // surfaces them as they land; the panel's "Scoring… N to go" bar tracks it.
    setProfile(prof);
    // Profile view (issue #43): reflect the write we just made, no re-fetch
    // needed — we already know exactly what landed.
    setProfileMeta({ targetRoles: payload.target_roles, targetSectors: payload.target_sectors, cvUpdatedAt: nowIso });
    return true;
  }

  useEffect(() => {
    const runId = ++runRef.current;
    setProfileChecked(false);
    async function load() {
      // F3 (issue #37): the three public reads below are served by ONE static
      // artifact, rebuilt daily after the scrape — zero DB reads per anonymous
      // visitor. The live queries stay as FALLBACK for a missing/unreachable
      // artifact (deploy-order safe; the map never breaks on the dataplane).
      const plane = await fetchDataplane(import.meta.env.VITE_SUPABASE_URL as string);
      // Jobs are public postings (anon SELECT on is_live rows, migration
      // 20260705121000) — fetch them signed-in or not. Everything personalized
      // below stays behind the user check.
      let rows: JobsRow[] = [];
      let cosRows: DataplaneCompany[] = [];
      let offRows: DataplaneOffice[] = [];
      if (plane) {
        rows = plane.jobs as unknown as JobsRow[];
        cosRows = plane.companies;
        offRows = plane.offices;
      } else {
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from("jobs")
            .select("id, company, title, url, location, remote, source, seniority, posted_at, company_id, extraction, role_family, workplace")
            .eq("is_live", true)
            .range(from, from + PAGE - 1);
          if (error || !data) break;
          rows = rows.concat(data as JobsRow[]);
          if (data.length < PAGE) break;
        }
        const { data: cos } = await supabase
          .from("companies")
          .select(
            "slug, logo_domain, lat, lng, website, sector, stage, headcount_bucket, hq_city, hq_country, linkedin_url, description, founded_year, uk_sponsor_status",
          );
        cosRows = (cos ?? []) as DataplaneCompany[];
        const { data: offs } = await supabase.from("company_offices").select("company_slug, lat, lng");
        offRows = (offs ?? []) as DataplaneOffice[];
      }
      // Companies dimension (~600 rows): real logo domains beat the name-guess,
      // street office coords beat the sunflower scatter. Failure degrades to
      // guess + centroid, never blocks.
      const dims = new Map<string, CompanyDim>();
      cosRows.forEach((c) =>
        dims.set(c.slug, {
          logo_domain: c.logo_domain, lat: c.lat, lng: c.lng,
          website: c.website, sector: c.sector, stage: c.stage,
          headcount_bucket: c.headcount_bucket, hq_city: c.hq_city, hq_country: c.hq_country,
          linkedin_url: c.linkedin_url, description: c.description, founded_year: c.founded_year,
          uk_sponsor_status: c.uk_sponsor_status,
        }),
      );
      // Per-city offices: a company hiring in several cities gets each pin on the
      // right office (distance-matched). Empty until seeded — degrades to the
      // single companies coord, never blocks.
      const officesBySlug = new Map<string, [number, number][]>();
      offRows.forEach((o) => {
        const arr = officesBySlug.get(o.company_slug) ?? [];
        arr.push([o.lng, o.lat]);
        officesBySlug.set(o.company_slug, arr);
      });
      if (!user) {
        if (runRef.current !== runId) return;
        // Anonymous browse (or sign-out: clears the previous session's state).
        setJobs(enrichAll(rows, dims, officesBySlug).sort(byScore));
        setProfile(null);
        setProfileMeta(null);
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
        {
          score: number | null;
          reason: string | null;
          fitBullets: string[] | null;
          subscores: ScoreSubscore[] | null;
          evidence: ScoreEvidence[] | null;
        }
      > = {};
      (scoresData ?? []).forEach((s) => {
        const sig = s.signals as ScoreSignals;
        scoreByJob[s.job_id] = {
          score: s.score,
          reason: sig?.reason ?? null,
          fitBullets: sig?.fit_bullets ?? null,
          subscores: sig?.subscores ?? null,
          evidence: sig?.evidence ?? null,
        };
      });
      const merged = enrichAll(rows, dims, officesBySlug).map((j) => ({
        ...j,
        score: scoreByJob[j.id]?.score ?? null,
        reason: scoreByJob[j.id]?.reason ?? null,
        fitBullets: scoreByJob[j.id]?.fitBullets ?? null,
        subscores: scoreByJob[j.id]?.subscores ?? null,
        evidence: scoreByJob[j.id]?.evidence ?? null,
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
        .select(
          "target_seniority, target_cities, open_to_remote, citizenship, eu_work_authorized, languages, cv_text, target_roles, target_sectors, updated_at",
        )
        .eq("id", user.id)
        .maybeSingle();
      if (runRef.current !== runId) return;
      if (prof) {
        setProfile(prof as ScoreableProfile);
        setProfileMeta({
          targetRoles: prof.target_roles ?? [],
          targetSectors: prof.target_sectors ?? [],
          cvUpdatedAt: prof.updated_at ?? null,
        });
      }
      if (!prof?.cv_text?.trim()) {
        // Post-OAuth handoff (Phase A): a CV stashed before the sign-in redirect
        // is written to the profile now, then revealed. Only when the profile
        // has no CV yet (never clobber an existing one). Scoring itself is the
        // server worker's job; the poll effect below surfaces its results.
        const stash = readCvStash();
        if (stash && runRef.current === runId) {
          clearCvStash();
          await applyCv(
            user.id,
            {
              cv_text: stash.cv_text,
              cv_hash: stash.cv_hash,
              target_roles: stash.target_roles,
              target_sectors: stash.target_sectors,
            },
            merged,
          );
        }
      }
      // Profile + stash handoff settled — `needsCv` may now be trusted.
      if (runRef.current === runId) setProfileChecked(true);
    }
    load();
    return () => {
      // Cancels this run's loops on unmount AND on dep change; the next run's
      // own increment keeps every runId unique.
      runRef.current++;
      // Drop any score batch buffered for this run so it can't flush into the
      // next user's freshly-loaded view (the same leak the runRef guard prevents).
      scoreBufferRef.current?.cancel();
    };
  }, [user]);

  // ── Score poll (issue #33): while the signed-in user has a CV and any role is
  // still unscored, pull landed scores every SCORE_POLL_MS so the server pass
  // fills the map in front of them. Stops on its own when nothing is unscored
  // (interval not re-armed) and on signout/unmount (cleanup).
  const hasUnscored = jobs.some((j) => j.score == null);
  const hasCv = Boolean(profile?.cv_text?.trim());
  useEffect(() => {
    if (!user || !hasCv || !hasUnscored || loading) return;
    const runId = runRef.current;
    const t = setInterval(() => void refreshScores(user.id, runId), SCORE_POLL_MS);
    return () => clearInterval(t);
  }, [user, hasCv, hasUnscored, loading]);

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

  /** Manual "check now" — an immediate scores pull, ahead of the next poll tick.
   *  Kept for the RolesPanel prop surface; scoring itself is server-side. */
  const scoreMore = () => {
    if (!user || !profile?.cv_text?.trim()) return;
    void refreshScores(user.id, runRef.current);
  };

  /**
   * Signed-in CV submit (from the CV-unlock modal): write the CV + labels to the
   * profile and reveal + score in-session. The anon path stashes instead and the
   * load effect hands off after sign-in. Returns true on success.
   */
  const submitCv = async (
    text: string,
    labels: { roles: string[]; sectors: string[] },
  ): Promise<boolean> => {
    if (!user) return false;
    const cvText = text.trim();
    if (!cvText) return false;
    return applyCv(
      user.id,
      {
        cv_text: cvText,
        cv_hash: hashCv(cvText),
        target_roles: labels.roles,
        target_sectors: labels.sectors,
      },
      jobs,
    );
  };

  return {
    jobs,
    loading,
    // "Scoring" now means the SERVER pass hasn't drained this user's backlog yet
    // (the worker runs regardless; this drives the panel's progress bar).
    scoring: Boolean(user) && hasCv && hasUnscored && !loading,
    remaining: jobs.filter((j) => j.score == null).length,
    applied,
    markApplied,
    scoreMore,
    submitCv,
    /** Post-CV state: the score reveal keys on a CV being present. */
    scored: Boolean(profile?.cv_text?.trim()),
    signedIn: Boolean(user),
    /** Stored CV text (profile view, issue #43) — null until a signed-in user has one. */
    cvText: profile?.cv_text ?? null,
    /** Picked labels + last-write date (profile view, issue #43). */
    profileMeta,
    /** Signed in with a settled profile but NO CV (Rober 7-13): whichever door
     *  they entered through, the map shell opens the CV modal — CV mandatory as
     *  an invariant, not a door policy. */
    needsCv: shouldPromptCv({
      signedIn: Boolean(user),
      profileChecked,
      hasCv,
      stashPending: Boolean(readCvStash()),
    }),
  };
}
