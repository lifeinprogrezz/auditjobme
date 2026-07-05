import { useMemo, useState } from "react";
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

  const visible = useMemo(() => filterJobs(jobs, filters), [jobs, filters]);

  // Detail highlight: the selected company's cities, unjittered (mockup behavior).
  const focusLngLats = useMemo(() => {
    if (!detailJob) return null;
    const cities = [
      ...new Set(
        jobs.filter((j) => j.company === detailJob.company && j.city).map((j) => j.city as string),
      ),
    ];
    return cities.map((c) => coordsOf(c)).filter((c): c is [number, number] => c !== null);
  }, [detailJob, jobs]);

  const rootClass = [
    "roles-theme",
    scored && "scored",
    detailJob && "detail-open",
    panelHidden && "panel-hidden",
    view === "list" && "view-list",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass}>
      <div className="stars" />
      <GlobeMap jobs={visible} scored={scored} focusLngLats={focusLngLats} />
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
          detailJob={detailJob}
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
