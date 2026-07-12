import { describe, it, expect, beforeEach } from "vitest";
import {
  THEME_STORAGE_KEY,
  readStoredTheme,
  resolveInitialTheme,
  applyThemeToDom,
  setTheme,
} from "@/lib/theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("theme — resolution helpers (design direction §9.1)", () => {
  it("readStoredTheme returns only a valid stored choice, else null", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null } as Pick<Storage, "getItem">;
    expect(readStoredTheme(s)).toBeNull();
    store.set(THEME_STORAGE_KEY, "dark");
    expect(readStoredTheme(s)).toBe("dark");
    store.set(THEME_STORAGE_KEY, "light");
    expect(readStoredTheme(s)).toBe("light");
    store.set(THEME_STORAGE_KEY, "banana");
    expect(readStoredTheme(s)).toBeNull();
  });

  it("resolveInitialTheme: an explicit stored choice wins over the OS preference", () => {
    expect(resolveInitialTheme(true, "light")).toBe("light");
    expect(resolveInitialTheme(false, "dark")).toBe("dark");
  });

  it("resolveInitialTheme: with no stored choice, follows prefers-color-scheme", () => {
    expect(resolveInitialTheme(true, null)).toBe("dark");
    expect(resolveInitialTheme(false, null)).toBe("light");
  });
});

describe("theme — the ONE root class drives the whole app", () => {
  it("applyThemeToDom toggles .dark and color-scheme on <html>", () => {
    applyThemeToDom("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    applyThemeToDom("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("setTheme persists the explicit choice so a reload reproduces it (no-flash parity)", () => {
    setTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    // The pre-paint path (readStoredTheme + resolveInitialTheme, mirrored in
    // index.html) now reproduces the choice even against a light OS default — this
    // is the no-flash-on-reload guarantee.
    expect(resolveInitialTheme(false, readStoredTheme())).toBe("dark");
    setTheme("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
