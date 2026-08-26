// Pins the D-class page chrome (design direction §6.0 / wave D3 item 3): the shell
// bar is opaque paper (no backdrop-blur), the ONE active-nav idiom is the
// surface-glass thumb (`.nav-thumb`, NOT a `bg-secondary` pill), and the page h1
// lands on the §2.1 `page` token (24px) — never the off-scale `sm:text-3xl` (30px).
// Rule + code move together: this test moves with AppShell.tsx.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppShell from "@/components/app/AppShell";

const signOut = vi.fn(async () => {});
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: { email: "rober@example.com" }, session: null, loading: false, signOut }),
}));

function renderShell(route = "/today", title?: string) {
  return render(
    <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppShell title={title}>
        <p>body</p>
      </AppShell>
    </MemoryRouter>,
  );
}

describe("AppShell — D-class page chrome (§6.0)", () => {
  afterEach(cleanup);

  it("the shell bar is opaque paper: bg-background, no backdrop-blur, hairline border", () => {
    const { container } = renderShell();
    const header = container.querySelector("header") as HTMLElement;
    expect(header.className).toContain("bg-background");
    expect(header.className).toContain("border-b");
    expect(header.className).not.toContain("backdrop-blur");
    // No translucent fill on the opaque D-class bar.
    expect(header.className).not.toContain("bg-background/85");
  });

  it("the active nav item is the surface-glass thumb, never a bg-secondary pill", () => {
    renderShell("/today");
    const active = screen.getByRole("link", { name: "Today" });
    expect(active.className).toContain("nav-thumb");
    expect(active.className).toContain("text-foreground");
    // The second active-state idiom (the bg-secondary pill) is dead.
    expect(active.className).not.toContain("bg-secondary");
  });

  it("an inactive nav item is a muted label, not the thumb", () => {
    renderShell("/today");
    const inactive = screen.getByRole("link", { name: "Applications" });
    expect(inactive.className).toContain("text-muted-foreground");
    expect(inactive.className).not.toContain("nav-thumb");
  });

  it("Map|List segmented toggle (Rober 7-25): Map is a muted button back to the globe, List is the active thumb", () => {
    renderShell("/today");
    const map = screen.getByRole("button", { name: "Map" });
    expect(map.className).toContain("text-muted-foreground");
    expect(map.classList.contains("nav-thumb")).toBe(false);
    const list = screen.getByText("List");
    expect(list.classList.contains("nav-thumb")).toBe(true);
  });

  it("the page h1 uses the on-scale `page` token, not sm:text-3xl", () => {
    renderShell("/today", "Applications");
    const h1 = screen.getByRole("heading", { level: 1, name: "Applications" });
    expect(h1.className).toContain("text-page");
    expect(h1.className).not.toContain("text-3xl");
    expect(h1.className).not.toContain("text-2xl");
  });
});

describe("legal pages are reachable (#audit)", () => {
  // They shipped ROUTED BUT UNLINKED: the only /privacy reference in src/ was the
  // <Route>, and the one occurrence in the deployed HTML sat inside <noscript>,
  // which no JavaScript user ever sees. For an EU product that asks for a CV,
  // "the page exists at a URL" is not the same as having provided the information.
  it("every product page links to Privacy and Terms", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppShell title="Test">content</AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /privacy/i })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: /terms/i })).toHaveAttribute("href", "/terms");
  });

  it("the map footer links them too, since it is the only surface an anon sees", () => {
    const source = readFileSync(join(process.cwd(), "src/pages/RolesMap.tsx"), "utf8");
    expect(source).toContain('to="/privacy"');
    expect(source).toContain('to="/terms"');
  });
});
