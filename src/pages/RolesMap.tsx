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
import { EMPTY_FILTERS, companyCityRoles, filterJobs, type RoleJob, type RolesFilters } from "@/lib/roles";
import { coordsOf } from "@/lib/geo";
import { useRolesData } from "@/hooks/useRolesData";

export default function RolesMap() {
  const { jobs, loading, scoring, remaining, applied, markApplied, scoreMore, scored, signedIn } =
    useRolesData();
  const [filters, setFilters] = useState<RolesFilters>(EMPTY_FILTERS);
  const [view, setView] = useState<"map" | "list">("map");
  const [detailJob, setDetailJob] = useState<RoleJob | null>(null);
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
  const panelJobs = useMemo(() => {
    let out = visible;
    if (sel.co) out = out.filter((j) => norm(j.company) === norm(sel.co as string));
    if (sel.city) out = out.filter((j) => j.city === sel.city);
    return out;
  }, [visible, sel]);

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
        light={light}
        onCompanyClick={(company, city) => {
          // One role in this city → jump straight to its full detail; several →
          // filter the list to this company + city (Rober 2026-07-06). Either
          // way the camera holds — no zoom-out (see applyFocus in GlobeMap).
          const roles = companyCityRoles(visible, company, city);
          if (roles.length === 1) {
            setSel({ co: null, city: null });
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
        }}
      />
      <div className="vig" />
      <div className="ui">
        <HeadBar
          scored={scored}
          signedIn={signedIn}
          filters={filters}
          onFilters={setFilters}
          view={view}
          onView={setView}
        />
        <RolesPanel
          jobs={panelJobs}
          allJobs={jobs}
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
          onOpenDetail={setDetailJob}
          onCloseDetail={() => setDetailJob(null)}
          onMarkApplied={markApplied}
          onScoreMore={scoreMore}
          onToggleHidden={() => setPanelHidden((v) => !v)}
        />
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
