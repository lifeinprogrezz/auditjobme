import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import ErrorFallback from "./components/ErrorFallback.tsx";
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

// Production error visibility from day one (v1 spec §3). Errors only — no performance
// tracing or session replay (product analytics is deferred). No-op unless VITE_SENTRY_DSN
// is set, so it ships safely before the Sentry project exists.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 0,
    environment: import.meta.env.MODE,
  });
}

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
    <App />
  </Sentry.ErrorBoundary>,
);
