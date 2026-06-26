---
name: glass-design
description: Use when building or restyling any auditjob.me UI — the roles/map page, the glass surfaces, the globe, design tokens (colors/type/spacing), the CV-unlock flow, or Logo.dev logos. Carries the locked design system + the hard-won technical learnings so they are never re-derived or regressed.
---

# auditjob.me — glass design system

Distilled 2026-06-26 from the 2026-06-23 UI/UX deep-research (was gitignored scratch:
`.superpowers/brainstorm/.../notes/design-progress.md` + `design-tokens-research.md`, mockup
`core-roles-page-v43.html`). This is the durable, reachable home for that work. Colors were "lock LAST"
as of 6-23 — treat the token values as the working reference, the *learnings* as hard rules.

## Strategic spine (locked)
**Map = hook · Score = hero · Audit = closer.** The per-user fit SCORE (each role scored against the
user's own CV) is the core differentiator. Pre-CV = anonymous browsable map + roles (the wow, zero
friction); **"Add your CV" unlock** reveals personalized scores (the conversion moment). Watch-out:
pre-CV the score (our hero) is hidden, so the post-CV score-reveal must land as a real moment (pills
bloom + count up + re-rank).

## Design system (locked)
- **Dark dramatic globe** (chosen over pastel v1–v9 for "serious/strong/impactful"). MapLibre GL JS
  **v5** + globe projection + clusters; CARTO **Dark Matter** basemap; GSAP. Companion mockup is
  vanilla; the real build is Vite + React + Tailwind + shadcn.
- **GLASS = CLEAR, not frosted (KEY DECISION, v35).** All glass (headbar, panel, contributors, CV,
  dropdowns, zoom) = translucent tint + rim + sheen + grain, **NO `backdrop-filter` blur/displacement.**
  Rober prefers the lighter/airier look; the frosted liquid-glass was movement-gated (frost on idle,
  sharp while panning) so it "condensed" on stop — disliked, and the gate was the perf cost. Clear =
  consistent + smooth + his preference. The SVG `#gd` displacement filter may still exist unused; don't
  wire it back. (If frost is ever wanted, it's a one-line add to the headbar ONLY.)
- **Headbar CV unlock (v40+):** pre-CV = calm jade-tinted **"Add your CV"** button + ＋ spark chip;
  the Map/List toggle is HIDDEN pre-CV (no scored roles yet) and appears only **post-CV**, at which
  point the "Add your CV" button moves to the profile/avatar (headbar stays clean). Swap driven by
  `body.scored` (`#navcv` ↔ `.seg`). **Button aesthetic: jade tint + text + spark ONLY — NO neon-glow
  box-shadows** (those read as "vibe-coded"; use the system `var(--sh)` shadow like everything else).
- **Panel pre-CV:** no top CTA; straight to uniform clear-glass cards (logo + Company + Role + City),
  cursor-follow spotlight hover, full scrolling list, `bottom:22px`. **Post-CV:** score pills bloom +
  count up, Audit/Prep + "why it fits" appear, re-rank. Detail-view contextual **"Unlock your fit"**
  CTA per role = agreed, not built yet.
- **Map chrome:** zoom (+/-) at **left-middle, vertically centered**; NO live "footbar" (removed);
  contributors = custom glass pill **centered bottom**, credits `santifer | © CARTO | © OpenStreetMap`
  (vertical-bar seps, all linked). Fonts: **Space Grotesk** (display) / **Geist** (UI) / **Geist Mono**
  (numerals). Logos via Logo.dev.

## Hard-won technical learnings (DON'T regress)
1. **Globe:** call `map.setProjection({type:'globe'})` AFTER `style.load` (the constructor option gets
   reset). Globe zoom math is unstable on load → frame with `fitBounds`, never a raw zoom number.
2. **Terrain/sea:** insert hillshade + color-relief layers ABOVE the basemap **water fill** (else the
   ocean paints over them → flat sea). Sea depth must be **color-relief** (renders on every GPU);
   hillshade-only relief is GPU-dependent and was flat on Rober's machine. color-relief IS supported in
   MapLibre v5.
3. **Entrance anims:** never animate `opacity` — a backgrounded tab freezes the tween and the element
   sticks translucent (the "panel too glassy" bug). GSAP leaves an inline `transform` that overrides CSS
   `transform`, so drive panel hide/show with GSAP, not a CSS class transform.
4. **Always verify in a headless browser (Playwright MCP) BEFORE handing back** — this caught the `top`
   global-collision blank screen, the layer-order flat sea, and the opacity-stuck panel.

## Logo.dev
Publishable (client-safe) token lives in the auditjobme env / the design-progress notes — reference it
by location, don't hardcode it into committed source. Pattern:
`https://img.logo.dev/{domain}?token={pk_...}&size=96&format=png&theme=dark&retina=true&fallback=404`
→ `onerror` → colored-initial fallback. `theme=dark` returns transparent light marks for most brands;
a few (e.g. Factorial) ship a filled colored tile — that's the brand's real asset, leave it. Favicon
services (unavatar/google/ddg) are NOT logos — don't use them.

## Design tokens (working reference — colors lock last)
- **Ink (replaces black):** `#0B1F26`. Ramp 50 `#F5F8F8` · 200 `#D6E2E5` · 500 `#5E828C` · 700 `#1E4753`
  · 900 `#0B1F26` · 950 `#081519`.
- **Score ramp (colorblind-safe, Radix-anchored):** great `#12A594` / luminous `#1FD8B8` / text `#067A6F`
  · mid `#FFA01C` · low `#E54D2E`. Score glow = `#1FD8B8` halo only. **Rationed saturation: the SCORE is
  the only luminous color.** Secondary interactive accent = violet/iris `#6E56CF`.
- **Type:** base 16px, Major-Third 1.25. h1 2.441 · display 3.815 · **score numeral `clamp(3rem,8vw,4.5rem)`**,
  Geist Mono tabular. caption .8 · sm .875 · base 1 · lead 1.25.
- **Glass tokens:** fill `rgba(255,255,255,.55)` · fill-strong `.72` · fill-mint `rgba(228,245,239,.45)`
  · border `rgba(255,255,255,.65)` · rim-top `rgba(255,255,255,.9)` · shadow `rgba(20,60,70,.12)`. (Dark
  panel tint ≈ `rgba(15,27,33,.72)`.)
- **Elevation shadows:** card `0 8px 24px -8px rgba(20,60,70,.12), inset 0 1px 0 0 rgba(255,255,255,.9),
  inset 0 -1px 0 0 rgba(11,31,38,.06)` · hero adds `0 0 40px -8px rgba(31,216,184,.18)` glow · score halo
  `0 0 28px 0 rgba(31,216,184,.45)`.
- **Spacing** 4/8/12/16/24/32/48/64/96 · **radius** sm8 md12 lg16 xl24 2xl32 pill999.

## Accessibility (non-negotiable)
Body ≥4.5:1 (ink-900 on pastels clears). The score numeral uses `#067A6F` or `#081519` — NOT the luminous
`#1FD8B8` (it fails on light glass). **Never color-only:** numeral + label + color together. Wrap glass in
`@supports (backdrop-filter: blur(1px))` with a solid fallback (and clear-glass needs no blur anyway).

## Open / next (as of 6-23)
LIVE CAROUSEL of the roles page (landing hero — Rober's explicit ask) · detail-view "Unlock your fit" CTA ·
lock colors (final pass) · then ship tokens-in-code (CSS `:root` vars + Tailwind theme) + a DESIGN.md guide.
