// Northgoing brand primitives (issue #107). ONE definition of the mark, the
// wordmark, and the product name, so every surface (app header, favicon, app
// icons, social image, email header) renders the same identity.
//
// Direction A "Needle", chosen by Rober 2026-08-19: a compass needle with a
// solid north half, an outlined south half, and a hairline pivot gap. It is a
// measuring instrument, which is what the score is.
//
// Geometry is monochrome by construction — both halves paint with currentColor,
// so the mark is ink on the light stage and pale on the dark map with no theme
// branching anywhere. Never introduce a literal color here: the score palette
// (jade / amber / coral) means fit, and a colored mark would make the accent
// say two different things (BRAND.md).
//
// public/favicon.svg carries the SAME two paths and is pinned to these
// constants by src/test/brand-mark.test.ts. Edit one, edit both, in one commit.

/** Shared coordinate space for every rendering of the mark. */
export const MARK_VIEWBOX = "0 0 64 64";

/** North half: solid. The answered direction. */
export const MARK_NORTH = "M32 4 L47 34 L32 28 L17 34 Z";

/** South half: outline. The direction still open. */
export const MARK_SOUTH = "M32 60 L47 38.5 L32 44.5 L17 38.5 Z";

/** Outline weight of the south half, in viewBox units. */
export const MARK_SOUTH_STROKE = 3.4;

/** The product name. The cutover (#106) swaps domains, never this string. */
export const BRAND_NAME = "Northgoing";

type MarkProps = {
  /** Rendered size in pixels. Square by construction. */
  size?: number;
  className?: string;
  /** Accessible name. Omit inside a lockup, where the wordmark already names it. */
  title?: string;
};

/**
 * The bare mark. Inherits color from its parent, so place it on any ground and
 * it takes that ground's ink.
 */
export function NorthgoingMark({ size = 24, className, title }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      fill="none"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={MARK_NORTH} fill="currentColor" />
      <path
        d={MARK_SOUTH}
        fill="none"
        stroke="currentColor"
        strokeWidth={MARK_SOUTH_STROKE}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Mark plus wordmark, the standard horizontal lockup. The wordmark is set in
 * the display face already loaded globally (Space Grotesk, via @fontsource in
 * main.tsx) — no extra font request.
 */
export function NorthgoingLockup({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: size * 0.42 }}>
      <NorthgoingMark size={size} />
      <span
        style={{
          fontFamily: '"Space Grotesk", "Geist Sans", system-ui, sans-serif',
          fontWeight: 600,
          fontSize: size * 0.86,
          letterSpacing: "-0.03em",
          lineHeight: 1,
        }}
      >
        {BRAND_NAME}
      </span>
    </span>
  );
}
