import { useState } from "react";
import { lovable } from "@/integrations/lovable/index";

export default function LandingPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError("");
    const { error } = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (error) {
      setError(error.message || "Login failed");
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f0e0c",
      color: "#f0ede8",
      fontFamily: "'Plus Jakarta Sans', sans-serif",
    }}>
      {/* NAV */}
      <nav style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "1.2rem 2rem",
        maxWidth: 1100,
        margin: "0 auto",
      }}>
        <span style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 500,
          fontSize: "1.1rem",
          letterSpacing: "-.02em",
        }}>
          auditjob.me
        </span>
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          style={{
            padding: "0.55rem 1.4rem",
            borderRadius: 6,
            border: "1px solid #2a2825",
            background: "transparent",
            color: "#f0ede8",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 600,
            fontSize: ".7rem",
            letterSpacing: ".06em",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.5 : 1,
            transition: "all .2s",
          }}
        >
          {loading ? "..." : "Sign in"}
        </button>
      </nav>

      {/* HERO */}
      <main style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "6rem 2rem 4rem",
        textAlign: "center",
      }}>
        <h1 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 400,
          fontSize: "clamp(2.2rem, 6vw, 4rem)",
          lineHeight: 1.08,
          letterSpacing: "-.04em",
          marginBottom: "1.5rem",
        }}>
          Land interviews with<br />
          <span style={{ color: "#c8c4bc" }}>AI-powered job audits</span>
        </h1>

        <p style={{
          fontSize: "clamp(.85rem, 2vw, 1.05rem)",
          color: "#8a8780",
          lineHeight: 1.7,
          maxWidth: 520,
          margin: "0 auto 2.5rem",
        }}>
          Paste a job link and your CV — get a full audit with company research,
          tailored proposals, and interactive prototypes that show employers
          you've already done the work.
        </p>

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          style={{
            padding: "0.9rem 2.4rem",
            borderRadius: 8,
            border: "none",
            background: "#f0ede8",
            color: "#0f0e0c",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 600,
            fontSize: ".78rem",
            letterSpacing: ".06em",
            cursor: loading ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.6rem",
            opacity: loading ? 0.5 : 1,
            transition: "all .2s",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {loading ? "One moment..." : "Get started with Google"}
        </button>

        <p style={{
          fontSize: ".72rem",
          color: "#6a6760",
          marginTop: "1rem",
          lineHeight: 1.6,
        }}>
          We use your Google account only to sign you in and save your audits.
          No emails are sent on your behalf. See our{" "}
          <a href="/privacy" style={{ color: "#8a8780", textDecoration: "underline", textUnderlineOffset: "2px" }}>Privacy Policy</a>.
        </p>

        {error && (
          <p style={{ color: "#e74c3c", fontSize: ".7rem", marginTop: "1rem" }}>{error}</p>
        )}
      </main>

      {/* HOW IT WORKS */}
      <section style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "2rem 2rem 5rem",
      }}>
        <h2 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 400,
          fontSize: "1.3rem",
          letterSpacing: "-.02em",
          textAlign: "center",
          marginBottom: "3rem",
          color: "#8a8780",
        }}>
          How it works
        </h2>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "2rem",
        }}>
          {[
            { step: "01", title: "Paste a job link", desc: "Drop any job posting URL and upload your CV to get started." },
            { step: "02", title: "AI builds the audit", desc: "We research the company, analyze fit, and generate tailored proposals." },
            { step: "03", title: "Share & impress", desc: "Get a shareable link with your audit — prototypes, insights, and all." },
          ].map((item) => (
            <div key={item.step} style={{
              padding: "1.5rem",
              borderRadius: 10,
              border: "1px solid #1a1916",
              background: "#141310",
            }}>
              <span style={{
                fontSize: ".65rem",
                color: "#5a5750",
                fontWeight: 600,
                letterSpacing: ".1em",
              }}>{item.step}</span>
              <h3 style={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 500,
                fontSize: "1rem",
                margin: ".6rem 0 .5rem",
                letterSpacing: "-.01em",
              }}>{item.title}</h3>
              <p style={{
                fontSize: ".78rem",
                color: "#6a6760",
                lineHeight: 1.6,
              }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{
        borderTop: "1px solid #1a1916",
        padding: "1.5rem 2rem",
        textAlign: "center",
        fontSize: ".65rem",
        color: "#5a5750",
      }}>
        <a href="/privacy" style={{ color: "#7a7770", textDecoration: "underline", textUnderlineOffset: "2px", marginRight: "1rem" }}>Privacy Policy</a>
        <a href="/terms" style={{ color: "#7a7770", textDecoration: "underline", textUnderlineOffset: "2px" }}>Terms of Service</a>
        <p style={{ marginTop: ".8rem" }}>© {new Date().getFullYear()} auditjob.me</p>
      </footer>
    </div>
  );
}
