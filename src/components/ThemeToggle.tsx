// One day/night control (design direction §9.1): an icon ghost button built from
// the existing control vocabulary, reachable on EVERY surface — the map HeadBar and
// the page AppShell both render it, and clicking flips the whole app via the single
// root theme class (src/lib/theme.ts). It shows the glyph of the theme it will
// switch TO, so the icon reads as the action. `className` lets each chrome home
// dress it in its own voice (roles.css `.themetoggle` on the map; Tailwind on pages)
// without a second component.
import { useTheme } from "@/lib/theme";

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={`themetoggle ${className}`.trim()}
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? (
        // In dark → offer the sun (switch to light).
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        // In light → offer the moon (switch to dark).
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
