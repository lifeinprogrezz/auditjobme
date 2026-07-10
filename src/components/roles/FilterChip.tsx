import { useRef, useState } from "react";
import { createPortal } from "react-dom";

export type FilterOption = { value: string; label: string; count: number };

type Props = {
  label: string;
  options: FilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
  open: boolean;
  onOpenToggle: () => void;
  /** Clear every selection for this dimension at once. */
  onClearAll: () => void;
  /** Show an in-dropdown search box (for long lists — City, Sector). */
  searchable?: boolean;
  /** Greyed + non-opening when there's nothing to pick under the current filters
   *  (keeps the chip in place instead of vanishing — steadier headbar). */
  disabled?: boolean;
};

// Searchable multi-select filter chip (City / Sector / Size) — same glass voice as
// the headbar Level chip, but its option list scrolls and, when `searchable`, can be
// typed to narrow (dozens of cities/sectors). Each option shows its live role count.
// Rober 2026-07-06.
export default function FilterChip({
  label,
  options,
  selected,
  onToggle,
  open,
  onOpenToggle,
  onClearAll,
  searchable,
  disabled,
}: Props) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  const chipRef = useRef<HTMLDivElement>(null);
  // The chip row scrolls horizontally (overflow-x: auto clips descendants) and the
  // glass .nav's transform + backdrop-filter block the position:fixed escape hatch —
  // so the open dropdown portals onto the .roles-theme page root (keeps the theme's
  // CSS variables + light/dark class) anchored below the chip's viewport rect.
  const rect = open ? chipRef.current?.getBoundingClientRect() : undefined;

  // Chip clicks toggle the dropdown, but clicks INSIDE the dropdown (search box,
  // checkboxes) must not — they manage their own state.
  const insideDrop = (e: React.SyntheticEvent) =>
    (e.target as Element).closest(".fdrop") != null;

  return (
    <div
      ref={chipRef}
      className={`fchip${selected.length ? " active" : ""}${open ? " open" : ""}${disabled ? " disabled" : ""}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-expanded={open}
      aria-disabled={disabled}
      onClick={(e) => {
        if (disabled || insideDrop(e)) return;
        onOpenToggle();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (disabled || insideDrop(e)) return;
        e.preventDefault();
        onOpenToggle();
      }}
    >
      <span className="flabel">{label}</span>
      <span className="fcount">{selected.length}</span>
      <svg className="caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
        <path d="m6 9 6 6 6-6" />
      </svg>
      {open && rect && createPortal(
      <div className="fdrop fdrop-multi fdrop-portal" style={{ top: rect.bottom + 9, left: rect.left }}>
        {searchable && (
          <input
            className="fdrop-search"
            type="text"
            placeholder={`Search ${label.toLowerCase()}…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {selected.length > 0 && (
          <button
            type="button"
            className="fdrop-clearall"
            onClick={(e) => {
              e.stopPropagation();
              onClearAll();
            }}
          >
            Clear all ({selected.length})
          </button>
        )}
        <div className="fdrop-list">
          {shown.map((o) => (
            <label key={o.value}>
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => onToggle(o.value)}
              />
              <span className="fdrop-lab">{o.label}</span>
              <span className="fdrop-n">{o.count}</span>
            </label>
          ))}
          {shown.length === 0 && <div className="fdrop-empty">No matches</div>}
        </div>
      </div>,
      document.querySelector(".roles-theme") ?? document.body,
      )}
    </div>
  );
}
