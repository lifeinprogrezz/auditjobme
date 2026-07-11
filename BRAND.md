# Brand & copy rules

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
