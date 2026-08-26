import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import "@/styles/roles.css";
import GlobeMap from "@/components/roles/GlobeMap";
import RolesPanel from "@/components/roles/RolesPanel";
import HeadBar from "@/components/roles/HeadBar";
import CvUnlockModal from "@/components/roles/CvUnlockModal";
import { AUTH_BYPASSED, useAuth } from "@/components/AuthProvider";
import {
  EMPTY_FILTERS,
  FRESHNESS_WINDOWS,
  LEVELS,
  UK_SPONSOR_STATUSES,
  byScore,
  roleSeenMs,
  companyCityRoles,
  filterJobs,
  roleFamily,
  ROLE_FAMILY_OTHER,
  workplaceOf,
  WORKPLACES,
  sizeBand,
  sizeBandOrder,
  type RoleJob,
  type RolesFilters,
} from "@/lib/roles";
import { ROLE_FAMILY_OPTIONS } from "@/lib/labels";
import { pickableSectors, sectorLiquidity } from "@/lib/sectors";
import { coordsOf } from "@/lib/geo";
import { useRolesData } from "@/hooks/useRolesData";
import { useTheme } from "@/lib/theme";
import { BRAND_NAME } from "@/lib/brandName";

// Curated priority pool for the default "Hot right now" showcase (Rober 7-06):
// recognizable big-tech + hot young high-growth, cool-first. Each card must be a
// FRESH (<=21d) real PM role (see hotJobs) — so a company only appears when it has
// one; Mistral/Lovable sit in the pool and surface automatically the day they post
// a fresh PM role. If fewer than seven favorites are fresh, the panel backfills
// with the freshest fresh-PM roles from any other company. Slugs from companies.slug.
const HOT_PRIORITY = [
  "google", "stripe", "spotify", "revolut", "n8n_de", "mistral_ai", "lovable_se",
  "alan_fr", "pleo_dk", "adyen", "wise_it", "n26", "sumup", "getyourguide",
  "typeform_es", "celonis",
];
const HOT_COUNT = 7;
const FRESH_MS = 21 * 24 * 60 * 60 * 1000;

export default function RolesMap() {
  const {
    jobs,
    loading,
    scoring,
    remaining,
    eligibleIds,
    applied,
    saved,
    toggleSaved,
    dismissed,
    toggleDismissed,
    scoreMore,
    submitCv,
    scored,
    signedIn,
    needsCv,
  } = useRolesData();
  const { signInWithGoogle } = useAuth();
  // CV-unlock modal (Phase A front door). Opened from the "Add your CV" affordances,
  // and from the Settings page's Replace-CV deep link (?cv=1) — one shared instance.
  const [cvModalOpen, setCvModalOpen] = useState(false);
  // Warm the paper surfaces' lazy chunks while the user browses the map (Rober
  // 7-25 "smoother map↔list") — the List toggle / avatar-menu jumps then swap
  // with no "Loading…" flash. Idle-delayed past the map's own heavy startup.
  useEffect(() => {
    const t = window.setTimeout(() => {
      import("./Today").catch(() => {});
      import("./Tracker").catch(() => {});
    }, 1500);
    return () => window.clearTimeout(t);
  }, []);
  // /?cv=1 → open the CV-unlock flow and strip the param (Rober 7-25: the /settings
  // PAGE replaced the profile modal, so Replace-CV deep-links back to the map's
  // one parsed-upload flow instead of rebuilding it on paper).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("cv") !== "1") return;
    setCvModalOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("cv");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  // Post-sign-in CV gate (Rober 7-13): a session with no CV on the profile gets
  // the CV modal opened in front of it — fires once per false→true transition,
  // so closing it doesn't trap the user in a reopen loop.
  useEffect(() => {
    if (needsCv && !AUTH_BYPASSED) setCvModalOpen(true);
  }, [needsCv]);
  const [filters, setFilters] = useState<RolesFilters>(EMPTY_FILTERS);
  const [detailJob, setDetailJob] = useState<RoleJob | null>(null);
  // A panel-card click flies the map to the role's city (see openDetail); the
  // nonce forces a re-fly even when the same city is reopened.
  const [flyTarget, setFlyTarget] = useState<{ center: [number, number]; nonce: number } | null>(
    null,
  );
  // City-filter camera frame: selecting cities in the headbar frames them on the
  // map (1 → fly to it, 2+ → fit them together). Nonce re-fires each change. 7-06.
  const [cityFrame, setCityFrame] = useState<{ coords: [number, number][]; nonce: number } | null>(
    null,
  );
  // "Hot right now" is a first-impression state: once you've narrowed anything, a
  // later full clear shows the honest full list, not the curated showcase again.
  const [hasExplored, setHasExplored] = useState(false);
  // Bumped to snap an anon visitor back to the Europe landing frame (see below).
  const [europeFrame, setEuropeFrame] = useState(0);
  const [panelHidden, setPanelHidden] = useState(false);
  // Day/night lives in ONE root theme (src/lib/theme.ts, design direction §9.1); the
  // map derives its `.light` glass + basemap skin from it, so the HeadBar toggle and
  // the pages' toggle drive the same source. Initial follows the OS preference / the
  // stored choice — there is no separate map-only default any more.
  const { theme, toggle } = useTheme();
  const light = theme === "light";

  // DEV shortcut: "L" flips day/night fast — now routed through the one toggle so it
  // stays in sync with the persisted theme.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as Element | null;
      if (t && "closest" in t && t.closest("input,textarea")) return;
      if (e.key === "l" || e.key === "L") toggle();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Map→panel selection, kept OUTSIDE RolesFilters so the globe keeps rendering
  // ALL visible roles (other bubbles stay clickable) while only the PANEL narrows.
  // Company (logo click) wins over city (cluster click); each clears the other.
  // ONE map→panel selection: a company and/or a city, each independently
  // removable via a chip in the panel. A company pin sets both (Prosper +
  // Barcelona); a city cluster sets just the city. Filtering by company is
  // case-insensitive so a scraped casing variant can't split the count.
  const [sel, setSel] = useState<{ co: string | null; city: string | null }>({ co: null, city: null });
  const norm = (s: string) => s.trim().toLowerCase();

  // Dismissed roles leave the rail and the map entirely (issue #73 slice 4) — saying
  // "not interested" has to mean it everywhere, not just on /today. The catalog-scope
  // badge below still counts the WHOLE catalog: that number is about the pool we
  // scanned, not about your view.
  const pool = useMemo(() => (dismissed.size ? jobs.filter((j) => !dismissed.has(j.id)) : jobs), [jobs, dismissed]);

  const visible = useMemo(() => filterJobs(pool, filters), [pool, filters]);

  // Top-left badge is the TOTAL catalog size — always the full numbers, never the
  // filtered view (Rober 7-06). The per-view count lives in the panel's filter bar.
  const scopeRoles = jobs.length;
  const scopeCos = useMemo(
    () => new Set(jobs.map((j) => j.company_id ?? j.company)).size,
    [jobs],
  );

  // Cross-faceted option counts (Rober 7-09): each facet's counts reflect every OTHER
  // active headbar filter — pick Paris and the Sector chip now counts the sectors AMONG
  // Paris roles (descending), the same additive narrowing the panel's role count shows.
  // A facet never constrains its OWN options (its selection is reset before counting),
  // so you can always still switch or add that facet's values. Size keeps the canonical
  // ladder order; city/sector/language rank by count. (Supersedes the old full-catalog
  // counts — an option with 0 roles under the current filters simply drops out.)
  // Role vertical facet — the five families, cross-faceted like the rest.
  // VALUE and LABEL are split (issue #70): the filter clause compares against
  // roleFamily(j), which is the lowercase stored value, so the chips can read
  // "Sales" instead of "sales" without breaking the comparison. Fixed vocabulary
  // order (not count-desc) so the list does not reshuffle as you filter; an
  // option with no roles under the current filters drops out, as before.
  // "Other" is appended only when unlabelled rows are actually present.
  const roleOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of filterJobs(pool, { ...filters, roles: [] }))
      m.set(roleFamily(j), (m.get(roleFamily(j)) ?? 0) + 1);
    const known = ROLE_FAMILY_OPTIONS.filter((o) => (m.get(o.value) ?? 0) > 0).map((o) => ({
      value: o.value as string,
      label: o.label,
      count: m.get(o.value) ?? 0,
    }));
    const other = m.get(ROLE_FAMILY_OTHER) ?? 0;
    return other > 0
      ? [...known, { value: ROLE_FAMILY_OTHER, label: "Other", count: other }]
      : known;
  }, [pool, filters]);
  const levelOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of filterJobs(pool, { ...filters, levels: [] }))
      if (j.seniority) m.set(j.seniority, (m.get(j.seniority) ?? 0) + 1);
    // Keep the fixed ladder order (Junior→Executive), each with its faceted count.
    return LEVELS.map((l) => ({ value: l.value, label: l.label, count: m.get(l.value) ?? 0 }));
  }, [pool, filters]);
  // Workplace facet — fixed Remote/Hybrid/On-site order (like the Level ladder),
  // counts over roles with a KNOWN mode (discovery semantics; unknown ≈60% excluded).
  const workplaceOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of filterJobs(pool, { ...filters, workplaces: [] })) {
      const w = workplaceOf(j);
      if (w) m.set(w, (m.get(w) ?? 0) + 1);
    }
    return WORKPLACES.map((w) => ({ value: w.value, label: w.label, count: m.get(w.value) ?? 0 }));
  }, [pool, filters]);
  const cityOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of filterJobs(pool, { ...filters, cities: [] }))
      if (j.city) m.set(j.city, (m.get(j.city) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [pool, filters]);
  const sectorOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of filterJobs(pool, { ...filters, sectors: [] }))
      if (j.sector) m.set(j.sector, (m.get(j.sector) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [pool, filters]);
  // The CV-unlock modal's industry picker is a DIFFERENT list from the headbar
  // facet above (issue #70). The facet shows every live sector with a count beside
  // it, which is its own honesty mechanism. The target picker shows no count and
  // its pick is AND-ed into the paid scoring prefilter, so a sector that cannot
  // return roles costs the user their whole score run — only sectors with live
  // liquidity may be offered. Derived from the full catalog, not the filtered
  // pool: the scoring pass runs over the catalog too.
  const targetSectorOptions = useMemo(
    () => pickableSectors(sectorLiquidity(jobs)),
    [jobs],
  );
  const sizeOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of filterJobs(pool, { ...filters, sizes: [] })) {
      const b = sizeBand(j.headcount);
      if (b) m.set(b, (m.get(b) ?? 0) + 1);
    }
    return [...m.entries()]
      .sort((a, b) => sizeBandOrder(a[0]) - sizeBandOrder(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [pool, filters]);
  // Non-English languages a role explicitly requires (English is implicit); cross-faceted
  // like the others — the counts reflect the city/sector/size/etc currently selected.
  const languageOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of filterJobs(pool, { ...filters, languages: [] }))
      for (const l of j.extraction?.languages_required ?? []) {
        const s = typeof l === "string" ? l.trim() : "";
        if (s && s.toLowerCase() !== "english") m.set(s, (m.get(s) ?? 0) + 1);
      }
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [pool, filters]);

  // Freshness facet (issue #73 slice 3) — fixed 7/14/28-day ladder like the Level
  // ladder, counts over roles we can actually date (roleSeenMs). Filter only: we
  // measured age against the personal engine's scoring data on 2026-07-26 and it does
  // NOT predict match quality, so it never touches ranking.
  const freshnessOptions = useMemo(() => {
    const now = Date.now();
    const base = filterJobs(pool, { ...filters, freshness: [] }, now);
    return FRESHNESS_WINDOWS.map((w) => ({
      value: w.value,
      label: w.label,
      count: base.filter((j) => roleSeenMs(j) >= now - w.days * 86_400_000).length,
    }));
  }, [pool, filters]);
  // UK sponsor-licence facet (issue #73 slice 5): the Home Office register status is
  // already a company attribute and already a badge — this makes it filterable.
  const sponsorOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of filterJobs(pool, { ...filters, sponsors: [] }))
      if (j.ukSponsorStatus) m.set(j.ukSponsorStatus, (m.get(j.ukSponsorStatus) ?? 0) + 1);
    return UK_SPONSOR_STATUSES.map((st) => ({ value: st.value, label: st.label, count: m.get(st.value) ?? 0 }));
  }, [pool, filters]);

  // Default landing (nothing searched / filtered / selected) shows a curated
  // "hot companies" showcase — one Product role from each (Rober 7-06). The reset
  // control returns here; any search/filter/pin-click switches to real results.
  const isDefaultView =
    !sel.co &&
    !sel.city &&
    !filters.query &&
    filters.levels.length === 0 &&
    !filters.roles?.length &&
    filters.cities.length === 0 &&
    filters.sectors.length === 0 &&
    filters.sizes.length === 0 &&
    !filters.languages?.length &&
    !filters.workplaces?.length &&
    !filters.freshness?.length &&
    !filters.sponsors?.length;

  // Remember the first narrowing so a later full clear shows the honest full list
  // rather than snapping back to the curated showcase. Only the reset-view control
  // brings the showcase back (Rober 7-06).
  useEffect(() => {
    if (!isDefaultView) setHasExplored(true);
  }, [isDefaultView]);
  // Without a CV, a "score-ranked" full list is just alphabetical noise — so for an
  // anon visitor, returning to the default view snaps back to the LANDING (showcase +
  // Europe frame), exactly like the reset-view control. A scored visitor keeps the
  // genuinely ranked full list with the camera left where it was (Rober 7-06).
  useEffect(() => {
    if (isDefaultView && hasExplored && !scored) {
      setHasExplored(false);
      setEuropeFrame((n) => n + 1);
    }
  }, [isDefaultView, hasExplored, scored]);
  // Scored users (signed in + CV on file) get their genuinely fit-ranked list as the
  // DEFAULT rail ("Best fit"), not the curated showcase — the showcase is the
  // anon/no-CV landing only (Rober 7-15). For anon, !scored is always true so this is
  // unchanged; only scored users skip straight to the byScore ranking below.
  const showShowcase = isDefaultView && !scored;

  const hotJobs = useMemo(() => {
    // Each showcase card must be a FRESH (<=21d) real PM role: skip legal/EA/intern/
    // eng titles that merely contain "Product" (Rober 7-06 — Lovable was leaking
    // "Product Counsel", Mistral an "Executive Assistant"), and skip stale roles —
    // a months-old card "looks bad". Pick each company's freshest qualifying role,
    // take the priority favorites first, then backfill with the freshest fresh-PM
    // roles from any other company so the row is always seven fresh, cool cards.
    const now = Date.now();
    const BAD = /counsel|assistant|paralegal|recruit|\bintern\b|internship|graduate|designer|\bengineer\b/i;
    const GOOD =
      /product (manager|lead|owner)|head of product|group product|principal product|senior product|staff product|director of product|chief product/i;
    const freshGood = (j: RoleJob) => {
      if (!j.company_id || !j.posted_at || !GOOD.test(j.title) || BAD.test(j.title)) return false;
      const t = Date.parse(j.posted_at);
      return !Number.isNaN(t) && now - t <= FRESH_MS;
    };
    // Freshest qualifying role per company.
    const best = new Map<string, RoleJob>();
    for (const j of visible) {
      if (!freshGood(j)) continue;
      const slug = j.company_id as string;
      const cur = best.get(slug);
      if (!cur || Date.parse(j.posted_at as string) > Date.parse(cur.posted_at as string))
        best.set(slug, j);
    }
    const picked: RoleJob[] = [];
    const used = new Set<string>();
    for (const slug of HOT_PRIORITY) {
      const j = best.get(slug);
      if (j && picked.length < HOT_COUNT) {
        picked.push(j);
        used.add(slug);
      }
    }
    if (picked.length < HOT_COUNT) {
      const backfill = [...best.entries()]
        .filter(([slug]) => !used.has(slug))
        .map(([, j]) => j)
        .sort((a, b) => Date.parse(b.posted_at as string) - Date.parse(a.posted_at as string));
      for (const j of backfill) {
        if (picked.length >= HOT_COUNT) break;
        picked.push(j);
      }
    }
    return picked;
  }, [visible]);
  const panelJobs = useMemo(() => {
    if (isDefaultView) {
      if (showShowcase) {
        // First-load showcase: the seven hot cards, then every OTHER company's live
        // roles so the panel keeps scrolling (Rober 7-06).
        const hotSlugs = new Set(hotJobs.map((j) => j.company_id));
        return [...hotJobs, ...visible.filter((j) => !hotSlugs.has(j.company_id ?? null))];
      }
      // Cleared after exploring → the honest full list, score-ranked. Clearing reads
      // as "show me everything"; the camera is left where it was (no forced move).
      return [...visible].sort(byScore);
    }
    let out = visible;
    if (sel.co) out = out.filter((j) => norm(j.company) === norm(sel.co as string));
    if (sel.city) out = out.filter((j) => j.city === sel.city);
    return out;
  }, [visible, sel, isDefaultView, showShowcase, hotJobs]);

  // The click-time snapshot goes stale when a background score lands — re-read
  // the live row by id so the detail view matches the card.
  const detailLive = useMemo(
    () => (detailJob ? jobs.find((j) => j.id === detailJob.id) ?? detailJob : null),
    [detailJob, jobs],
  );

  // Personalized detail must not outlive the session.
  useEffect(() => {
    if (!signedIn) setDetailJob(null);
  }, [signedIn]);

  // The headbar City filter drives the camera: frame the selected cities so the map
  // always matches your city selection (Rober 7-06). Empty selection leaves the
  // camera untouched — the reset-view control is the one way back to Europe.
  useEffect(() => {
    if (filters.cities.length === 0) return;
    const coords = filters.cities
      .map((c) => coordsOf(c))
      .filter((c): c is [number, number] => c !== null);
    if (coords.length) setCityFrame((prev) => ({ coords, nonce: (prev?.nonce ?? 0) + 1 }));
  }, [filters.cities]);

  // Detail highlight: the selected company's cities, unjittered (mockup behavior).
  const focusLngLats = useMemo(() => {
    if (!detailLive) return null;
    const cities = [
      ...new Set(
        jobs.filter((j) => j.company === detailLive.company && j.city).map((j) => j.city as string),
      ),
    ];
    return cities.map((c) => coordsOf(c)).filter((c): c is [number, number] => c !== null);
  }, [detailLive, jobs]);

  // Opening a role from the panel list (hot showcase OR a search result) flies the
  // map to that role's city — the same reveal a city-bubble click performs — so the
  // globe never stays on the wide default while the panel shows one specific role
  // (Rober 7-06). Map pin clicks already move the camera, so they set detailJob
  // directly and bypass this.
  const openDetail = (job: RoleJob) => {
    setDetailJob(job);
    if (!job.city) return;
    // From the default showcase, adopt the clicked role's city as the panel
    // context so "All roles" returns to THAT city (matching the map, which flies
    // there) instead of snapping back to the global default. Search / city /
    // company contexts keep their existing selection. Rober 7-06.
    if (isDefaultView) setSel({ co: null, city: job.city });
    const c = coordsOf(job.city);
    if (c) setFlyTarget((prev) => ({ center: c, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  const rootClass = [
    "roles-theme",
    "page-fade",
    light && "light",
    scored && "scored",
    detailLive && "detail-open",
    panelHidden && "panel-hidden",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass}>
      <div className="stars" />
      <GlobeMap
        jobs={visible}
        scored={scored}
        focusLngLats={focusLngLats}
        flyTo={flyTarget}
        cityFrame={cityFrame}
        europeFrame={europeFrame}
        light={light}
        onCompanyClick={(company, city) => {
          // One role in this city → jump straight to its full detail; several →
          // filter the list to this company + city (Rober 2026-07-06). Either
          // way the camera holds — no zoom-out (see applyFocus in GlobeMap).
          const roles = companyCityRoles(visible, company, city);
          if (roles.length === 1) {
            // Keep the CITY context (not a full reset): open the single role, but
            // "All roles" should return to the city you were browsing, e.g.
            // Barcelona — not the global default list (Rober 7-06). The company's
            // other-city roles stay reachable via the detail's "More roles" list.
            setSel({ co: null, city });
            setDetailJob(roles[0]);
          } else {
            setSel({ co: company, city });
            setDetailJob(null);
          }
          setPanelHidden(false);
        }}
        onCityClick={(city) => {
          setSel({ co: null, city });
          setPanelHidden(false);
        }}
        onResetView={() => {
          setSel({ co: null, city: null });
          setDetailJob(null);
          setFilters(EMPTY_FILTERS);
          setHasExplored(false);
        }}
      />
      <div className="vig" />
      <div className="ui">
        <HeadBar
          scored={scored}
          signedIn={signedIn}
          filters={filters}
          onFilters={setFilters}
          roleOptions={roleOptions}
          levelOptions={levelOptions}
          workplaceOptions={workplaceOptions}
          cityOptions={cityOptions}
          sectorOptions={sectorOptions}
          sizeOptions={sizeOptions}
          languageOptions={languageOptions}
          freshnessOptions={freshnessOptions}
          sponsorOptions={sponsorOptions}
          onClearAll={() => {
            setFilters(EMPTY_FILTERS);
            setSel({ co: null, city: null });
          }}
          onAddCv={() => setCvModalOpen(true)}
          onSignIn={signInWithGoogle}
          // Brand = home: same state reset as the map's reset control, plus a camera
          // re-frame to the Europe landing (europeFrame bump eases the globe back).
          onBrand={() => {
            setSel({ co: null, city: null });
            setDetailJob(null);
            setFilters(EMPTY_FILTERS);
            setHasExplored(false);
            setEuropeFrame((n) => n + 1);
          }}
        />
        <RolesPanel
          jobs={panelJobs}
          onAddCv={() => setCvModalOpen(true)}
          // The detail's "More roles at this company" list reads allJobs — feed it the
          // dismissed-free pool so a role you said no to can't reappear there.
          allJobs={pool}
          defaultView={isDefaultView}
          filters={filters}
          onFilters={setFilters}
          selCo={sel.co}
          selCity={sel.city}
          onClearCo={() => setSel((s) => ({ ...s, co: null }))}
          onClearCity={() => setSel((s) => ({ ...s, city: null }))}
          scored={scored}
          signedIn={signedIn}
          loading={loading}
          scoring={scoring}
          eligibleIds={eligibleIds}
          remaining={remaining}
          detailJob={detailLive}
          applied={applied}
          saved={saved}
          dismissed={dismissed}
          onToggleDismissed={toggleDismissed}
          onOpenDetail={openDetail}
          onCloseDetail={() => setDetailJob(null)}
          onScoreMore={scoreMore}
          onToggleSaved={toggleSaved}
          onToggleHidden={() => setPanelHidden((v) => !v)}
        />
        <div className="scope" aria-label="Catalog scope">
          <span className="scope-cell">
            <b>{scopeRoles.toLocaleString()}</b> roles
          </span>
          <span className="scope-sep" />
          <span className="scope-cell">
            <b>{scopeCos.toLocaleString()}</b> companies
          </span>
        </div>
        {/* Creator credit — glass pill mirrored top-right of the .scope pill (Rober 7-07),
            out of the nav so expanded filters can't overflow the headbar. */}
        <div className="madeby" aria-label="Site creator">
          <span className="mb-by">
            created by <span className="mb-h">@lifeinprogrezz</span>
          </span>
          <span className="mb-sep" />
          <a className="mb-ico" href="https://x.com/lifeinprogrezz" target="_blank" rel="noopener noreferrer" aria-label="Rober on X">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
          <a className="mb-ico" href="https://www.linkedin.com/in/robertoquinterodelaiglesia/" target="_blank" rel="noopener noreferrer" aria-label="Rober on LinkedIn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.25 8h4.5v13H.25V8zm7 0h4.32v1.78h.06c.6-1.07 2.07-2.2 4.26-2.2 4.56 0 5.4 2.9 5.4 6.67V21h-4.5v-5.9c0-1.4-.03-3.2-2-3.2-2 0-2.3 1.53-2.3 3.1V21h-4.5V8z" />
            </svg>
          </a>
          {/* Northgoing is open source (MIT) — the repo sits with the creator links so a
              curious visitor finds it on the map, the only surface anons ever see.
              Renamed to `northgoing` on 2026-08-19; the old `auditjobme` slug still
              301s, but pointing at the live name avoids relying on that forever. */}
          <a className="mb-ico" href="https://github.com/lifeinprogrezz/northgoing" target="_blank" rel="noopener noreferrer" aria-label={`${BRAND_NAME} source code on GitHub`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.19.69-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.8 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
            </svg>
          </a>
        </div>
        <div className="attrib">
          {/* Privacy and Terms were deployed but UNREACHABLE: nothing in the app
              linked them, and the only occurrence in the shipped HTML sat inside
              <noscript>, which no JavaScript user ever sees. For an EU product that
              asks for a CV, "it exists at a URL" is not the same as having provided
              it. The map is the only surface an anonymous visitor sees, so the links
              live here. */}
          <Link to="/privacy">Privacy</Link>
          <span className="sep">|</span>
          <Link to="/terms">Terms</Link>
          <span className="sep">|</span>
          <span>
            ©{" "}
            <a href="https://carto.com/" target="_blank" rel="noopener noreferrer">
              CARTO
            </a>
          </span>
          <span className="sep">|</span>
          <span>
            ©{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenStreetMap
            </a>
          </span>
        </div>
      </div>
      <CvUnlockModal
        open={cvModalOpen}
        onClose={() => setCvModalOpen(false)}
        signedIn={signedIn}
        sectorOptions={targetSectorOptions}
        onSubmit={submitCv}
      />
      {/* ProfileModal is GONE (Rober 7-25): its settings body lives on the routed
          /settings page, and the avatar opens the unified AccountMenu popover
          (rendered inside HeadBar) on every surface. */}
    </div>
  );
}
