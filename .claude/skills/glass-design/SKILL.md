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
- **RIM-LIGHT SYSTEM (approved live 2026-07-05, system-wide in `src/styles/roles.css`).** Glass tells
  at the rim (the Outpace optics insight, done as STATIC PAINT — inset box-shadows, never a filter).
  Light enters top-left. **Raised panes** (headbar/dropdowns/attrib/zoom via `--sh`): top hairline
  `rgba(255,255,255,.18)` + icy band `rgba(170,225,240,.28)` falling off ~16px + bottom seat into
  shadow. **Tall panes** (the roles panel): same plus side edges — lit left (hairline .07 + band .16),
  seated right. **Small chips/buttons** (filterbtn/fchip/signin/btn.g/score-pending): compact version,
  1px top light + faint band + 1px bottom seat. **Sunken wells** (search field, Map/List track): the
  INVERSE — `inset 0 1px 2px rgba(0,0,0,.28)` top seat + faint bottom light. **Cards/drole/panel-note:**
  mid-scale bands. **Luminous elements stay EXEMPT** (scored pills, btn.p, seg indicator, CV spark) —
  the score remains the only glow. The icy band color (170,225,240) is glass-light, deliberately far
  from the score teal — don't drift them together.
- **Headbar CV unlock (v40+):** pre-CV = calm jade-tinted **"Add your CV"** button + ＋ spark chip;
  the Map/List toggle is HIDDEN pre-CV (no scored roles yet) and appears only **post-CV**, at which
  point the "Add your CV" button moves to the profile/avatar (headbar stays clean). Swap driven by
  `body.scored` (`#navcv` ↔ `.seg`). **Button aesthetic: jade tint + text + spark ONLY — NO neon-glow
  box-shadows** (those read as "vibe-coded"; use the system `var(--sh)` shadow like everything else).
- **Panel pre-CV:** no top CTA; straight to uniform clear-glass cards (logo + Company + Role + City),
  cursor-follow spotlight hover, full scrolling list, `bottom:22px`. **Post-CV:** score pills bloom +
  count up, Audit/Prep + "why it fits" appear, re-rank. Detail-view contextual **"Unlock your fit"**
  CTA per role = agreed, not built yet.
- **Map chrome:** zoom (+/-) at **left-middle, vertically centered** (54px buttons since 7-05); NO live
  "footbar" (removed); contributors = custom glass pill **centered bottom**, credits
  `santifer | © CARTO | © OpenStreetMap` (vertical-bar seps, all linked). Fonts: **Space Grotesk**
  (display) / **Geist** (UI) / **Geist Mono** (numerals). Logos via Logo.dev — **theme must match the
  surface**: white pins → `theme=light`, dark glass cards → `theme=dark` (dark marks on white = the
  "broken logos" bug).
- **IDENTITY = PAPER LIGHT in DARK SPACE (Rober's final call 2026-07-05, after full light-skin A/B).**
  The shipped default: daylight Positron globe with a luminous white-blue atmosphere HALO, floating in
  the SAME ink starfield cosmos as dark mode (space never goes light). Light glass = white fills + INK
  text + dark hairline rims (a white border on light reads as a plain contour, not glass) + inner white
  catch-light. Contrast rule: sea is MID-TONE slate (never mist-on-mist — white-on-white was the failed
  first pass), labels/borders carry real ink. Cluster bubbles are TWO-TIER (startupmap pattern): counts
  <10 = white glass w/ ink text, hubs = near-black ink glass. **Interactive accent = ONE family: jade
  (#12A594/#1FD8B8, ink text on primary buttons) — violet is dead**; score pills stay their own luminous
  system. Footer = freshest-roles marquee ticker (the liveness signal); CARTO/OSM attribution = corner
  pill, must stay visible. Dark ink remains the alternate identity behind the DEV "L" toggle (future
  theme setting). Initial camera = fitBounds [[-32,18],[48,64]] w/ panel padding (startupmap framing).
- **MAP PALETTE (dark identity) = INK & GRAPHITE (2026-07-05, live A/B vs indigo + the original teal).**
  The world is a neutral graphite stage: slate-blue sea relief (rgba(4,8,14)→rgba(20,34,50) ramp),
  graphite hillshade (highlight #38434c), hairline neutral borders (#7f95a3 @ .22), ink page halo
  (#10181f→#020407). Rationale: the old teal Atlantic spent the score's hue on scenery; ink makes
  glass rims, score pills, and brand logos the only color. Values in GlobeMap.tsx + roles.css —
  retune there only (final color lock may still adjust).
- **Markers (clusters + pins) are DOM elements** — never override `.maplibregl-marker`'s
  `position:absolute` (position:relative drops them into flow → the vertical-stack bug) and never put
  CSS `transform` on the marker element itself (it clobbers maplibre's positioning transform — scale an
  inner child if hover-scale is ever wanted). A source with no layer never loads tiles: keep the
  invisible `roles-tiles` probe layer or querySourceFeatures goes empty. Same-city roles sit on a
  deterministic sunflower disc (geo.ts `sunflowerLngLat`, ~6 km cap); cities hold one glass bubble
  until zoom 10 (clusterMaxZoom); cluster-click easeTo must carry the panel-aware padding.

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

## Real refraction ("honest" liquid glass) — researched 2026-07-05, for MARKETING surfaces only

Reference: https://glass.outpacestudios.com/ (Outpace Studios' engine + essay; their runcycle demo
shots — glass dropdown over a cherry-blossom photo and over a 3D glass-mug hero — are the art-direction
reference set for the landing, issue #17). Their thesis independently confirms our v35 lock: **"blur
isn't glass"** — a frosted panel with a bright border is an impression of glass. They go the other way
from us: compute the actual bend.

**The technique, distilled (with attribution — architecture credit goes to Aave's "Building Glass for
the Web"; the optics are Outpace's):**
- One displacement map, COMPUTED not painted: model the pane as a convex squircle dome (flat centre,
  thin rim band), refract a straight-down ray through it with Snell's law at index 1.5, aim the bend
  along a rounded-rect SDF normal. All bending concentrates at the rim; centre stays clear. Blue
  channel carries specular height → the bright rim light. Feed it to a single SVG `feDisplacementMap`.
- **Refract a COPY of the backdrop, never the live backdrop.** `backdrop-filter` + SVG displacement is
  Chromium-only (Safari/Firefox silently drop the SVG part → flat blur). Plain `filter` runs everywhere:
  render the backdrop twice, counter-position the copy 1:1 under the lens, bend the copy. The real UI
  underneath stays unfiltered and interactive.
- Browser gotchas that bite: feImage REFUSES `data:` URIs in real WebKit — the map must be a `blob:`
  URL · force sRGB (filters default to linearRGB, silently changing displacement distances) · Safari
  caches filter output by id — an animating lens needs a fresh id per rebuild · Safari caps filter
  source size — clip the backdrop copy to the lens box or it renders nothing · tier by engine: Chromium
  affords 3 passes (chromatic fringe) + specular; Safari gets 1 pass, same material, never a blur
  fallback.
- One traveling lens, not one per menu: spring-driven, interruptible, resizes to each dropdown — reads
  as a single pane of glass moving.

**Where this is allowed:** marketing/landing surfaces only — the #17 landing hero/nav is the natural
home. **The core app UI (roles globe, panel, headbar) stays CLEAR glass — the v35 lock is unchanged**
(lighter/airier preference + zero per-frame filter cost; Safari re-rasterises moving-backdrop filters
in software every frame, which is exactly the perf class we removed). If refraction ever tempts us
app-side, the answer is still no; propose it for a static marketing moment instead.

**Glass typography (freedrw reference, same 7-05 batch):** translucent white display text over a
saturated single-hue gradient + giant soft-blurred glass numerals as background texture. Cheap (pure
CSS, static — no backdrop reads), striking, and a legitimate landing-hero option; never for data UI.
Clear glass needs a flat/dark backdrop to read (our globe qualifies); over busy photography you need
either a scrim (token research §scrim) or real refraction — plain clear tint fails there.

## Accessibility — glass + motion fallbacks (added 7-05, applies to the SHIPPED /roles too)
- `prefers-reduced-motion: reduce` → no springs/count-ups/camera flights: cut to final state
  (score numerals render final value; flyTo/fitBounds use duration 0).
- `prefers-reduced-transparency: reduce` → swap glass fills for opaque `--surface-2`-class panels
  (text on solid, full contrast). Treat as progressive enhancement (Safari ships it; Chromium partial).
- The glass is an enhancement; the interface must work without it.

## Open / next (as of 7-05; roles page SHIPPED — see planning spec 2026-07-05-roles-globe-port-design.md)
LIVE CAROUSEL landing hero = issue #17 (refraction + glass-type vocabulary above is its palette) ·
detail-view "Unlock your fit" CTA = issue #18 · reduced-motion/transparency fallbacks on /roles ·
lock colors (final pass — values live in src/styles/roles.css) · DESIGN.md guide.

## Light liquid glass over nature — validated 2026-07-07 (Verdaura build, esade-mba)

A full LIGHT counterpart to the dark clear-glass system, built and user-tuned across ~8 live iterations on a
perfume-brand scrollytelling page. The winning recipe, in Rober's own words: *"keep the background vivid,
diffuse it, reduce the colour on the boxes, make the glass more cristal."*

- **Vivid but DIFFUSED photo, fixed.** One nature photo as a `position:fixed` page background (`inset:-18px`
  to hide blur bleed), `filter: saturate(1.4) contrast(1.05) brightness(1.02) blur(6px)`. The blur is the key
  move: a soft vivid wash reads premium AND lets the glass go very crystal without hurting legibility (nothing
  sharp behind the text). **Plain white between sections was the #1 "AI-made" tell** — the fixed photo must
  show through everywhere you scroll (Rober: "now is just white and pure white when you scroll").
- **Crystal glass, not milky.** Panels `rgba(255,255,255,.38–.44)` + `backdrop-filter: blur(20–26px)`, thin
  white rim, big soft shadow, cursor-follow spotlight (`::after` radial at `--mx/--my`) + hover lift. He pushed
  opacity DOWN twice ("too opaque, make it more cristal"); crystal beats frosted here.
- **Colour lives in the PHOTO, not the UI.** Mute the in-box elements to a tonal palette (ink text, ONE muted
  accent used sparingly, charts in muted greens/sage/one dusty rose). Colourful UI on a colourful photo reads
  busy; neutral UI on a vivid photo reads premium. This is the runcycle/Outpace lesson made explicit, and the
  fix when he said "everything looks greyish" (weak) then "too hot" — the answer was neither: vivid bg + calm UI.
- **Content is HOSTED, never floating.** Every section wrapped in one glass panel (consolidated, compact); nav
  is a floating glass pill bar; buttons are glass pills. Bare text on the background was the second AI tell.
- **Type:** a rounded humanist face reads "Apple" and warm; he rejected geometric Space Grotesk as "boxy".
  Manrope (variable font, one ~24KB woff2 covers every weight) was the pick. Embed base64 for self-containment.
- **Hero = a FEW big numbers.** 2–3 large figures on their own glass panel; six small ones were unreadable.
- **Motion in EVERY section** (IntersectionObserver reveal, staggered `transition-delay`), not one static block.
- **Self-contained:** image (optimized webp), font, data all base64-embedded; zero external requests → works as
  a claude.ai artifact and offline. Light photos compress far smaller than dark foliage (~60KB vs ~480KB webp).

**Reference set (Rober's own art-direction picks, saved for reuse):** runcycle / Outpace Studios landing shots
— glass nav + pill buttons over a glass-mug-with-moss hero, and over cherry-blossom-on-blue: light, airy, a
single nature-in-glass hero, minimal copy, huge breathing room. This is the LIGHT companion to the dark globe.
The scrim rule still holds over busy photos, but **diffusing the photo (blur) is the lighter-touch alternative
to a heavy scrim and preserves vividness** — prefer it for light surfaces.

**2026 trend confirmation (web research 7-07):** Apple Liquid Glass (iOS 26 / macOS Tahoe) is now
"infrastructure"; glassmorphism rose to ~10% of generations by mid-2026; recurring rules: (1) glass needs
depth/a photo behind it, (2) scrims or diffusion for text contrast, (3) glass for hero + highlights, not
everywhere. Sources: orizon.co glassmorphism-2026, setproduct liquid-glass-vs-glassmorphism, mycodelesswebsite
best-glassmorphism-websites.
