// Pins buildPin's logo chain on the /roles globe (issue #153, PR #164 live-verify
// rounds 1+2). A company with no companies.logo_domain renders the coloured
// initial straight away — NO name-based favicon guess (a speculative request
// 404s and the browser logs every failed <img> load to console, unsuppressable
// from app JS). Same law as PaperLogo / RolesPanel Logo. Rule + code move together.
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
  it("renders the coloured initial straight away when there is no domain — no <img>, no guess", () => {
    const root = buildPin(base);
    expect(root.querySelector("img")).toBeNull();
    const fallback = root.querySelector(".fallback") as HTMLElement;
    expect(fallback.style.display).not.toBe("none");
    expect(fallback.textContent).toBe("A");
    expect(fallback.style.background).toBe("rgb(0, 0, 0)"); // jsdom serialises "#000" as rgb()
  });

  it("falls through to the coloured initial once every known-domain service has failed", () => {
    const root = buildPin({ ...base, domain: "adobe.com" });
    const img = root.querySelector("img") as HTMLImageElement;
    fireEvent.error(img);
    fireEvent.error(img);
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

  it("shows a placeholder glyph for an empty company name", () => {
    const root = buildPin({ ...base, co: "" });
    expect(root.querySelector("img")).toBeNull();
    const fallback = root.querySelector(".fallback") as HTMLElement;
    expect(fallback.style.display).not.toBe("none");
  });
});
