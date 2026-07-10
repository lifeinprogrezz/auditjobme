import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { type Level, type RolesFilters } from "@/lib/roles";
import FilterChip, { type FilterOption } from "./FilterChip";

export type HeadBarProps = {
  scored: boolean;
  signedIn: boolean;
  filters: RolesFilters;
  onFilters: (f: RolesFilters) => void;
  roleOptions: FilterOption[];
  levelOptions: FilterOption[];
  cityOptions: FilterOption[];
  sectorOptions: FilterOption[];
  sizeOptions: FilterOption[];
  languageOptions: FilterOption[];
  /** Reset every filter (and the map pin selection) at once. */
  onClearAll: () => void;
  view: "map" | "list";
  onView: (v: "map" | "list") => void;
  /** Opens the CV-unlock modal (Phase A front door). */
  onAddCv: () => void;
};

// Glass nav headbar (v43 mockup lines 237–269). State classes .scored /
// .panel-hidden etc live on the page root (.roles-theme), not here.
export default function HeadBar({ scored, signedIn, filters, onFilters, roleOptions, levelOptions, cityOptions, sectorOptions, sizeOptions, languageOptions, onClearAll, view, onView, onAddCv }: HeadBarProps) {
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [chipsShown, setChipsShown] = useState(false);
  // Smooth width reveal via grid-template-columns 0fr→1fr (.show); .expanded (after
  // the 550ms slide) frees the inner overflow so dropdowns can escape.
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const [openChip, setOpenChip] = useState<"role" | "level" | "city" | "sector" | "size" | "language" | null>(null);
  const expandTimer = useRef<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  // The chip row hides its scrollbar, so give mouse users two ways to move it:
  // the wheel scrolls it horizontally, and press-drag pans it. A native wheel
  // listener ({passive:false}) is required — React's delegated onWheel can't
  // preventDefault. Drag suppresses the trailing click (capture phase) past 5px
  // so panning never toggles a chip.
  const drag = useRef<{ startX: number; startLeft: number; moved: boolean } | null>(null);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      el.scrollLeft += d;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const onRowPointerDown = (e: React.PointerEvent) => {
    const el = rowRef.current;
    if (!el || e.pointerType !== "mouse" || el.scrollWidth <= el.clientWidth) return;
    drag.current = { startX: e.clientX, startLeft: el.scrollLeft, moved: false };
  };
  const onRowPointerMove = (e: React.PointerEvent) => {
    const el = rowRef.current;
    const d = drag.current;
    if (!el || !d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < 5) return;
    if (!d.moved) {
      d.moved = true;
      el.classList.add("panning");
      el.setPointerCapture(e.pointerId);
    }
    el.scrollLeft = d.startLeft - dx;
  };
  const onRowPointerUp = () => {
    rowRef.current?.classList.remove("panning");
    // Cleared on the next tick so the capture-phase click of THIS gesture still
    // sees moved=true and gets suppressed.
    window.setTimeout(() => { drag.current = null; }, 0);
  };
  const onRowClickCapture = (e: React.MouseEvent) => {
    if (drag.current?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

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
      // .fdrop is portaled out of the chip (scrollable row) — treat it as inside.
      if (t && !t.closest(".fchip") && !t.closest(".filterbtn") && !t.closest(".fdrop")) setOpenChip(null);
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
      }, 550);
    }
  };

  const toggleLevel = (v: Level) => {
    const levels = filters.levels.includes(v)
      ? filters.levels.filter((x) => x !== v)
      : [...filters.levels, v];
    onFilters({ ...filters, levels });
  };

  // City / Sector / Size are string multi-selects — one generic toggler.
  const toggleIn = (key: "cities" | "sectors" | "sizes" | "languages" | "roles", v: string) => {
    const cur = filters[key] ?? [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onFilters({ ...filters, [key]: next });
  };
  const chipOpen = (key: "role" | "level" | "city" | "sector" | "size" | "language") => () =>
    setOpenChip(openChip === key ? null : key);

  // Any filter active → show the headbar-wide Clear all (Rober 7-09).
  const anyActive =
    (filters.roles?.length ?? 0) > 0 ||
    filters.levels.length > 0 ||
    filters.cities.length > 0 ||
    filters.sectors.length > 0 ||
    filters.sizes.length > 0 ||
    (filters.languages?.length ?? 0) > 0 ||
    filters.remoteOnly ||
    filters.query.trim() !== "";

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
        {filters.query && (
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
        {/* Fixed-position portaled dropdowns would detach on scroll — close them. */}
        <div
          className="fchips-inner"
          ref={rowRef}
          onScroll={() => setOpenChip(null)}
          onPointerDown={onRowPointerDown}
          onPointerMove={onRowPointerMove}
          onPointerUp={onRowPointerUp}
          onPointerCancel={onRowPointerUp}
          onClickCapture={onRowClickCapture}
        >
        {/* Chip order: what → where → company (spec 2026-07-10). Role leads — one
            "Product Manager" bucket until the engine goes all-vertical (#34). */}
        <FilterChip
          label="Role"
          options={roleOptions}
          selected={filters.roles ?? []}
          onToggle={(v) => toggleIn("roles", v)}
          open={openChip === "role"}
          onOpenToggle={chipOpen("role")}
          onClearAll={() => onFilters({ ...filters, roles: [] })}
          disabled={roleOptions.length === 0 && !(filters.roles?.length ?? 0)}
        />
        <FilterChip
          label="Level"
          options={levelOptions}
          selected={filters.levels}
          onToggle={(v) => toggleLevel(v as Level)}
          open={openChip === "level"}
          onOpenToggle={chipOpen("level")}
          onClearAll={() => onFilters({ ...filters, levels: [] })}
          disabled={levelOptions.every((o) => o.count === 0) && filters.levels.length === 0}
        />
        <FilterChip
          label="City"
          searchable
          options={cityOptions}
          selected={filters.cities}
          onToggle={(v) => toggleIn("cities", v)}
          open={openChip === "city"}
          onOpenToggle={chipOpen("city")}
          onClearAll={() => onFilters({ ...filters, cities: [] })}
          disabled={cityOptions.length === 0 && filters.cities.length === 0}
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
        <FilterChip
          label="Sector"
          searchable
          options={sectorOptions}
          selected={filters.sectors}
          onToggle={(v) => toggleIn("sectors", v)}
          open={openChip === "sector"}
          onOpenToggle={chipOpen("sector")}
          onClearAll={() => onFilters({ ...filters, sectors: [] })}
          disabled={sectorOptions.length === 0 && filters.sectors.length === 0}
        />
        <FilterChip
          label="Size"
          options={sizeOptions}
          selected={filters.sizes}
          onToggle={(v) => toggleIn("sizes", v)}
          open={openChip === "size"}
          onOpenToggle={chipOpen("size")}
          onClearAll={() => onFilters({ ...filters, sizes: [] })}
          disabled={sizeOptions.length === 0 && filters.sizes.length === 0}
        />
        <FilterChip
          label="Language"
          searchable
          options={languageOptions}
          selected={filters.languages ?? []}
          onToggle={(v) => toggleIn("languages", v)}
          open={openChip === "language"}
          onOpenToggle={chipOpen("language")}
          onClearAll={() => onFilters({ ...filters, languages: [] })}
          disabled={languageOptions.length === 0 && !(filters.languages?.length ?? 0)}
        />

        {anyActive && (
          <button
            type="button"
            className="fclear"
            onClick={onClearAll}
            aria-label="Clear all filters"
            title="Clear all filters"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        )}
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
          (the modal routes through sign-in); CSS hides it once the root carries .scored. */}
      <button
        type="button"
        className="navcv"
        onClick={onAddCv}
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
