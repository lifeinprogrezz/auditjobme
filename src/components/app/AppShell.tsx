// Shared chrome for the routed product surfaces (issue #42; D-class page chrome
// per design direction §6.0). The shell bar + top nav are PAPER, not glass: an
// opaque `--background` bar (no backdrop-blur — dead weight on an opaque fill), a
// hairline `border-b`, and `--shadow-page` once content has scrolled beneath it.
// The active nav item is the ONE active-nav idiom — the surface-glass thumb
// (`.nav-thumb`, shared with the map's segmented control), never a `bg-secondary`
// pill. Ink-glass token layer only.
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import { cn } from "@/lib/utils";
import ThemeToggle from "@/components/ThemeToggle";

const NAV = [
  { to: "/today", label: "Today" },
  { to: "/tracker", label: "Applications" },
];

// The two nav voices (§4.3/§6.0): active = the surface-glass thumb with an ink
// 600 label; inactive = a muted 500 label that inks on hover. Radius 10 (§2.4),
// control type (13px). No `bg-secondary` active pill, no `--act-strong` fill.
const NAV_ACTIVE =
  "nav-thumb rounded-[10px] border border-border px-2.5 py-1.5 text-control font-semibold text-foreground";
const NAV_INACTIVE =
  "rounded-[10px] px-2.5 py-1.5 text-control font-medium text-muted-foreground transition-colors hover:text-foreground";

export default function AppShell({
  title,
  children,
}: {
  /** Optional page heading rendered under the nav. */
  title?: string;
  children: ReactNode;
}) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  // §6.0 directive: the page shadow lifts the bar only once content scrolls under
  // it, so at rest the bar sits flush as flat paper.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="page-grain min-h-screen overflow-x-clip bg-background text-foreground">
      <header
        className={cn(
          "sticky top-0 z-20 border-b border-border bg-background transition-shadow duration-200",
          scrolled && "shadow-page",
        )}
      >
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-1 px-4 sm:px-6">
          <NavLink to="/" className="font-display text-body font-semibold tracking-tight">
            auditjob.me
          </NavLink>
          <span className="mx-2 h-4 w-px bg-border" aria-hidden="true" />
          <nav className="flex items-center gap-1" aria-label="Product sections">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1" />
          <NavLink to="/" className={NAV_INACTIVE}>
            Map
          </NavLink>
          {/* Day/night toggle (design direction §9.1): the SAME component the map
              HeadBar renders, so the one control reaches every surface. */}
          <ThemeToggle className="inline-grid h-8 w-8 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" />
          <button type="button" onClick={handleSignOut} className={NAV_INACTIVE}>
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-8 sm:px-6">
        {title && <h1 className="text-balance font-display text-page">{title}</h1>}
        {children}
      </main>
    </div>
  );
}
