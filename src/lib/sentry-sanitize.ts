/**
 * Sentry event + breadcrumb sanitizer — the Sentry half of the credential leak
 * whose analytics half shipped in #91.
 *
 * Same root cause. Supabase signs users in with Google over the implicit flow,
 * which returns the whole session in the URL *fragment*:
 * `https://northgoing.com/#access_token=...&provider_token=...&refresh_token=...`.
 * Two default @sentry/react browser integrations record that URL, so any error
 * captured during or shortly after the sign-in redirect shipped the user's access
 * token, Google provider token and refresh token to a second third-party service.
 * The refresh token is the serious one: it mints new sessions and outlives the
 * access token.
 *
 * What actually carries it, read out of the installed integration source
 * (@sentry/browser 8.55.2) rather than assumed:
 *
 *  - `HttpContext` (integrations/httpcontext.js) sets `event.request.url` to
 *    `window.location.href` and `event.request.headers.Referer` to
 *    `document.referrer`, on EVERY captured error.
 *  - `Breadcrumbs` (integrations/breadcrumbs.js) records navigation `from` / `to`
 *    as `parseUrl(...).relative`, and `relative` is `path + query + fragment`
 *    (core/utils-hoist/url.js), so the fragment rides along. The same integration
 *    puts a request URL on `data.url` for xhr and fetch breadcrumbs.
 *
 * Checked and found NOT to be a carrier today, and what was done about each:
 *
 *  - `event.sdkProcessingMetadata.normalizedRequest` holds a second copy of the
 *    request, but `createEventEnvelope` deletes `sdkProcessingMetadata` before the
 *    envelope is built, so it never reaches the wire. Left alone.
 *  - `event.transaction` is empty here: nothing sets it without a tracing or router
 *    integration, and neither is configured (`tracesSampleRate: 0`, default
 *    integration list only). Scrubbed anyway, because adding
 *    `browserTracingIntegration` later would quietly make it a carrier.
 *  - `event.extra` / `event.contexts` / `event.tags` / `event.message` / exception
 *    messages carry no URL today. Scrubbed anyway: those are the open bags product
 *    code reaches for, and the shared rule only rewrites a string that looks like a
 *    URL or actually carries a credential parameter, so clean data passes through
 *    byte-identical.
 *  - Stack frame filenames are script URLs, needed for grouping and source maps,
 *    and never carry the page fragment. Left alone.
 *
 * One inherited boundary, stated rather than papered over: the shared rule
 * recognises a credential parameter at a URL delimiter (string start, `?`, `#`, `&`),
 * not in the middle of a sentence. That matches the vector — every carrier above is a
 * URL or a URL fragment — and keeping the rule as #91 calibrated it avoids redacting
 * ordinary prose on both vendors at once.
 *
 * ONE sanitizer, two vendors: `sanitizeUrl`, `sanitizeString` and the property-bag
 * walk all come from ./analytics-sanitize, which PostHog already uses. A second
 * copy of this logic is how one of the two silently rots.
 *
 * Both hooks FAIL CLOSED and never throw. `addBreadcrumb` calls `beforeBreadcrumb`
 * inline inside the instrumentation handler, so a throw there would surface in
 * whatever the user just clicked, and a throw in `beforeSend` would break error
 * reporting itself. If sanitizing cannot complete, the event or the breadcrumb is
 * dropped (`null`) rather than sent unsanitized. Losing one error report beats
 * leaking a refresh token.
 *
 * The durable fix is switching Supabase auth to PKCE so tokens never reach a URL at
 * all. That touches the load-bearing auth flow and wants its own change; until then
 * every vendor that records URLs needs a hook like this one.
 *
 * Wired into `Sentry.init({ beforeSend, beforeBreadcrumb })` in src/main.tsx.
 */

import type { Breadcrumb, ErrorEvent as SentryErrorEvent } from "@sentry/react";
import { sanitizeAnalyticsProperties, sanitizeString, sanitizeUrl } from "./analytics-sanitize.js";

/**
 * Breadcrumb `data` keys the browser integrations fill with a URL. These are handled
 * by KEY rather than by inspecting the value, because `from` / `to` hold a RELATIVE
 * url (`/#access_token=...`) — recognising those by content alone would tie the fix
 * to today's OAuth parameter names, which is exactly the rot to avoid.
 */
const URL_BEARING_BREADCRUMB_KEYS = ["from", "to", "url"] as const;

function sanitizeBreadcrumbData(data: Record<string, unknown>): Record<string, unknown> {
  // Generic pass first (catches a URL under any key), then the unconditional drop of
  // the fragment on the keys known to hold one.
  const out = sanitizeAnalyticsProperties(data);
  for (const key of URL_BEARING_BREADCRUMB_KEYS) {
    const value = out[key];
    if (typeof value === "string") out[key] = sanitizeUrl(value);
  }
  return out;
}

/**
 * `Sentry.init({ beforeBreadcrumb })`. Scrubs navigation `from` / `to` — the
 * `parseUrl(...).relative` that carries the fragment — plus the request URL on xhr
 * and fetch breadcrumbs, and any URL that reached `data` under another key.
 */
export function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  try {
    if (!breadcrumb || typeof breadcrumb !== "object") return null;

    const out: Breadcrumb = { ...breadcrumb };
    if (out.data && typeof out.data === "object") {
      out.data = sanitizeBreadcrumbData(out.data as Record<string, unknown>);
    }
    if (typeof out.message === "string") out.message = sanitizeString("message", out.message);
    return out;
  } catch {
    return null;
  }
}

/**
 * `Sentry.init({ beforeSend })`. Scrubs `event.request` (HttpContext's copy of
 * `location.href` and `document.referrer`), the breadcrumbs riding on the event,
 * and every open bag a URL could reach.
 */
export function sanitizeSentryEvent(event: SentryErrorEvent): SentryErrorEvent | null {
  try {
    if (!event || typeof event !== "object") return null;

    // The whole request bag, not just `url`: `headers.Referer` is the second copy,
    // and a future field is covered without an edit here.
    if (event.request) {
      event.request = sanitizeAnalyticsProperties(
        event.request as unknown as Record<string, unknown>,
      ) as SentryErrorEvent["request"];
    }

    if (Array.isArray(event.breadcrumbs)) {
      // Defense in depth. `beforeBreadcrumb` already cleaned everything the
      // integrations recorded, but breadcrumbs can also arrive attached straight to
      // a `captureEvent` payload, which never passes through that hook.
      event.breadcrumbs = event.breadcrumbs
        .map((crumb) => sanitizeSentryBreadcrumb(crumb))
        .filter((crumb): crumb is Breadcrumb => crumb !== null);
    }

    if (typeof event.transaction === "string") {
      event.transaction = sanitizeString("transaction", event.transaction);
    }
    if (typeof event.message === "string") {
      event.message = sanitizeString("message", event.message);
    }
    for (const exception of event.exception?.values ?? []) {
      if (typeof exception.value === "string") {
        exception.value = sanitizeString("value", exception.value);
      }
    }

    if (event.extra) {
      event.extra = sanitizeAnalyticsProperties(event.extra as Record<string, unknown>);
    }
    if (event.contexts) {
      event.contexts = sanitizeAnalyticsProperties(
        event.contexts as Record<string, unknown>,
      ) as SentryErrorEvent["contexts"];
    }
    if (event.tags) {
      event.tags = sanitizeAnalyticsProperties(event.tags as Record<string, unknown>) as SentryErrorEvent["tags"];
    }

    return event;
  } catch {
    return null;
  }
}
