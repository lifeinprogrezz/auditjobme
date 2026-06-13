// Branded fallback shown by the root Sentry.ErrorBoundary (src/main.tsx) on any uncaught
// render error — a white-screen guard. Sentry reports the error once VITE_SENTRY_DSN is set.
export default function ErrorFallback() {
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
