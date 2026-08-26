// "Your matches" facet chip (issue #154) — one small component, shared by the
// headbar (HeadBar.tsx, always visible so the chip lineup stays steady) and the
// panel rail header (RolesPanel.tsx, next to the heading). Reuses the existing
// .fchip glass voice (roles.css) — no new aesthetics, no dropdown: this facet is
// a single on/off toggle, not a multi-select.
export type MineChipProps = {
  active: boolean;
  /** Greyed + inert, same voice as every other chip with nothing to pick
   *  (logged out, or no CV on file yet — "Your matches" has no slice to show). */
  disabled?: boolean;
  onToggle: () => void;
};

export default function MineChip({ active, disabled, onToggle }: MineChipProps) {
  return (
    <button
      type="button"
      className={`fchip mine${active ? " active" : ""}${disabled ? " disabled" : ""}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="flabel">Your matches</span>
      {active && (
        <span className="x" aria-hidden="true">
          ×
        </span>
      )}
    </button>
  );
}
