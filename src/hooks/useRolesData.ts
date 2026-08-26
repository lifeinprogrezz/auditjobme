import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/components/ui/sonner";
import type { ScoreableProfile } from "@/lib/score";
import type { ScoreSubscore, ScoreEvidence } from "@/lib/scorePrompt";
import { applyLandedScores, byScore, type RoleJob } from "@/lib/roles";
import { inFlightCompanyKeys } from "@/lib/product";
import { isInFlightStatus } from "@/lib/tracker";
import { hashCv, readCvStash, clearCvStash, normalizeTargetRoles } from "@/lib/labels";
import { normalizeTargetSectors } from "@/lib/sectors";
import { prefilterJobs } from "@/lib/scorePrefilter";
import { shouldPromptCv } from "@/lib/deviceSession";
import { cityOf, coordsOf } from "@/lib/geo";
import { domainFor } from "@/lib/logodev";
import type { DataplaneCompany, DataplaneOffice } from "@/lib/dataplane";
import { DEV_FIXTURE, DEV_FIXTURE_PROFILE, devFixtureScores } from "@/lib/devFixture";
import { createScoreBuffer, type ScoreBuffer } from "@/lib/scoreCoalescer";
import { buildWarmIndex, type ParsedConnection, type WarmContact } from "@/lib/connections";
import { track } from "@/lib/analytics";
import {
  parseAndSaveCv,
  ensureCvStructured,
  CV_STRUCTURED_CLEAR,
  isMissingCvStructuredColumn,
} from "@/lib/cvParse";
import {
  applicationsQuery,
  connectionsQuery,
  dismissedQuery,
  fetchScores,
  profileQuery,
  publicPoolQuery,
  rolesKeys,
  savedQuery,
  scoresQuery,
  type ApplicationsData,
  type ConnectionRow,
  type JobsRow,
  type ProfileRow,
  type RoleSetData,
  type ScoreRow,
} from "@/lib/rolesQueries";

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

// Stable empties. Every derived list below is memoized on its query's data, so a
// fresh `[]` per render would rebuild the whole map on every render.
const NO_SCORES: ScoreRow[] = [];
const NO_CONNECTIONS: ConnectionRow[] = [];
const NO_APPLICATIONS: ApplicationsData = { applications: [], jobRows: [] };
const NO_ROLE_SET: RoleSetData = { ids: [], rows: [] };

/** scores rows → the map applyLandedScores merges. A row with a null score is left
 *  out: it is not a number anyone can rank on, and the role stays honestly unscored. */
function landedScoreMap(rows: ScoreRow[]): Map<string, LandedScore> {
  const out = new Map<string, LandedScore>();
  for (const s of rows) {
    if (s.score == null) continue;
    const sig = s.signals as ScoreSignals;
    out.set(s.job_id, {
      score: Number(s.score),
      reason: sig?.reason ?? null,
      fitBullets: sig?.fit_bullets ?? null,
      subscores: sig?.subscores ?? null,
      evidence: sig?.evidence ?? null,
    });
  }
  return out;
}

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

// Companies without a street office fan out on a golden-angle disc around the
// city centroid. Base radius ~0.85km (the old per-role sunflower spread ~6km
// and dropped logos in the Mediterranean/port) — but a dense city with dozens
// of office-less companies stacks pins at that fixed radius (issue #153 item
// B2: 1Password, Adobe and hundreds more landed exactly on top of each other
// in Barcelona/London/Berlin). The radius now grows with how many companies
// actually share the disc, capped so it still never reaches the sea.
const CO_DISC_DEG = 0.0085;
const CO_DISC_DEG_MAX = 0.03;
/** Per-city disc radius (degrees) for the n companies with no matched office
 *  sharing it. n=10 (a typical smaller city) reproduces the original fixed
 *  0.0085; a city with 30+ such companies (Barcelona, London, Berlin) fans out
 *  further, capped at CO_DISC_DEG_MAX. Pure — pinned by
 *  src/test/roles-disc-radius.test.ts. */
export function discRadiusFor(n: number): number {
  return Math.min(CO_DISC_DEG_MAX, CO_DISC_DEG * Math.sqrt(n / 10));
}
function centroidPlace(centroid: [number, number], idx: number, n: number): [number, number] {
  const a = idx * 2.399963; // golden angle; idx is the company's stable rank among office-less peers in the city
  const radius = discRadiusFor(n);
  const r = radius * Math.sqrt((idx + 0.5) / Math.max(n, 1));
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
  const companyIdByGroup = new Map<string, string | null>(); // `${city}|${co}` -> a representative company_id
  for (const r of rows) {
    const city = cityOf(r.location);
    cityById.set(r.id, city);
    if (city) {
      const set = companiesByCity.get(city) ?? new Set<string>();
      set.add(normName(r.company));
      companiesByCity.set(city, set);
      const gk = `${city}|${normName(r.company)}`;
      if (!companyIdByGroup.has(gk)) companyIdByGroup.set(gk, r.company_id);
    }
  }
  // Pass 1: every company that HAS a matched office gets its position now, at
  // the real coordinate — it never touches the sunflower disc. Everything else
  // queues up per city, in stable sorted order, so the disc's radius (below)
  // can be sized to the group that will actually share it.
  const posByGroup = new Map<string, [number, number] | null>(); // `${city}|${co}` -> shared point
  const needsDiscByCity = new Map<string, string[]>(); // city -> [`${city}|${co}`, ...] sorted
  for (const [city, set] of companiesByCity) {
    const centroid = coordsOf(city);
    const queue: string[] = [];
    for (const cn of [...set].sort()) {
      const gk = `${city}|${cn}`;
      const companyId = companyIdByGroup.get(gk);
      let pos: [number, number] | null = null;
      if (centroid) {
        const cands: [number, number][] = companyId ? [...(officesBySlug.get(companyId) ?? [])] : [];
        const dim = companyId ? dims.get(companyId) : undefined;
        if (dim && dim.lat != null && dim.lng != null) cands.push([dim.lng, dim.lat]);
        pos = officeFor(centroid, cands);
      }
      if (pos) posByGroup.set(gk, pos);
      else queue.push(gk);
    }
    if (queue.length) needsDiscByCity.set(city, queue);
  }
  // Pass 2: place the office-less queue on the disc, radius sized to ITS count.
  for (const [city, queue] of needsDiscByCity) {
    const centroid = coordsOf(city);
    const n = queue.length;
    queue.forEach((gk, idx) => {
      posByGroup.set(gk, centroid ? centroidPlace(centroid, idx, n) : null);
    });
  }
  const posFor = (city: string | null, r: JobsRow): [number, number] | null => {
    if (!city) return null;
    return posByGroup.get(`${city}|${normName(r.company)}`) ?? null;
  };
  return rows.map((r) => {
    const city = cityById.get(r.id) ?? null;
    const dim = r.company_id ? dims.get(r.company_id) : undefined;
    return {
      ...r,
      score: null,
      reason: null,
      fitBullets: null,
      subscores: null,
      evidence: null,
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

/** A RoleJob narrowed back to the stored columns, for the optimistic push into a
 *  cached saved/dismissed set (the enrichment is re-derived from these). */
function toJobsRow(job: RoleJob): JobsRow {
  return {
    id: job.id,
    company: job.company,
    title: job.title,
    url: job.url,
    location: job.location,
    remote: job.remote,
    source: job.source,
    seniority: job.seniority,
    posted_at: job.posted_at,
    first_seen_at: job.first_seen_at ?? null,
    company_id: job.company_id ?? null,
    extraction: job.extraction ?? null,
    role_family: job.role_family ?? null,
    workplace: job.workplace ?? null,
    has_jd: job.has_jd ?? null,
  };
}

// The server-side backlog worker (api/score-backlog.ts, issue #33) is the only
// scorer now; the page POLLS landed scores at this cadence while any visible
// role is unscored, so the map fills in live without the page doing the paying.
const SCORE_POLL_MS = 20_000;

/**
 * Data plane for the /roles page. The reads live in the TanStack Query cache
 * (issue #152, `src/lib/rolesQueries.ts`), keyed by USER ID: a route change or a
 * tab focus reuses them instead of blanking the page, and a new user object with
 * the same id — which supabase-js hands out on every token refresh — changes
 * nothing. Scoring is SERVER-SIDE (the backlog worker, issue #33): this hook only
 * reads `scores`, polling while unscored roles remain so results land in front of
 * the user — leaving the page never stops a pass.
 */
export function useRolesData() {
  const { user } = useAuth();
  // The id, never the object: supabase-js (autoRefreshToken + persistSession)
  // emits a NEW session, and so a new User object, on tab focus. Keyed on the
  // object, every read below re-ran on every focus (issue #152 items E6/F1).
  const userId = user?.id ?? null;
  const signedIn = Boolean(userId);
  const queryClient = useQueryClient();

  const poolQ = useQuery(publicPoolQuery());
  const scoresQ = useQuery({ ...scoresQuery(userId), enabled: signedIn });
  const applicationsQ = useQuery({ ...applicationsQuery(userId), enabled: signedIn });
  const savedQ = useQuery({ ...savedQuery(userId), enabled: signedIn });
  const dismissedQ = useQuery({ ...dismissedQuery(userId), enabled: signedIn });
  const connectionsQ = useQuery({ ...connectionsQuery(userId), enabled: signedIn });
  const profileQ = useQuery({ ...profileQuery(userId), enabled: signedIn });

  // Work sitting in an open Anthropic batch (#96), read from the user's own
  // score_batches rows. Drives the progress bar's "Collecting the rest" phase
  // (#149) — the one state the score count alone cannot tell you about.
  const [batchPending, setBatchPending] = useState(false);
  // The pre-redirect CV stash is being written to the profile right now. Held
  // separately from the reads so `profileChecked` stays false across the write.
  const [handoffBusy, setHandoffBusy] = useState(false);
  const handoffDoneFor = useRef<string | null>(null);
  // Whose data this render belongs to. Async loops compare against it so a reply
  // that arrives after a user change is dropped instead of landing in the new
  // user's view.
  const currentUserRef = useRef<string | null>(userId);
  useEffect(() => {
    currentUserRef.current = userId;
  }, [userId]);

  // ── Companies dimension (~600 rows): real logo domains beat the name-guess,
  // street office coords beat the sunflower scatter. Failure degrades to guess +
  // centroid, never blocks.
  const companies = poolQ.data?.companies;
  const offices = poolQ.data?.offices;
  const poolJobs = poolQ.data?.jobs;
  const dims = useMemo(() => {
    const m = new Map<string, CompanyDim>();
    (companies ?? []).forEach((c: DataplaneCompany) =>
      m.set(c.slug, {
        logo_domain: c.logo_domain, lat: c.lat, lng: c.lng,
        website: c.website, sector: c.sector, stage: c.stage,
        headcount_bucket: c.headcount_bucket, hq_city: c.hq_city, hq_country: c.hq_country,
        linkedin_url: c.linkedin_url, description: c.description, founded_year: c.founded_year,
        uk_sponsor_status: c.uk_sponsor_status,
      }),
    );
    return m;
  }, [companies]);
  // Per-city offices: a company hiring in several cities gets each pin on the
  // right office (distance-matched). Empty until seeded — degrades to the single
  // companies coord, never blocks.
  const officesBySlug = useMemo(() => {
    const m = new Map<string, [number, number][]>();
    (offices ?? []).forEach((o: DataplaneOffice) => {
      const arr = m.get(o.company_slug) ?? [];
      arr.push([o.lng, o.lat]);
      m.set(o.company_slug, arr);
    });
    return m;
  }, [offices]);

  const enriched = useMemo(
    () => enrichAll(poolJobs ?? [], dims, officesBySlug),
    [poolJobs, dims, officesBySlug],
  );
  // ── Issue #54, the non-urgent half. THE DEFERRAL LIVES HERE, and it has to: a
  // `startTransition` around the cache write does nothing, because `useQuery` subscribes
  // through `useSyncExternalStore` (store-change re-renders are scheduled on SyncLane
  // whatever transition the write sat in) and TanStack's notifyManager batches the
  // notification into a `setTimeout(0)` that has left the transition's scope by the time
  // it runs. `useDeferredValue` is the version React honours: every rebuild downstream of
  // `landed` — the jobs sort, the Today queue, the map facets and markers — re-renders at
  // transition priority, so a click during a scoring drain interrupts it instead of
  // waiting behind it. Pinned by src/test/score-deferral.test.ts; do not inline
  // `scoresQ.data` back into the memo.
  const deferredScores = useDeferredValue(scoresQ.data);
  const landed = useMemo(() => landedScoreMap(deferredScores ?? NO_SCORES), [deferredScores]);
  // #130 lives inside applyLandedScores: a score held by a role with no description
  // is not applied, so the role renders as unscored and cannot rank on a stale row.
  const jobs = useMemo(() => {
    const merged = applyLandedScores(enriched, landed, false);
    // Dev-only (VITE_E2E_BYPASS_AUTH under vite dev): the mock user has no JWT, so
    // the scores read returns nothing and every authed surface renders empty. Fill
    // the gaps with obviously-labelled synthetic scores so an automated walk can
    // reach the queue, the dismiss control and the "+N more" affordance. Folded out
    // of production builds — see lib/devFixture.ts.
    const withFixture = DEV_FIXTURE ? devFixtureScores(merged) : merged;
    return withFixture.sort(byScore);
  }, [enriched, landed]);

  const applicationsData = applicationsQ.data ?? NO_APPLICATIONS;
  const applications = applicationsData.applications;
  // The applied roles' OWN job rows, fetched by id WITHOUT the is_live filter. The
  // in-flight company collapse must be LIVENESS-INDEPENDENT — career-ops' appliedCos
  // is — and postings routinely close mid-conversation.
  const appliedJobsRaw = applicationsData.jobRows;
  const applied = useMemo(() => new Set(applications.map((a) => a.job_id)), [applications]);

  const savedData = savedQ.data ?? NO_ROLE_SET;
  const saved = useMemo(() => new Set(savedData.ids), [savedData]);
  const savedJobsRaw = useMemo(
    () => enrichAll(savedData.rows, dims, officesBySlug),
    [savedData, dims, officesBySlug],
  );
  const dismissedData = dismissedQ.data ?? NO_ROLE_SET;
  const dismissed = useMemo(() => new Set(dismissedData.ids), [dismissedData]);
  const dismissedJobsRaw = useMemo(
    () => enrichAll(dismissedData.rows, dims, officesBySlug),
    [dismissedData, dims, officesBySlug],
  );

  // Warm contacts (issue #41): the user's own LinkedIn connections upload, read
  // whole so the Today cards can mark "You know N people here". Information only —
  // NEVER fed into scoring (deliberate divergence from the personal engine).
  const connectionRows = connectionsQ.data ?? NO_CONNECTIONS;
  const connections = useMemo<WarmContact[]>(
    () =>
      connectionRows.map((r) => ({
        fullName: r.full_name,
        company: r.company,
        companyKey: r.company_key,
        position: r.position,
        linkedinUrl: r.linkedin_url,
      })),
    [connectionRows],
  );
  const connectionsUpdatedAt = useMemo(
    () =>
      connectionRows.reduce<string | null>(
        (acc, r) => (acc == null || r.created_at > acc ? r.created_at : acc),
        null,
      ),
    [connectionRows],
  );

  const profileRow = profileQ.data ?? null;
  const profile = useMemo<ScoreableProfile | null>(() => {
    if (profileRow) return profileRow as ScoreableProfile;
    // Same dev-only gate as the fixture scores: `scored` is Boolean(profile.cv_text),
    // and the mock user has no profile row, so without this /today never leaves its
    // "add your CV" empty state and the walk sees nothing.
    return DEV_FIXTURE ? DEV_FIXTURE_PROFILE : null;
  }, [profileRow]);
  const profileMeta = useMemo<ProfileMeta | null>(() => {
    if (profileRow) {
      // Vocabulary shim (issue #70). The migration rewrites the stored rows, but a
      // profile written between deploy and migration — or by a browser tab still
      // running the previous bundle — can still hold a retired archetype or sector
      // variant. Translating on read means such a value narrows the view instead of
      // matching nothing and rendering permanent "Not scored".
      return {
        targetRoles: normalizeTargetRoles(profileRow.target_roles),
        targetSectors: normalizeTargetSectors(profileRow.target_sectors),
        cvUpdatedAt: profileRow.updated_at ?? null,
      };
    }
    // A jobs.role_family value, not a display string: "Product Manager" was in none
    // of the three old vocabularies and matched nothing (issue #70).
    return DEV_FIXTURE ? { targetRoles: ["product"], targetSectors: [], cvUpdatedAt: null } : null;
  }, [profileRow]);

  // Same gate the map used to apply after its first setJobs: the catalogue and this
  // user's scores. Everything else fills in behind it.
  const loading = poolQ.isPending || (signedIn && scoresQ.isPending);

  // ── Score-arrival coalescer (issue #54). Each poll pushes its landed-score snapshot
  // here instead of committing directly; the buffer merges snapshots that bunch up
  // (initial-load handoff + a manual "check now" + a poll can fire in the same tick)
  // into ONE commit, so a drain costs one derived rebuild per flush instead of one per
  // reply. Each poll's map is a full snapshot, so the merged union IS the freshest
  // complete set and can replace the cached rows outright.
  //
  // This half is the COALESCING only. Making the resulting rebuild non-urgent is the
  // `useDeferredValue` above — wrapping this write in `startTransition` looked like it
  // did the job and did not, for the reasons written there.
  const commitScoresRef = useRef<(rows: ScoreRow[]) => void>(() => {});
  useEffect(() => {
    commitScoresRef.current = (rows) => {
      const uid = currentUserRef.current;
      if (!uid) return;
      queryClient.setQueryData(rolesKeys.scores(uid), rows);
    };
  }, [queryClient]);
  const scoreBufferRef = useRef<ScoreBuffer<ScoreRow> | null>(null);
  if (scoreBufferRef.current === null) {
    scoreBufferRef.current = createScoreBuffer<ScoreRow>((merged) =>
      commitScoresRef.current([...merged.values()]),
    );
  }
  // Drop any batch buffered for the previous user so it can never flush into the
  // next one's view (the cache keys already scope by id; this closes the window
  // between the fetch returning and the flush landing).
  useEffect(() => {
    const buffer = scoreBufferRef.current;
    return () => buffer?.cancel();
  }, [userId]);

  /** Pull the user's landed scores and merge them into the map. The server worker
   *  writes them continuously; this is the read side of the poll. */
  async function refreshScores(uid: string) {
    const data = await fetchScores(uid);
    if (!data.length || currentUserRef.current !== uid) return;
    scoreBufferRef.current?.push(new Map(data.map((row) => [row.job_id, row] as const)));
  }

  /** Does this user still have work sitting in an Anthropic batch (#96)? One
   *  own-row read, gated by the "Users read own score batches" RLS policy on
   *  score_batches (migration 20260726103000). It is what tells the progress bar
   *  "collecting the rest" from "still scoring": batch work is bought and waiting
   *  on the provider, which gives no latency guarantee. Any error (the table is
   *  applied by hand, so it can legitimately be absent) reads as "no batch", and
   *  the bar falls back to the scoring phase. */
  async function refreshBatchPending(uid: string) {
    const { data, error } = await supabase
      .from("score_batches")
      .select("id")
      .eq("user_id", uid)
      .eq("status", "submitted")
      .limit(1);
    if (currentUserRef.current !== uid) return;
    setBatchPending(!error && (data ?? []).length > 0);
  }

  /**
   * Ask the backlog worker to drain THIS user's slice now (issue #149).
   *
   * The cron behind api/score-backlog.ts is declared every 10 minutes and
   * throttled by GitHub to roughly hourly, so a saved CV used to sit for an hour
   * before its first score. Fire-and-forget on purpose: the caller's job is done
   * whether or not this lands, and the 20 s score poll surfaces whatever it
   * produces. Any failure is silent by design (offline, dev server with no
   * functions, rate-limited) because the cron tick is still the safety net.
   *
   * The browser never holds CRON_SECRET: api/score-kick.ts takes the user's own
   * Supabase access token, verifies it server-side, and drains for that id only.
   */
  async function kickScoringWorker() {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return; // signed out, or the dev fixture user, which has no JWT
      await fetch("/api/score-kick", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      });
    } catch {
      // Best effort. The scheduled worker still owns the backlog.
    }
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
    uid: string,
    payload: { cv_text: string; cv_hash: string; target_roles: string[]; target_sectors: string[] },
  ): Promise<boolean> {
    const cvText = payload.cv_text.trim();
    if (!cvText) return false;
    // Prior hash (score-cache key) + the stored text. A missing cv_hash column
    // pre-migration returns an error, not a throw — treat it as "no stored hash".
    const { data: hd, error: he } = await supabase
      .from("profiles")
      .select("cv_text, cv_hash")
      .eq("id", uid)
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
    const base = {
      cv_text: cvText,
      cv_hash: payload.cv_hash,
      target_roles: payload.target_roles,
      target_sectors: payload.target_sectors,
      onboarded_at: nowIso,
      updated_at: nowIso,
    };
    // A CHANGED CV retires the structured parse of the one it replaces, in the SAME
    // write (#150). Left behind, it would print the previous CV's jobs under every
    // tailored CV from here on whenever the re-parse below does not land. An
    // unchanged CV keeps its structure, so re-submitting the same file is free.
    const patch = changed ? { ...base, ...CV_STRUCTURED_CLEAR } : base;
    let { error: upErr } = await supabase.from("profiles").update(patch).eq("id", uid);
    if (upErr && isMissingCvStructuredColumn(upErr.message)) {
      // Before the #150 migration lands those two columns are unknown. Saving the CV
      // matters more than clearing them, and readCvStructuredState refuses a
      // structure older than cv_changed_at anyway, so the stale render stays
      // impossible either way.
      ({ error: upErr } = await supabase.from("profiles").update(base).eq("id", uid));
    }
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
      await supabase.from("profiles").update({ cv_changed_at: new Date().toISOString() }).eq("id", uid);
      // scores_ready_notified_at is deliberately NOT reset. That email says "we
      // finished scoring your roles", which is true once, on the first pass. A
      // refresh happens behind a user who is already here, and with scores kept
      // the completion check would read zero-pending immediately and fire a mail
      // claiming work that has not happened yet.
    }

    // Structured CV parse (issue #150): ONE language model call per CV, so every
    // tailored CV after this renders with real sections, bullets and dates instead
    // of one paragraph. Deliberately NOT awaited — the reveal below is what the
    // person is waiting for, and a parse failure only means the tailored CV keeps
    // the old plain-text render. A CV that did not change is not re-parsed.
    //
    // It fires AFTER the cv_changed_at stamp above, never before: the parse writes
    // cv_structured_at, and a stamp that lands first would read back as older than
    // the CV and be thrown away as stale on the next load.
    void (changed ? parseAndSaveCv(uid, cvText) : ensureCvStructured(uid, cvText));

    // Fresh scoreable profile — OLD columns only, so this read is pre-migration safe.
    const { data: fresh } = await supabase
      .from("profiles")
      .select("target_seniority, target_cities, open_to_remote, citizenship, eu_work_authorized, languages, cv_text")
      .eq("id", uid)
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
      // Same local blanking as before: the map drops back to unscored until the
      // worker's refreshed numbers land through the poll.
      queryClient.setQueryData(rolesKeys.scores(uid), NO_SCORES);
    }
    // Flip `scored` false→true → the CSS reveal + FitChip count-up fire
    // in-session. This flip is what reveals the map, so success resolves HERE.
    // Scores arrive from the SERVER worker (issue #33) — the poll effect
    // surfaces them as they land; the panel's "Scoring… N to go" bar tracks it.
    // Profile view (issue #43): reflect the write we just made, no re-fetch needed
    // — we already know exactly what landed.
    queryClient.setQueryData<ProfileRow | null>(rolesKeys.profile(uid), {
      target_seniority: prof.target_seniority,
      target_cities: prof.target_cities,
      open_to_remote: prof.open_to_remote,
      citizenship: prof.citizenship,
      eu_work_authorized: prof.eu_work_authorized,
      languages: prof.languages,
      cv_text: cvText,
      target_roles: payload.target_roles,
      target_sectors: payload.target_sectors,
      updated_at: nowIso,
    });
    // #149: the CV is stored, so the worker has something to score. Ask for the
    // drain now rather than waiting on the schedule. Never awaited: the reveal
    // above is what this function promises.
    void kickScoringWorker();
    return true;
  }

  // ── Post-OAuth CV handoff (Phase A): a CV stashed before the sign-in redirect is
  // written to the profile now, then revealed. Only when the profile has no CV yet
  // (never clobber an existing one). Scoring itself is the server worker's job.
  const profileFetched = profileQ.isFetched;
  const stashPending = Boolean(readCvStash());
  const stashOutstanding =
    signedIn && !DEV_FIXTURE && stashPending && profileFetched && !profileRow?.cv_text?.trim();
  useEffect(() => {
    if (!userId || !stashOutstanding || handoffDoneFor.current === userId) return;
    handoffDoneFor.current = userId;
    const stash = readCvStash();
    if (!stash) return;
    clearCvStash();
    setHandoffBusy(true);
    void applyCv(userId, {
      cv_text: stash.cv_text,
      cv_hash: stash.cv_hash,
      // Same shim as the profile read above, and it matters MORE here: the stash is
      // written by the bundle the user had before the OAuth redirect and read by the
      // one they have after, so a sign-up started before this deploy would otherwise
      // write a retired archetype into a brand-new profile row (issue #70).
      target_roles: normalizeTargetRoles(stash.target_roles),
      target_sectors: normalizeTargetSectors(stash.target_sectors),
    }).finally(() => setHandoffBusy(false));
    // applyCv is re-created every render; the ref guard above is what makes this
    // run exactly once per signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, stashOutstanding]);

  /** True once every own-row read has landed AND any pre-redirect CV stash has been
   *  handed off — the earliest moment `needsCv` and the routed /settings page can be
   *  trusted. It covers the whole set, not just the profile, because Settings renders
   *  the dismissed list and the connections count off the same gate. `isFetched` (not
   *  `isFetchedAfterMount`) is the load-bearing choice: a cached read satisfies it on
   *  the FIRST render of a revisit, which is what removes the loading gate (#152). */
  const profileChecked =
    signedIn &&
    profileFetched &&
    scoresQ.isFetched &&
    applicationsQ.isFetched &&
    savedQ.isFetched &&
    dismissedQ.isFetched &&
    connectionsQ.isFetched &&
    !stashOutstanding &&
    !handoffBusy;

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
    if (!userId || !hasCv || !hasUnscored || loading) return;
    // #149: the batch state is read once up front so the progress bar has the
    // right phase without waiting a poll cycle, then on the same cadence.
    void refreshBatchPending(userId);
    const t = setInterval(() => {
      void refreshScores(userId);
      void refreshBatchPending(userId);
    }, SCORE_POLL_MS);
    return () => clearInterval(t);
  }, [userId, hasCv, hasUnscored, loading]);

  const markApplied = async (job: RoleJob) => {
    if (!userId) return;
    const key = rolesKeys.applications(userId);
    const prev = queryClient.getQueryData<ApplicationsData>(key) ?? NO_APPLICATIONS;
    // Mirror the row into `applications` too (default status 'applied'), so the
    // company's other roles collapse out of the queue in the same tick. Carry the
    // job's identity alongside, so applying a role that is NOT in the live pool (an
    // expired role applied from the Saved section) still resolves to its company.
    queryClient.setQueryData<ApplicationsData>(key, {
      applications: [...prev.applications.filter((a) => a.job_id !== job.id), { job_id: job.id, status: "applied" }],
      jobRows: prev.jobRows.some((j) => j.id === job.id)
        ? prev.jobRows
        : [...prev.jobRows, { id: job.id, company: job.company, company_id: job.company_id ?? null }],
    });
    const { error } = await supabase
      .from("applications")
      .upsert({ user_id: userId, job_id: job.id }, { onConflict: "user_id,job_id" });
    if (error) {
      queryClient.setQueryData<ApplicationsData>(key, prev);
      toast.error("Couldn't mark as applied. Please try again.");
      return;
    }
    // Only call site left using this hook's markApplied is Today (issue #89) —
    // RolesMap routes "apply" through /apply, which fires its own from:"apply".
    track("application_marked_applied", { from: "today" });
    // Applied ⇒ leaves Saved (Rober 7-16): the role lives on the applications board
    // now; keeping the bookmark too is clutter. Best-effort — never blocks the apply.
    if (saved.has(job.id)) {
      const savedKey = rolesKeys.saved(userId);
      const prevSaved = queryClient.getQueryData<RoleSetData>(savedKey) ?? NO_ROLE_SET;
      queryClient.setQueryData<RoleSetData>(savedKey, {
        ids: prevSaved.ids.filter((id) => id !== job.id),
        rows: prevSaved.rows,
      });
      await supabase.from("saved_jobs").delete().eq("user_id", userId).eq("job_id", job.id);
    }
  };

  /** Optimistic add/remove against a cached own-role set (saved_jobs /
   *  dismissed_jobs), rolled back on failure. One shape for both toggles. */
  const toggleRoleSet = async (
    key: readonly unknown[],
    table: "saved_jobs" | "dismissed_jobs",
    uid: string,
    job: RoleJob,
    present: boolean,
    failure: string,
  ): Promise<boolean> => {
    const prev = queryClient.getQueryData<RoleSetData>(key) ?? NO_ROLE_SET;
    queryClient.setQueryData<RoleSetData>(key, {
      ids: present ? prev.ids.filter((id) => id !== job.id) : [...prev.ids, job.id],
      // Keep the undo/Saved list populated for a role acted on straight from the queue.
      rows: present || prev.rows.some((r) => r.id === job.id) ? prev.rows : [...prev.rows, toJobsRow(job)],
    });
    // Dev-only walk (VITE_E2E_BYPASS_AUTH): the mock user's write is refused by RLS,
    // which would roll the row straight back and make the control look broken. Keep
    // the state local instead — nothing is persisted, exactly as the gate intends.
    if (DEV_FIXTURE && table === "dismissed_jobs") return true;
    const { error } = present
      ? await supabase.from(table).delete().eq("user_id", uid).eq("job_id", job.id)
      : await supabase.from(table).upsert({ user_id: uid, job_id: job.id }, { onConflict: "user_id,job_id" });
    if (error) {
      queryClient.setQueryData<RoleSetData>(key, prev);
      toast.error(failure);
      return false;
    }
    return true;
  };

  // Save / unsave a role for later (Rober 7-15). Optimistic toggle against the
  // saved_jobs table; rolls back + toasts on failure, same idiom as markApplied.
  const toggleSaved = async (job: RoleJob) => {
    if (!userId) return;
    const wasSaved = saved.has(job.id);
    await toggleRoleSet(
      rolesKeys.saved(userId),
      "saved_jobs",
      userId,
      job,
      wasSaved,
      wasSaved ? "Couldn't remove from saved. Please try again." : "Couldn't save. Please try again.",
    );
  };

  // Dismiss / restore a role (issue #73 slice 4). "Not interested" is the missing
  // half of the queue: without it the same rejected match keeps nagging from the top
  // forever. Optimistic toggle against dismissed_jobs, same idiom as toggleSaved.
  const toggleDismissed = async (job: RoleJob) => {
    if (!userId) return;
    const wasDismissed = dismissed.has(job.id);
    await toggleRoleSet(
      rolesKeys.dismissed(userId),
      "dismissed_jobs",
      userId,
      job,
      wasDismissed,
      wasDismissed ? "Couldn't restore this role. Please try again." : "Couldn't hide this role. Please try again.",
    );
  };

  // Persist edited target labels to the profile (Settings, Rober 7-15). Roles/sectors
  // don't feed the 5 score subscores, so cached scores stay valid — but they DO drive
  // the scoring prefilter (#114): a widened selection surfaces new unscored eligible
  // rows here, and the worker picks them up as fresh backlog on its next tick.
  const saveTargets = async (roles: string[], sectors: string[]): Promise<boolean> => {
    if (!userId) return false;
    const { error } = await supabase
      .from("profiles")
      .update({ target_roles: roles, target_sectors: sectors })
      .eq("id", userId);
    if (error) {
      toast.error("Couldn't save your settings. Please try again.");
      return false;
    }
    queryClient.setQueryData<ProfileRow | null>(rolesKeys.profile(userId), (prev) =>
      prev ? { ...prev, target_roles: roles, target_sectors: sectors } : prev,
    );
    // #149: new targets widen or move the paid slice, so there is fresh backlog
    // the moment this write lands. Same fire-and-forget as the CV path.
    void kickScoringWorker();
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
    if (!userId || rows.length === 0) return false;
    const { error: delErr } = await supabase.from("connections").delete().eq("user_id", userId);
    if (delErr) {
      toast.error("Couldn't save your connections. Please try again.");
      return false;
    }
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase.from("connections").insert(
        rows.slice(i, i + CHUNK).map((r) => ({
          user_id: userId,
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
    const nowIso = new Date().toISOString();
    queryClient.setQueryData<ConnectionRow[]>(
      rolesKeys.connections(userId),
      rows.map((r) => ({
        full_name: r.fullName,
        company: r.company,
        company_key: r.companyKey,
        position: r.position,
        linkedin_url: r.linkedinUrl,
        created_at: nowIso,
      })),
    );
    // Counts only — never names, companies or the file itself (issue #89 rule).
    track("connections_uploaded", { connection_count: rows.length });
    return true;
  };

  /** Remove the whole connections upload (issue #41): every row goes, and every
   *  warm marker disappears with it. */
  const removeConnections = async (): Promise<boolean> => {
    if (!userId) return false;
    const { error } = await supabase.from("connections").delete().eq("user_id", userId);
    if (error) {
      toast.error("Couldn't remove your connections. Please try again.");
      return false;
    }
    queryClient.setQueryData<ConnectionRow[]>(rolesKeys.connections(userId), NO_CONNECTIONS);
    track("connections_removed");
    return true;
  };

  /** Manual "check now" — an immediate scores pull, ahead of the next poll tick.
   *  Kept for the RolesPanel prop surface; scoring itself is server-side. */
  const scoreMore = () => {
    if (!userId || !profile?.cv_text?.trim()) return;
    void refreshScores(userId);
  };

  /**
   * Signed-in CV submit (from the CV-unlock modal): write the CV + labels to the
   * profile and reveal + score in-session. The anon path stashes instead and the
   * handoff effect above picks it up after sign-in. Returns true on success.
   */
  const submitCv = async (
    text: string,
    labels: { roles: string[]; sectors: string[] },
  ): Promise<boolean> => {
    if (!userId) return false;
    const cvText = text.trim();
    if (!cvText) return false;
    return applyCv(userId, {
      cv_text: cvText,
      cv_hash: hashCv(cvText),
      target_roles: labels.roles,
      target_sectors: labels.sectors,
    });
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
    scoring: signedIn && hasCv && hasUnscored && !loading,
    remaining: eligibleJobs.filter((j) => j.score == null).length,
    /** Size of the paid slice (#114). The denominator of the progress bar (#149):
     *  "N to go" alone never said what it was counting down from. */
    eligibleCount: eligibleJobs.length,
    /** This user has work in an open Anthropic batch — the progress bar's
     *  "Collecting the rest" phase (#149). */
    batchPending,
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
    scored: hasCv,
    signedIn,
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
      signedIn,
      profileChecked,
      hasCv,
      stashPending,
    }),
  };
}
