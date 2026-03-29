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
    desc: "Every number sourced. Every competitor mapped.",
    img: auditResearch,
    alt: "Research stats grid showing company metrics and market data",
  },
  {
    num: "02",
    label: "DIAGNOSIS",
    desc: "What's broken. Why it matters. Why nobody fixed it.",
    img: auditHero,
    alt: "Audit diagnosis showing key findings and impact analysis",
  },
  {
    num: "03",
    label: "PROPOSALS",
    desc: "Three moves. Problem, solution, execution.",
    img: auditProposals,
    alt: "Phased proposal cards with strategic recommendations",
  },
  {
    num: "04",
    label: "ABOUT",
    desc: "Why you. Not just what you did, but why it matters here.",
    img: auditAbout,
    alt: "About section showing candidate fit and qualifications",
  },
];

export default function LandingPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
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
    }}>
      {/* LIGHTBOX */}
      {lightboxImg && (
        <div
          onClick={() => setLightboxImg(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
            padding: "2rem",
            animation: "lightbox-in .2s ease",
          }}
        >
          <img
            src={lightboxImg}
            alt="Full screenshot"
            style={{
              maxWidth: "90vw",
              maxHeight: "90vh",
              borderRadius: 8,
              boxShadow: "0 0 60px rgba(0,0,0,0.5)",
              objectFit: "contain",
            }}
          />
        </div>
      )}
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
          marginBottom: "12px",
          maxWidth: 780,
          color: "#f0ede8",
        }}>
          The application nobody ignores
        </h1>

        <p style={{
          fontSize: "16px",
          fontFamily: "'DM Sans', sans-serif",
          color: "rgba(255,255,255,0.45)",
          lineHeight: 1.7,
          maxWidth: 500,
          margin: "0 auto 1.4rem",
          fontWeight: 300,
        }}>
          Full company audit in 2 minutes.{" "}
          <span style={{ fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>
            Research. Proposals. Contacts.
          </span>
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

      {/* PROCESS STRIP */}
      <div className="process-strip" style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.4rem",
        padding: "48px 2rem 32px",
        fontFamily: "'DM Sans', sans-serif",
      }}>
        {[
          { num: "1", text: "Upload your CV" },
          { num: "2", text: "Paste the job link" },
          { num: "3", text: "Get your audit" },
          { num: "4", text: "Share it" },
        ].map((step, i, arr) => (
          <div key={step.num} style={{ display: "flex", alignItems: "center", gap: "1.4rem" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: ACCENT }}>{step.num}</span>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "rgba(255,255,255,0.45)" }}>{step.text}</span>
            </div>
            {i < arr.length - 1 && (
              <span className="process-dot" style={{ fontSize: "14px", color: "rgba(255,255,255,0.2)" }}>·</span>
            )}
          </div>
        ))}
      </div>

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
              marginBottom: "8px",
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
            </div>
            <p style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px",
              color: "rgba(255,255,255,0.5)",
              fontWeight: 500,
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
              <div
                className="showcase-img-wrapper"
                onClick={() => setLightboxImg(item.img)}
                style={{
                  position: "relative",
                  borderRadius: 12,
                  overflow: "hidden",
                  transform: "rotateX(2deg)",
                  boxShadow: "0 30px 80px -20px rgba(138,154,138,0.08), 0 0 0 1px rgba(255,255,255,0.03)",
                  transition: "transform .3s ease, filter .3s ease",
                  cursor: "zoom-in",
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
        {/* Example link */}
        <div style={{
          textAlign: "center",
          padding: "40px 0 4px",
        }}>
          <a
            href="https://auditjob.me/a/roberto-quintero/vercel-20"
            target="_blank"
            rel="noopener noreferrer"
            className="example-audit-link"
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "14px",
              fontWeight: 500,
              letterSpacing: ".08em",
              color: "rgba(255,255,255,0.45)",
              textDecoration: "underline",
              textUnderlineOffset: "4px",
              transition: "color .3s ease",
              display: "inline-block",
            }}
          >
            See a full audit example
          </a>
        </div>
      </section>

      {/* SIGN IN — compact */}
      <section
        ref={signInRef}
        style={{
          padding: "2rem 2rem 3rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <h2 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 700,
          fontSize: "clamp(1.3rem, 3vw, 1.8rem)",
          letterSpacing: "-.02em",
          marginBottom: "14px",
          color: "#f0ede8",
        }}>
          2 free audits. No catch.
        </h2>

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
          marginTop: "24px",
          lineHeight: 1.6,
        }}>
          We only use your Google account to sign you in. No email access, no data sharing.{" "}
          <a href="/privacy" style={{ color: "#6a6760", textDecoration: "underline", textUnderlineOffset: "2px" }}>Privacy Policy</a>
        </p>
      </section>

      {/* FOOTER */}
      <footer style={{
        padding: "1.4rem 2.4rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: "11px",
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
        .example-audit-link:hover {
          color: rgba(255,255,255,0.7) !important;
        }
        .cta-button:hover {
          filter: brightness(0.9);
          box-shadow: 0 0 16px rgba(138,154,138,0.12);
        }
        @media (max-width: 600px) {
          .process-strip {
            flex-direction: column !important;
            gap: 8px !important;
          }
          .process-dot {
            display: none;
          }
        }
        @media (max-width: 680px) {
          .showcase-panel {
            margin-bottom: 3rem !important;
          }
        }
        @keyframes lightbox-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
    </div>
  );
}
