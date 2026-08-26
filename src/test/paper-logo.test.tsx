// Pins PaperLogo — the shared D-class page logo (design direction §5.5 + banked D3
// nit 5a). Two laws: (1) the logo.dev `theme` param follows the ACTIVE app theme
// (light card → theme=light, dark card → theme=dark) or the broken-logos bug
// returns; (2) the fallback stage RESETS on a theme flip, so a themed logo that
// 404'd once gets another shot at its NEW theme variant instead of staying stuck
// on a favicon/initial. Rule + code move together.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import PaperLogo from "@/components/app/PaperLogo";
import { setTheme } from "@/lib/theme";

// Deterministic logo/favicon URLs so the theme param and the fallback chain are
// assertable without a live logo.dev token.
vi.mock("@/lib/logodev", () => ({
  logoUrl: (domain: string, theme: "dark" | "light") => `https://logo.test/${domain}?theme=${theme}`,
  faviconUrls: (domain: string) => [`https://fav.test/1/${domain}`, `https://fav.test/2/${domain}`],
}));

describe("PaperLogo — theme-aware page logo (§5.5) + reset-on-theme (nit 5a)", () => {
  beforeEach(() => act(() => setTheme("light")));
  afterEach(cleanup);

  it("the logo.dev theme param follows the active theme", () => {
    const { container } = render(<PaperLogo domain="acme.com" company="Acme" />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://logo.test/acme.com?theme=light");
    act(() => setTheme("dark"));
    expect(img.getAttribute("src")).toBe("https://logo.test/acme.com?theme=dark");
  });

  it("resets the fallback chain on a theme flip (retries the new themed logo)", () => {
    const { container } = render(<PaperLogo domain="acme.com" company="Acme" />);
    const img = container.querySelector("img") as HTMLImageElement;
    // logo.dev 404s once → the chain advances to the site favicon.
    fireEvent.error(img);
    expect(img.getAttribute("src")).toBe("https://fav.test/1/acme.com");
    // A theme flip must rewind to stage 0 so the NEW theme's logo is retried first.
    act(() => setTheme("dark"));
    expect(img.getAttribute("src")).toBe("https://logo.test/acme.com?theme=dark");
  });

  it("renders the initial straight away when there is no domain — no guessed favicon request", () => {
    // PR #164 live-verify rounds 1+2: a name-based favicon guess 404s and the
    // browser logs every failed <img> load to console; no guess is made.
    const { container } = render(<PaperLogo domain={null} company="Zeta" size={24} />);
    expect(container.querySelector("img")).toBeNull();
    const span = container.querySelector("span") as HTMLElement;
    expect(span.textContent).toBe("Z");
    // Tile size maps to the 24px box; radius stays on the {…,10,…} scale.
    expect(span.className).toContain("h-6");
    expect(span.className).toContain("rounded-[10px]");
  });

  it("falls straight to the initial for an empty company name", () => {
    const { container } = render(<PaperLogo domain={null} company="" size={24} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("span")).not.toBeNull();
  });
});
