// One app-wide day/night theme system (design direction §9.1). A SINGLE root class
// on <html> drives BOTH worlds off one source of truth: the shadcn token pages read
// `.dark`, and the /roles map derives its own `.light` class from the same value
// (RolesMap). Initial value = an explicit stored choice, else the OS
// `prefers-color-scheme`. The choice persists in localStorage and is applied
// PRE-PAINT by an inline script in index.html — this module MIRRORS that read
// (resolveInitialTheme / readStoredTheme) so React state matches the already-painted
// DOM with no flash of the wrong theme. Pure helpers are unit-tested in
// src/test/theme.test.ts. Rule + code move together: keep the index.html inline
// script in sync with resolveInitialTheme below.
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "ajm-theme";

/** The persisted explicit choice, or null when none has been made (fall back to the
 *  OS preference). Reads defensively — localStorage can throw in private mode. */
export function readStoredTheme(store?: Pick<Storage, "getItem"> | null): Theme | null {
  try {
    const s = store ?? (typeof localStorage !== "undefined" ? localStorage : null);
    const v = s?.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** Initial theme resolution, shared by the pre-paint inline script and this module:
 *  an explicit stored choice wins; otherwise the OS `prefers-color-scheme`. Pure. */
export function resolveInitialTheme(prefersDark: boolean, stored: Theme | null): Theme {
  if (stored) return stored;
  return prefersDark ? "dark" : "light";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

/** The theme the pre-paint script already committed to <html> (the source of truth
 *  so React never disagrees with the painted DOM). Falls back to the shared
 *  resolution when no class is present yet (tests / first import before paint). */
function currentDomTheme(): Theme {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) {
    return "dark";
  }
  return resolveInitialTheme(systemPrefersDark(), readStoredTheme());
}

/** Write the theme to <html>: the ONE root class (`.dark`) plus `color-scheme` so
 *  native form controls / scrollbars match. No-op outside a DOM. */
export function applyThemeToDom(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

let current: Theme = currentDomTheme();
const listeners = new Set<() => void>();

export function setTheme(theme: Theme): void {
  current = theme;
  applyThemeToDom(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode / quota — the DOM class still applied for this session */
  }
  listeners.forEach((l) => l());
}

export function toggleTheme(): void {
  setTheme(current === "dark" ? "light" : "dark");
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React binding: the live theme + a two-state toggle. Consumed by the HeadBar
 *  (map chrome) and the AppShell (page chrome) so ONE control reaches every
 *  surface, and by RolesMap to derive the map's `.light` class. */
export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void } {
  const theme = useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
  return { theme, toggle: toggleTheme, setTheme };
}
