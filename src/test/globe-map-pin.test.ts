// Pins buildPin's logo chain on the /roles globe (issue #153 blocker 1, round 2).
// Companies sitting on generic ATS hosts (Workday, Ashby, Dover, ...) never get a
// companies.logo_domain from the apply-URL fallback, so the map pin's OWN chain is
// their only logo path — the same last-resort law PaperLogo/RolesPanel Logo already
// apply (guessedFaviconUrl before the coloured initial). Rule + code move together.
//
// maplibre-gl calls window.URL.createObjectURL at import time (module-level
// setWorkerUrl), which jsdom doesn't implement — polyfilled before the dynamic
// import below so the module can load at all in this environment.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { fireEvent } from "@testing-library/react";
import type { buildPin as BuildPinFn, PinProps } from "@/components/roles/GlobeMap";

vi.mock("@/lib/logodev", () => ({
  logoUrl: (domain: string) => `https://logo.test/${domain}`,
  faviconUrls: (domain: string) => [`https://fav.test/1/${domain}`, `https://fav.test/2/${domain}`],
  guessedFaviconUrl: (company: string) => (company ? `https://guess.test/${company}` : null),
}));

let buildPin: typeof BuildPinFn;

beforeAll(async () => {
  if (typeof window.URL.createObjectURL !== "function") {
    window.URL.createObjectURL = () => "blob:mock";
  }
  ({ buildPin } = await import("@/components/roles/GlobeMap"));
});

const base: PinProps = {
  id: "adobe|munich",
  co: "Adobe",
  domain: null,
  city: "Munich",
  role: "1 open role",
  score: null,
  bucket: "",
  hue: "#000",
  count: 1,
};

describe("buildPin — logo chain (issue #153 blocker 1)", () => {
  it("tries the guessed-domain favicon before the coloured initial when there is no domain", () => {
    // The real-world case: Adobe/1Password/5U AI/Adaptyv sit on generic ATS hosts,
    // so companies.logo_domain is null and this guess is the pin's only logo path.
    const root = buildPin(base);
    const img = root.querySelector("img") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe("https://guess.test/Adobe");
    const fallback = root.querySelector(".fallback") as HTMLElement;
    expect(fallback.style.display).toBe("none");
  });

  it("falls through to the coloured initial when the guess 404s", () => {
    const root = buildPin(base);
    const img = root.querySelector("img") as HTMLImageElement;
    fireEvent.error(img);
    expect(img.style.display).toBe("none");
    const fallback = root.querySelector(".fallback") as HTMLElement;
    expect(fallback.style.display).toBe("grid");
    expect(fallback.textContent).toBe("A");
  });

  it("still prefers logo.dev + the real favicons when a domain is on file", () => {
    const root = buildPin({ ...base, domain: "adobe.com" });
    const img = root.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://logo.test/adobe.com");
  });

  it("goes straight to the initial when even the guess has nothing to work with", () => {
    const root = buildPin({ ...base, co: "" });
    expect(root.querySelector("img")).toBeNull();
    const fallback = root.querySelector(".fallback") as HTMLElement;
    expect(fallback.style.display).not.toBe("none");
  });
});
