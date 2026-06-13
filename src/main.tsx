import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
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

// Friendly fallback for any uncaught render error (white-screen guard). Sentry.ErrorBoundary
// renders this regardless of DSN, and reports the error once VITE_SENTRY_DSN is set.
function ErrorFallback() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "#0f0e0c", color: "#f0ede8", fontFamily: "'Plus Jakarta Sans', sans-serif", textAlign: "center", padding: "2rem" }}>
      <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "1.4rem" }}>Something broke on our end.</p>
      <p style={{ fontSize: ".8rem", color: "#8a8780", maxWidth: 420, lineHeight: 1.6 }}>
        This page hit an error. Reloading usually fixes it. If it keeps happening, that's on us.
      </p>
      <a href="/" style={{ marginTop: 6, fontSize: ".72rem", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#0f0e0c", background: "#8a9a8a", padding: ".7rem 1.2rem", borderRadius: 8, textDecoration: "none" }}>
        Back to start
      </a>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
    <App />
  </Sentry.ErrorBoundary>,
);
