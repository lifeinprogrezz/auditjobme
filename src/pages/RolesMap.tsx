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
import FooterTicker from "@/components/roles/FooterTicker";
import { EMPTY_FILTERS, filterJobs, type RoleJob, type RolesFilters } from "@/lib/roles";
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

  const visible = useMemo(() => filterJobs(jobs, filters), [jobs, filters]);

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
      <GlobeMap jobs={visible} scored={scored} focusLngLats={focusLngLats} light={light} />
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
          jobs={visible}
          allJobs={jobs}
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
        <FooterTicker
          jobs={jobs}
          onOpen={(j) => {
            setDetailJob(j);
            setPanelHidden(false);
          }}
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
