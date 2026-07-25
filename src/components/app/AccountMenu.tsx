// AccountMenu — THE one signed-in account control, rendered identically on every
// surface (Rober 7-25 "just unify it"): the gradient avatar circle opens a small
// popover with the workspace links + Sign out. It replaces both the map's
// ProfileModal (whose settings body moved to the /settings PAGE) and the paper
// pages' bare "Sign out" text button.
//
// Two visual variants, one behavior:
//   glass — the map headbar (.av / .avmenu classes from roles.css, glass tokens)
//   paper — AppShell pages (Tailwind on the ink-paper tokens)
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";

const ITEMS: { label: string; to: string }[] = [
  { label: "Today", to: "/today" },
  { label: "Applications", to: "/tracker" },
  { label: "Settings", to: "/settings" },
];

export default function AccountMenu({ variant }: { variant: "glass" | "paper" }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Outside click / Escape both dismiss — standard popover contract.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    navigate("/");
  };

  const paper = variant === "paper";

  return (
    <div ref={wrapRef} className={paper ? "relative flex-none" : "avwrap"}>
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={
          paper
            ? "block h-8 w-8 cursor-pointer rounded-full border border-border [background:conic-gradient(from_200deg,#1fd8b8,#3cb4ff,#9e8cff,#1fd8b8)]"
            : "av"
        }
      />
      {open && (
        <div
          role="menu"
          className={
            paper
              ? "absolute right-0 top-full z-50 mt-2 w-44 rounded-[10px] border border-border bg-card p-1 shadow-page-lift"
              : "avmenu"
          }
        >
          {ITEMS.map((item) => (
            <button
              key={item.to}
              type="button"
              role="menuitem"
              onClick={() => go(item.to)}
              className={
                paper
                  ? "block w-full rounded-[8px] px-3 py-2 text-left text-control font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  : undefined
              }
            >
              {item.label}
            </button>
          ))}
          <div className={paper ? "mx-2 my-1 h-px bg-border" : "avmenu-sep"} aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className={
              paper
                ? "block w-full rounded-[8px] px-3 py-2 text-left text-control font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                : undefined
            }
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
