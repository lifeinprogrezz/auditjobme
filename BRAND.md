# Brand & copy rules

## Name and mark (issue #107, decided 2026-08-19)

**Northgoing.** From the north-going ship, Swedish *norrgående*. The product is a map,
and a map is only useful once it gives you a direction, so the name is the direction
rather than the feature. It replaces `auditjob.me`, which tied the brand to the audit,
now one feature among several rather than the core.

**The mark is a compass needle.** Solid north half, outlined south half, a hairline gap
at the pivot. It is a measuring instrument, which is exactly what the score is: the
product reads a situation and gives you a bearing. The two halves carry the second
reading, that one direction is answered and the other is still open.

- **Source of truth:** `src/lib/brand.tsx` holds the geometry, the wordmark lockup, and
  the product name. `public/favicon.svg` carries the same two paths and is pinned to it
  by `src/test/brand-mark.test.ts`. Change one, change both, in the same commit.
- **Every binary is generated,** never hand-exported: `node scripts/generate-icons.mjs`
  rebuilds the icon set and the social image from `public/favicon.svg`.
- **The mark is monochrome by construction.** Both halves paint with `currentColor`, so
  it is ink on the light stage and pale on the dark map with no theme branching. Never
  give it a color: the score palette below already means fit, and a colored mark would
  make the accent say two different things.
- **Wordmark:** lowercase `northgoing`, Space Grotesk 600, letter-spacing `-0.03em`, set
  beside the mark at roughly 0.86 of the mark's height. The lowercase is the LETTERING,
  not the name: `BRAND_WORDMARK` is what the logo draws (map headbar, page headers, social
  card, email masthead), and `BRAND_NAME` stays `Northgoing` everywhere the name is spoken
  in prose, titles, legal copy and email bodies. Both live in `src/lib/brandName.ts`.
  Pick by the ROLE the text plays, never by the file you happen to be editing: lowercase
  in a sentence reads as a typo and breaks the moment the name starts one.
- **Grounds:** tab icons are the ink mark on transparency. App icons and the social card
  put the pale mark on the ink ground, because iOS, Android, and Open Graph readers all
  composite transparency onto a ground you do not control.

## Visual (matches the live product — rewritten 2026-07-11, Track D S3)

The brand is a **monochrome ink-glass system** — the look of the live /roles map.
Color appears ONLY as data semantics (score buckets) and company logos; there is no
decorative brand accent. The old "sage on charcoal" palette is retired (it never
shipped on the live surface).

- **Token source of truth:** `src/index.css` (`:root` light / `.dark`) +
  `tailwind.config.ts` (`fontFamily`, `colors.score`). The map's `src/styles/roles.css`
  is the reference implementation, self-scoped under `.roles-theme` — keep it that way.
- **Light (default):** white / off-white glass surfaces (`#ffffff`, `#f0f4f6`,
  `#e4ebee` on a `#f7f9fa` stage), near-black ink text `#0b1f26`, blue-grey muteds
  (`#3f5a63`, `#6f8a92`), dark hairline borders (`rgba(11,31,38,.10–.13)`).
  Strong actions are ink blocks (`#15232c` with `#f4f8f9` lettering).
- **Dark:** deep ink-teal surfaces (`#0f1d24`, `#16262e`, `#1c2f38`), pale text
  `#eaf2f3`, muteds `#9db1b8` / `#6e858e`, white hairlines (`rgba(255,255,255,.07–.14)`).
  Strong actions invert: pale blocks with ink lettering.
- **Score semantics (the only color, identical both themes):** great = jade `#1fd8b8`
  (deep `#12a594`, ink `#04241f`) · mid = amber `#ffc44d` · low = coral `#ff6f4d`.
  Never use these as UI chrome.
- **Typography:** Space Grotesk (display/headings, `font-display`), Geist Sans (body,
  `font-sans`), Geist Mono (numbers/data, tabular, `font-mono`). Loaded globally in
  `src/main.tsx` via @fontsource. Plus Jakarta Sans and DM Sans are retired (they were
  referenced but never installed).
- **Surfaces:** glass — translucent fills, hairline rims, soft inner light; radius
  language ~11px controls / 14–18px cards (`--radius: 0.75rem` base).
- Audit artifacts/display pages: white background, brand-aligned, no AI-tells.
- No decorative emojis in product UI.

## Copy (user-facing — pages, buttons, emails, audit output)
- Warm, direct, founder voice. Contractions are good ("don't", "it's").
- **No em-dashes (—)** in user-facing copy. Use periods or commas.
- No AI-tell phrasings ("delve", "leverage", "the lesson generalizes", "moreover").
- Expand abbreviations on first use (Product Manager, not PM; curriculum vitae → CV is
  fine, it's universal in EU job context). Universal OK: AI, URL, PDF, EU, USD.
- Numbers: never fabricate. Every metric shown to a user must come from data we hold.

## Product promises (copy may state these; code must honor them)
- "We never rewrite your CV" (LLM touches summary + letter only).
- "Free, with fair-use limits" (no hidden paywall language).
- Job hunting is private: no public-by-default user content; sharing is always opt-in.
