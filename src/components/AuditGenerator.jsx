import { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import FingerprintJS from "@fingerprintjs/fingerprintjs";
import { textOn, safeAccent, getPublicAuditOwner } from "./audit/utils.js";
import { makeCSS } from "./audit/styles.js";
import { downloadPDF } from "./audit/pdfHtml.js";
import { callClaude, extractText } from "./audit/api.js";
import { AUDIT_STAGES, runAudit } from "@/lib/audit/runAudit";
import { saveAuditPrivate } from "@/lib/audit/saveAudit";
import { FREE_AUDIT_LIMIT, auditsRemaining } from "@/lib/audit/auditLimit";
import { BRAND_NAME } from "@/lib/brandName";

/* ═══════════════════ CONSTANTS ═══════════════════ */
/** Canonical public origin. Shared audit links are for sending to other people, so
 *  they always point at production, never at wherever the app is running. */
const PUBLIC_ORIGIN = "https://northgoing.com";
/* The seven stages and the pipeline behind them live in src/lib/audit/runAudit.ts
 * (issue #159), so this page and the Apply page run the same audit. */
const STEPS = AUDIT_STAGES.map((label) => ({ label }));

/* ═══════════════════ INTERSECTION OBSERVER ═══════════════════ */
function useInView(ref) {
  const [vis, setVis] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVis(true); }, { threshold: 0.06 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref]);
  return vis;
}

function Anim({ children, delay = 0, style = {} }) {
  const ref = useRef();
  const vis = useInView(ref);
  return <div ref={ref} className={`anim ${vis ? "vis" : ""}`} style={{ animationDelay: `${delay}s`, ...style }}>{children}</div>;
}

/* ═══════════════════ PROTOTYPE COMPONENT ═══════════════════ */
function Prototype({ proto, accent }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(false);

  const run = async () => {
    if (!input.trim()) return;
    setLoading(true); setError(false); setResult(null);
    try {
      const res = await callClaude([{ role: "user", content: input }], {
        system: proto.system_prompt || `You are a helpful product analysis tool for ${proto.title}. Respond in JSON with clear, actionable output. Raw JSON only, no markdown backticks.`,
        max_tokens: 1500,
      });
      const text = extractText(res);
      setResult(text);
    } catch {
      setError(true);
      setResult(proto.fallback || "Demo unavailable. This prototype would analyze your input and provide structured, actionable output specific to this product intervention.");
    }
    setLoading(false);
  };

  return (
    <div className="proto-card">
      <div className="proto-header">
        <div>
          <h3>{proto.title}</h3>
          <span className="proto-header-sub">{proto.description}</span>
        </div>
        <span className="proto-tag">Prototype</span>
      </div>
      <div className="proto-body">
        <div className="proto-input-label">{proto.input_label || "Try it"}</div>
        <div className="proto-input-row">
          <input
            className="proto-input"
            placeholder={proto.placeholder || "Type something..."}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && run()}
          />
          <button className="proto-btn" onClick={run} disabled={loading || !input.trim()}>
            {loading ? "Running..." : proto.button_label || "Run →"}
          </button>
        </div>
        <p className="proto-hint">{proto.hint || "This would appear as a feature within the product."}</p>
        {result && (
          <div className="proto-result" style={{ whiteSpace: "pre-wrap" }}>
            {result}
          </div>
        )}
        {error && !loading && (
          <button onClick={run} style={{ marginTop: 8, background: "none", border: `1px solid ${accent}`, color: accent, padding: "6px 14px", borderRadius: 6, fontSize: ".72rem", fontWeight: 700, cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════ MAIN APP ═══════════════════ */
export default function App() {
  const [stage, setStage] = useState("input");
  
  const [cvFile, setCvFile] = useState(null);
  const [cvBase64, setCvBase64] = useState(null);
  const [jobLink, setJobLink] = useState("");
  const [showAdv, setShowAdv] = useState(false);
  const [personal, setPersonal] = useState("");
  const [stepStatus, setStepStatus] = useState([]);
  const [error, setError] = useState(null);
  const [protoTab, setProtoTab] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const [avgDuration, setAvgDuration] = useState(120); // default ~2min
  const [showHistory, setShowHistory] = useState(false);
  const [pastAudits, setPastAudits] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);

  // Auth from context (AuthProvider)
  const { user } = useAuth();

  // Deep-link prefill: /audit?job=<url> (e.g. from a digest role card) fills the job link.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const job = searchParams.get("job");
    if (job) setJobLink(job);
  }, [searchParams]);

  // Load audit history
  const loadHistory = async () => {
    if (!user) return;
    setLoadingHistory(true);
    const { data } = await supabase
      .from("audits")
      .select("id, company_name, role_name, audit_label, accent_color, pdf_path, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setPastAudits(data || []);
    setLoadingHistory(false);
  };

  useEffect(() => { if (user) loadHistory(); }, [user]);

  // Whitelist check — bypass free limit for whitelisted emails
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  useEffect(() => {
    if (!user?.email) return;
    supabase.from("whitelisted_emails").select("id").eq("email", user.email).maybeSingle()
      .then(({ data }) => setIsWhitelisted(!!data));
  }, [user]);

  // Device fingerprinting for anti-abuse
  const [deviceFp, setDeviceFp] = useState(null);
  const [deviceAuditCount, setDeviceAuditCount] = useState(0);
  useEffect(() => {
    FingerprintJS.load().then(fp => fp.get()).then(result => {
      setDeviceFp(result.visitorId);
      supabase.rpc("count_audits_by_fingerprint", { p_fingerprint: result.visitorId })
        .then(({ data }) => setDeviceAuditCount(data || 0));
    }).catch(err => console.warn("Fingerprint init failed:", err));
  }, []);

  const auditCount = pastAudits.length;
  const totalLimit = FREE_AUDIT_LIMIT;
  // The gate maths is shared with the Apply page (issue #159): src/lib/audit/auditLimit.ts.
  const freeUsed = Math.max(auditCount, deviceAuditCount);
  const remainingCredits = auditsRemaining({ auditCount, deviceAuditCount, isWhitelisted });
  const atLimit = remainingCredits === 0;

  const submitFeedback = async () => {
    if (!feedbackText.trim() || !user) return;
    setFeedbackSending(true);
    await supabase.from("feedback").insert({ user_id: user.id, message: feedbackText.trim() });
    setFeedbackSending(false);
    setFeedbackSent(true);
    setFeedbackText("");
    setTimeout(() => { setShowFeedback(false); setFeedbackSent(false); }, 1800);
  };


  const loadAudit = async (id) => {
    const { data } = await supabase
      .from("audits")
      .select("audit_data, slug, is_published")
      .eq("id", id)
      .single();

    if (data?.audit_data) {
      setData(data.audit_data);
      setStage("hub");
      setShowHistory(false);
      setAuditId(id);
      setAuditSlug(data.slug || null);
      setIsPublished(!!data.is_published);

      if (data.slug && user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username, display_name")
          .eq("id", user.id)
          .maybeSingle();

        const resolvedOwnerSlug = getPublicAuditOwner(user, profile);
        setOwnerSlug(resolvedOwnerSlug);
        setShareUrl(data.is_published && resolvedOwnerSlug ? `${PUBLIC_ORIGIN}/a/${resolvedOwnerSlug}/${data.slug}` : null);
      } else {
        setShareUrl(null);
      }
    }
  };

  // Save audit to DB + upload PDF. Audits start PRIVATE (#90) -- is_published
  // stays false until the owner presses the explicit share control below.
  const [auditId, setAuditId] = useState(null);
  const [auditSlug, setAuditSlug] = useState(null);
  const [ownerSlug, setOwnerSlug] = useState(null);
  const [isPublished, setIsPublished] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [shareUrl, setShareUrl] = useState(null);
  const [copied, setCopied] = useState(false);

  const saveAudit = async (auditData, durationSecs) => {
    if (!user) return;
    // The write itself lives in src/lib/audit/saveAudit.ts (issue #159) so the
    // Apply page saves an audit exactly the way this page always has: PRIVATE,
    // with is_published false until the Publish control below flips it.
    const saved = await saveAuditPrivate({
      userId: user.id,
      user,
      auditData,
      jobLink,
      deviceFingerprint: deviceFp,
      durationSeconds: durationSecs || null,
    });
    if (!saved) return;
    if (saved.auditId && deviceFp) setDeviceAuditCount(prev => prev + 1);
    setAuditId(saved.auditId);
    setAuditSlug(saved.slug);
    setOwnerSlug(saved.ownerSlug);
    setIsPublished(false);
    setShareUrl(null);
    loadHistory();
  };

  // Explicit share action (#90): the ONLY thing that makes an audit readable
  // by anyone besides its owner. Flips is_published server-side (RLS scoped to
  // the owning row) and only then reveals the link.
  const publishAudit = async () => {
    if (!auditId || publishing) return;
    setPublishing(true);
    // .select("id") is required here, not decorative: Supabase/PostgREST returns
    // no error when an UPDATE's RLS policy (or a missing grant) matches zero rows --
    // it just updates nothing. Without checking the returned row, a frontend that
    // ever runs ahead of its migration would flip isPublished=true and reveal a
    // share link while the row stays private server-side.
    const { data, error } = await supabase.from("audits").update({ is_published: true }).eq("id", auditId).select("id");
    setPublishing(false);
    if (error) {
      console.error("Failed to publish audit:", error);
      return;
    }
    if (!data || data.length === 0) {
      console.error("Failed to publish audit: update matched no row (policy or grant mismatch)");
      return;
    }
    setIsPublished(true);
    setShareUrl(ownerSlug && auditSlug ? `${PUBLIC_ORIGIN}/a/${ownerSlug}/${auditSlug}` : null);
  };

  // Timer for processing stage
  useEffect(() => {
    if (stage !== "processing") { setElapsed(0); elapsedRef.current = 0; return; }
    const t = setInterval(() => setElapsed(e => { const n = e + 1; elapsedRef.current = n; return n; }), 1000);
    return () => clearInterval(t);
  }, [stage]);

  // Fetch average audit duration for dynamic progress bar — re-fetch each time processing starts
  const fetchAvgDuration = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("get_global_avg_duration");
      if (!error && data && data > 60 && data < 600) {
        setAvgDuration(data);
      }
    } catch (_) {}
  }, []);

  useEffect(() => { fetchAvgDuration(); }, []);
  useEffect(() => { if (stage === "processing") fetchAvgDuration(); }, [stage]);

  // Audit data
  const [data, setData] = useState({
    cv: null, company: null, pains: null, diagnosis: null,
    proposals: null, prototypes: null, about: null, contacts: null, accent: "#8a9a8a", roleCtx: null, showProtos: false
  });

  const fileRef = useRef();

  const handleFile = e => {
    const f = e.target.files?.[0];
    if (f?.type === "application/pdf") {
      setCvFile(f);
      const r = new FileReader();
      r.onload = () => setCvBase64(r.result.split(",")[1]);
      r.readAsDataURL(f);
    }
  };

  const handleDrop = useCallback(e => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f?.type === "application/pdf") {
      setCvFile(f);
      const r = new FileReader();
      r.onload = () => setCvBase64(r.result.split(",")[1]);
      r.readAsDataURL(f);
    }
  }, []);

  const up = (i, s) => setStepStatus(p => { const n = [...p]; n[i] = s; return n; });

  const scrollTo = id => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  const generate = async () => {
    if (!cvBase64 || !jobLink.trim()) return;
    if (atLimit) return;
    setStage("processing");
    setStepStatus(STEPS.map(() => "pending"));
    setError(null);
    try {
      // The seven stages themselves are in src/lib/audit/runAudit.ts (issue #159).
      // This page keeps its own stage list, history and Publish control; the Apply
      // page keeps one button and a PDF. Neither owns a second copy of the pipeline.
      const finalData = await runAudit({
        cv: { pdfBase64: cvBase64 },
        jobLink,
        personal,
        onStage: up,
      });
      const finalElapsed = elapsedRef.current;
      setData(finalData);
      saveAudit(finalData, finalElapsed);
      setStage("hub");
    } catch (err) {
      console.error(err);
      setError(err.message);
      setStage("input");
    }
  };

  const reset = () => {
    setStage("input"); setData({ cv:null,company:null,pains:null,diagnosis:null,proposals:null,prototypes:null,about:null,contacts:null,accent:"#8a9a8a",roleCtx:null,showProtos:false });
    setCvFile(null); setCvBase64(null); setJobLink(""); setPersonal(""); setShowAdv(false); setShareUrl(null); setCopied(false);
    setAuditId(null); setAuditSlug(null); setOwnerSlug(null); setIsPublished(false); setPublishing(false);
  };

  const accent = safeAccent(data.accent) || "#8a9a8a";
  const showProtos = data.showProtos || false;
  const NAV_LINKS = showProtos
    ? ["research","diagnosis","proposals","prototypes","about"]
    : ["research","diagnosis","proposals","about"];
  const ABOUT_NUM = showProtos ? "05" : "04";
  const PROTO_NUM = "04";

  if (!user) {
    return (
      <>
        <style>{makeCSS(accent)}</style>
        <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif", padding: "3rem 1.5rem" }}>
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            <a href="/digest" style={{ color: accent, textDecoration: "underline", textUnderlineOffset: "2px", fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".06em" }}>← Back to your roles</a>
            <p style={{ marginTop: "1.5rem", fontSize: ".85rem", color: "var(--muted)" }}>
              Please <a href="/" style={{ color: accent, textDecoration: "underline", textUnderlineOffset: "2px" }}>sign in</a> to build a company audit.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{makeCSS(accent)}</style>

      {/* ─── NAV ─── */}
      <div className="nav">
        <span className="nav-title" style={{ cursor: stage === "results" ? "pointer" : "default" }} onClick={() => stage === "results" && scrollTo("hero")}>
          {(stage === "results" || stage === "hub") ? `${data.company?.company || ""} ${data.roleCtx?.audit_label || "Product Audit"}` : BRAND_NAME}
        </span>
        {stage === "results" && (
          <div className="nav-links">
            {NAV_LINKS.map(s => (
              <span key={s} className="nav-link" onClick={() => scrollTo(s)}>{s}</span>
            ))}
          </div>
        )}
        <div className="nav-right">
          {stage === "results" && (
            <button className="mode-btn" onClick={() => setStage("hub")}>← HUB</button>
          )}
          {stage === "hub" && (
            <button className="mode-btn" onClick={reset} style={{ borderColor: accent, color: accent }}>NEW</button>
          )}
          {user && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{
                background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, padding: "4px 0",
              }}
            >
              {user.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="" style={{ width: 26, height: 26, borderRadius: "50%", border: "1px solid var(--border)" }} />
              ) : (
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".6rem", fontWeight: 700, color: textOn(accent) }}>
                  {(user.email || "U")[0].toUpperCase()}
                </div>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ─── UNIFIED SIDEBAR ─── */}
      {showHistory && (
        <div style={{
          position: "fixed", top: 48, right: 0, bottom: 0, width: "min(340px, 100vw)", background: "#1a1916",
          borderLeft: "1px solid #2a2825", zIndex: 150, display: "flex", flexDirection: "column", animation: "fadeIn .2s ease",
        }}>
          {/* Header: User info */}
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #2a2825" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <p style={{ fontSize: ".72rem", fontWeight: 600, color: "#f0ede8", marginBottom: 2 }}>
                  {user?.user_metadata?.full_name || user?.user_metadata?.name || "User"}
                </p>
                <p style={{ fontSize: ".58rem", color: "#8a8780" }}>{user?.email}</p>
              </div>
              <button onClick={() => setShowHistory(false)} style={{ background: "none", border: "none", color: "#8a8780", cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}>×</button>
            </div>
          </div>

          {/* Middle: Audit history (scrollable) */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
            <span style={{ fontSize: ".58rem", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#8a8780", display: "block", marginBottom: 12 }}>
              MY AUDITS
            </span>
            {loadingHistory && <p style={{ fontSize: ".7rem", color: "#8a8780" }}>Loading...</p>}
            {pastAudits.map(a => (
              <div
                key={a.id}
                onClick={() => { loadAudit(a.id); setShowHistory(false); }}
                style={{
                  padding: "12px 14px", borderRadius: 8, border: "1px solid #2a2825", marginBottom: 8,
                  cursor: "pointer", transition: "border-color .2s",
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = safeAccent(a.accent_color) || "#8a8780"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2825"}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 8, height: 8, background: safeAccent(a.accent_color) || "#8a8780", flexShrink: 0 }} />
                  <span style={{ fontSize: ".78rem", fontWeight: 600, color: "#f0ede8" }}>{a.company_name}</span>
                </div>
                <p style={{ fontSize: ".62rem", color: "#8a8780", marginBottom: 4 }}>{a.audit_label || "Product Audit"}</p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: ".55rem", color: "#5a5850" }}>
                    {new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                  {a.pdf_path && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        const { data } = await supabase.storage.from("audit-pdfs").createSignedUrl(a.pdf_path, 3600);
                        if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
                      }}
                      style={{ fontSize: ".55rem", color: safeAccent(a.accent_color) || "#8a8780", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", textDecoration: "none", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
                    >
                      PDF
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!loadingHistory && pastAudits.length === 0 && (
              <p style={{ fontSize: ".7rem", color: "#5a5850", textAlign: "center", marginTop: 40 }}>No audits yet. Generate your first one!</p>
            )}
          </div>

          {/* Footer: Counter + Feedback + Sign Out */}
          <div style={{ padding: "14px 20px", borderTop: "1px solid #2a2825" }}>
            {/* Audit counter — free audits usage */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: ".55rem", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#8a8780" }}>
                  Free audits
                </span>
                <span style={{ fontSize: ".6rem", fontWeight: 700, color: atLimit ? "#e84c2b" : accent }}>
                  {freeUsed}/{totalLimit}
                </span>
              </div>
              <div style={{ width: "100%", height: 3, background: "#2a2825", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", background: atLimit ? "#e84c2b" : accent, width: `${Math.min((freeUsed / totalLimit) * 100, 100)}%`, transition: "width .3s ease", borderRadius: 2 }} />
              </div>
              {atLimit && (
                <p style={{ marginTop: 8, fontSize: ".55rem", color: "#8a8780", letterSpacing: ".04em" }}>Free limit reached</p>
              )}
            </div>
            {/* Feedback + Sign Out */}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => { setShowFeedback(true); setShowHistory(false); }}
                style={{
                  flex: 1, padding: "7px", borderRadius: 6, border: "1px solid #2a2825", background: "transparent",
                  color: "#f0ede8", fontSize: ".55rem", fontWeight: 600, cursor: "pointer", fontFamily: "'Plus Jakarta Sans',sans-serif",
                  letterSpacing: ".06em", textTransform: "uppercase",
                }}
              >
                Feedback
              </button>
              <button
                onClick={async () => { await supabase.auth.signOut(); window.location.href = "/"; }}
                style={{
                  flex: 1, padding: "7px", borderRadius: 6, border: "1px solid #2a2825", background: "transparent",
                  color: "#f0ede8", fontSize: ".55rem", fontWeight: 600, cursor: "pointer", fontFamily: "'Plus Jakarta Sans',sans-serif",
                  letterSpacing: ".06em", textTransform: "uppercase",
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ─── INPUT STAGE ─── */}
      {stage === "input" && (
        <div style={{ paddingTop: 48, minHeight: "100vh", background: "var(--bg)" }}>
          <div className="input-wrap">
            <Anim>
              <h1 className="input-h1">
                Show them you<br/>
                <span style={{ color: accent, fontStyle: "italic", fontWeight: 500, fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap" }}>already did the job.</span>
              </h1>
              <p className="input-sub">Send proof, not promises.</p>
            </Anim>

            {error && (
              <div style={{ padding: "12px 16px", borderRadius: 8, background: "rgba(220,38,38,.1)", border: "1px solid #fecaca", color: "#dc2626", marginBottom: 20, fontSize: ".8rem" }}>
                ⚠ {error}
              </div>
            )}

            <Anim delay={0.1}>
              <div
                className={`drop-zone ${cvFile ? "has-file" : ""}`}
                onClick={() => fileRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
              >
                <input ref={fileRef} type="file" accept=".pdf" onChange={handleFile} style={{ display: "none" }} />
                {cvFile ? (
                  <div>
                    <span style={{ fontSize: 16, color: accent, fontWeight: 500 }}>✓</span>
                    <p style={{ fontWeight: 500, fontSize: ".78rem", marginTop: 6, color: "var(--text)" }}>{cvFile.name}</p>
                    <p style={{ fontSize: ".62rem", color: "var(--muted)", marginTop: 4, letterSpacing: ".03em" }}>Click to change</p>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontWeight: 500, fontSize: ".78rem", color: "var(--text)", letterSpacing: ".02em" }}>Upload your CV</p>
                    <p style={{ fontSize: ".62rem", color: "var(--muted)", marginTop: 6, letterSpacing: ".03em" }}>PDF · drag & drop or click</p>
                  </div>
                )}
              </div>
            </Anim>

            <Anim delay={0.2}>
              <input
                className={`job-input ${jobLink.trim() ? "has-value" : ""}`}
                placeholder="Paste the job posting link"
                value={jobLink}
                onChange={e => setJobLink(e.target.value)}
              />
            </Anim>

            <Anim delay={0.25}>
              <button className="adv-toggle" onClick={() => setShowAdv(!showAdv)}>
                <span style={{ transform: showAdv ? "rotate(90deg)" : "none", transition: "transform .2s", display: "inline-block" }}>▸</span>
                Add personal context (optional)
              </button>
              {showAdv && (
                <textarea
                  className="adv-text"
                  rows={3}
                  placeholder="Anything the audit should know: why this role, a personal insight, relevant experience not on your CV..."
                  value={personal}
                  onChange={e => setPersonal(e.target.value)}
                />
              )}
            </Anim>

            <Anim delay={0.3}>
              <button
                className={`gen-btn ${cvBase64 && jobLink.trim() && !atLimit ? "ready" : "disabled"}`}
                onClick={generate}
                disabled={!cvBase64 || !jobLink.trim() || atLimit}
              >
                Generate Audit
              </button>
              {atLimit && (
                <p className="gen-hint"><span style={{ color: "var(--muted)" }}>Free limit reached</span></p>
              )}
              <p className="gen-hint"><span style={{ color: "var(--muted)" }}>Built by </span><a href="https://x.com/lifeinprogrezz" target="_blank" rel="noopener noreferrer" style={{ color: accent, textDecoration: "none" }}>@lifeinprogrezz</a></p>
            </Anim>
          </div>
        </div>
      )}

      {/* ─── PROCESSING ─── */}
      {stage === "processing" && (() => {
        const EST = avgDuration; // dynamic from real audit data
        const activeStep = STEPS[stepStatus.findIndex(s => s === "active")] || STEPS[0];
        const pct = Math.min(Math.round((elapsed / EST) * 100), 99);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        return (
        <div style={{ paddingTop: 48, minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ maxWidth: 420, width: "100%", padding: "0 24px", textAlign: "center" }}>
            <Anim>
              <p style={{ fontSize: ".55rem", fontWeight: 500, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 16 }}>
                (Building your audit)
              </p>
              <h2 style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 400, fontSize: "clamp(1.5rem, 4.5vw, 2.2rem)", color: "var(--text)", marginBottom: 40, letterSpacing: "-.03em", lineHeight: 1.1, marginTop: 0 }}>
                {activeStep?.label || "Processing"}
              </h2>
            </Anim>
            <div style={{ width: "100%", height: 2, background: "var(--border)", borderRadius: 1, overflow: "hidden", marginBottom: 16 }}>
              <div style={{ height: "100%", background: accent, width: `${pct}%`, transition: "width 1s linear", borderRadius: 1 }} />
            </div>
            <p style={{ fontSize: ".55rem", color: "var(--muted)", fontVariantNumeric: "tabular-nums", letterSpacing: ".04em", fontWeight: 400 }}>
              {mins}:{secs.toString().padStart(2, "0")}
            </p>
          </div>
        </div>
        );
      })()}

      {/* ─── HUB (Results Pre-Page) ─── */}
      {stage === "hub" && data.company && (
        <div style={{ paddingTop: 48, minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
          <div className="hub">
            <Anim>
              <p style={{ fontSize: ".55rem", fontWeight: 500, letterSpacing: ".16em", textTransform: "uppercase", color: accent, marginBottom: 24 }}>
                (Audit complete)
              </p>
              <h1 className="hub-title">{data.company.company}<br /><span style={{ color: accent }}>{data.roleCtx?.audit_label || "Product Audit"}</span></h1>
              <p className="hub-sub">Ready for {data.company.role}.</p>
            </Anim>
            <Anim delay={0.2}>
              <div className="hub-actions">
                <button className="hub-btn" style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)", width: "100%" }} onClick={() => downloadPDF(data)}>
                  Download PDF
                </button>
                <button className="hub-btn" style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)", width: "100%" }} onClick={() => { if (isPublished && shareUrl) { window.open(shareUrl, "_blank"); } else { setStage("results"); } }}>
                  View Interactive Audit
                </button>
                {isPublished && shareUrl ? (
                  <button className="hub-btn" style={{ background: accent, color: textOn(accent), width: "100%" }} onClick={() => { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                    {copied ? "Link Copied" : "Share Audit Link"}
                  </button>
                ) : (
                  <button className="hub-btn" style={{ background: accent, color: textOn(accent), width: "100%" }} onClick={publishAudit} disabled={publishing || !auditId}>
                    {publishing ? "Publishing..." : "Publish & Get Link"}
                  </button>
                )}
              </div>
              <p className="gen-hint">
                <span style={{ color: "var(--muted)" }}>
                  {isPublished
                    ? "This link is public now. Anyone who has it can read the audit."
                    : "This audit is private. Only you can see it until you publish. Once you publish, anyone with the link can read it."}
                </span>
              </p>
            </Anim>
            {data.contacts?.length > 0 && (
              <Anim delay={0.3}>
                <div className="hub-contacts">
                  <div className="hub-contacts-label" style={{ textAlign: "center" }}>Reach out to</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                    {data.contacts.map((c, i) => (
                      <a key={i} href={c.url || "#"} target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: ".85rem 1.1rem", borderRadius: 8, border: "1px solid var(--border)", textDecoration: "none", color: "var(--text)", transition: "border-color .2s" }}>
                        <div style={{ fontWeight: 500, fontSize: ".78rem", marginBottom: 3 }}>{c.name}</div>
                        <div style={{ fontSize: ".6rem", color: "var(--muted)" }}>{c.title}</div>
                      </a>
                    ))}
                  </div>
                </div>
              </Anim>
            )}
          </div>
        </div>
      )}

      {/* ─── RESULTS ─── */}
      {stage === "results" && data.company && (
        <div style={{ paddingTop: 0 }}>
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
                const h = data.diagnosis?.headline || `Product Audit: ${data.company.company}`;
                const lines = h.split('\n').filter(Boolean);
                if (lines.length >= 2) return <>{lines[0]}<br/><span className="accent">{lines.slice(1).join(' ')}</span></>;
                return h;
              })()}</h1>
            </Anim>
            <Anim delay={0.5}>
              <p className="hero-sub">{data.diagnosis?.sub || data.company.company_desc}</p>
            </Anim>
            <Anim delay={0.7}>
              <div className="hero-bottom">
                <span className="scroll-label">SCROLL ↓</span>
                <div className="hero-author">
                  <strong>{data.cv?.name || "Author"}</strong>
                  <span>{data.roleCtx?.role_type || data.company?.role || "Growth & Product"}</span>
                </div>
              </div>
            </Anim>
          </section>

          {/* RESEARCH */}
          <section className="section" id="research">
            <Anim><div className="sec-label">01 — RESEARCH</div></Anim>
            <Anim delay={0.1}>
              <div className="sec-h2">The numbers.</div>
              {data.company.competitors?.length > 0 && (
                <div className="sec-h2"><span className="accent">vs. {data.company.competitors.join(", ")}.</span></div>
              )}
            </Anim>
            <Anim delay={0.2}>
              <div className="stats-grid">
                {(data.company.stats || []).slice(0, 8).map((s, i) => (
                  <div className="stat-cell" key={i}>
                    <div className="stat-val hd">
                      {s.value}
                    </div>
                    <div className="stat-label">{s.label}</div>
                    {s.delta && (
                      s.source_url
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
              <div className="sec-h2">
                {data.diagnosis?.findings?.length || 3} findings.
              </div>
              <div className="sec-h2"><span className="accent">And why the team hasn't fixed them.</span></div>
              <p className="sec-intro">
                These gaps aren't failures — they're the predictable output of a team correctly prioritizing other things. But they leave a window open.
              </p>
            </Anim>
            {(data.diagnosis?.findings || []).map((f, i) => (
              <Anim key={i} delay={0.15 * (i + 1)}>
                <div className="finding-card">
                  <div className="finding-header">
                    <span className="finding-num">{f.number || `0${i + 1}`}</span>
                    {f.title}
                  </div>
                  <div className="finding-cols">
                    <div className="finding-col">
                      <div className="finding-col-label evidence">EVIDENCE</div>
                      <p>{f.evidence}</p>
                      {f.evidence_sources?.length > 0 && (
                        <p style={{ marginTop: 6, fontSize: ".68rem" }}>
                          Sources: {f.evidence_sources.map((s, j) => (
                            <span key={j}>
                              {j > 0 && " · "}
                              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>
                            </span>
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
            {(data.proposals?.proposals || []).map((p, i) => (
              <Anim key={i} delay={0.15 * (i + 1)}>
                <div className="prop-card">
                  <div className="prop-phase">PHASE {p.phase || i + 1}</div>
                  <div className="prop-title hd">{p.title}</div>
                  <div className="prop-grid">
                    <div className="prop-cell">
                      <div className="prop-cell-label problem">PROBLEM</div>
                      <p>{p.problem}</p>
                    </div>
                    <div className="prop-cell">
                      <div className="prop-cell-label solution">SOLUTION</div>
                      <p>{p.solution}</p>
                    </div>
                    <div className="prop-cell">
                      <div className="prop-cell-label how">HOW IT WORKS</div>
                      <p>{p.how_it_works}</p>
                    </div>
                    <div className="prop-cell">
                      <div className="prop-cell-label target">TARGET · EFFORT · IMPACT</div>
                      <p>{p.target_effort_impact}</p>
                    </div>
                  </div>
                </div>
              </Anim>
            ))}
          </section>

          {/* PROTOTYPES (only for tech domains) */}
          {showProtos && (
          <section className="section" id="prototypes">
            <Anim><div className="sec-label">{PROTO_NUM} — PROTOTYPES</div></Anim>
            <Anim delay={0.1}>
              <div className="sec-h2">Working prototypes.</div>
              <div className="sec-h2"><span className="accent">Each mapped to a specific gap.</span></div>
              <p className="sec-intro">Built with the Claude API. These are product concepts, not UI mockups.</p>
            </Anim>
            <Anim delay={0.2}>
              <div className="proto-tabs">
                {(data.prototypes?.prototypes || []).map((pt, i) => (
                  <button
                    key={i}
                    className={`proto-tab ${protoTab === i ? "active" : ""}`}
                    onClick={() => setProtoTab(i)}
                  >
                    Phase {pt.phase || i + 1} — {pt.title?.replace(/Phase \d+ — /i, "") || `Prototype ${i + 1}`}
                  </button>
                ))}
              </div>
            </Anim>
            <Anim delay={0.3}>
              {(data.prototypes?.prototypes || []).length > 0 && (
                <Prototype
                  key={protoTab}
                  proto={data.prototypes.prototypes[protoTab]}
                  accent={accent}
                />
              )}
            </Anim>
          </section>
          )}

          {/* ABOUT */}
          <section className="about-section" id="about">
            <Anim><div className="sec-label">{ABOUT_NUM} — ABOUT</div></Anim>
            <Anim delay={0.1}>
              <div className="sec-h2" style={{ textAlign: "center" }}>{data.about?.headline || "Why I'm the right PM"}</div>
              <div className="sec-h2" style={{ textAlign: "center" }}><span className="accent">{data.about?.headline_accent || "for this specific gap."}</span></div>
            </Anim>
            <div className="about-inner">
              <Anim delay={0.2}>
                <div className="about-stats">
                  {(data.about?.stats || []).slice(0, 3).map((s, i) => (
                    <div className="about-stat" key={i}>
                      <div className="about-stat-val hd">{s.value}</div>
                      <div className="about-stat-label">{s.label}</div>
                    </div>
                  ))}
                </div>
              </Anim>
              <Anim delay={0.3}>
                <div className="about-cols">
                  {(data.about?.columns || []).slice(0, 3).map((c, i) => (
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
            <a href={data.company?.role_url || jobLink} target="_blank" rel="noopener noreferrer">
              {(data.company?.role || "").toUpperCase()}
            </a>
            <div style={{ marginTop: "12px", fontSize: ".5rem", fontWeight: 400, letterSpacing: ".08em", opacity: 0.5 }}>
              MADE WITH{" "}
              <a href={PUBLIC_ORIGIN} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
                {BRAND_NAME.toUpperCase()}
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ─── FEEDBACK DIALOG ─── */}
      {showFeedback && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)" }} onClick={() => { setShowFeedback(false); setFeedbackSent(false); }} />
          <div style={{ position: "relative", background: "#1a1916", border: "1px solid #2a2825", borderRadius: 10, padding: "28px 24px", width: "min(400px, 90vw)", animation: "fadeUp .25s ease" }}>
            <button onClick={() => { setShowFeedback(false); setFeedbackSent(false); }} style={{ position: "absolute", top: 12, right: 14, background: "none", border: "none", color: "#8a8780", cursor: "pointer", fontSize: "1rem" }}>×</button>
            {feedbackSent ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <p style={{ fontSize: ".78rem", color: "#f0ede8", fontWeight: 600 }}>Thanks for your feedback</p>
              </div>
            ) : (
              <>
                <p style={{ fontSize: ".62rem", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: accent, marginBottom: 8, textAlign: "center" }}>Feedback</p>
                <p style={{ fontSize: ".83rem", color: "#f0ede8", fontWeight: 500, marginBottom: 16, lineHeight: 1.5, textAlign: "center" }}>What should we improve?</p>
                <textarea
                  value={feedbackText}
                  onChange={e => setFeedbackText(e.target.value)}
                  placeholder="A bug, a feature idea, anything."
                  rows={4}
                  style={{ width: "100%", padding: ".75rem 1rem", borderRadius: 8, border: "1px solid #2a2825", fontSize: ".78rem", fontFamily: "'Plus Jakarta Sans',sans-serif", background: "transparent", color: "#f0ede8", resize: "vertical", lineHeight: 1.6 }}
                />
                <button
                  onClick={submitFeedback}
                  disabled={!feedbackText.trim() || feedbackSending}
                  style={{ width: "100%", marginTop: 12, padding: "10px", borderRadius: 8, border: "none", background: feedbackText.trim() ? accent : "#2a2825", color: feedbackText.trim() ? textOn(accent) : "#8a8780", fontSize: ".65rem", fontWeight: 700, cursor: feedbackText.trim() ? "pointer" : "not-allowed", fontFamily: "'Plus Jakarta Sans',sans-serif", letterSpacing: ".1em", textTransform: "uppercase", transition: "all .2s" }}
                >
                  {feedbackSending ? "Sending..." : "Send"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

    </>
  );
}
