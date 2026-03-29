import { useState, useRef, useEffect } from "react";
import { lovable } from "@/integrations/lovable/index";
import auditOpening from "@/assets/audit-opening.png";
import auditResearch from "@/assets/audit-research.png";
import auditHero from "@/assets/audit-hero.png";
import auditProposals from "@/assets/audit-proposals.png";
import auditAbout from "@/assets/audit-about.png";

const ACCENT = "#8a9a8a";

const showcaseItems = [
  {
    num: "01",
    label: "RESEARCH",
    desc: "Real company data. Sourced and verified.",
    img: auditResearch,
    alt: "Research stats grid showing company metrics and market data",
  },
  {
    num: "02",
    label: "DIAGNOSIS",
    desc: "Problems identified. Impact quantified.",
    img: auditHero,
    alt: "Audit diagnosis showing key findings and impact analysis",
  },
  {
    num: "03",
    label: "PROPOSALS",
    desc: "Strategic solutions. Phased and actionable.",
    img: auditProposals,
    alt: "Phased proposal cards with strategic recommendations",
  },
  {
    num: "04",
    label: "ABOUT",
    desc: "Your fit. Backed by proof.",
    img: auditAbout,
    alt: "About section showing candidate fit and qualifications",
  },
];

export default function LandingPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const signInRef = useRef<HTMLDivElement>(null);
  const showcaseRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("showcase-visible");
          }
        });
      },
      { threshold: 0.15 }
    );
    showcaseRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });
    return () => observer.disconnect();
  }, []);

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
        position: "relative",
        zIndex: 10,
      }}>
        <span style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 500,
          fontSize: ".65rem",
          letterSpacing: ".1em",
          textTransform: "uppercase",
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
            border: "1px solid #5a5750",
            background: "transparent",
            color: "#f0ede8",
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
        minHeight: "calc(100vh - 60px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 2rem 6rem",
        textAlign: "center",
      }}>
        <p style={{
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: ".2em",
          textTransform: "uppercase",
          color: "#6a6760",
          marginBottom: "1rem",
        }}>
          Stop sending CVs. Start auditing.
        </p>

        <h1 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 800,
          fontSize: "clamp(2.8rem, 8vw, 5.2rem)",
          lineHeight: 1.0,
          letterSpacing: "-.045em",
          marginBottom: "2rem",
          maxWidth: 780,
          color: "#f0ede8",
        }}>
          The application nobody ignores
        </h1>

        <p style={{
          fontSize: ".92rem",
          color: "#6a6760",
          lineHeight: 1.7,
          maxWidth: 500,
          margin: "0 auto 2.2rem",
          fontWeight: 400,
        }}>
          Full company audit in 2 minutes. Research. Proposals. Contacts.
        </p>

        <button
          onClick={scrollToSignIn}
          className="cta-button"
          style={{
            padding: "16px 40px",
            borderRadius: 6,
            border: "none",
            background: ACCENT,
            color: "#0f0e0c",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 600,
            fontSize: ".78rem",
            letterSpacing: ".04em",
            cursor: "pointer",
            transition: "filter .2s, box-shadow .2s",
          }}
        >
          Get your audit
        </button>
      </section>

      {/* PRODUCT SHOWCASE — 5 screenshots */}
      <section style={{
        padding: "2rem 1.5rem 4rem",
        maxWidth: 1060,
        margin: "0 auto",
        width: "100%",
      }}>
        {showcaseItems.map((item, i) => (
          <div
            key={item.num}
            ref={(el) => { showcaseRefs.current[i] = el; }}
            className="showcase-panel"
            style={{
              marginBottom: i < showcaseItems.length - 1 ? "5rem" : "0",
            }}
          >
            {/* Label with horizontal line */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "1.2rem",
              marginBottom: "1.6rem",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: ".6rem", flexShrink: 0 }}>
                <span style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 700,
                  fontSize: "24px",
                  color: ACCENT,
                  letterSpacing: "-.02em",
                }}>
                  {item.num}
                </span>
                <span style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 700,
                  fontSize: ".7rem",
                  letterSpacing: ".18em",
                  textTransform: "uppercase",
                  color: "#f0ede8",
                }}>
                  {item.label}
                </span>
              </div>
              <div style={{
                flex: 1,
                height: "1px",
                background: "#2a2825",
              }} />
            </div>
            <p style={{
              fontSize: ".82rem",
              color: "#5a5750",
              fontWeight: 400,
              lineHeight: 1.6,
              marginBottom: "1.4rem",
            }}>
              {item.desc}
            </p>

            {/* Screenshot */}
            <div style={{
              perspective: "1200px",
              maxWidth: 960,
            }}>
              <div className="showcase-img-wrapper" style={{
                position: "relative",
                borderRadius: 12,
                overflow: "hidden",
                transform: "rotateX(2deg)",
                boxShadow: "0 30px 80px -20px rgba(138,154,138,0.08), 0 0 0 1px rgba(255,255,255,0.03)",
                transition: "transform .3s ease, filter .3s ease",
              }}>
                <img
                  src={item.img}
                  alt={item.alt}
                  style={{
                    width: "100%",
                    display: "block",
                  }}
                />
                {/* Edge fades */}
                <div style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: "35%",
                  background: "linear-gradient(to bottom, transparent, #0f0e0c)",
                  pointerEvents: "none",
                }} />
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: "8%",
                  background: "linear-gradient(to right, #0f0e0c, transparent)",
                  pointerEvents: "none",
                }} />
                <div style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: "8%",
                  background: "linear-gradient(to left, #0f0e0c, transparent)",
                  pointerEvents: "none",
                }} />
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* SIGN IN — compact */}
      <section
        ref={signInRef}
        style={{
          padding: "4rem 2rem 3rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        {/* Process line */}
        <p style={{ fontSize: "13px", color: "#5a5750", marginBottom: "16px" }}>
          Upload your CV <span style={{ color: ACCENT }}>→</span> Paste a job link <span style={{ color: ACCENT }}>→</span> Get your audit
        </p>

        <h2 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 400,
          fontSize: "24px",
          letterSpacing: "-.02em",
          marginBottom: "8px",
          color: "#f0ede8",
        }}>
          Try it free. No card required.
        </h2>
        <p style={{
          fontSize: ".78rem",
          color: "#5a5750",
          marginBottom: "24px",
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
          marginTop: "12px",
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
        fontSize: "13px",
        color: "#9a9790",
      }}>
        <span>© {new Date().getFullYear()} auditjob.me</span>
        <div style={{ display: "flex", gap: "1.2rem" }}>
          <a href="/privacy" style={{ color: "#9a9790", textDecoration: "none" }}>Privacy</a>
          <a href="/terms" style={{ color: "#9a9790", textDecoration: "none" }}>Terms</a>
        </div>
      </footer>

      <noscript>
        <div style={{ padding: "2rem", color: "#f0ede8", background: "#0f0e0c" }}>
          <h1>auditjob.me</h1>
          <p>Paste a job link and your CV to generate a full company audit with research, proposals, and prototypes.</p>
          <p><a href="/privacy">Privacy Policy</a> | <a href="/terms">Terms of Service</a></p>
        </div>
      </noscript>

      <style>{`
        .showcase-panel {
          opacity: 0;
          transform: translateY(40px) scale(0.95);
          transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1),
                      transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .showcase-visible {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        .showcase-img-wrapper:hover {
          transform: rotateX(2deg) scale(1.02) !important;
          filter: brightness(1.05);
        }
        .cta-button:hover {
          filter: brightness(0.9);
          box-shadow: 0 0 12px rgba(138,154,138,0.08);
        }
        @media (max-width: 680px) {
          .showcase-panel {
            margin-bottom: 3rem !important;
          }
        }
      `}</style>
    </div>
  );
}
