import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import ErrorFallback from "./components/ErrorFallback.tsx";
import { sanitizeAnalyticsProperties } from "./lib/analytics-sanitize";
import { sanitizeSentryBreadcrumb, sanitizeSentryEvent } from "./lib/sentry-sanitize";
// Brand fonts load globally (token layer: tailwind font-display/sans/mono +
// roles.css --font-d/s/m) so toasts, dialogs, and standalone pages never fall
// back to the browser default — previously only the /roles chunk imported them.
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/geist-mono/700.css";
import "./index.css";
// FitChip — the one score-presentation block, shared by the page world and the
// map scope (design direction §3.1). Loaded globally so both consume one copy.
import "./styles/fitchip.css";

// Production error visibility from day one (v1 spec §3). Errors only — no performance
// tracing or session replay (product analytics is deferred). No-op unless VITE_SENTRY_DSN
// is set, so it ships safely before the Sentry project exists.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 0,
    environment: import.meta.env.MODE,
    // Same leak as the PostHog hook below, second vendor. Supabase's implicit OAuth
    // flow leaves the session in the URL fragment, and two default Sentry
    // integrations record that URL: HttpContext writes it to event.request.url, and
    // Breadcrumbs stores navigation from/to as path + query + FRAGMENT. So any error
    // captured around sign-in shipped the access token, Google provider token and
    // refresh token. Scrubbed before send, sharing one sanitizer with analytics.
    // See lib/sentry-sanitize.
    beforeSend: sanitizeSentryEvent,
    beforeBreadcrumb: sanitizeSentryBreadcrumb,
  });
}

// Cookieless analytics (Track D S4, Rober 7-11): PostHog EU (Frankfurt) with
// persistence:"memory" — no cookies, no cross-visit identifier, so no consent
// banner is required; the full consent-gated setup (CMP) is a launch-time task.
// No-op unless VITE_POSTHOG_KEY is set (same pattern as Sentry above). Loaded
// lazily so the analytics bundle never delays the map.
const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
if (posthogKey) {
  import("posthog-js").then(({ default: posthog }) => {
    posthog.init(posthogKey, {
      api_host: "https://eu.i.posthog.com",
      persistence: "memory",
      capture_pageview: "history_change",
      autocapture: false,
      disable_session_recording: true,
      // Nothing credential-bearing may leave the browser. Supabase's implicit OAuth
      // flow returns the session in the URL fragment, and `capture_pageview` records
      // the full URL — so unsanitized, every sign-in shipped the user's access token,
      // Google provider token and refresh token to PostHog. Sanitized before send,
      // in code, rather than filtered on the vendor side. See lib/analytics-sanitize.
      sanitize_properties: sanitizeAnalyticsProperties,
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
    <App />
  </Sentry.ErrorBoundary>,
);
