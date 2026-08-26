import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/components/ui/sonner";
import { RUBRIC_VERSION, type ScoreableProfile } from "@/lib/score";
import type { ScoreSubscore, ScoreEvidence } from "@/lib/scorePrompt";
import { applyLandedScores, byScore, type RoleJob, type RoleExtraction } from "@/lib/roles";
import { inFlightCompanyKeys } from "@/lib/product";
import { isInFlightStatus } from "@/lib/tracker";
import { hashCv, readCvStash, clearCvStash, normalizeTargetRoles } from "@/lib/labels";
import { normalizeTargetSectors } from "@/lib/sectors";
import { hasReadableJd, prefilterJobs } from "@/lib/scorePrefilter";
import { fetchAllPages } from "@/lib/pagedSelect";
import { shouldPromptCv } from "@/lib/deviceSession";
import { cityOf, coordsOf } from "@/lib/geo";
import { domainFor } from "@/lib/logodev";
import { fetchDataplane, type DataplaneCompany, type DataplaneOffice } from "@/lib/dataplane";
import { DEV_FIXTURE, DEV_FIXTURE_PROFILE, devFixtureScores } from "@/lib/devFixture";
import { createScoreBuffer, type ScoreBuffer } from "@/lib/scoreCoalescer";
import { buildWarmIndex, type ParsedConnection, type WarmContact } from "@/lib/connections";
import { track } from "@/lib/analytics";

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
  /** jobs.first_seen_at — the Freshness facet's primary key (issue #73 slice 3);
   *  NOT NULL in the DB, optional here only for a pre-#73 dataplane artifact. */
  first_seen_at?: string | null;
  company_id: string | null;
  extraction: RoleExtraction | null;
  role_family: string | null;
  workplace: string | null;
  /** jobs.has_jd (#130): optional only for an artifact built before the column. */
  has_jd?: boolean | null;
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
  // The application ROWS (job_id + status), not just the ids: the in-flight company
  // collapse (issue #73 slice 2) needs the status to tell a live conversation from a
  // closed one — a rejected company must resurface on a new role.
  const [applications, setApplications] = useState<{ job_id: string; status: string | null }[]>([]);
  // The applied roles' OWN job rows, fetched by id WITHOUT the is_live filter (same
  // idiom as savedJobsRaw/dismissedJobsRaw). The in-flight company collapse must be
  // LIVENESS-INDEPENDENT — career-ops' appliedCos is — and postings routinely close
  // mid-conversation: resolving applications against the live pool alone would let a
  // company's other roles resurface the moment the applied posting flipped is_live
  // false. Identity columns only; nothing here is rendered.
  const [appliedJobsRaw, setAppliedJobsRaw] = useState<
    { id: string; company: string; company_id: string | null }[]
  >([]);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Dismissed roles fetched WITHOUT the is_live filter, so the /settings undo list
  // still has display data once a posting expires (same reason as savedJobsRaw).
  const [dismissedJobsRaw, setDismissedJobsRaw] = useState<RoleJob[]>([]);
  // Saved roles fetched WITHOUT the is_live filter, so an expired-but-saved role still
  // has display data for the Today Saved section (Rober 7-15 review).
  const [savedJobsRaw, setSavedJobsRaw] = useState<RoleJob[]>([]);
  // Warm contacts (issue #41): the user's own LinkedIn connections upload, read
  // whole so the Today cards can mark "You know N people here". Information only —
  // NEVER fed into scoring (deliberate divergence from the personal engine).
  const [connections, setConnections] = useState<WarmContact[]>([]);
  const [connectionsUpdatedAt, setConnectionsUpdatedAt] = useState<string | null>(null);
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
    // Paged: PostgREST caps an un-ranged select at 1000 rows, silently. Un-paged, a
    // user with more scores than that saw most of their roles as unscored forever.
    const data = await fetchAllPages<{ job_id: string; score: number | null; signals: unknown }>(
      () =>
        supabase
          .from("scores")
          .select("job_id, score, signals")
          .eq("user_id", userId)
          .eq("rubric_version", RUBRIC_VERSION),
      { label: "scores:refresh" },
    );
    if (!data.length || runRef.current !== runId) return;
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
      // Scores are NOT deleted (#123). Deleting them re-bought the user's whole
      // slice at ~$3.69 per edit, and blanked their map until the worker drained
      // — so the most engaged user, the one who iterates on their CV, was the
      // most expensive and got the worst experience. The old numbers stay on
      // screen, marked against the CV that produced them, and the worker
      // refreshes the best ones first on a paced budget (src/lib/scoreRefresh.ts).
      //
      // Stamping the change time is what lets the worker wait for editing to
      // stop: eight saves in one sitting become one refresh.
      await supabase.from("profiles").update({ cv_changed_at: new Date().toISOString() }).eq("id", userId);
      // scores_ready_notified_at is deliberately NOT reset. That email says "we
      // finished scoring your roles", which is true once, on the first pass. A
      // refresh happens behind a user who is already here, and with scores kept
      // the completion check would read zero-pending immediately and fire a mail
      // claiming work that has not happened yet.
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
            .select("id, company, title, url, location, remote, source, seniority, posted_at, first_seen_at, company_id, extraction, role_family, workplace, has_jd")
            .eq("is_live", true)
            .range(from, from + PAGE - 1);
          if (error || !data) break;
          rows = rows.concat(data as JobsRow[]);
          if (data.length < PAGE) break;
        }
        // Paged: 598 companies today, but the catalogue grows and PostgREST would
        // silently return the first 1000. A company missing from this list loses its
        // logo, sector, headcount and map position — quietly, on an arbitrary subset.
        const cos = await fetchAllPages<DataplaneCompany>(
          () =>
            supabase
              .from("companies")
              .select(
                "slug, logo_domain, lat, lng, website, sector, stage, headcount_bucket, hq_city, hq_country, linkedin_url, description, founded_year, uk_sponsor_status",
              ),
          { label: "companies:dataplane" },
        );
        cosRows = cos;
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
        setApplications([]);
        setAppliedJobsRaw([]);
        setSaved(new Set());
        setSavedJobsRaw([]);
        setDismissed(new Set());
        setDismissedJobsRaw([]);
        setConnections([]);
        setConnectionsUpdatedAt(null);
        setLoading(false);
        return;
      }
      // Paged for the same reason as the poll above: this is the fetch that decides
      // which roles show a score at all, so truncation here is the whole map going
      // blank-ish for anyone past 1000 scores.
      const scoresData = await fetchAllPages<{ job_id: string; score: number | null; signals: unknown }>(
        () =>
          supabase
            .from("scores")
            .select("job_id, score, signals")
            .eq("user_id", user.id)
            .eq("rubric_version", RUBRIC_VERSION),
        { label: "scores:initial" },
      );
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
      const scoredRows = enrichAll(rows, dims, officesBySlug).map((j) => {
        // #130: a score held by a role with no description is not applied, so
        // the role renders as unscored and cannot rank on a stale row.
        const hit = hasReadableJd(j) ? scoreByJob[j.id] : undefined;
        return {
          ...j,
          score: hit?.score ?? null,
          reason: hit?.reason ?? null,
          fitBullets: hit?.fitBullets ?? null,
          subscores: hit?.subscores ?? null,
          evidence: hit?.evidence ?? null,
        };
      });
      // Dev-only (VITE_E2E_BYPASS_AUTH under vite dev): the mock user has no JWT, so
      // the query above returns nothing and every authed surface renders empty. Fill
      // the gaps with obviously-labelled synthetic scores so an automated walk can
      // reach the queue, the dismiss control and the "+N more" affordance. Folded out
      // of production builds — see lib/devFixture.ts.
      const merged = DEV_FIXTURE ? devFixtureScores(scoredRows) : scoredRows;
      merged.sort(byScore);
      if (runRef.current !== runId) return;
      setJobs(merged);
      setLoading(false);

      const { data: appsData } = await supabase
        .from("applications")
        .select("job_id, status")
        .eq("user_id", user.id);
      if (runRef.current !== runId) return;
      setApplied(new Set((appsData ?? []).map((a) => a.job_id)));
      setApplications((appsData ?? []).map((a) => ({ job_id: a.job_id, status: a.status ?? null })));

      // Resolve those applications to their companies from their OWN rows, not from
      // the live pool (see appliedJobsRaw): an application whose posting has since
      // closed must still collapse its company while the conversation is open.
      const appliedIds = (appsData ?? []).map((a) => a.job_id);
      if (appliedIds.length > 0) {
        const { data: appliedRows } = await supabase
          .from("jobs")
          .select("id, company, company_id")
          .in("id", appliedIds);
        if (runRef.current !== runId) return;
        setAppliedJobsRaw((appliedRows ?? []) as { id: string; company: string; company_id: string | null }[]);
      } else {
        setAppliedJobsRaw([]);
      }

      // Dismissed roles (issue #73 slice 4) — same own-row table shape as saved_jobs.
      const { data: dismissedData } = await supabase
        .from("dismissed_jobs")
        .select("job_id")
        .eq("user_id", user.id);
      if (runRef.current !== runId) return;
      const dismissedIds = (dismissedData ?? []).map((d) => d.job_id);
      setDismissed(new Set(dismissedIds));
      if (dismissedIds.length > 0) {
        const { data: dismissedRows } = await supabase
          .from("jobs")
          .select("id, company, title, url, location, remote, source, seniority, posted_at, first_seen_at, company_id, extraction, role_family, workplace")
          .in("id", dismissedIds);
        if (runRef.current !== runId) return;
        setDismissedJobsRaw(enrichAll((dismissedRows ?? []) as JobsRow[], dims, officesBySlug));
      } else {
        setDismissedJobsRaw([]);
      }

      const { data: savedData } = await supabase.from("saved_jobs").select("job_id").eq("user_id", user.id);
      if (runRef.current !== runId) return;
      const savedIds = (savedData ?? []).map((s) => s.job_id);
      setSaved(new Set(savedIds));
      // Fetch the saved roles' rows WITHOUT the is_live filter so a role saved for
      // later still shows in the Saved section once the posting expires (the whole
      // point of "save for later"). Same company enrichment; scores aren't needed here.
      if (savedIds.length > 0) {
        const { data: savedRows } = await supabase
          .from("jobs")
          .select("id, company, title, url, location, remote, source, seniority, posted_at, first_seen_at, company_id, extraction, role_family, workplace")
          .in("id", savedIds);
        if (runRef.current !== runId) return;
        setSavedJobsRaw(enrichAll((savedRows ?? []) as JobsRow[], dims, officesBySlug));
      } else {
        setSavedJobsRaw([]);
      }

      // Warm contacts (issue #41): the user's whole connections upload, paged past
      // PostgREST's row cap (a LinkedIn export routinely runs to a few thousand
      // rows). Read defensively — an error (e.g. the migration not applied yet)
      // just means no markers anywhere, never a crash.
      {
        let connRows: {
          full_name: string;
          company: string;
          company_key: string;
          position: string | null;
          linkedin_url: string | null;
          created_at: string;
        }[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from("connections")
            .select("full_name, company, company_key, position, linkedin_url, created_at")
            .eq("user_id", user.id)
            .range(from, from + PAGE - 1);
          if (error || !data) break;
          connRows = connRows.concat(data);
          if (data.length < PAGE) break;
        }
        if (runRef.current !== runId) return;
        setConnections(
          connRows.map((r) => ({
            fullName: r.full_name,
            company: r.company,
            companyKey: r.company_key,
            position: r.position,
            linkedinUrl: r.linkedin_url,
          })),
        );
        setConnectionsUpdatedAt(
          connRows.reduce<string | null>((acc, r) => (acc == null || r.created_at > acc ? r.created_at : acc), null),
        );
      }

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
        // Vocabulary shim (issue #70). The migration rewrites the stored rows, but
        // a profile written between deploy and migration — or by a browser tab
        // still running the previous bundle — can still hold a retired archetype
        // or sector variant. Translating on read means such a value narrows the
        // view instead of matching nothing and rendering permanent "Not scored".
        setProfileMeta({
          targetRoles: normalizeTargetRoles(prof.target_roles),
          targetSectors: normalizeTargetSectors(prof.target_sectors),
          cvUpdatedAt: prof.updated_at ?? null,
        });
      } else if (DEV_FIXTURE) {
        // Same dev-only gate: `scored` is Boolean(profile.cv_text), and the mock
        // user has no profile row, so without this /today never leaves its
        // "add your CV" empty state and the walk sees nothing.
        setProfile(DEV_FIXTURE_PROFILE);
        // A jobs.role_family value, not a display string: "Product Manager" was in
        // none of the three old vocabularies and matched nothing (issue #70).
        setProfileMeta({ targetRoles: ["product"], targetSectors: [], cvUpdatedAt: null });
      }
      if (!DEV_FIXTURE && !prof?.cv_text?.trim()) {
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
              // Same shim as the profile read above, and it matters MORE here: the
              // stash is written by the bundle the user had before the OAuth
              // redirect and read by the one they have after, so a sign-up started
              // before this deploy would otherwise write a retired archetype into
              // a brand-new profile row (issue #70).
              target_roles: normalizeTargetRoles(stash.target_roles),
              target_sectors: normalizeTargetSectors(stash.target_sectors),
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

  // ── Score poll (issue #33): while the signed-in user has a CV and any ELIGIBLE
  // role is still unscored, pull landed scores every SCORE_POLL_MS so the server
  // pass fills the map in front of them. Eligibility is the SAME prefilter the
  // worker pays by (#114) — judged over the full catalog would keep the poll and
  // the progress bar alive forever, since pruned-out rows never score. Stops on
  // its own when the eligible slice is fully scored and on signout/unmount.
  const eligibleJobs = useMemo(
    () =>
      prefilterJobs(jobs, {
        roles: profileMeta?.targetRoles ?? [],
        sectors: profileMeta?.targetSectors ?? [],
      }),
    [jobs, profileMeta],
  );
  const hasUnscored = eligibleJobs.some((j) => j.score == null);
  const eligibleIds = useMemo(() => new Set(eligibleJobs.map((j) => j.id)), [eligibleJobs]);
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
    // Mirror the row into `applications` too (default status 'applied'), so the
    // company's other roles collapse out of the queue in the same tick.
    setApplications((prev) => [...prev.filter((a) => a.job_id !== job.id), { job_id: job.id, status: "applied" }]);
    // Carry the job's identity alongside, so applying a role that is NOT in the live
    // pool (an expired role applied from the Saved section) still resolves to its
    // company for the collapse — the same reason the load path fetches these rows.
    setAppliedJobsRaw((prev) =>
      prev.some((j) => j.id === job.id)
        ? prev
        : [...prev, { id: job.id, company: job.company, company_id: job.company_id ?? null }],
    );
    const { error } = await supabase
      .from("applications")
      .upsert({ user_id: user.id, job_id: job.id }, { onConflict: "user_id,job_id" });
    if (error) {
      setApplied((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
      setApplications((prev) => prev.filter((a) => a.job_id !== job.id));
      setAppliedJobsRaw((prev) => prev.filter((j) => j.id !== job.id));
      toast.error("Couldn't mark as applied. Please try again.");
      return;
    }
    // Only call site left using this hook's markApplied is Today (issue #89) —
    // RolesMap routes "apply" through /apply, which fires its own from:"apply".
    track("application_marked_applied", { from: "today" });
    // Applied ⇒ leaves Saved (Rober 7-16): the role lives on the applications board
    // now; keeping the bookmark too is clutter. Best-effort — never blocks the apply.
    if (saved.has(job.id)) {
      setSaved((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
      await supabase.from("saved_jobs").delete().eq("user_id", user.id).eq("job_id", job.id);
    }
  };

  // Save / unsave a role for later (Rober 7-15). Optimistic toggle against the
  // saved_jobs table; rolls back + toasts on failure, same idiom as markApplied.
  const toggleSaved = async (job: RoleJob) => {
    if (!user) return;
    const wasSaved = saved.has(job.id);
    setSaved((prev) => {
      const next = new Set(prev);
      if (wasSaved) next.delete(job.id);
      else next.add(job.id);
      return next;
    });
    const { error } = wasSaved
      ? await supabase.from("saved_jobs").delete().eq("user_id", user.id).eq("job_id", job.id)
      : await supabase.from("saved_jobs").upsert({ user_id: user.id, job_id: job.id }, { onConflict: "user_id,job_id" });
    if (error) {
      setSaved((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.add(job.id);
        else next.delete(job.id);
        return next;
      });
      toast.error(wasSaved ? "Couldn't remove from saved. Please try again." : "Couldn't save. Please try again.");
    }
  };

  // Dismiss / restore a role (issue #73 slice 4). "Not interested" is the missing
  // half of the queue: without it the same rejected match keeps nagging from the top
  // forever. Optimistic toggle against dismissed_jobs, same idiom as toggleSaved.
  const toggleDismissed = async (job: RoleJob) => {
    if (!user) return;
    const wasDismissed = dismissed.has(job.id);
    setDismissed((prev) => {
      const next = new Set(prev);
      if (wasDismissed) next.delete(job.id);
      else next.add(job.id);
      return next;
    });
    // Keep the undo list populated for a role dismissed straight from the queue.
    if (!wasDismissed) setDismissedJobsRaw((prev) => (prev.some((j) => j.id === job.id) ? prev : [...prev, job]));
    // Dev-only walk (VITE_E2E_BYPASS_AUTH): the mock user's insert is refused by RLS,
    // which would roll the row straight back and make the control look broken. Keep
    // the state local instead — nothing is persisted, exactly as the gate intends.
    if (DEV_FIXTURE) return;
    const { error } = wasDismissed
      ? await supabase.from("dismissed_jobs").delete().eq("user_id", user.id).eq("job_id", job.id)
      : await supabase
          .from("dismissed_jobs")
          .upsert({ user_id: user.id, job_id: job.id }, { onConflict: "user_id,job_id" });
    if (error) {
      setDismissed((prev) => {
        const next = new Set(prev);
        if (wasDismissed) next.add(job.id);
        else next.delete(job.id);
        return next;
      });
      toast.error(
        wasDismissed ? "Couldn't restore this role. Please try again." : "Couldn't hide this role. Please try again.",
      );
    }
  };

  // Persist edited target labels to the profile (Settings, Rober 7-15). Roles/sectors
  // don't feed the 5 score subscores, so cached scores stay valid — but they DO drive
  // the scoring prefilter (#114): a widened selection surfaces new unscored eligible
  // rows here, and the worker picks them up as fresh backlog on its next tick.
  const saveTargets = async (roles: string[], sectors: string[]): Promise<boolean> => {
    if (!user) return false;
    const { error } = await supabase
      .from("profiles")
      .update({ target_roles: roles, target_sectors: sectors })
      .eq("id", user.id);
    if (error) {
      toast.error("Couldn't save your settings. Please try again.");
      return false;
    }
    setProfile((p) => (p ? { ...p, target_roles: roles, target_sectors: sectors } : p));
    setProfileMeta((m) => (m ? { ...m, targetRoles: roles, targetSectors: sectors } : m));
    return true;
  };

  /**
   * Replace the stored connections upload with a freshly parsed one (issue #41,
   * from /settings). Replace-not-merge on purpose: the LinkedIn export is a full
   * snapshot, so the stored set should be exactly the latest file. Chunked
   * inserts keep each request bounded. Returns true on success; a mid-way
   * failure surfaces a toast and the user re-uploads (the next upload wipes and
   * rewrites, so a partial state never survives a retry).
   */
  const saveConnections = async (rows: ParsedConnection[]): Promise<boolean> => {
    if (!user || rows.length === 0) return false;
    const { error: delErr } = await supabase.from("connections").delete().eq("user_id", user.id);
    if (delErr) {
      toast.error("Couldn't save your connections. Please try again.");
      return false;
    }
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase.from("connections").insert(
        rows.slice(i, i + CHUNK).map((r) => ({
          user_id: user.id,
          full_name: r.fullName,
          company: r.company,
          company_key: r.companyKey,
          position: r.position,
          linkedin_url: r.linkedinUrl,
          connected_on: r.connectedOn,
        })),
      );
      if (error) {
        toast.error("Couldn't save your connections. Please try again.");
        return false;
      }
    }
    setConnections(
      rows.map((r) => ({
        fullName: r.fullName,
        company: r.company,
        companyKey: r.companyKey,
        position: r.position,
        linkedinUrl: r.linkedinUrl,
      })),
    );
    setConnectionsUpdatedAt(new Date().toISOString());
    // Counts only — never names, companies or the file itself (issue #89 rule).
    track("connections_uploaded", { connection_count: rows.length });
    return true;
  };

  /** Remove the whole connections upload (issue #41): every row goes, and every
   *  warm marker disappears with it. */
  const removeConnections = async (): Promise<boolean> => {
    if (!user) return false;
    const { error } = await supabase.from("connections").delete().eq("user_id", user.id);
    if (error) {
      toast.error("Couldn't remove your connections. Please try again.");
      return false;
    }
    setConnections([]);
    setConnectionsUpdatedAt(null);
    track("connections_removed");
    return true;
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

  // Saved roles for the Today section: live saved roles (enriched, score-carrying) plus
  // any saved role that has since expired out of the live pool (from savedJobsRaw),
  // filtered by the current saved set so unsaving drops them immediately (Rober 7-15).
  const savedJobs = useMemo(() => {
    const byId = new Map<string, RoleJob>();
    for (const j of savedJobsRaw) if (saved.has(j.id)) byId.set(j.id, j);
    for (const j of jobs) if (saved.has(j.id)) byId.set(j.id, j);
    return [...byId.values()];
  }, [jobs, saved, savedJobsRaw]);

  // Dismissed roles for the /settings undo list — same live-row-wins merge as
  // savedJobs, filtered by the current set so restoring drops them immediately.
  const dismissedJobs = useMemo(() => {
    const byId = new Map<string, RoleJob>();
    for (const j of dismissedJobsRaw) if (dismissed.has(j.id)) byId.set(j.id, j);
    for (const j of jobs) if (dismissed.has(j.id)) byId.set(j.id, j);
    return [...byId.values()];
  }, [jobs, dismissed, dismissedJobsRaw]);

  // Companies with a LIVE conversation (issue #73 slice 2): their other roles
  // collapse out of the action queue. Rejected/closed companies are absent here,
  // so they resurface on a new role.
  // The pool is the live jobs PLUS the applied roles' own rows: a dead applied
  // posting is absent from `jobs`, and resolving against `jobs` alone would silently
  // stop collapsing that company mid-conversation. appliedJobsRaw leads so it still
  // resolves if the live pool is empty; falling back to `jobs` keeps the collapse
  // working if that fetch ever comes back empty.
  const inFlightCompanies = useMemo(
    () => inFlightCompanyKeys([...appliedJobsRaw, ...jobs], applications, isInFlightStatus),
    [jobs, appliedJobsRaw, applications],
  );

  // Warm-contact lookup (issue #41): company key → who the user knows there.
  // Consumed per card row on Today; empty map (no upload) short-circuits every
  // lookup, so users without an upload pay nothing.
  const warmIndex = useMemo(() => buildWarmIndex(connections), [connections]);

  return {
    jobs,
    loading,
    // "Scoring" now means the SERVER pass hasn't drained this user's backlog yet
    // (the worker runs regardless; this drives the panel's progress bar).
    scoring: Boolean(user) && hasCv && hasUnscored && !loading,
    remaining: eligibleJobs.filter((j) => j.score == null).length,
    /** Ids of the roles this user's paid pass covers (#114). Surfaces that render
     *  a pending state need it: an unscored role OUTSIDE this set never scores,
     *  so "Scoring this role…" would be a permanent lie (see scoreStatusOf). */
    eligibleIds,
    applied,
    markApplied,
    saved,
    savedJobs,
    toggleSaved,
    /** Roles the user said no to (issue #73 slice 4) — excluded from the queue + rail. */
    dismissed,
    dismissedJobs,
    toggleDismissed,
    /** companyKey() set of companies with an in-flight application (issue #73 slice 2). */
    inFlightCompanies,
    /** Warm contacts (issue #41): lookup for the card marker, count + date for
     *  /settings, save/remove for the upload flow. Never touches scoring. */
    warmIndex,
    connectionsCount: connections.length,
    connectionsUpdatedAt,
    saveConnections,
    removeConnections,
    saveTargets,
    scoreMore,
    submitCv,
    /** Post-CV state: the score reveal keys on a CV being present. */
    scored: Boolean(profile?.cv_text?.trim()),
    signedIn: Boolean(user),
    /** Stored CV text (profile view, issue #43) — null until a signed-in user has one. */
    cvText: profile?.cv_text ?? null,
    /** Picked labels + last-write date (profile view, issue #43). */
    profileMeta,
    /** True once the signed-in profile row has actually been fetched. The routed
     *  /settings page MUST gate on this (review 7-25): rendering the panel off
     *  the pre-fetch defaults shows "No CV on file" to users who have one, and a
     *  chip edit seeded from the empty defaults can SAVE over stored targets. */
    profileChecked,
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
