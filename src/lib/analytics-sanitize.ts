/**
 * Analytics property sanitizer — strips credential material out of every property
 * PostHog sends, before it leaves the browser.
 *
 * Why this exists (confirmed live in the production PostHog project, 2026-07-26):
 * Supabase signs users in with Google OAuth over the implicit flow, which returns
 * the whole session in the URL *fragment* —
 * `https://northgoing.com/#access_token=...&provider_token=...&refresh_token=...`.
 * With `capture_pageview: "history_change"` PostHog records `$current_url` verbatim,
 * so every sign-in wrote that user's access token, Google provider token and refresh
 * token into a third-party analytics store. The refresh token is the serious one: it
 * mints new sessions and outlives the access token.
 *
 * Measured in the live project, one sign-in session of 6 events: `$current_url`
 * carried the tokens on 1 event (the OAuth callback pageview) but `$session_entry_url`
 * carried them on ALL 6. PostHog stamps the session's entry URL onto every subsequent
 * event, so the fragment outlives the page that caused it and a single sign-in
 * contaminates every event that follows — pageviews, $web_vitals, everything. That is
 * why this hook runs over every outgoing event's properties, not just at pageview time,
 * and why the rule below is generic rather than an allowlist of the two property names
 * that happened to be observed: `$session_entry_pathname`, `$session_entry_referrer`,
 * `$initial_current_url` and whatever PostHog adds next belong to the same class.
 *
 * Three deliberate choices:
 *  - The fragment goes in full. No analytics here reads it, and an allowlist of
 *    "safe" fragment keys would rot the moment a new auth parameter appears.
 *  - Known credential keys are stripped from QUERY strings too. Supabase's PKCE
 *    flow puts `code` in the query, so a future flow change must not silently
 *    reintroduce the leak.
 *  - A string is scrubbed when its KEY looks URL-shaped, when its VALUE looks
 *    URL-shaped, or when its value carries a credential parameter at all — three
 *    independent triggers, so a rename on PostHog's side cannot reopen the hole.
 *
 * Wired into `posthog.init({ sanitize_properties })` in src/main.tsx — sanitizing
 * before send, so nothing sensitive is ever transmitted. A PostHog-side ingestion
 * filter would not do: behavior is locked in code, not in a vendor console.
 */

/** Query/fragment parameter names that carry credential material. Lower-case. */
const CREDENTIAL_PARAMS = new Set([
  "access_token",
  "refresh_token",
  "provider_token",
  "provider_refresh_token",
  "id_token",
  "code",
  "token_type",
  "expires_in",
  "expires_at",
]);

/**
 * Property keys whose value is a URL. Matched against the key with any leading `$`
 * removed, so this covers PostHog's own set — `$current_url`, `$pathname`, `$host`,
 * `$referrer` — plus the `$initial_*` and `$session_entry_*` prefixed copies PostHog
 * derives from them (`$initial_current_url`, `$session_entry_url`, …) and any future
 * `*_url` / `*_referrer` property, without this list needing an edit.
 */
const URL_KEY_RE = /(?:^|_)(?:url|href|uri|link|location|referrer|referer|pathname|host)$/i;

/** Catch-all for a URL that arrives under a key this file has never heard of. */
const LOOKS_LIKE_URL_RE = /^https?:\/\//i;

/**
 * Last-resort catch-all: a value carrying a credential parameter at all, whatever
 * its key and whatever its shape. Anything still matching this after the URL surgery
 * is replaced outright rather than transmitted.
 */
const CREDENTIAL_MARKER_RE = new RegExp(`(?:^|[?#&])(?:${[...CREDENTIAL_PARAMS].join("|")})=`, "i");

const REDACTED = "<redacted>";

/** Guards against a deeply nested or self-referencing property bag. */
const MAX_DEPTH = 6;

function isUrlKey(key: string): boolean {
  return URL_KEY_RE.test(key.replace(/^\$/, ""));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Lower-cased parameter name of a `key=value` pair, tolerant of bad encoding. */
function paramName(pair: string): string {
  const raw = pair.split("=")[0];
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/**
 * Drop the fragment entirely, then drop credential parameters from the query.
 * Pure string surgery on purpose: it works on relative and malformed URLs, and
 * unlike `new URL()` it cannot throw.
 */
export function sanitizeUrl(value: string): string {
  const hashAt = value.indexOf("#");
  const withoutFragment = hashAt === -1 ? value : value.slice(0, hashAt);

  const queryAt = withoutFragment.indexOf("?");
  if (queryAt === -1) return withoutFragment;

  const base = withoutFragment.slice(0, queryAt);
  const kept = withoutFragment
    .slice(queryAt + 1)
    .split("&")
    .filter((pair) => !CREDENTIAL_PARAMS.has(paramName(pair)));

  return kept.length ? `${base}?${kept.join("&")}` : base;
}

/**
 * Scrub one string that MIGHT be a URL. Left byte-identical unless its key looks
 * URL-shaped, its value looks URL-shaped, or it carries a credential parameter —
 * so passing ordinary text through this costs nothing. Exported because the Sentry
 * hooks in ./sentry-sanitize need the same rule for single strings (an event's
 * `transaction`, `message` and exception values); one implementation, two vendors.
 */
export function sanitizeString(key: string, value: string): string {
  const carriesCredentials = CREDENTIAL_MARKER_RE.test(value);
  if (!carriesCredentials && !isUrlKey(key) && !LOOKS_LIKE_URL_RE.test(value)) return value;

  const cleaned = sanitizeUrl(value);
  // Belt and braces: if a credential survived the URL surgery — a shape this module
  // does not model — drop the value rather than transmit it.
  return CREDENTIAL_MARKER_RE.test(cleaned) ? REDACTED : cleaned;
}

function sanitizeValue(value: unknown, key: string, depth: number): unknown {
  if (typeof value === "string") return sanitizeString(key, value);
  // Only plain objects and arrays are walked — a Date or a class instance must
  // survive intact.
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  // Absurd nesting is dropped rather than passed through unwalked: fail closed.
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, key, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = sanitizeValue(v, k, depth + 1);
  return out;
}

/**
 * PostHog's `sanitize_properties` hook. Called for event properties and, separately,
 * for the `$set_once` person properties — both of which carry a copy of the URL.
 *
 * Fails CLOSED: if anything in here goes wrong the properties are dropped rather
 * than sent unsanitized. Losing a pageview beats leaking a refresh token.
 */
export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>,
  _eventName?: string,
): Record<string, unknown> {
  try {
    if (!isPlainObject(properties)) return {};
    return sanitizeValue(properties, "", 0) as Record<string, unknown>;
  } catch {
    return {};
  }
}
