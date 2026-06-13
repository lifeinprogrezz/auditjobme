import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import ErrorFallback from "./components/ErrorFallback.tsx";
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
