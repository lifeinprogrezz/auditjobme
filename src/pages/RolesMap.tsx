import { useEffect, useMemo, useState } from "react";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/geist-mono/700.css";
import "@/styles/roles.css";
import GlobeMap from "@/components/roles/GlobeMap";
import RolesPanel from "@/components/roles/RolesPanel";
import HeadBar from "@/components/roles/HeadBar";
import {
  EMPTY_FILTERS,
  companyCityRoles,
  filterJobs,
  sizeBand,
  sizeBandOrder,
  type RoleJob,
  type RolesFilters,
} from "@/lib/roles";
import { coordsOf } from "@/lib/geo";
import { useRolesData } from "@/hooks/useRolesData";

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
  const { jobs, loading, scoring, remaining, applied, scoreMore, scored, signedIn } =
    useRolesData();
  const [filters, setFilters] = useState<RolesFilters>(EMPTY_FILTERS);
  const [view, setView] = useState<"map" | "list">("map");
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
  const [panelHidden, setPanelHidden] = useState(false);
  // Light is the shipped default (Rober's call, 2026-07-05); dark ink stays
  // as the alternate identity for a future theme setting.
  const [light, setLight] = useState(true);

  // DEV-only identity comparison: "L" flips the whole page (map + glass skin).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as Element | null;
      if (t && "closest" in t && t.closest("input,textarea")) return;
      if (e.key === "l" || e.key === "L") setLight((v) => !v);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Map→panel selection, kept OUTSIDE RolesFilters so the globe keeps rendering
  // ALL visible roles (other bubbles stay clickable) while only the PANEL narrows.
  // Company (logo click) wins over city (cluster click); each clears the other.
  // ONE map→panel selection: a company and/or a city, each independently
  // removable via a chip in the panel. A company pin sets both (Prosper +
  // Barcelona); a city cluster sets just the city. Filtering by company is
  // case-insensitive so a scraped casing variant can't split the count.
  const [sel, setSel] = useState<{ co: string | null; city: string | null }>({ co: null, city: null });
  const norm = (s: string) => s.trim().toLowerCase();

  const visible = useMemo(() => filterJobs(jobs, filters), [jobs, filters]);

  // Top-left badge is the TOTAL catalog size — always the full numbers, never the
  // filtered view (Rober 7-06). The per-view count lives in the panel's filter bar.
  const scopeRoles = jobs.length;
  const scopeCos = useMemo(
    () => new Set(jobs.map((j) => j.company_id ?? j.company)).size,
    [jobs],
  );

  // Filter option lists, derived from the FULL catalog (not the filtered view) so
  // options never disappear as you narrow. Counts are live role counts; city/sector
  // sorted by frequency, size by the canonical ladder. Rober 7-06.
  const cityOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) if (j.city) m.set(j.city, (m.get(j.city) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [jobs]);
  const sectorOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) if (j.sector) m.set(j.sector, (m.get(j.sector) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [jobs]);
  const sizeOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) {
      const b = sizeBand(j.headcount);
      if (b) m.set(b, (m.get(b) ?? 0) + 1);
    }
    return [...m.entries()]
      .sort((a, b) => sizeBandOrder(a[0]) - sizeBandOrder(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [jobs]);

  // Default landing (nothing searched / filtered / selected) shows a curated
  // "hot companies" showcase — one Product role from each (Rober 7-06). The reset
  // control returns here; any search/filter/pin-click switches to real results.
  const isDefaultView =
    !sel.co &&
    !sel.city &&
    !filters.query &&
    filters.levels.length === 0 &&
    filters.cities.length === 0 &&
    filters.sectors.length === 0 &&
    filters.sizes.length === 0 &&
    !filters.remoteOnly;
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
      // The seven hot cards first, then every OTHER company's live roles so the
      // panel keeps scrolling — no dead space under the showcase, and no repeated
      // logos right below their hero card (Rober 7-06).
      const hotSlugs = new Set(hotJobs.map((j) => j.company_id));
      return [...hotJobs, ...visible.filter((j) => !hotSlugs.has(j.company_id ?? null))];
    }
    let out = visible;
    if (sel.co) out = out.filter((j) => norm(j.company) === norm(sel.co as string));
    if (sel.city) out = out.filter((j) => j.city === sel.city);
    return out;
  }, [visible, sel, isDefaultView, hotJobs]);

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
    light && "light",
    scored && "scored",
    detailLive && "detail-open",
    panelHidden && "panel-hidden",
    view === "list" && "view-list",
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
        }}
      />
      <div className="vig" />
      <div className="ui">
        <HeadBar
          scored={scored}
          signedIn={signedIn}
          filters={filters}
          onFilters={setFilters}
          cityOptions={cityOptions}
          sectorOptions={sectorOptions}
          sizeOptions={sizeOptions}
          view={view}
          onView={setView}
        />
        <RolesPanel
          jobs={panelJobs}
          allJobs={jobs}
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
          remaining={remaining}
          detailJob={detailLive}
          applied={applied}
          onOpenDetail={openDetail}
          onCloseDetail={() => setDetailJob(null)}
          onScoreMore={scoreMore}
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
        <div className="attrib">
          <a href="https://github.com/santifer/career-ops" target="_blank" rel="noopener noreferrer">
            santifer
          </a>
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
    </div>
  );
}
