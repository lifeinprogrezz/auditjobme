import { useState, useRef } from "react";
import { lovable } from "@/integrations/lovable/index";
import auditPreview from "@/assets/audit-preview.png";

const ACCENT = "#8a9a8a";

export default function LandingPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const signInRef = useRef<HTMLDivElement>(null);

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

  const scrollToSignIn = () => {
    signInRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f0e0c",
      color: "#f0ede8",
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* NAV */}
      <nav style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "1.4rem 2.4rem",
      }}>
        <span style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 500,
          fontSize: ".65rem",
          letterSpacing: ".1em",
          textTransform: "uppercase" as const,
          color: "#f0ede8",
        }}>
          auditjob.me
        </span>
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          style={{
            padding: "0.45rem 1.1rem",
            borderRadius: 6,
            border: "1px solid #2a2825",
            background: "transparent",
            color: "#8a8780",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 500,
            fontSize: ".68rem",
            letterSpacing: ".04em",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.5 : 1,
            transition: "opacity .2s",
          }}
        >
          {loading ? "..." : "Sign in"}
        </button>
      </nav>

      {/* HERO */}
      <section style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "6rem 2rem 5rem",
        textAlign: "center",
      }}>
        <p style={{
          fontSize: ".58rem",
          fontWeight: 600,
          letterSpacing: ".14em",
          textTransform: "uppercase" as const,
          color: "#8a8780",
          marginBottom: ".8rem",
        }}>
          Stop applying. Start auditing.
        </p>

        <h1 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 400,
          fontSize: "clamp(1.8rem, 5vw, 3.2rem)",
          lineHeight: 1.1,
          letterSpacing: "-.045em",
          marginBottom: "1.4rem",
          maxWidth: 560,
        }}>
          Land the job before the interview
        </h1>

        <p style={{
          fontSize: ".82rem",
          color: "#8a8780",
          lineHeight: 1.65,
          maxWidth: 460,
          margin: "0 auto 2.4rem",
        }}>
          Paste a job link. Upload your CV. Get a full company audit
          with research, proposals, and decision-maker contacts in 2 minutes.
        </p>

        <button
          onClick={scrollToSignIn}
          style={{
            padding: "0.75rem 2rem",
            borderRadius: 6,
            border: "none",
            background: ACCENT,
            color: "#0f0e0c",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 600,
            fontSize: ".72rem",
            letterSpacing: ".05em",
            cursor: "pointer",
            transition: "opacity .2s",
          }}
        >
          Start free
        </button>
      </section>

      {/* HOW IT WORKS */}
      <section style={{
        padding: "4rem 2.4rem",
        maxWidth: 900,
        margin: "0 auto",
        width: "100%",
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "2.5rem",
        }}>
          {[
            { num: "01", title: "Upload your CV", desc: "Your background becomes the foundation." },
            { num: "02", title: "Paste a job link", desc: "Any role, any company. Researched in real time." },
            { num: "03", title: "Get your audit", desc: "Company research. Diagnosis. Proposals. Contacts. Live URL ready to share." },
          ].map((step) => (
            <div key={step.num}>
              <span style={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 700,
                fontSize: ".72rem",
                color: ACCENT,
                letterSpacing: ".04em",
                display: "block",
                marginBottom: ".5rem",
              }}>
                {step.num}
              </span>
              <p style={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 500,
                fontSize: ".88rem",
                color: "#f0ede8",
                marginBottom: ".3rem",
              }}>
                {step.title}
              </p>
              <p style={{
                fontSize: ".75rem",
                color: "#6a6760",
                lineHeight: 1.6,
              }}>
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* AUDIT PREVIEW PLACEHOLDER */}
      <section style={{
        padding: "4rem 2.4rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}>
        <p style={{
          fontSize: ".58rem",
          fontWeight: 600,
          letterSpacing: ".14em",
          textTransform: "uppercase" as const,
          color: "#8a8780",
          marginBottom: "1.5rem",
        }}>
          What you get
        </p>
        <div style={{
          maxWidth: 700,
          width: "100%",
          minHeight: 200,
        }} />
      </section>

      {/* SIGN IN SECTION */}
      <section
        ref={signInRef}
        style={{
          padding: "4rem 2rem 5rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <h2 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 400,
          fontSize: "clamp(1.2rem, 3vw, 1.8rem)",
          letterSpacing: "-.03em",
          marginBottom: ".6rem",
          color: "#f0ede8",
        }}>
          Try it free. No card required.
        </h2>
        <p style={{
          fontSize: ".78rem",
          color: "#8a8780",
          marginBottom: "2rem",
        }}>
          2 free audits to see the difference.
        </p>

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          style={{
            padding: "0.85rem 2rem",
            borderRadius: 8,
            border: "none",
            background: "#f0ede8",
            color: "#0f0e0c",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 600,
            fontSize: ".72rem",
            letterSpacing: ".05em",
            cursor: loading ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.55rem",
            opacity: loading ? 0.5 : 1,
            transition: "opacity .2s",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {loading ? "One moment..." : "Continue with Google"}
        </button>

        {error && (
          <p style={{ color: "#c0392b", fontSize: ".68rem", marginTop: ".8rem" }}>{error}</p>
        )}

        <p style={{
          fontSize: ".62rem",
          color: "#4a4740",
          marginTop: "1.2rem",
          lineHeight: 1.6,
        }}>
          We only use your Google account to sign you in.{" "}
          <a href="/privacy" style={{ color: "#6a6760", textDecoration: "underline", textUnderlineOffset: "2px" }}>Privacy Policy</a>
        </p>
      </section>

      {/* FOOTER */}
      <footer style={{
        padding: "1.4rem 2.4rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: ".62rem",
        color: "#6a6760",
      }}>
        <span>© {new Date().getFullYear()} auditjob.me</span>
        <div style={{ display: "flex", gap: "1.2rem" }}>
          <a href="/privacy" style={{ color: "#6a6760", textDecoration: "none" }}>Privacy</a>
          <a href="/terms" style={{ color: "#6a6760", textDecoration: "none" }}>Terms</a>
        </div>
      </footer>

      <noscript>
        <div style={{ padding: "2rem", color: "#f0ede8", background: "#0f0e0c" }}>
          <h1>auditjob.me</h1>
          <p>Paste a job link and your CV to generate a full company audit with research, proposals, and prototypes.</p>
          <p><a href="/privacy">Privacy Policy</a> | <a href="/terms">Terms of Service</a></p>
        </div>
      </noscript>
    </div>
  );
}
