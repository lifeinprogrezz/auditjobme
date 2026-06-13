import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/* ═══════════════════ REUSABLE RENDER HELPERS ═══════════════════ */
function textOn(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#0f0e0c" : "#f0ede8";
}

function safeAccent(hex: string) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return "#8a9a8a";
  let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const brightness = (r*299 + g*587 + b*114) / 1000;
  if (brightness < 80) {
    const factor = 0.55;
    r = Math.round(r + (255 - r) * factor);
    g = Math.round(g + (255 - g) * factor);
    b = Math.round(b + (255 - b) * factor);
    return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
  }
  if (brightness > 220) {
    const factor = 0.4;
    r = Math.round(r * (1 - factor));
    g = Math.round(g * (1 - factor));
    b = Math.round(b * (1 - factor));
    return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
  }
  return hex;
}

function slugifyOwner(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function useInView(ref: any) {
  const [vis, setVis] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVis(true); }, { threshold: 0.06 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref]);
  return vis;
}

function Anim({ children, delay = 0, style = {} }: any) {
  const ref = useRef<HTMLDivElement>(null);
  const vis = useInView(ref);
  return <div ref={ref} className={`anim ${vis ? "vis" : ""}`} style={{ animationDelay: `${delay}s`, ...style }}>{children}</div>;
}

export default function PublicAudit() {
  const { username, slug } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!username || !slug) { setError("Invalid link"); setLoading(false); return; }

      const requestedOwner = slugifyOwner(username);

      const { data: matchingAudits, error: auditsError } = await supabase
        .from("audits")
        .select("user_id, audit_data")
        .eq("slug", slug)
        .eq("is_published", true);

      if (auditsError) {
        console.error("Public audit lookup failed while fetching audits", { slug, auditsError });
        setError("Audit not found or is private");
        setLoading(false);
        return;
      }

      if (!matchingAudits || matchingAudits.length === 0) {
        setError("Audit not found or is private");
        setLoading(false);
        return;
      }

      if (matchingAudits.length === 1) {
        setData(matchingAudits[0].audit_data);
        setLoading(false);
        return;
      }

      const ownerIds = [...new Set(matchingAudits.map((audit: any) => audit.user_id).filter(Boolean))];
      const { data: profiles, error: profilesError } = await supabase
        .from("public_profiles")
        .select("id, username, display_name")
        .in("id", ownerIds);

      if (profilesError) {
        console.error("Public audit lookup failed while fetching profiles", { username, slug, profilesError });
      }

      const matchedProfile = profiles?.find((profile: any) => {
        const ownerSlug = slugifyOwner(profile.username || profile.display_name || "");
        return ownerSlug === requestedOwner;
      });

      const matchedAudit = matchedProfile
        ? matchingAudits.find((audit: any) => audit.user_id === matchedProfile.id)
        : null;

      if (!matchedAudit) {
        console.error("Public audit owner could not be resolved", { username, slug, ownerIds, profiles });
        setError("User not found");
        setLoading(false);
        return;
      }

      setData(matchedAudit.audit_data);
      setLoading(false);
    }
    load();
  }, [username, slug]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f0e0c", color: "#8a8780", fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: ".7rem", letterSpacing: ".1em", textTransform: "uppercase" as const }}>
        Loading audit...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", background: "#0f0e0c", color: "#f0ede8", fontFamily: "'Plus Jakarta Sans', sans-serif", gap: 12 }}>
        <p style={{ fontSize: "1.2rem", fontFamily: "'DM Sans', sans-serif", fontWeight: 800 }}>404</p>
        <p style={{ fontSize: ".75rem", color: "#8a8780" }}>{error || "Audit not found"}</p>
      </div>
    );
  }

  const accent = safeAccent(data.accent) || "#8a9a8a";
  const showProtos = data.showProtos || false;
  const ABOUT_NUM = showProtos ? "05" : "04";

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  const NAV_LINKS = showProtos
    ? ["research", "diagnosis", "proposals", "prototypes", "about"]
    : ["research", "diagnosis", "proposals", "about"];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400;1,9..40,500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        :root{--bg:#0f0e0c;--surface:#1a1916;--text:#f0ede8;--muted:#8a8780;--border:#2a2825;--accent:${accent};--hero-bg:#0f0e0c}
        *{box-sizing:border-box;margin:0;padding:0}
        *::-webkit-scrollbar{display:none}*{scrollbar-width:none}
        body,html{font-family:'Plus Jakarta Sans',sans-serif;background:var(--bg);color:var(--text);scroll-behavior:smooth}
        .hd{font-family:'DM Sans',sans-serif;font-weight:800}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        .anim{opacity:0}.anim.vis{animation:fadeUp .6s ease forwards}

        .nav{position:fixed;top:0;left:0;right:0;height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(1.2rem,4vw,3rem);z-index:100;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);background:rgba(15,14,12,.92)}
        .nav-title{font-family:'DM Sans',sans-serif;font-weight:500;font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text)}
        .nav-links{display:flex;gap:1.5rem}
        .nav-link{font-size:.62rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);text-decoration:none;cursor:pointer;transition:color .2s}
        .nav-link:hover{color:var(--text)}

        .hero{min-height:100vh;display:flex;flex-direction:column;justify-content:flex-end;padding:0 clamp(1.2rem,4vw,3rem) clamp(2rem,4vw,3rem);background:var(--hero-bg);color:#f0ede8;position:relative}
        .hero-label{font-size:.62rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8a8780;margin-bottom:1.2rem;display:flex;align-items:center;gap:.5rem}
        .hero-dot{width:8px;height:8px;background:var(--accent);display:inline-block}
        .hero h1{font-family:'DM Sans',sans-serif;font-weight:800;font-size:clamp(1.9rem,5.5vw,4.2rem);line-height:1.05;letter-spacing:-.03em;margin-bottom:.8rem;color:#f0ede8}
        .hero h1 .accent{color:var(--accent)}
        .hero-sub{font-size:.83rem;color:#8a8780;max-width:540px;line-height:1.7;margin-bottom:2rem}
        .hero-bottom{display:flex;justify-content:space-between;align-items:flex-end}
        .hero-author{text-align:right}
        .hero-author strong{font-size:.83rem;display:block;color:#f0ede8}
        .hero-author span{font-size:.7rem;color:#8a8780}

        .section{position:relative;padding:clamp(3rem,8vw,5rem) clamp(1.2rem,4vw,3rem)}
        .section::before{content:'';position:absolute;top:0;left:clamp(1.2rem,4vw,3rem);right:clamp(1.2rem,4vw,3rem);height:1px;background:var(--border)}
        .sec-label{font-size:.62rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:1.5rem}
        .sec-h2{font-family:'DM Sans',sans-serif;font-weight:800;font-size:clamp(1.6rem,3.5vw,3rem);line-height:1.05;letter-spacing:-.03em;margin-bottom:.4rem}
        .sec-h2 .accent{color:var(--accent)}
        .sec-intro{font-size:.83rem;color:var(--muted);max-width:560px;line-height:1.7;margin-bottom:2rem}

        .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--border);border-radius:8px;overflow:hidden}
        .stat-cell{padding:1.2rem 1.4rem;border-right:1px solid var(--border);border-bottom:1px solid var(--border)}
        .stat-cell:nth-child(4n){border-right:none}.stat-cell:nth-last-child(-n+4){border-bottom:none}
        .stat-val{font-family:'DM Sans',sans-serif;font-weight:800;font-size:clamp(1.2rem,2.5vw,1.8rem);margin-bottom:.25rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .stat-label{font-size:.62rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
        .stat-delta{font-size:.6rem;color:var(--accent);margin-top:.2rem;font-weight:600;text-decoration:none;display:block}
        a.stat-delta{text-decoration:underline dotted;text-underline-offset:3px}

        .quote-block{border-left:3px solid var(--accent);padding:1.2rem 1.5rem;margin-top:2rem;background:var(--surface);border-radius:0 8px 8px 0}
        .quote-label{font-size:.58rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:.6rem}
        .quote-block p{font-size:.83rem;font-style:italic;line-height:1.7;color:var(--text)}
        .quote-src{font-size:.65rem;color:var(--muted);margin-top:.5rem;font-style:normal}
        .quote-src a{color:var(--muted);text-decoration:underline dotted;text-underline-offset:3px}

        .finding-card{border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:1.5rem}
        .finding-header{padding:1.2rem 1.5rem;font-family:'DM Sans',sans-serif;font-weight:700;font-size:.9rem;display:flex;gap:.6rem;align-items:center}
        .finding-num{color:var(--muted);font-weight:600}
        .finding-cols{display:grid;grid-template-columns:repeat(3,1fr)}
        .finding-col{padding:1rem 1.5rem;border-right:1px solid var(--border);border-top:1px solid var(--border)}
        .finding-col:last-child{border-right:none}
        .finding-col-label{font-size:.58rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:.5rem}
        .finding-col-label.evidence{color:var(--text)}.finding-col-label.impact{color:var(--accent)}.finding-col-label.why{color:var(--text)}
        .finding-col p{font-size:.78rem;line-height:1.65;color:var(--muted)}
        .finding-col a{color:var(--muted);text-decoration:underline dotted;text-underline-offset:3px}
        .finding-tag{display:inline-block;padding:.25rem .7rem;font-size:.56rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--border);border-radius:4px;margin:0 1.5rem 1rem;color:var(--muted)}

        .prop-card{margin-bottom:2.5rem}
        .prop-phase{font-size:.62rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:.5rem}
        .prop-title{font-family:'DM Sans',sans-serif;font-weight:800;font-size:1.1rem;margin-bottom:1rem}
        .prop-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--border);border-radius:8px;overflow:hidden}
        .prop-cell{padding:1rem 1.5rem;border-right:1px solid var(--border);border-bottom:1px solid var(--border)}
        .prop-cell:nth-child(2n){border-right:none}.prop-cell:nth-last-child(-n+2){border-bottom:none}
        .prop-cell-label{font-size:.58rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:.4rem}
        .prop-cell-label.problem{color:var(--accent)}.prop-cell-label.solution{color:var(--text)}.prop-cell-label.how{color:var(--accent)}.prop-cell-label.target{color:var(--text)}
        .prop-cell p{font-size:.78rem;line-height:1.65;color:var(--muted)}

        .about-section{position:relative;padding:clamp(3rem,8vw,5rem) clamp(1.2rem,4vw,3rem);text-align:center;background:var(--hero-bg);color:#f0ede8}
        .about-section::before{content:'';position:absolute;top:0;left:clamp(1.2rem,4vw,3rem);right:clamp(1.2rem,4vw,3rem);height:1px;background:#2a2825}
        .about-inner{max-width:700px;margin:0 auto}
        .about-stats{display:grid;grid-template-columns:repeat(3,1fr);max-width:700px;margin:2rem auto;border:1px solid #2a2825;border-radius:8px;overflow:hidden}
        .about-stat{padding:1.5rem;border-right:1px solid #2a2825;text-align:center}
        .about-stat:last-child{border-right:none}
        .about-stat-val{font-family:'DM Sans',sans-serif;font-weight:800;font-size:clamp(1.3rem,3vw,2rem);margin-bottom:.3rem;color:#f0ede8}
        .about-stat-label{font-size:.56rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8a8780}
        .about-cols{display:grid;grid-template-columns:repeat(3,1fr);max-width:700px;margin:2rem auto;gap:2rem;text-align:center}
        .about-col h4{font-family:'DM Sans',sans-serif;font-weight:800;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:.6rem;color:#f0ede8}
        .about-col p{font-size:.75rem;line-height:1.7;color:#8a8780}
        .about-section .sec-label{color:#8a8780}.about-section .sec-h2{color:#f0ede8}

        .footer{padding:2rem clamp(1.2rem,4vw,3rem);text-align:center;font-size:.55rem;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);border-top:1px solid var(--border)}
        .footer a{color:var(--accent);text-decoration:none}

        @media(max-width:900px){
          .stats-grid{grid-template-columns:repeat(2,1fr)}
          .finding-cols{grid-template-columns:1fr}.finding-col{border-right:none;border-bottom:1px solid var(--border)}.finding-col:last-child{border-bottom:none}
          .prop-grid{grid-template-columns:1fr}.prop-cell{border-right:none!important;border-bottom:1px solid var(--border)}.prop-cell:last-child{border-bottom:none}
          .about-cols{grid-template-columns:1fr}
        }
        @media(max-width:600px){
          .nav-links{display:none}
          .hero{min-height:90vh;padding-top:60px}
          .hero h1{font-size:clamp(1.5rem,7.5vw,2.2rem)}
          .about-stats{grid-template-columns:1fr}.about-stat{border-right:none;border-bottom:1px solid #2a2825}.about-stat:last-child{border-bottom:none}
        }
      `}</style>

      {/* NAV */}
      <div className="nav">
        <span className="nav-title" style={{ cursor: "pointer" }} onClick={() => scrollTo("hero")}>
          {data.company?.company || ""} {data.roleCtx?.audit_label || "Product Audit"}
        </span>
        <div className="nav-links">
          {NAV_LINKS.map((s: string) => (
            <span key={s} className="nav-link" onClick={() => scrollTo(s)}>{s}</span>
          ))}
        </div>
      </div>

      {/* HERO */}
      <section className="hero" id="hero">
        <Anim delay={0.2}>
          <div className="hero-label">
            <span className="hero-dot" />
            {(data.roleCtx?.audit_label || "PRODUCT AUDIT").toUpperCase()} — {new Date().toLocaleString("en", { month: "long", year: "numeric" }).toUpperCase()}
          </div>
        </Anim>
        <Anim delay={0.4}>
          <h1>{(() => {
            const h = data.diagnosis?.headline || `Product Audit: ${data.company?.company}`;
            const lines = h.split('\n').filter(Boolean);
            if (lines.length >= 2) return <>{lines[0]}<br/><span className="accent">{lines.slice(1).join(' ')}</span></>;
            return h;
          })()}</h1>
        </Anim>
        <Anim delay={0.5}><p className="hero-sub">{data.diagnosis?.sub || data.company?.company_desc}</p></Anim>
        <Anim delay={0.7}>
          <div className="hero-bottom">
            <span style={{ fontSize: ".58rem", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#8a8780" }}>SCROLL ↓</span>
            <div className="hero-author">
              <strong>{data.cv?.name || "Author"}</strong>
              <span>{data.roleCtx?.role_type || data.company?.role || ""}</span>
            </div>
          </div>
        </Anim>
      </section>

      {/* RESEARCH */}
      <section className="section" id="research">
        <Anim><div className="sec-label">01 — RESEARCH</div></Anim>
        <Anim delay={0.1}>
          <div className="sec-h2">The numbers.</div>
          {data.company?.competitors?.length > 0 && (
            <div className="sec-h2"><span className="accent">vs. {data.company.competitors.join(", ")}.</span></div>
          )}
        </Anim>
        <Anim delay={0.2}>
          <div className="stats-grid">
            {(data.company?.stats || []).slice(0, 8).map((s: any, i: number) => (
              <div className="stat-cell" key={i}>
                <div className="stat-val hd">{s.value}</div>
                <div className="stat-label">{s.label}</div>
                {s.delta && (s.source_url
                  ? <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="stat-delta">{s.delta}</a>
                  : <div className="stat-delta">{s.delta}</div>
                )}
              </div>
            ))}
          </div>
        </Anim>
        {data.pains?.key_quote && (
          <Anim delay={0.3}>
            <div className="quote-block">
              <div className="quote-label">FIELD SIGNAL</div>
              <p>{(data.pains.key_quote || "").replace(/<cite[^>]*>/g, '').replace(/<\/cite>/g, '')}</p>
              {data.pains.quote_source && (
                <div className="quote-src">
                  Source: {data.pains.quote_url
                    ? <a href={data.pains.quote_url} target="_blank" rel="noopener noreferrer">{data.pains.quote_source}</a>
                    : data.pains.quote_source}
                </div>
              )}
            </div>
          </Anim>
        )}
      </section>

      {/* DIAGNOSIS */}
      <section className="section" id="diagnosis">
        <Anim><div className="sec-label">02 — DIAGNOSIS</div></Anim>
        <Anim delay={0.1}>
          <div className="sec-h2">{data.diagnosis?.findings?.length || 3} findings.</div>
          <div className="sec-h2"><span className="accent">And why the team hasn't fixed them.</span></div>
          <p className="sec-intro">These gaps aren't failures — they're the predictable output of a team correctly prioritizing other things.</p>
        </Anim>
        {(data.diagnosis?.findings || []).map((f: any, i: number) => (
          <Anim key={i} delay={0.15 * (i + 1)}>
            <div className="finding-card">
              <div className="finding-header"><span className="finding-num">{f.number || `0${i + 1}`}</span>{f.title}</div>
              <div className="finding-cols">
                <div className="finding-col">
                  <div className="finding-col-label evidence">EVIDENCE</div>
                  <p>{f.evidence}</p>
                  {f.evidence_sources?.length > 0 && (
                    <p style={{ marginTop: 6, fontSize: ".68rem" }}>
                      Sources: {f.evidence_sources.map((s: any, j: number) => (
                        <span key={j}>{j > 0 && " · "}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a></span>
                      ))}
                    </p>
                  )}
                </div>
                <div className="finding-col">
                  <div className="finding-col-label impact">{f.impact_type || "REVENUE IMPACT"}</div>
                  <p>{f.impact}</p>
                </div>
                <div className="finding-col">
                  <div className="finding-col-label why">WHY NOT FIXED</div>
                  <p>{f.why_not_fixed}</p>
                </div>
              </div>
              {f.tag && <div className="finding-tag">{f.tag}</div>}
            </div>
          </Anim>
        ))}
      </section>

      {/* PROPOSALS */}
      <section className="section" id="proposals">
        <Anim><div className="sec-label">03 — PROPOSALS</div></Anim>
        <Anim delay={0.1}>
          <div className="sec-h2">{(() => {
            const h = data.proposals?.headline || `${data.proposals?.proposals?.length || 3} interventions.`;
            const lines = h.split('\n').filter(Boolean);
            if (lines.length >= 2) return <>{lines[0]}<br/><span className="accent">{lines.slice(1).join(' ')}</span></>;
            return h;
          })()}</div>
          {data.proposals?.sub && <p className="sec-intro">{data.proposals.sub}</p>}
        </Anim>
        {(data.proposals?.proposals || []).map((p: any, i: number) => (
          <Anim key={i} delay={0.15 * (i + 1)}>
            <div className="prop-card">
              <div className="prop-phase">PHASE {p.phase || i + 1}</div>
              <div className="prop-title hd">{p.title}</div>
              <div className="prop-grid">
                <div className="prop-cell"><div className="prop-cell-label problem">PROBLEM</div><p>{p.problem}</p></div>
                <div className="prop-cell"><div className="prop-cell-label solution">SOLUTION</div><p>{p.solution}</p></div>
                <div className="prop-cell"><div className="prop-cell-label how">HOW IT WORKS</div><p>{p.how_it_works}</p></div>
                <div className="prop-cell"><div className="prop-cell-label target">TARGET · EFFORT · IMPACT</div><p>{p.target_effort_impact}</p></div>
              </div>
            </div>
          </Anim>
        ))}
      </section>

      {/* ABOUT */}
      <section className="about-section" id="about">
        <Anim><div className="sec-label">{ABOUT_NUM} — ABOUT</div></Anim>
        <Anim delay={0.1}>
          <div className="sec-h2" style={{ textAlign: "center" }}>{data.about?.headline || "Why I'm the right fit"}</div>
          <div className="sec-h2" style={{ textAlign: "center" }}><span className="accent">{data.about?.headline_accent || "for this specific gap."}</span></div>
        </Anim>
        <div className="about-inner">
          <Anim delay={0.2}>
            <div className="about-stats">
              {(data.about?.stats || []).slice(0, 3).map((s: any, i: number) => (
                <div className="about-stat" key={i}>
                  <div className="about-stat-val hd">{s.value}</div>
                  <div className="about-stat-label">{s.label}</div>
                </div>
              ))}
            </div>
          </Anim>
          <Anim delay={0.3}>
            <div className="about-cols">
              {(data.about?.columns || []).slice(0, 3).map((c: any, i: number) => (
                <div className="about-col" key={i}>
                  <h4>{c.skill}</h4>
                  <p>{c.proof}</p>
                </div>
              ))}
            </div>
          </Anim>
        </div>
      </section>

      {/* FOOTER */}
      <div className="footer">
        BUILT FOR {(data.company?.company || "").toUpperCase()} — APPLYING FOR{" "}
        <a href={data.company?.role_url || "#"} target="_blank" rel="noopener noreferrer">
          {(data.company?.role || "").toUpperCase()}
        </a>
        <div style={{ marginTop: "12px", fontSize: ".5rem", fontWeight: 400, letterSpacing: ".08em", opacity: 0.5 }}>
          MADE WITH{" "}
          <a href="https://auditjob.me" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
            AUDITJOB.ME
          </a>
        </div>
      </div>
    </>
  );
}
