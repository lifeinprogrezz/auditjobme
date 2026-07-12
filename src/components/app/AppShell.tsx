// Shared chrome for the routed product surfaces (issue #42): a token-layer top nav
// that ties Today / Applications / Apply together and back to the map, plus sign-out.
// Ink-glass only — no new visual language; the map keeps its own self-scoped shell.
import { type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/today", label: "Today" },
  { to: "/tracker", label: "Applications" },
];

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

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-1 px-4 sm:px-6">
          <NavLink to="/" className="font-display text-sm font-semibold tracking-tight">
            auditjob.me
          </NavLink>
          <span className="mx-2 h-4 w-px bg-border" aria-hidden="true" />
          <nav className="flex items-center gap-1" aria-label="Product sections">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1" />
          <NavLink to="/" className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            Map
          </NavLink>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-8 sm:px-6">
        {title && <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>}
        {children}
      </main>
    </div>
  );
}
