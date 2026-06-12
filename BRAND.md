# Brand & copy rules

## Visual
- Palette: sage `#8a9a8a` accents on dark charcoal (see `tailwind.config.ts`). Audit
  artifacts/display pages: white background, brand-aligned, no AI-tells.
- Typography and components: shadcn/ui defaults, Plus Jakarta Sans where already used.
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
