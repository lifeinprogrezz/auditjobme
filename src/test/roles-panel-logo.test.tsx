// Pins RolesPanel's card Logo — issue #153 / PR #164 live-verify rounds 1+2.
// A company with NO domain on file renders the coloured initial straight away:
// the same hue helper (hueFor) and `fallback` class as the map pin in
// GlobeMap's buildPin, so every rail card shows either a logo or an initial.
// There is NO name-based favicon guess in the chain: a speculative request 404s
// and the browser logs every failed <img> load to the console (143 in one
// walk), which no onError handler can silence. Rule + code move together.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { Logo } from "@/components/roles/RolesPanel";
import { hueFor } from "@/lib/roles";
import { setTheme } from "@/lib/theme";

vi.mock("@/lib/logodev", () => ({
  logoUrl: (domain: string, theme: "dark" | "light") => `https://logo.test/${domain}?theme=${theme}`,
  faviconUrls: (domain: string) => [`https://fav.test/1/${domain}`, `https://fav.test/2/${domain}`],
}));

// jsdom serialises a hex background as rgb(); compare through the same setter.
function cssColor(hex: string): string {
  const el = document.createElement("div");
  el.style.background = hex;
  return el.style.background;
}

describe("RolesPanel Logo — initial fallback, no favicon guess (issue #153)", () => {
  beforeEach(() => act(() => setTheme("light")));
  afterEach(cleanup);

  it("renders the coloured initial straight away when there is no domain — no <img>, no guess", () => {
    const { container } = render(<Logo domain={null} company="Adobe" />);
    expect(container.querySelector("img")).toBeNull();
    const span = container.querySelector("span.fallback") as HTMLElement;
    expect(span).not.toBeNull();
    expect(span.classList.contains("fb")).toBe(true);
    expect(span.textContent).toBe("A");
    expect(span.style.background).toBe(cssColor(hueFor("Adobe")));
  });

  it("still prefers logo.dev + the real favicons when a domain is on file", () => {
    const { container } = render(<Logo domain="adobe.com" company="Adobe" />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://logo.test/adobe.com?theme=light");
  });

  it("falls through to the initial once every known-domain service has failed", () => {
    const { container } = render(<Logo domain="adobe.com" company="Adobe" />);
    const img = container.querySelector("img") as HTMLImageElement;
    fireEvent.error(img);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    expect((container.querySelector("span.fallback") as HTMLElement).textContent).toBe("A");
  });

  it("shows a placeholder glyph, never an empty box, for an empty company name", () => {
    const { container } = render(<Logo domain={null} company="" />);
    expect(container.querySelector("img")).toBeNull();
    expect((container.querySelector("span.fallback") as HTMLElement).textContent).toBe("?");
  });
});
