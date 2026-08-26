// Pins RolesPanel's card Logo — issue #153 blocker 1, round 2. Same last-resort
// law as PaperLogo (D-class pages) and GlobeMap's buildPin: a company with no
// domain on file gets ONE guessed-domain favicon attempt before the coloured
// initial. Real prod companies this reaches: Adobe (Workday), 1Password/Adaptyv
// (Ashby), 5U AI (Dover) — generic ATS hosts the apply-URL fallback never derives
// a logo_domain from. Rule + code move together.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { Logo } from "@/components/roles/RolesPanel";
import { setTheme } from "@/lib/theme";

vi.mock("@/lib/logodev", () => ({
  logoUrl: (domain: string, theme: "dark" | "light") => `https://logo.test/${domain}?theme=${theme}`,
  faviconUrls: (domain: string) => [`https://fav.test/1/${domain}`, `https://fav.test/2/${domain}`],
  guessedFaviconUrl: (company: string) => (company ? `https://guess.test/${company}` : null),
}));

describe("RolesPanel Logo — guessed-domain fallback (issue #153 blocker 1)", () => {
  beforeEach(() => act(() => setTheme("light")));
  afterEach(cleanup);

  it("tries one guessed-domain favicon before the coloured initial when there is no domain", () => {
    const { container } = render(<Logo domain={null} company="Adobe" />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe("https://guess.test/Adobe");
  });

  it("falls through to the coloured initial when the guess 404s", () => {
    const { container } = render(<Logo domain={null} company="Adobe" />);
    const img = container.querySelector("img") as HTMLImageElement;
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    const span = container.querySelector(".fb") as HTMLElement;
    expect(span.textContent).toBe("A");
  });

  it("still prefers logo.dev + the real favicons when a domain is on file", () => {
    const { container } = render(<Logo domain="adobe.com" company="Adobe" />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://logo.test/adobe.com?theme=light");
  });

  it("goes straight to the initial when even the guess has nothing to work with", () => {
    const { container } = render(<Logo domain={null} company="" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".fb")).not.toBeNull();
  });
});
