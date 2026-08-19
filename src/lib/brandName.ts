// The product name, alone in a framework-free module (issue #106 cutover).
//
// It lives here rather than in src/lib/brand.tsx because two very different
// consumers need it and only one of them can load JSX:
//   - the React surfaces (header, legal pages, audit footers) import it through
//     src/lib/brand.tsx, which re-exports it beside the mark;
//   - the email builders (src/lib/nightly.ts) and the Vercel Functions in api/
//     are compiled to native ESM and must stay free of React, so they import
//     this module directly with an extensioned "./brandName.js" specifier
//     (src/test/api-esm-imports.test.ts pins that rule).
// One definition, so the header, the emails and the from-name can never drift.

/** The product name. The domain cutover (#106) swaps hosts, never this string. */
export const BRAND_NAME = "Northgoing";

/**
 * The wordmark: the name AS DRAWN in the logo, which is lowercase (Rober,
 * 2026-08-19). This is deliberately a second constant rather than a call to
 * .toLowerCase() at each site, because the two are different things and drift
 * in different directions. BRAND_NAME is a proper noun and belongs in prose,
 * titles, legal copy and email bodies, where lowercase would read as a typo and
 * would break the moment the name starts a sentence. BRAND_WORDMARK is
 * lettering and belongs anywhere the logo is set: the map headbar, the paper
 * page headers, the social card, the email header.
 *
 * Use the one that matches the ROLE the text is playing, never the one that
 * matches the surface you happen to be editing.
 */
export const BRAND_WORDMARK = "northgoing";
