import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LEVELS, type Level, type RolesFilters } from "@/lib/roles";
import FilterChip, { type FilterOption } from "./FilterChip";

export type HeadBarProps = {
  scored: boolean;
  signedIn: boolean;
  filters: RolesFilters;
  onFilters: (f: RolesFilters) => void;
  cityOptions: FilterOption[];
  sectorOptions: FilterOption[];
  sizeOptions: FilterOption[];
  view: "map" | "list";
  onView: (v: "map" | "list") => void;
};

// Glass nav headbar (v43 mockup lines 237–269). State classes .scored /
// .panel-hidden etc live on the page root (.roles-theme), not here.
export default function HeadBar({ scored, signedIn, filters, onFilters, cityOptions, sectorOptions, sizeOptions, view, onView }: HeadBarProps) {
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [chipsShown, setChipsShown] = useState(false);
  // Two-step overflow (mockup 330): .show slides chips in with overflow hidden,
  // .expanded (after the 340ms slide) frees overflow so dropdowns can escape.
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const [openChip, setOpenChip] = useState<"level" | "city" | "sector" | "size" | null>(null);
  const expandTimer = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Click anywhere outside a chip / the filter button closes dropdowns (mockup 335).
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && !t.closest(".fchip") && !t.closest(".filterbtn")) setOpenChip(null);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(
    () => () => {
      if (expandTimer.current != null) window.clearTimeout(expandTimer.current);
    },
    [],
  );

  const toggleChips = () => {
    if (chipsShown) {
      if (expandTimer.current != null) {
        window.clearTimeout(expandTimer.current);
        expandTimer.current = null;
      }
      setChipsExpanded(false);
      setOpenChip(null);
      setChipsShown(false);
    } else {
      setChipsShown(true);
      expandTimer.current = window.setTimeout(() => {
        setChipsExpanded(true);
        expandTimer.current = null;
      }, 340);
    }
  };

  const toggleLevel = (v: Level) => {
    const levels = filters.levels.includes(v)
      ? filters.levels.filter((x) => x !== v)
      : [...filters.levels, v];
    onFilters({ ...filters, levels });
  };

  // City / Sector / Size are string multi-selects — one generic toggler.
  const toggleIn = (key: "cities" | "sectors" | "sizes", v: string) => {
    const cur = filters[key];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onFilters({ ...filters, [key]: next });
  };
  const chipOpen = (key: "city" | "sector" | "size") => () =>
    setOpenChip(openChip === key ? null : key);

  const levelOpen = openChip === "level";
  const levelActive = filters.levels.length > 0;

  // div[role=button] chips don't fire click on Enter/Space — wire it explicitly.
  const keyActivate = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if ((e.target as Element).closest(".fdrop")) return; // let checkboxes handle their own keys
    e.preventDefault();
    fn();
  };

  return (
    <header className="nav glass liquid">
      <Link className="brand" to="/underconstruction">auditjob.me</Link>
      <span className="sep" />

      <div className="cmd">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={searchRef}
          type="text"
          aria-label="Search roles"
          placeholder="Search roles, companies"
          value={filters.query}
          onChange={(e) => onFilters({ ...filters, query: e.target.value })}
        />
        {filters.query ? (
          <button
            type="button"
            className="cmd-clear"
            aria-label="Clear search"
            onClick={() => {
              onFilters({ ...filters, query: "" });
              searchRef.current?.focus();
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <kbd>⌘K</kbd>
        )}
      </div>

      <button
        type="button"
        className={`filterbtn${chipsShown ? " on" : ""}`}
        aria-expanded={chipsShown}
        onClick={toggleChips}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 5h18M6 12h12M10 19h4" />
        </svg>
        Filter
      </button>

      <div className={`fchips${chipsShown ? " show" : ""}${chipsExpanded ? " expanded" : ""}`}>
        <div
          className={`fchip${levelActive ? " active" : ""}${levelOpen ? " open" : ""}`}
          role="button"
          tabIndex={0}
          aria-expanded={levelOpen}
          onClick={(e) => {
            if ((e.target as Element).closest(".fdrop")) return;
            setOpenChip(levelOpen ? null : "level");
          }}
          onKeyDown={keyActivate(() => setOpenChip(levelOpen ? null : "level"))}
        >
          <span className="flabel">Level</span>
          <span className="fcount">{filters.levels.length}</span>
          <svg className="caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
            <path d="m6 9 6 6 6-6" />
          </svg>
          <div className="fdrop">
            {LEVELS.map((l) => (
              <label key={l.value}>
                <input
                  type="checkbox"
                  value={l.value}
                  checked={filters.levels.includes(l.value)}
                  onChange={() => toggleLevel(l.value)}
                />
                <span>{l.label}</span>
              </label>
            ))}
          </div>
        </div>

        <FilterChip
          label="City"
          searchable
          options={cityOptions}
          selected={filters.cities}
          onToggle={(v) => toggleIn("cities", v)}
          open={openChip === "city"}
          onOpenToggle={chipOpen("city")}
        />
        <FilterChip
          label="Sector"
          searchable
          options={sectorOptions}
          selected={filters.sectors}
          onToggle={(v) => toggleIn("sectors", v)}
          open={openChip === "sector"}
          onOpenToggle={chipOpen("sector")}
        />
        <FilterChip
          label="Size"
          options={sizeOptions}
          selected={filters.sizes}
          onToggle={(v) => toggleIn("sizes", v)}
          open={openChip === "size"}
          onOpenToggle={chipOpen("size")}
        />

        <div
          className={`fchip${filters.remoteOnly ? " active" : ""}`}
          role="button"
          tabIndex={0}
          aria-pressed={filters.remoteOnly}
          onClick={() => {
            setOpenChip(null);
            onFilters({ ...filters, remoteOnly: !filters.remoteOnly });
          }}
          onKeyDown={keyActivate(() => {
            setOpenChip(null);
            onFilters({ ...filters, remoteOnly: !filters.remoteOnly });
          })}
        >
          <span className="flabel">Remote</span>
          <span className="fcount">1</span>
        </div>
      </div>

      <span className="spacer" />

      {/* CSS hides the seg pre-scored (.roles-theme:not(.scored) .seg) — always rendered. */}
      <div className={`seg${view === "list" ? " list" : ""}`}>
        <span className="ind" />
        <button type="button" className={view === "map" ? "on" : ""} aria-pressed={view === "map"} onClick={() => onView("map")}>
          Map
        </button>
        <button type="button" className={view === "list" ? "on" : ""} aria-pressed={view === "list"} onClick={() => onView("list")}>
          List
        </button>
      </div>

      {/* The CV is the unlock and the differentiator — anon gets the same jade door
          (it routes through sign-in); CSS hides it once the root carries .scored. */}
      <button
        type="button"
        className="navcv"
        onClick={() => navigate("/underconstruction")}
      >
        <span className="sp">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        Add your CV
      </button>

      <div
        className="av"
        role="button"
        tabIndex={0}
        aria-label="Profile"
        onClick={() => navigate("/underconstruction")}
        onKeyDown={keyActivate(() => navigate("/underconstruction"))}
      />
    </header>
  );
}
