---
name: glass-design
description: Use when building or restyling ANY auditjob.me UI — the roles/map page, the post-CV surfaces (rail cards, score/fit chips, role detail, /today, /apply, /tracker), glass surfaces, the globe, design tokens (colors/type/spacing/radius/motion), score & status presentation, the CV-unlock flow, adopted UI libraries, or Logo.dev logos. Carries the locked design system (v2: content-surface system — when glass, when ink) + the hard-won technical learnings so they are never re-derived or regressed.
---

# auditjob.me — glass design system (v2)

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

## v2 — Content-surface system (locked 2026-07-12, S-tier overhaul #58)

v1 was a /roles-MAP system with no vocabulary for dense post-CV data surfaces — that silence is what
produced the "generic AI output" pages and the "horrible colors" score pills. v2 adds the dense-surface
laws. Per-surface application + defect ledger for the #58 waves: planning repo
`docs/specs/2026-07-12-design-direction-post-cv-surfaces.md` (the acceptance contract; it wins on any
conflict for that overhaul). External bar = jackandjill (measured teardown:
`docs/design-research/2026-07-12-s-tier/research-jackandjill-live.md`). North star: **ink speaks,
color whispers, glass floats.**

### When glass, when ink (surface classes — every surface belongs to exactly ONE)
- **A · chrome glass** — headbar, chips, dropdowns, tooltips, zoom, modals: clear glass + rim-light,
  the v1 recipes unchanged.
- **B · rail glass** — the 358px roles panel + scannable cards (≤2 lines of running text): current
  fills (dark .72 / light .66).
- **C · reading glass** — list view (560px), the detail panel, ANY pane with >2 consecutive lines of
  body text or >48ch measure: **fill goes ≥0.92 of `--surface`; glass survives at the RIM only**
  (hairline + top catch-light). The opacity-by-density law: wider/denser text → more opaque fill.
  (Defect it kills: map labels ghosting through the list panel behind dense text.)
- **D · page paper** — /today, /apply, /tracker, legal, the AppShell page bar + top nav: opaque
  documents. `--background` stage, `--card` cards, hairline borders, TWO-LAYER ink shadow (`0 1px 2px
  ink/4% + 0 12px 32px -16px ink/10%`; lift variant deeper) — the jackandjill depth model, NOT the
  rim-light stacks and NOT flat shadcn — **plus jackandjill's third ingredient: a full-page
  `feTurbulence` grain (~220px tile, 4–6% opacity, both themes)**. The shadow's ink is a theme-specific
  SHADOW PAINT that stays DARK in both themes (light: ink `#0B1F26`; dark: the deep stage ink, NEVER
  the flipped pale text token — a pale-tinted shadow is a halo, jackandjill is light-only and can't be
  copied into dark). **Dark-theme depth is VALUE-first:** card one value step above stage + a white
  hairline top edge (BRAND.md dark hairlines `.07–.14`); the darker shadow (alphas ×1.5) assists, never
  carries. Calm editorial density: heavy whitespace, logos are the only rich color, anti-dashboard.

### Score & status laws (v2 REVISES v1's "score = the only glow")
- **The score is the only COLOR, rendered as ink-on-wash — never a saturated glowing object.** ONE
  FitChip component everywhere: ink numeral (Geist Mono, tabular, 700, −0.04em) on a whisper wash of
  the bucket hue (`color-mix(score-token 18%→7%, transparent)`), ink-8% hairline, radius 4, tier word
  folded in (`4.6 · Strong`, word progressively disclosed), NO glow/gradient objects. Sizes sm/md/lg
  (lg = detail hero, numeral 28). Pending = same geometry + shimmer skeleton, clearly not disabled.
  Tier words: great **Strong** · mid **Fair** · low **Weak**. Never color-only (numeral + word + wash).
- **Score tokens have exactly three sanctioned renderings:** the FitChip wash · breakdown bar fills
  (flat single token, 4px track, no gradient) · map pin/cluster ring tint. Anywhere else = violation.
- **Score color is a POINT, never a PLANE:** no banners, fills, chrome borders, or sign chips in score
  hues (this is the BRAND.md "never as UI chrome" rule plus the low-alpha FitChip-wash carve-out).
- **Status = whisper.** Informational status is an inline system line (mono muted caption + optional
  hairline) + shimmer on the pending elements; loud treatment only for action-required. Toasts via
  sonner, quiet. The jade "scoring…" banner class of things is banned.
- **Fit-dependent copy:** great → "Strong fit"/"Why you fit" · mid → "Fair fit"/"Where you stand" ·
  low → "Weak fit"/"Where it breaks down". Header pairs derive from the bucket in code.
- **On the map, score presence = ring/ink on logos only** — never chips/numerals on the canvas; the
  one sanctioned spectacle is the first score-reveal (bloom + count-up + re-rank), steady state is calm.

### Card, CTA, chip, evidence laws
- **Card anatomy (one idiom):** radius 16 (tiles 10), padding 16 rail / 24 page / 12 tile, one shadow
  per surface class, hover = translateY(-1px) + border deepen ink 10%→18%, 150ms. Grid `logo | title block | FitChip`.
  **Reason text is a card citizen:** muted ink, 12/1.5, line-clamp-2, no box/border/italic. Footer
  actions behind a hairline border-t inside the same padding — a divider, never a tinted strip. No
  icon-in-a-pale-chip per row (the #1 AI tell).
- **Buttons: one idiom, two strengths.** Primary = ink fill (`--act-strong`), radius 10, 13/600, no
  glow. Secondary = hairline ink/20, hover deepens to /30 (color shift only). **One primary per
  viewport**; list-row CTAs are secondary. Actioned state = affordance removed (plain text + check),
  not recolored. Same component on map + pages.
- **Chips:** neutral meta chips = ink-tint glass, ink text (the geo-badge is the reference). Semantic
  fit = FitChip only. Segmented controls (Map/List etc.) are CHROME: sunken track + surface-glass
  thumb + ink text — never `--act-strong` blocks, never luminous.
- **Evidence quote-pair rows:** definition-list grid (`16px 1fr`; cites `max-content 1fr`), mono +/−
  glyph in muted ink (no colored squares), keys 10px caps +0.08em `nowrap`, quotes muted ink with max
  TWO emphasis devices (muted + quotation marks — no italic). Whole block carded, hairline dividers.
  Empty → "— no signal", never fabricate.

### v2 global tokens (supersede the v1 "working reference" ramp below)
- **Type scale (px, the ONLY sizes):** 10 micro (caps keys/eyebrows, +0.08em) · 11 caption · 12 dense ·
  13 control · 14 body (1.6) · 16 title · 18 section · 24 page-h1 · 32 display · mono numerals
  12/14/28. Sans weights 400/500/600 ONLY — 700 lives solely on mono numerals + brand. Tracking
  tightens as size grows; never tighten ≤14px. `text-balance` titles, `text-pretty` prose. No
  half-pixels, no arbitrary `text-[…]`.
- **Spacing:** 4/8/12/16/24/32/48/64; card padding 16/24/12; line-heights land on the grid;
  **gap AROUND a group > gap INSIDE it** (StyleSeed — proximity does the grouping, not boxes).
- **Radius:** {4 chips · 10 controls/tiles · 16 cards · 24 panels/modals · 999 true pills}. Nested:
  inner ≈ outer − padding.
- **Color:** three ink tones per theme (text/muted/subtle); every new tint via `color-mix` from
  ink/surface — ZERO new hex/rgba literals (any touched line converts); zero decorative hues; the
  action accent is ink itself.
- **Numerals:** always Geist Mono + tabular-nums where numbers align or change.
- **Motion:** tokens 100/150/200/250ms, ease-out, transform/opacity/color/box-shadow/border-color
  only; entrances ≤400ms; loops = skeletons/status only; hover gated `@media(hover:hover)`;
  reduced-motion cuts to final state. Score-reveal is the one big moment.

### Adopted libraries (decided 2026-07-12 — use these, don't re-research)
- **`@number-flow/react`** (~7-8 kB, dep-free) — score count-up/changes; tabular + reduced-motion
  built in. https://number-flow.barvian.me/
- **`@formkit/auto-animate`** (~3 kB) — list add/remove/reorder (/apply, /tracker, rail re-rank).
  https://auto-animate.formkit.com/
- **Radix (installed):** Collapsible = text expand · HoverCard = evidence peek · ToggleGroup =
  segmented controls · Tooltip · ScrollArea. https://www.radix-ui.com/primitives
  **sonner** = quiet toasts. https://sonner.emilkowal.ski/ **`@tailwindcss/typography`** =
  expanded prose only. https://github.com/tailwindlabs/tailwindcss-typography
  Native `@container` for dual-width cards (skip the plugin).
- **`@dnd-kit/core` + `@dnd-kit/sortable`** (stable, NOT `@dnd-kit/react`) — tracker drag; decouple
  via one semantic event `{cardId, toColumn, newIndex}` + fractional gap ordering.
  https://docs.dndkit.com/
- **SKIP:** framer-motion (34 kB floor; only ever `LazyMotion`+`m` for a designed shared element) ·
  vaul sheets (routed-pages decision; revisit post-launch) · Recharts for the score breakdown
  (anti-dashboard; typographic rows win; keep the `{headline, subscores, signals[]}` data contract) ·
  **Radix Progress for the breakdown bars** (4px CSS track + flat token fill wins for 5 static bars;
  Progress becomes the sanctioned primitive ONLY if a tracker stage-stepper rail ships post-launch) ·
  Kibo kanban (re-imports the generic look) · fluid-type plugins.
- **Review lint (StyleSeed):** Rule 59 status-color-=-severity-only · Rule 32 number 2:1 with its
  unit · Rule 18 nested radii · CC-9b no icon-in-pale-chip rows. https://github.com/bitjaru/styleseed

## Design system (v1 core, locked)
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
  mid-scale bands. ~~Luminous elements stay EXEMPT (scored pills, btn.p, seg indicator, CV spark) —
  the score remains the only glow.~~ **REVISED by v2 (7-12): scored pills → ink-on-wash FitChip (no
  glow); the seg indicator → chrome thumb (never act-strong/luminous); only the CV spark and the
  one-time score-reveal keep luminosity.** The icy band color (170,225,240) is glass-light, deliberately
  far from the score teal — don't drift them together.
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
services (unavatar/google/ddg) are NOT logos — don't use them. **v2 paper/reading cards (D/C-class)
are THEME-AWARE:** the `theme` param follows the ACTIVE app theme — light theme (white cards) →
`theme=light`, dark theme (ink-teal cards) → `theme=dark`; a hardcoded param breaks on theme switch
(the broken-logos bug, both directions).

## Design tokens (working reference — colors lock last)
- **Ink (replaces black):** `#0B1F26`. Ramp 50 `#F5F8F8` · 200 `#D6E2E5` · 500 `#5E828C` · 700 `#1E4753`
  · 900 `#0B1F26` · 950 `#081519`.
- **Score ramp (colorblind-safe; live tokens are `src/index.css` --score-* = roles.css `#1fd8b8/#12a594/
  #04241f/#ffc44d/#ff6f4d`).** v2: rendered ONLY as ink-on-wash FitChip / flat bar fills / map ring —
  never a luminous fill or glow (see v2 score laws above). ~~Secondary interactive accent =
  violet/iris `#6E56CF`~~ — **violet is dead** (7-05 identity lock); the only interactive accent is ink.
- **Type:** SUPERSEDED by the v2 scale above. The `clamp(3rem,8vw,4.5rem)` score numeral survives only
  as the one-time score-REVEAL / marketing hero moment, Geist Mono tabular.
- **Glass tokens:** fill `rgba(255,255,255,.55)` · fill-strong `.72` · fill-mint `rgba(228,245,239,.45)`
  · border `rgba(255,255,255,.65)` · rim-top `rgba(255,255,255,.9)` · shadow `rgba(20,60,70,.12)`. (Dark
  panel tint ≈ `rgba(15,27,33,.72)`.)
- **Elevation shadows:** card `0 8px 24px -8px rgba(20,60,70,.12), inset 0 1px 0 0 rgba(255,255,255,.9),
  inset 0 -1px 0 0 rgba(11,31,38,.06)` · hero glow + the score halo (`0 0 28px 0 rgba(31,216,184,.45)`)
  are RETIRED for standing UI (v2: FitChips don't glow) — luminosity only at the score-REVEAL moment.
- **Spacing** 4/8/12/16/24/32/48/64/96 · **radius** SUPERSEDED by v2: {4 chips · 10 controls · 16 cards ·
  24 panels · 999 true pills}, nested = outer − padding.

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

## Open / next (as of 7-12; v2 content-surface system LOCKED)
Wave contract + bug ledger = planning spec `2026-07-12-design-direction-post-cv-surfaces.md`.
Waves D1-D3 of #58 implement the v2 laws (FitChip, card/CTA/toggle/evidence primitives, /today /apply
/tracker paper pages) · LIVE CAROUSEL landing hero = issue #17 (refraction + glass-type vocabulary
above is its palette) · lock colors (final pass — values live in src/styles/roles.css + src/index.css)
· DESIGN.md guide.

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
