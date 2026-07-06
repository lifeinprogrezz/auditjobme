import { useState } from "react";

export type FilterOption = { value: string; label: string; count: number };

type Props = {
  label: string;
  options: FilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
  open: boolean;
  onOpenToggle: () => void;
  /** Show an in-dropdown search box (for long lists — City, Sector). */
  searchable?: boolean;
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
  searchable,
}: Props) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  // Chip clicks toggle the dropdown, but clicks INSIDE the dropdown (search box,
  // checkboxes) must not — they manage their own state.
  const insideDrop = (e: React.SyntheticEvent) =>
    (e.target as Element).closest(".fdrop") != null;

  return (
    <div
      className={`fchip${selected.length ? " active" : ""}${open ? " open" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={(e) => {
        if (insideDrop(e)) return;
        onOpenToggle();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (insideDrop(e)) return;
        e.preventDefault();
        onOpenToggle();
      }}
    >
      <span className="flabel">{label}</span>
      <span className="fcount">{selected.length}</span>
      <svg className="caret" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
        <path d="m6 9 6 6 6-6" />
      </svg>
      <div className="fdrop fdrop-multi">
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
      </div>
    </div>
  );
}
