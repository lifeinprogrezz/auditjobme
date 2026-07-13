// PaperLogo — the shared company logo for the D-class PAPER pages (/today, /apply,
// /tracker). Theme-aware per the design direction §5.5 + skill Logo.dev rule: the
// logo.dev `theme` param follows the ACTIVE app theme (light card → theme=light,
// dark card → theme=dark) or the broken-logos bug returns. Fallback chain:
// logo.dev → the site's real favicons → a coloured initial.
//
// Banked D3 nit (5a): the fallback stage RESETS when the theme flips. A themed
// logo that 404'd once used to stay stuck on a favicon/initial after a theme
// switch, because `stage` never rewound to give the NEW theme variant a shot —
// the `useEffect` below rewinds it so the newly-themed logo is retried first.
import { useEffect, useState } from "react";
import { logoUrl, faviconUrls } from "@/lib/logodev";
import { useTheme } from "@/lib/theme";

/** Rendered box sizes (px). Radius stays 10 (§2.4 tile radius) at every size. */
export type PaperLogoSize = 24 | 40;

export default function PaperLogo({
  domain,
  company,
  size = 40,
}: {
  domain: string | null;
  company: string;
  size?: PaperLogoSize;
}) {
  const { theme } = useTheme();
  const chain = domain
    ? [logoUrl(domain, theme === "dark" ? "dark" : "light"), ...faviconUrls(domain)].filter(Boolean)
    : [];
  const [stage, setStage] = useState(0);
  // Rewind the fallback chain on a theme flip so the new theme's logo is retried.
  useEffect(() => setStage(0), [theme]);
  const src = chain[stage] ?? null;
  const box = size === 24 ? "h-6 w-6" : "h-10 w-10";
  if (!src) {
    // Fallback monogram is INK-TINTED, not hash-coloured (design direction §2.3
    // zero-decorative-hues + resolution #7 "violet is dead"): an ink wash + ink
    // letter in both themes. The FitChip wash stays the ONLY data colour on paper
    // pages. `--foreground` is theme-scoped, so the wash + letter follow the theme.
    return (
      <span
        className={`${box} grid flex-none place-items-center rounded-[10px] font-display text-body font-bold text-foreground/75`}
        style={{ background: "color-mix(in srgb, hsl(var(--foreground)) 9%, transparent)" }}
        aria-hidden="true"
      >
        {company.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={src as string}
      alt=""
      className={`${box} flex-none rounded-[10px] object-contain`}
      onError={() => setStage((s) => s + 1)}
    />
  );
}
