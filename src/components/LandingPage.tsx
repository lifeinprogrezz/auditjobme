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

  const steps = [
    { num: "01", title: "Upload your CV", desc: "Your background becomes the foundation." },
    { num: "02", title: "Paste a job link", desc: "Any role, any company. Researched in real time." },
    { num: "03", title: "Get your audit", desc: "Company research. Diagnosis. Proposals. Contacts. Live URL ready to share." },
  ];

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
        padding: "10rem 2rem 4rem",
        textAlign: "center",
      }}>
        <p style={{
          fontSize: ".52rem",
          fontWeight: 500,
          letterSpacing: ".18em",
          textTransform: "uppercase" as const,
          color: "#5a5750",
          marginBottom: "1.8rem",
        }}>
          Stop applying. Start auditing.
        </p>

        <h1 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 400,
          fontSize: "clamp(2.6rem, 7vw, 4.8rem)",
          lineHeight: 1.05,
          letterSpacing: "-.05em",
          marginBottom: "2.4rem",
          maxWidth: 700,
        }}>
          Land the job before the interview
        </h1>

        <p style={{
          fontSize: ".88rem",
          color: "#7a7770",
          lineHeight: 1.7,
          maxWidth: 480,
          margin: "0 auto 3.2rem",
        }}>
          Paste a job link. Upload your CV. Get a full company audit
          with research, proposals, and decision-maker contacts in 2 minutes.
        </p>

        <button
          onClick={scrollToSignIn}
          style={{
            padding: "0.9rem 2.6rem",
            borderRadius: 6,
            border: "none",
            background: ACCENT,
            color: "#0f0e0c",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 600,
            fontSize: ".78rem",
            letterSpacing: ".04em",
            cursor: "pointer",
            transition: "opacity .2s",
          }}
        >
          Start free
        </button>
      </section>

      {/* HOW IT WORKS */}
      <section style={{
        padding: "8rem 2.4rem 6rem",
        maxWidth: 960,
        margin: "0 auto",
        width: "100%",
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "0",
          position: "relative",
        }}>
          {steps.map((step, i) => (
            <div key={step.num} style={{
              padding: "0 2rem",
              borderLeft: i > 0 ? "1px solid #1e1d1a" : "none",
            }}>
              <span style={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 700,
                fontSize: "1.4rem",
                color: ACCENT,
                letterSpacing: "-.02em",
                display: "block",
                marginBottom: ".8rem",
              }}>
                {step.num}
              </span>
              <p style={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 500,
                fontSize: ".92rem",
                color: "#f0ede8",
                marginBottom: ".4rem",
                letterSpacing: "-.01em",
              }}>
                {step.title}
              </p>
              <p style={{
                fontSize: ".74rem",
                color: "#5a5750",
                lineHeight: 1.65,
              }}>
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* AUDIT PREVIEW */}
      <section style={{
        padding: "6rem 2.4rem 4rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}>
        <p style={{
          fontSize: ".52rem",
          fontWeight: 500,
          letterSpacing: ".18em",
          textTransform: "uppercase" as const,
          color: "#5a5750",
          marginBottom: "2.5rem",
        }}>
          What you get
        </p>
        <div style={{
          maxWidth: 960,
          width: "100%",
          position: "relative",
          borderRadius: 10,
          overflow: "hidden",
        }}>
          <img
            src={auditPreview}
            alt="Example audit output showing company research, competitive analysis, and field signals"
            style={{
              width: "100%",
              display: "block",
              opacity: 0.85,
            }}
          />
          <div style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "50%",
            background: "linear-gradient(to bottom, transparent, #0f0e0c)",
          }} />
          <p style={{
            position: "absolute",
            bottom: "2rem",
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: ".78rem",
            color: "#9a9790",
            lineHeight: 1.6,
            zIndex: 1,
          }}>
            Real audit. Real research. Ready in 2 minutes.
          </p>
        </div>
      </section>

      {/* SIGN IN SECTION */}
      <section
        ref={signInRef}
        style={{
          padding: "8rem 2rem 6rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <h2 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 400,
          fontSize: "clamp(1rem, 2.5vw, 1.3rem)",
          letterSpacing: "-.02em",
          marginBottom: ".6rem",
          color: "#f0ede8",
        }}>
          Try it free. No card required.
        </h2>
        <p style={{
          fontSize: ".78rem",
          color: "#5a5750",
          marginBottom: "2.4rem",
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
        fontSize: ".65rem",
        color: "#7a7770",
      }}>
        <span>© {new Date().getFullYear()} auditjob.me</span>
        <div style={{ display: "flex", gap: "1.2rem" }}>
          <a href="/privacy" style={{ color: "#7a7770", textDecoration: "none" }}>Privacy</a>
          <a href="/terms" style={{ color: "#7a7770", textDecoration: "none" }}>Terms</a>
        </div>
      </footer>

      <noscript>
        <div style={{ padding: "2rem", color: "#f0ede8", background: "#0f0e0c" }}>
          <h1>auditjob.me</h1>
          <p>Paste a job link and your CV to generate a full company audit with research, proposals, and prototypes.</p>
          <p><a href="/privacy">Privacy Policy</a> | <a href="/terms">Terms of Service</a></p>
        </div>
      </noscript>

      {/* Mobile responsive overrides */}
      <style>{`
        @media (max-width: 680px) {
          section > div[style*="grid-template-columns: repeat(3"] {
            grid-template-columns: 1fr !important;
          }
          section > div[style*="grid-template-columns: repeat(3"] > div {
            border-left: none !important;
            border-bottom: 1px solid #1e1d1a;
            padding: 1.5rem 0 !important;
          }
          section > div[style*="grid-template-columns: repeat(3"] > div:last-child {
            border-bottom: none;
          }
        }
      `}</style>
    </div>
  );
}
