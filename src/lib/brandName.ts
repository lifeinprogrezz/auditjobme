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
