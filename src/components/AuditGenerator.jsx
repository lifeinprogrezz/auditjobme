import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import FingerprintJS from "@fingerprintjs/fingerprintjs";

/* ═══════════════════ CONSTANTS ═══════════════════ */
const STEPS = [
  { label: "Parsing your CV" },
  { label: "Researching the company" },
  { label: "Building diagnosis" },
  { label: "Generating proposals" },
  { label: "Designing prototypes" },
  { label: "Matching your profile" },
  { label: "Finding decision-makers" },
];

const WEB_SEARCH = [{ type: "web_search_20250305", name: "web_search" }];

/* Domains that get interactive prototypes */
const PROTO_DOMAINS = ["tech_product", "engineering_technical", "data_analytics"];

/* Light/dark text helper based on accent brightness */
function textOn(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return (r*299 + g*587 + b*114) / 1000 > 150 ? "#0f0e0c" : "#f0ede8";
}

/* Color safety: prevent accent colors invisible on dark background */
function safeAccent(hex) {
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

/* Post-processing: fix common LLM output issues */
function validateOutput(data) {
  const trim = (s, max) => {
    if (!s || typeof s !== "string") return s || "";
    const words = s.split(/\s+/);
    if (words.length <= max) return s;
    const cut = words.slice(0, max).join(" ");
    const lastDot = cut.lastIndexOf(".");
    return lastDot > cut.length * 0.5 ? cut.slice(0, lastDot + 1) : cut + ".";
  };
  const fixHex = h => /^#[0-9a-fA-F]{6}$/.test(h) ? h : "#8a9a8a";

  // Company stats
  if (data.company?.stats) {
    data.company.stats = data.company.stats.map(s => ({
      ...s,
      value: trim(s.value, 3),
      label: trim(s.label, 3),
      delta: trim(s.delta, 5),
      source_url: (s.source_url && s.source_url.startsWith("http")) ? s.source_url : ""
    }));
  }
  if (data.company?.accent_color) data.company.accent_color = fixHex(data.company.accent_color);

  // Diagnosis findings
  if (data.diagnosis?.findings) {
    data.diagnosis.findings = data.diagnosis.findings.map(f => ({
      ...f,
      title: trim(f.title, 8),
      evidence: trim(f.evidence, 40),
      impact: trim(f.impact, 30),
      why_not_fixed: trim(f.why_not_fixed, 40),
      tag: trim(f.tag, 2),
      evidence_sources: (f.evidence_sources || []).filter(s => s.url && s.url.startsWith("http"))
    }));
  }

  // Proposals
  if (data.proposals?.proposals) {
    data.proposals.proposals = data.proposals.proposals.map(p => ({
      ...p,
      title: trim(p.title, 8),
      problem: trim(p.problem, 30),
      solution: trim(p.solution, 30),
      how_it_works: trim(p.how_it_works, 30),
      target_effort_impact: trim(p.target_effort_impact, 30)
    }));
  }

  // About columns
  if (data.about?.columns) {
    data.about.columns = data.about.columns.map(c => ({
      ...c,
      skill: trim(c.skill, 2),
      proof: trim(c.proof, 35)
    }));
  }

  return data;
}

/* ═══════════════════ API ═══════════════════ */
const SONNET = "claude-sonnet-4-20250514";
const HAIKU = "claude-haiku-4-5-20251001";

async function callClaude(messages, opts = {}) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(`${supabaseUrl}/functions/v1/anthropic-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${supabaseKey}`,
      "apikey": supabaseKey,
    },
    body: JSON.stringify({
      messages,
      model: opts.model || SONNET,
      max_tokens: opts.max_tokens || 4096,
      ...(opts.system ? { system: opts.system } : {}),
      ...(opts.tools ? { tools: opts.tools } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API ${res.status}`);
  }
  return res.json();
}

/* Retry wrapper: retries up to maxRetries times with delay between attempts */
async function callClaudeWithRetry(messages, opts = {}, maxRetries = 3, delayMs = 2000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callClaude(messages, opts);
    } catch (err) {
      lastError = err;
      console.warn(`API call attempt ${attempt}/${maxRetries} failed:`, err.message);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

/* Validation gate: checks that all critical sections have real data */
function validateSections({ company, diagnosis, proposals, about, contacts }) {
  const missing = [];
  if (!company?.stats?.length) missing.push("company_stats");
  if (!diagnosis?.findings?.length) missing.push("diagnosis");
  if (!proposals?.proposals?.length) missing.push("proposals");
  if (!about?.columns?.length && !about?.stats?.length) missing.push("about");
  if (!Array.isArray(contacts) || contacts.length === 0) missing.push("contacts");
  return missing;
}

function extractText(d) {
  return (d?.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

function safeParse(text) {
  try {
    return JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
  } catch {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) try { return JSON.parse(m[0]); } catch {}
    return null;
  }
}

/* ═══════════════════ CSS SYSTEM ═══════════════════ */
function makeCSS(dark, accent = "#8a9a8a") {
  const v = dark
    ? { bg: "#0f0e0c", surface: "#1a1916", text: "#f0ede8", muted: "#8a8780", border: "#2a2825", heroBg: "#0f0e0c" }
    : { bg: "#faf9f7", surface: "#ffffff", text: "#1a1a17", muted: "#7a7a72", border: "#e8e6e1", heroBg: "#1a1a17" };
  return `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400;1,9..40,500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
    :root{--bg:${v.bg};--surface:${v.surface};--text:${v.text};--muted:${v.muted};--border:${v.border};--accent:${accent};--hero-bg:${v.heroBg}}
    *{box-sizing:border-box;margin:0;padding:0}
    *::-webkit-scrollbar{display:none}*{scrollbar-width:none}
    body,html{font-family:'Plus Jakarta Sans',sans-serif;background:var(--bg);color:var(--text);scroll-behavior:smooth}
    .hd{font-family:'DM Sans',sans-serif;font-weight:800}
    @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .anim{opacity:0}.anim.vis{animation:fadeUp .6s ease forwards}
    .pulse{animation:pulse 1.5s ease-in-out infinite}

    /* NAV */
    .nav{position:fixed;top:0;left:0;right:0;height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(1.2rem,4vw,3rem);z-index:100;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);background:rgba(15,14,12,.92)}
    .nav-title{font-family:'DM Sans',sans-serif;font-weight:500;font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text)}
    .nav-links{display:flex;gap:1.5rem}
    .nav-link{font-size:.62rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);text-decoration:none;cursor:pointer;transition:color .2s}
    .nav-link:hover{color:var(--text)}
    .nav-right{display:flex;align-items:center;gap:1rem}
    .nav-date{font-size:.6rem;letter-spacing:.06em;color:var(--muted)}
    .mode-btn{background:none;border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:.55rem;font-weight:500;cursor:pointer;color:var(--text);font-family:'Plus Jakarta Sans',sans-serif;letter-spacing:.1em;text-transform:uppercase;transition:all .2s}

    /* HERO */
    .hero{min-height:100vh;display:flex;flex-direction:column;justify-content:flex-end;padding:0 clamp(1.2rem,4vw,3rem) clamp(2rem,4vw,3rem);background:var(--hero-bg);color:${dark ? "#f0ede8" : "#f0ede8"};position:relative}
    .hero-label{font-size:.62rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8a8780;margin-bottom:1.2rem;display:flex;align-items:center;gap:.5rem}
    .hero-dot{width:8px;height:8px;background:var(--accent);display:inline-block}
    .hero h1{font-family:'DM Sans',sans-serif;font-weight:800;font-size:clamp(1.9rem,5.5vw,4.2rem);line-height:1.05;letter-spacing:-.03em;margin-bottom:.8rem;color:#f0ede8}
    .hero h1 .accent{color:var(--accent)}
    .hero-sub{font-size:.83rem;color:#8a8780;max-width:540px;line-height:1.7;margin-bottom:2rem}
    .hero-bottom{display:flex;justify-content:space-between;align-items:flex-end}
    .scroll-label{font-size:.58rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8a8780}
    .hero-author{text-align:right}
    .hero-author strong{font-size:.83rem;display:block;color:#f0ede8}
    .hero-author span{font-size:.7rem;color:#8a8780}

    /* SECTIONS */
    .section{position:relative;padding:clamp(3rem,8vw,5rem) clamp(1.2rem,4vw,3rem)}
    .section::before{content:'';position:absolute;top:0;left:clamp(1.2rem,4vw,3rem);right:clamp(1.2rem,4vw,3rem);height:1px;background:var(--border)}
    .sec-label{font-size:.62rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:1.5rem}
    .sec-h2{font-family:'DM Sans',sans-serif;font-weight:800;font-size:clamp(1.6rem,3.5vw,3rem);line-height:1.05;letter-spacing:-.03em;margin-bottom:.4rem}
    .sec-h2 .accent{color:var(--accent)}
    .sec-intro{font-size:.83rem;color:var(--muted);max-width:560px;line-height:1.7;margin-bottom:2rem}

    /* STAT GRID */
    .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--border);border-radius:8px;overflow:hidden}
    .stat-cell{padding:1.2rem 1.4rem;border-right:1px solid var(--border);border-bottom:1px solid var(--border)}
    .stat-cell:nth-child(4n){border-right:none}
    .stat-cell:nth-last-child(-n+4){border-bottom:none}
    .stat-val{font-family:'DM Sans',sans-serif;font-weight:800;font-size:clamp(1.2rem,2.5vw,1.8rem);margin-bottom:.25rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .stat-label{font-size:.62rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
    .stat-delta{font-size:.6rem;color:var(--accent);margin-top:.2rem;font-weight:600;text-decoration:none;display:block}
    a.stat-delta{text-decoration:underline dotted;text-underline-offset:3px}

    /* QUOTE */
    .quote-block{border-left:3px solid var(--accent);padding:1.2rem 1.5rem;margin-top:2rem;background:var(--surface);border-radius:0 8px 8px 0}
    .quote-label{font-size:.58rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:.6rem}
    .quote-block p{font-size:.83rem;font-style:italic;line-height:1.7;color:var(--text)}
    .quote-src{font-size:.65rem;color:var(--muted);margin-top:.5rem;font-style:normal}
    .quote-src a{color:var(--muted);text-decoration:underline dotted;text-underline-offset:3px}

    /* FINDINGS */
    .finding-card{border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:1.5rem}
    .finding-header{padding:1.2rem 1.5rem;font-family:'DM Sans',sans-serif;font-weight:700;font-size:.9rem;display:flex;gap:.6rem;align-items:center}
    .finding-num{color:var(--muted);font-weight:600}
    .finding-cols{display:grid;grid-template-columns:repeat(3,1fr)}
    .finding-col{padding:1rem 1.5rem;border-right:1px solid var(--border);border-top:1px solid var(--border)}
    .finding-col:last-child{border-right:none}
    .finding-col-label{font-size:.58rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:.5rem}
    .finding-col-label.evidence{color:var(--text)}
    .finding-col-label.impact{color:var(--accent)}
    .finding-col-label.why{color:var(--text)}
    .finding-col p{font-size:.78rem;line-height:1.65;color:var(--muted)}
    .finding-col a{color:var(--muted);text-decoration:underline dotted;text-underline-offset:3px}
    .finding-tag{display:inline-block;padding:.25rem .7rem;font-size:.56rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--border);border-radius:4px;margin:0 1.5rem 1rem;color:var(--muted)}

    /* PROPOSALS */
    .prop-card{margin-bottom:2.5rem}
    .prop-phase{font-size:.62rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:.5rem}
    .prop-title{font-family:'DM Sans',sans-serif;font-weight:800;font-size:1.1rem;margin-bottom:1rem}
    .prop-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--border);border-radius:8px;overflow:hidden}
    .prop-cell{padding:1rem 1.5rem;border-right:1px solid var(--border);border-bottom:1px solid var(--border)}
    .prop-cell:nth-child(2n){border-right:none}
    .prop-cell:nth-last-child(-n+2){border-bottom:none}
    .prop-cell-label{font-size:.58rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:.4rem}
    .prop-cell-label.problem{color:var(--accent)}
    .prop-cell-label.solution{color:var(--text)}
    .prop-cell-label.how{color:var(--accent)}
    .prop-cell-label.target{color:var(--text)}
    .prop-cell p{font-size:.78rem;line-height:1.65;color:var(--muted)}

    /* PROTOTYPES */
    .proto-tabs{display:flex;gap:1.5rem;margin-bottom:2rem;border-bottom:1px solid var(--border);overflow-x:auto;-webkit-overflow-scrolling:touch}
    .proto-tab{font-size:.62rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);cursor:pointer;padding-bottom:10px;border-bottom:2px solid transparent;white-space:nowrap;background:none;border-top:none;border-left:none;border-right:none;font-family:'Plus Jakarta Sans',sans-serif}
    .proto-tab.active{color:var(--text);border-bottom-color:var(--accent)}
    .proto-card{border:1px solid var(--border);border-radius:8px;overflow:hidden}
    .proto-header{display:flex;justify-content:space-between;align-items:center;padding:1.2rem 1.5rem;border-bottom:1px solid var(--border)}
    .proto-header h3{font-family:'DM Sans',sans-serif;font-weight:700;font-size:.85rem}
    .proto-header-sub{font-size:.7rem;color:var(--muted)}
    .proto-tag{font-size:.56rem;font-weight:700;padding:.3rem .8rem;border:1px solid var(--accent);border-radius:4px;color:var(--accent);letter-spacing:.06em;text-transform:uppercase}
    .proto-body{padding:1.5rem}
    .proto-input-label{font-size:.58rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:.5rem}
    .proto-input-row{display:flex;gap:.8rem;margin-bottom:1rem}
    .proto-input{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:.7rem 1rem;font-size:.8rem;color:var(--text);font-family:'Plus Jakarta Sans',sans-serif}
    .proto-input:focus{outline:none;border-color:var(--accent)}
    .proto-btn{background:var(--accent);color:white;border:none;padding:.7rem 1.5rem;border-radius:6px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
    .proto-btn:disabled{opacity:.5;cursor:not-allowed}
    .proto-result{margin-top:1rem;padding:1.2rem;border-radius:6px;background:var(--surface);border:1px solid var(--border);font-size:.8rem;line-height:1.7;color:var(--text)}
    .proto-hint{font-size:.7rem;font-style:italic;color:var(--muted)}

    /* ABOUT */
    .about-section{position:relative;padding:clamp(3rem,8vw,5rem) clamp(1.2rem,4vw,3rem);text-align:center;background:var(--hero-bg);color:#f0ede8}
    .about-section::before{content:'';position:absolute;top:0;left:clamp(1.2rem,4vw,3rem);right:clamp(1.2rem,4vw,3rem);height:1px;background:#2a2825}
    .about-stats{display:grid;grid-template-columns:repeat(3,1fr);max-width:700px;margin:2rem auto;border:1px solid #2a2825;border-radius:8px;overflow:hidden}
    .about-stat{padding:1.5rem;border-right:1px solid #2a2825;text-align:center}
    .about-stat:last-child{border-right:none}
    .about-stat-val{font-family:'DM Sans',sans-serif;font-weight:800;font-size:clamp(1.3rem,3vw,2rem);margin-bottom:.3rem;color:#f0ede8}
    .about-stat-label{font-size:.56rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8a8780}
    .about-cols{display:grid;grid-template-columns:repeat(3,1fr);max-width:700px;margin:2rem auto;gap:2rem;text-align:center}
    .about-col h4{font-family:'DM Sans',sans-serif;font-weight:800;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:.6rem;color:#f0ede8;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .about-col p{font-size:.75rem;line-height:1.7;color:#8a8780}
    .about-link{font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);text-decoration:none;display:inline-block;margin-top:1.5rem}
    .about-section .sec-label{color:#8a8780}
    .about-section .sec-h2{color:#f0ede8}

    /* FOOTER */
    .footer{padding:2rem clamp(1.2rem,4vw,3rem);text-align:center;font-size:.55rem;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);border-top:1px solid var(--border)}
    .footer a{color:var(--accent);text-decoration:none}

    /* INPUT STAGE */
    .input-wrap{max-width:480px;margin:0 auto;padding:0 24px;display:flex;flex-direction:column;justify-content:center;min-height:calc(100vh - 48px)}
    .input-h1{font-family:'DM Sans',sans-serif;font-weight:400;font-size:clamp(1.9rem,5.5vw,3.4rem);line-height:1.08;letter-spacing:-.04em;text-align:center;margin-bottom:.6rem;color:var(--text)}
    .input-sub{font-size:.7rem;color:var(--muted);text-align:center;max-width:320px;margin:0 auto 1.8rem;line-height:1.5;letter-spacing:.04em;font-weight:500}
    .drop-zone{border:1px solid var(--border);border-radius:8px;padding:2.2rem 1.5rem;text-align:center;cursor:pointer;transition:all .2s;background:transparent}
    .drop-zone:hover{border-color:var(--muted)}
    .drop-zone.has-file{border-color:var(--accent)}
    .job-input{width:100%;padding:.85rem 1rem;border-radius:8px;border:1px solid var(--border);font-size:.8rem;font-family:'Plus Jakarta Sans',sans-serif;font-weight:400;background:transparent;color:var(--text);margin-top:.7rem;transition:all .2s;letter-spacing:.01em}
    .job-input:focus{outline:none;border-color:var(--accent)}
    .job-input.has-value{border-color:var(--accent)}
    .job-input::placeholder,.adv-text::placeholder{color:var(--muted);opacity:.6;font-weight:400;letter-spacing:.01em}
    .adv-toggle{background:none;border:none;cursor:pointer;font-size:.6rem;color:var(--muted);font-family:'Plus Jakarta Sans',sans-serif;font-weight:500;padding:.5rem 0;margin-top:.3rem;display:flex;align-items:center;gap:.4rem;letter-spacing:.04em}
    .adv-text{width:100%;padding:.75rem 1rem;border-radius:8px;border:1px solid var(--border);font-size:.75rem;font-family:'Plus Jakarta Sans',sans-serif;font-weight:400;background:transparent;color:var(--text);resize:vertical;line-height:1.6;margin-top:.4rem}
    .gen-btn{width:100%;margin-top:1.5rem;padding:.9rem;border-radius:8px;border:none;font-family:'Plus Jakarta Sans',sans-serif;font-weight:500;font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;transition:all .2s}
    .gen-btn.ready{background:var(--accent);color:#f0ede8}
    .gen-btn.ready:hover{opacity:.85}
    .gen-btn.disabled{background:var(--border);color:var(--muted);cursor:not-allowed}
    .gen-hint{text-align:center;font-size:.6rem;color:var(--muted);margin-top:1rem;letter-spacing:.02em}
    .gen-hint a:hover{color:var(--accent)}

    /* PROCESSING */
    .proc-wrap{max-width:480px;margin:0 auto;padding:100px 24px}
    .step-row{display:flex;align-items:center;gap:1rem;padding:.9rem 1.2rem;border-radius:8px;border:1px solid var(--border);margin-bottom:.7rem;transition:all .3s}
    .step-row.active{border-color:var(--accent);background:${dark ? "rgba(232,76,43,.08)" : "rgba(232,76,43,.05)"}}
    .step-row.done{border-color:${dark ? "#2a3a2a" : "#bbf7d0"};background:${dark ? "rgba(22,163,74,.06)" : "#f0fdf4"}}
    .step-row.pending{opacity:.4}
    .step-icon{font-size:1.1rem;width:24px;text-align:center}
    .step-text{font-size:.83rem;font-weight:500}
    .step-text.active{font-weight:700;color:var(--text)}
    .step-text.done{color:#16a34a}

    /* HUB */
    .hub{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 24px;text-align:center;min-height:calc(100vh - 48px)}
    .hub-title{font-family:'DM Sans',sans-serif;font-weight:400;font-size:clamp(1.8rem,4vw,2.8rem);line-height:1.1;letter-spacing:-.04em;margin-bottom:.6rem;color:var(--text)}
    .hub-sub{font-size:.75rem;color:var(--muted);max-width:380px;margin:0 auto 2.5rem;line-height:1.5;letter-spacing:.02em}
    .hub-actions{display:flex;gap:.8rem;justify-content:center;flex-wrap:wrap;margin-bottom:3rem}
    .hub-btn{padding:11px 28px;border-radius:8px;font-family:'Plus Jakarta Sans',sans-serif;font-weight:500;font-size:.68rem;cursor:pointer;transition:all .2s;border:none;letter-spacing:.1em;text-transform:uppercase}
    .hub-btn:hover{opacity:.85}
    .hub-contacts{max-width:600px;margin:0 auto;width:100%}
    .hub-contacts-label{font-size:.55rem;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:.8rem;text-align:left}
    .about-inner{max-width:700px;margin:0 auto}

    /* RESPONSIVE */
    @media(max-width:900px){
      .stats-grid{grid-template-columns:repeat(2,1fr)}
      .stat-cell:nth-child(2n){border-right:none}
      .stat-cell:nth-child(4n){border-right:none}
      .finding-cols{grid-template-columns:1fr}
      .finding-col{border-right:none;border-bottom:1px solid var(--border)}
      .finding-col:last-child{border-bottom:none}
      .prop-grid{grid-template-columns:1fr}
      .prop-cell{border-right:none!important;border-bottom:1px solid var(--border)}
      .prop-cell:last-child{border-bottom:none}
      .about-cols{grid-template-columns:1fr;gap:1.5rem}
    }
    @media(max-width:600px){
      .nav-links{display:none}
      .nav-date{display:none}
      .hero{min-height:90vh;padding-top:60px}
      .hero h1{font-size:clamp(1.5rem,7.5vw,2.2rem)}
      .sec-h2{font-size:clamp(1.25rem,6vw,1.8rem)}
      .hero-sub{font-size:.78rem}
      .hero-bottom{flex-direction:column;align-items:flex-start;gap:1.2rem}
      .hero-author{text-align:left}
      .stats-grid{grid-template-columns:repeat(2,1fr)}
      .stat-val{font-size:clamp(1.1rem,5vw,1.5rem)}
      .finding-header{padding:1rem 1.2rem}
      .finding-col{padding:.8rem 1.2rem}
      .proto-tabs{gap:.8rem}
      .proto-tab{font-size:.58rem}
      .proto-header{flex-direction:column;align-items:flex-start;gap:.6rem}
      .proto-input-row{flex-direction:column}
      .proto-btn{width:100%}
      .about-stats{grid-template-columns:1fr}
      .about-stat{border-right:none;border-bottom:1px solid #2a2825}
      .about-stat:last-child{border-bottom:none}
      .about-cols{grid-template-columns:1fr}
      .section,.about-section{padding:clamp(2.5rem,8vw,4rem) clamp(1rem,4vw,1.5rem)}
      .section::before,.about-section::before{left:clamp(1rem,4vw,1.5rem);right:clamp(1rem,4vw,1.5rem)}
      .footer{padding:1.8rem clamp(1rem,4vw,1.5rem);font-size:.56rem}
      .hub-actions{flex-direction:column;align-items:center}
      .hub-btn{width:100%}
      .input-h1{font-size:clamp(1.6rem,7vw,2.2rem)}
      .input-wrap{padding:0 20px}
      .input-sub{margin-bottom:1.4rem}
      .hub-title{font-size:clamp(1.5rem,6vw,2rem)}
    }
  `;
}

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

/* ═══════════════════ PDF HTML GENERATOR ═══════════════════ */
function generatePDFHTML(data) {
  const { company, pains, diagnosis, proposals, about, cv, accent, roleCtx } = data;
  const ac = safeAccent(accent) || "#8a9a8a";
  const auditLabel = (roleCtx?.audit_label || "Product Audit").toUpperCase();
  const e = s => (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  // Hero headline with accent second line
  const headlineHTML = (() => {
    const h = diagnosis?.headline || "";
    const lines = h.split('\n').filter(Boolean);
    if (lines.length >= 2) return e(lines[0]) + '<br/><span class="accent">' + e(lines.slice(1).join(' ')) + '</span>';
    return e(h);
  })();

  // Proposals headline with accent second line
  const propHeadlineHTML = (() => {
    const h = proposals?.headline || "3 interventions.";
    const lines = h.split('\n').filter(Boolean);
    if (lines.length >= 2) return e(lines[0]) + '<br/><span class="accent">' + e(lines.slice(1).join(' ')) + '</span>';
    return e(h);
  })();

  const statsHTML = (company?.stats||[]).slice(0,8).map(s =>
    `<div class="stat-cell"><div class="stat-val hd">${e(s.value)}</div><div class="stat-label">${e(s.label)}</div>${s.delta?(s.source_url?`<a class="stat-delta" href="${s.source_url}">${e(s.delta)}</a>`:`<div class="stat-delta">${e(s.delta)}</div>`):''}</div>`
  ).join("");

  const quoteHTML = pains?.key_quote ? `
    <div class="quote-block">
      <div class="quote-label">FIELD SIGNAL</div>
      <p>${e((pains.key_quote || "").replace(/<cite[^>]*>/g, '').replace(/<\/cite>/g, ''))}</p>
      <div class="quote-src">Source: ${pains.quote_url ? `<a href="${pains.quote_url}">${e(pains.quote_source)}</a>` : e(pains.quote_source)}</div>
    </div>` : '';

  const findingsHTML = (diagnosis?.findings||[]).map((f,i) => `
    <div class="finding-card">
      <div class="finding-header"><span class="finding-num">${f.number||'0'+(i+1)}</span>${e(f.title)}</div>
      <div class="finding-cols">
        <div class="finding-col"><div class="finding-col-label evidence">EVIDENCE</div><p>${e(f.evidence)}</p>${(f.evidence_sources||[]).length>0?`<p style="margin-top:6px;font-size:.68rem">Sources: ${f.evidence_sources.map(s=>`<a href="${s.url}">${e(s.name)}</a>`).join(' · ')}</p>`:''}</div>
        <div class="finding-col"><div class="finding-col-label impact">${e(f.impact_type||"REVENUE IMPACT")}</div><p>${e(f.impact)}</p></div>
        <div class="finding-col"><div class="finding-col-label why">WHY NOT FIXED</div><p>${e(f.why_not_fixed)}</p></div>
      </div>
      ${f.tag?`<div class="finding-tag">${e(f.tag)}</div>`:''}
    </div>`).join("");

  const propsHTML = (proposals?.proposals||[]).map((p,i) => `
    <div class="prop-card">
      <div class="prop-phase">PHASE ${p.phase||i+1}</div>
      <div class="prop-title hd">${e(p.title)}</div>
      <div class="prop-grid">
        <div class="prop-cell"><div class="prop-cell-label problem">PROBLEM</div><p>${e(p.problem)}</p></div>
        <div class="prop-cell"><div class="prop-cell-label solution">SOLUTION</div><p>${e(p.solution)}</p></div>
        <div class="prop-cell"><div class="prop-cell-label how">HOW IT WORKS</div><p>${e(p.how_it_works)}</p></div>
        <div class="prop-cell"><div class="prop-cell-label target">TARGET · EFFORT · IMPACT</div><p>${e(p.target_effort_impact)}</p></div>
      </div>
    </div>`).join("");

  const aboutHTML = about ? `
    <div class="about-section">
      <div class="sec-label">04 — ABOUT</div>
      <div class="sec-h2" style="text-align:center">${e(about.headline)}</div>
      <div class="sec-h2" style="text-align:center"><span class="accent">${e(about.headline_accent)}</span></div>
      <div class="about-inner">
        <div class="about-stats">
          ${(about.stats||[]).slice(0,3).map(s=>`<div class="about-stat"><div class="about-stat-val hd">${e(s.value)}</div><div class="about-stat-label">${e(s.label)}</div></div>`).join("")}
        </div>
        <div class="about-cols">
          ${(about.columns||[]).slice(0,3).map(c=>`<div class="about-col"><h4>${e(c.skill)}</h4><p>${e(c.proof)}</p></div>`).join("")}
        </div>
      </div>
    </div>` : '';

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(company?.company)} ${auditLabel}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400;1,9..40,500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  *::-webkit-scrollbar{display:none}*{scrollbar-width:none}
  body,html{font-family:'Plus Jakarta Sans',sans-serif;background:#0f0e0c;color:#f0ede8}
  .hd{font-family:'DM Sans',sans-serif;font-weight:800}
  .accent{color:${ac}}

  /* PRINT BAR */
  .pb{position:sticky;top:0;z-index:100;background:#1a1916;padding:10px 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #2a2825}
  .pb button{background:${ac};color:white;border:none;padding:8px 18px;border-radius:6px;font-family:'DM Sans',sans-serif;font-weight:700;font-size:13px;cursor:pointer}

  /* HERO */
  .hero{min-height:60vh;display:flex;flex-direction:column;justify-content:flex-end;padding:40px 3rem 3rem;background:#0f0e0c;color:#f0ede8}
  .hero-label{font-size:.62rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8a8780;margin-bottom:1.2rem;display:flex;align-items:center;gap:.5rem}
  .hero-dot{width:8px;height:8px;background:${ac};display:inline-block}
  .hero h1{font-family:'DM Sans',sans-serif;font-weight:800;font-size:clamp(1.9rem,5.5vw,3.5rem);line-height:1.05;letter-spacing:-.03em;margin-bottom:.8rem;color:#f0ede8}
  .hero-sub{font-size:.83rem;color:#8a8780;max-width:540px;line-height:1.7;margin-bottom:2rem}
  .hero-bottom{display:flex;justify-content:space-between;align-items:flex-end}
  .scroll-label{font-size:.58rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8a8780}
  .hero-author{text-align:right}
  .hero-author strong{font-size:.83rem;display:block;color:#f0ede8}
  .hero-author span{font-size:.7rem;color:#8a8780}

  /* SECTIONS */
  .section{position:relative;padding:3rem 3rem}
  .section::before{content:'';position:absolute;top:0;left:3rem;right:3rem;height:1px;background:#2a2825}
  .sec-label{font-size:.62rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8a8780;margin-bottom:1.5rem}
  .sec-h2{font-family:'DM Sans',sans-serif;font-weight:800;font-size:clamp(1.6rem,3.5vw,2.5rem);line-height:1.05;letter-spacing:-.03em;margin-bottom:.4rem}
  .sec-intro{font-size:.83rem;color:#8a8780;max-width:560px;line-height:1.7;margin-bottom:2rem}

  /* STATS */
  .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #2a2825;border-radius:8px;overflow:hidden}
  .stat-cell{padding:1.2rem 1.4rem;border-right:1px solid #2a2825;border-bottom:1px solid #2a2825}
  .stat-cell:nth-child(4n){border-right:none}.stat-cell:nth-last-child(-n+4){border-bottom:none}
  .stat-val{font-family:'DM Sans',sans-serif;font-weight:800;font-size:clamp(1.2rem,2.5vw,1.6rem);margin-bottom:.25rem;color:#f0ede8}
  .stat-label{font-size:.62rem;font-weight:600;color:#8a8780;text-transform:uppercase;letter-spacing:.06em}
  .stat-delta{font-size:.6rem;color:${ac};margin-top:.2rem;font-weight:600;text-decoration:none;display:block}
  a.stat-delta{text-decoration:underline dotted;text-underline-offset:3px}

  /* QUOTE */
  .quote-block{border-left:3px solid ${ac};padding:1.2rem 1.5rem;margin-top:2rem;background:#1a1916;border-radius:0 8px 8px 0}
  .quote-label{font-size:.58rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${ac};margin-bottom:.6rem}
  .quote-block p{font-size:.83rem;font-style:italic;line-height:1.7;color:#f0ede8}
  .quote-src{font-size:.65rem;color:#8a8780;margin-top:.5rem;font-style:normal}
  .quote-src a{color:#8a8780;text-decoration:underline dotted;text-underline-offset:3px}

  /* FINDINGS */
  .finding-card{border:1px solid #2a2825;border-radius:8px;overflow:hidden;margin-bottom:1.5rem}
  .finding-header{padding:1.2rem 1.5rem;font-family:'DM Sans',sans-serif;font-weight:700;font-size:.9rem;display:flex;gap:.6rem;align-items:center;color:#f0ede8}
  .finding-num{color:#8a8780;font-weight:600}
  .finding-cols{display:grid;grid-template-columns:repeat(3,1fr)}
  .finding-col{padding:1rem 1.5rem;border-right:1px solid #2a2825;border-top:1px solid #2a2825}
  .finding-col:last-child{border-right:none}
  .finding-col-label{font-size:.58rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:.5rem}
  .finding-col-label.evidence{color:#f0ede8}.finding-col-label.impact{color:${ac}}.finding-col-label.why{color:#f0ede8}
  .finding-col p{font-size:.78rem;line-height:1.55;color:#8a8780}
  .finding-col a{color:#8a8780;text-decoration:underline dotted;text-underline-offset:3px}
  .finding-tag{display:inline-block;padding:.25rem .7rem;font-size:.56rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border:1px solid #2a2825;border-radius:4px;margin:0 1.5rem 1rem;color:#8a8780}

  /* PROPOSALS */
  .prop-card{margin-bottom:2.5rem}
  .prop-phase{font-size:.62rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${ac};margin-bottom:.5rem}
  .prop-title{font-family:'DM Sans',sans-serif;font-weight:800;font-size:1.1rem;margin-bottom:1rem;color:#f0ede8}
  .prop-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #2a2825;border-radius:8px;overflow:hidden}
  .prop-cell{padding:1rem 1.5rem;border-right:1px solid #2a2825;border-bottom:1px solid #2a2825}
  .prop-cell:nth-child(2n){border-right:none}.prop-cell:nth-last-child(-n+2){border-bottom:none}
  .prop-cell-label{font-size:.58rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:.4rem}
  .prop-cell-label.problem{color:${ac}}.prop-cell-label.solution{color:#f0ede8}.prop-cell-label.how{color:${ac}}.prop-cell-label.target{color:#f0ede8}
  .prop-cell p{font-size:.78rem;line-height:1.55;color:#8a8780}

  /* ABOUT */
  .about-section{position:relative;padding:3rem;text-align:center;background:#0f0e0c;color:#f0ede8}
  .about-section::before{content:'';position:absolute;top:0;left:3rem;right:3rem;height:1px;background:#2a2825}
  .about-section .sec-label{color:#8a8780}
  .about-section .sec-h2{color:#f0ede8}
  .about-inner{max-width:700px;margin:0 auto}
  .about-stats{display:grid;grid-template-columns:repeat(3,1fr);margin:2rem 0;border:1px solid #2a2825;border-radius:8px;overflow:hidden}
  .about-stat{padding:1.5rem;border-right:1px solid #2a2825;text-align:center}
  .about-stat:last-child{border-right:none}
  .about-stat-val{font-family:'DM Sans',sans-serif;font-weight:800;font-size:clamp(1.3rem,3vw,1.8rem);margin-bottom:.3rem;color:#f0ede8}
  .about-stat-label{font-size:.56rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8a8780}
  .about-cols{display:grid;grid-template-columns:repeat(3,1fr);margin:2rem 0;gap:2rem;text-align:center}
  .about-col h4{font-family:'DM Sans',sans-serif;font-weight:800;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:.6rem;color:#f0ede8;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .about-col p{font-size:.75rem;line-height:1.7;color:#8a8780}
  .about-link{font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${ac};text-decoration:none;display:inline-block;margin-top:1.5rem}

  /* FOOTER */
  .footer{padding:2rem 3rem;text-align:center;font-size:.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8a8780;border-top:1px solid #2a2825}
  .footer a{color:${ac};text-decoration:none}

  /* PRINT */
  @media print{
    .pb{display:none!important}
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    @page{margin:0.6in 0.35in 0.35in 0.35in;size:A4}
    .hero{min-height:auto;padding:40px 2rem 2rem}
    .section,.about-section{padding:2rem}
    .section::before,.about-section::before{left:2rem;right:2rem}
    .no-break{page-break-inside:avoid;break-inside:avoid}
    .page-break{page-break-before:always;break-before:always}
    .finding-card{page-break-inside:avoid;break-inside:avoid}
    .prop-card{page-break-inside:avoid;break-inside:avoid}
    .about-section{page-break-inside:avoid;break-inside:avoid}
    .quote-block{page-break-inside:avoid;break-inside:avoid}
    .stats-grid{page-break-inside:avoid;break-inside:avoid;overflow:visible}
    .stat-cell{padding:0.8rem 1rem}
    .stat-val{font-size:14px!important;white-space:normal!important}
    .stat-label{font-size:9px!important}
    .stat-delta{font-size:8px!important}
  }
</style>
</head><body>
<div class="pb">
  <button onclick="window.print()">Save as PDF</button>
</div>
<!-- HERO -->
<section class="hero">
  <div class="hero-label"><span class="hero-dot"></span>${auditLabel} \u2014 MARCH 2026</div>
  <h1>${headlineHTML}</h1>
  <p class="hero-sub">${e(diagnosis?.sub)}</p>
  <div class="hero-bottom">
    <span class="scroll-label"></span>
    <div class="hero-author"><strong>${e(cv?.name)}</strong><span>${e(roleCtx?.role_type || company?.role || "")}</span></div>
  </div>
</section>

<!-- RESEARCH -->
<section class="section no-break">
  <div class="sec-label">01 \u2014 RESEARCH</div>
  <div class="sec-h2">The numbers.</div>
  ${company?.competitors?.length>0?`<div class="sec-h2"><span class="accent">vs. ${e(company.competitors.join(', '))}.</span></div>`:''}
  <div class="stats-grid" style="margin-top:1.5rem">${statsHTML}</div>
  ${quoteHTML}
</section>

<!-- DIAGNOSIS -->
<section class="section page-break">
  <div class="sec-label">02 \u2014 DIAGNOSIS</div>
  <div class="sec-h2">${(diagnosis?.findings||[]).length} findings.</div>
  <div class="sec-h2"><span class="accent">And why the team hasn't fixed them.</span></div>
  <p class="sec-intro">These gaps aren't failures \u2014 they're the predictable output of a team correctly prioritizing other things.</p>
  ${findingsHTML}
</section>

<!-- PROPOSALS -->
<section class="section page-break">
  <div class="sec-label">03 \u2014 PROPOSALS</div>
  <div class="sec-h2">${propHeadlineHTML}</div>
  ${proposals?.sub?`<p class="sec-intro">${e(proposals.sub)}</p>`:''}
  ${propsHTML}
</section>

<!-- ABOUT -->
${aboutHTML}

<!-- FOOTER -->
<div class="footer">
  BUILT FOR ${e(company?.company).toUpperCase()} \u2014 APPLYING FOR <a href="${company?.role_url||''}">${e(company?.role).toUpperCase()}</a>
</div>
</body></html>`;
  return html;
}

function downloadPDF(data) {
  const html = generatePDFHTML(data);
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("Please allow popups to download the PDF.");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  // Auto-trigger print once fonts and content are loaded
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.print();
    }, 600);
  };
}

/* ═══════════════════ MAIN APP ═══════════════════ */
export default function App() {
  const [stage, setStage] = useState("input");
  const dark = true;
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
  const [showProfile, setShowProfile] = useState(false); // kept for compat
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [purchasedCredits, setPurchasedCredits] = useState(0);
  const [paymentLoading, setPaymentLoading] = useState(null); // priceId being purchased
  const FREE_LIMIT = 2;

  // Get auth user
  const [user, setUser] = useState(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data?.user || null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

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

  // Load purchased credits
  useEffect(() => {
    if (!user) return;
    supabase.from("purchases").select("credits").eq("user_id", user.id)
      .then(({ data }) => {
        const total = (data || []).reduce((sum, p) => sum + (p.credits || 0), 0);
        setPurchasedCredits(total);
      });
  }, [user]);

  // Verify payment on return from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const payment = params.get("payment");
    if (payment === "success" && sessionId && user) {
      supabase.functions.invoke("verify-payment", { body: { sessionId } })
        .then(({ data }) => {
          if (data?.success && !data?.already_recorded) {
            setPurchasedCredits(prev => prev + (data.credits || 0));
          }
          // Clean URL
          window.history.replaceState({}, "", window.location.pathname);
        });
    } else if (payment === "canceled") {
      window.history.replaceState({}, "", window.location.pathname);
    }
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
  const totalLimit = FREE_LIMIT + purchasedCredits;
  // Block if EITHER account limit OR device limit is reached (device limit only applies to free tier)
  const atLimit = !isWhitelisted && (auditCount >= totalLimit || (purchasedCredits === 0 && deviceAuditCount >= FREE_LIMIT));

  const submitFeedback = async () => {
    if (!feedbackText.trim() || !user) return;
    setFeedbackSending(true);
    await supabase.from("feedback").insert({ user_id: user.id, message: feedbackText.trim() });
    setFeedbackSending(false);
    setFeedbackSent(true);
    setFeedbackText("");
    setTimeout(() => { setShowFeedback(false); setFeedbackSent(false); }, 1800);
  };


  const loadAudit = async (auditId) => {
    const { data } = await supabase
      .from("audits")
      .select("audit_data")
      .eq("id", auditId)
      .single();
    if (data?.audit_data) {
      setData(data.audit_data);
      setStage("hub");
      setShowHistory(false);
    }
  };

  // Save audit to DB + upload PDF
  const [shareUrl, setShareUrl] = useState(null);
  const [copied, setCopied] = useState(false);

  const saveAudit = async (auditData, durationSecs) => {
    if (!user) return;
    try {
      // Generate slug via DB function
      const { data: slugData } = await supabase.rpc("generate_audit_slug", {
        p_user_id: user.id,
        p_company: auditData.company?.company || "audit",
      });
      const slug = slugData || (auditData.company?.company || "audit").replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();

      // Get username
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .single();

      // Generate PDF HTML blob
      const pdfHtml = generatePDFHTML(auditData);
      const blob = new Blob([pdfHtml], { type: "text/html" });
      const fileName = `${user.id}/${slug}.html`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from("audit-pdfs")
        .upload(fileName, blob, { contentType: "text/html" });

      const pdfPath = uploadError ? null : fileName;

      // Save to audits table
      const { data: auditRow } = await supabase.from("audits").insert({
        user_id: user.id,
        company_name: auditData.company?.company || "Unknown",
        role_name: auditData.company?.role || "",
        audit_label: auditData.roleCtx?.audit_label || "Product Audit",
        accent_color: auditData.accent || "#8a9a8a",
        job_link: jobLink,
        audit_data: auditData,
        pdf_path: pdfPath,
        slug,
        is_published: true,
        duration_seconds: durationSecs || null,
      }).select("id").single();

      // Record device fingerprint for anti-abuse tracking
      if (auditRow?.id && deviceFp) {
        await supabase.from("device_fingerprints").insert({
          fingerprint_id: deviceFp,
          user_id: user.id,
          audit_id: auditRow.id,
        });
        // Update local device count
        setDeviceAuditCount(prev => prev + 1);
      }

      // Set shareable URL
      if (profile?.username) {
        setShareUrl(`${window.location.origin}/a/${profile.username}/${slug}`);
      }

      loadHistory();
    } catch (err) {
      console.error("Failed to save audit:", err);
    }
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
      const { data: rows } = await supabase
        .from("audits")
        .select("duration_seconds")
        .not("duration_seconds", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);
      if (rows?.length >= 3) {
        const avg = Math.round(rows.reduce((s, r) => s + r.duration_seconds, 0) / rows.length);
        if (avg > 60 && avg < 600) setAvgDuration(avg);
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
    if (atLimit) { setShowPaywall(true); return; }
    setStage("processing");
    setStepStatus(STEPS.map(() => "pending"));
    setError(null);

    const SYS = "Return ONLY valid JSON. No markdown fences, no explanation, no preamble. Raw JSON only. NEVER use em-dashes (—) in any text. Use commas, periods, or semicolons instead.";

    try {
      /* ══ Stage 1: Parse CV (Haiku — structured extraction, no reasoning needed) ══ */
      up(0, "active");
      const cv = safeParse(extractText(await callClaudeWithRetry([{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: cvBase64 } },
          { type: "text", text: `Extract from this CV as JSON: {"name":"string","current_role":"string","years_exp":number,"skills":["top 8"],"achievements":[{"metric":"string","context":"string"}],"education":"string","companies":[{"name":"string","role":"string","highlights":["string"]}],"summary":"2 sentence professional summary"}` }
        ],
      }], { system: SYS, model: HAIKU, max_tokens: 1500 }))) || { name: "Candidate", skills: [], achievements: [], companies: [] };
      up(0, "done");

      /* ══ Stage 2: Classifier (Haiku) + Company+Pains merged (Sonnet+search) — PARALLEL ══ */
      up(1, "active");
      const [roleCtxRaw, companyPainsRaw] = await Promise.all([
        callClaudeWithRetry([{
          role: "user",
          content: `Classify this role for a job audit tool.
JOB: ${jobLink}
CANDIDATE: ${cv.summary || ""}, skills: ${(cv.skills||[]).join(", ")}

DOMAINS:
tech_product|PM,Growth,UX|User complaints,product gaps|Reddit,G2,Trustpilot,ProductHunt|Product-layer gaps|Product interventions|REVENUE,RETENTION,GROWTH|Product demos|Why I'm the right PM|Direct product critique OK. NEVER attack team culture.
marketing_brand|Brand Mgr,CMO,Marketing|Consumer sentiment,market share,positioning|Social listening,Euromonitor,Nielsen,ad libraries|Brand positioning weaknesses|Brand initiatives|MARKET SHARE,BRAND EQUITY,CONVERSION|Campaign simulators|Why I'm the right Brand Strategist|Frame as market opportunity, not marketing team failure.
finance_corporate|FP&A,IB,Treasury|Margins,capital allocation,analyst concerns|SEC filings,earnings calls,Sacra,PitchBook|Financial performance gaps|Financial recommendations|MARGIN,SHAREHOLDER VALUE,CASH FLOW|Financial model simulators|Why I'm the right Financial Strategist|Factual analyst-level objectivity. Never blame management.
consulting_strategy|Strategy,Corp Dev,CoS|Client industry challenges,competitive positioning|Annual reports,investor decks,industry reports|Client challenges firm can address|Strategic initiatives|COMPETITIVE,MARKET POSITION,STRATEGIC VALUE|Market analyzers|Why I'm the right Strategy Lead|Frame as market opportunity. NEVER critique internal culture. NEVER Glassdoor.
sales_commercial|AE,VP Sales,RevOps|Pipeline friction,win rates,competitive displacement|G2,Gartner,Capterra,competitor pricing|Commercial opportunity gaps|Commercial plays|PIPELINE,WIN RATE,REVENUE|Deal analyzers|Why I'm the right Commercial Lead|Frame as untapped revenue. Never bash sales team.
operations_supply_chain|Ops Mgr,Procurement,COO|External supply chain risks,logistics costs|Supply Chain Dive,industry reports,ESG reports|External risks creating opportunities|Operational improvements|COST,EFFICIENCY,RESILIENCE|Supply chain simulators|Why I'm the right Operations Lead|Frame as external market forces. Never blame ops team.
hr_people|HR,Talent,DEI,L&D|Talent market trends,employer brand benchmarking|LinkedIn talent flow,Universum,Glassdoor aggregate ratings|Talent market challenges|People strategy initiatives|ATTRITION,EMPLOYER BRAND,CAPABILITY|Talent analyzers|Why I'm the right People Strategist|Frame as talent market opportunity. NEVER individual angry reviews or profanity.
engineering_technical|EM,CTO,Staff Eng|Tech ecosystem trends,developer experience|GitHub,Stack Overflow,HackerNews,eng blogs|Technology trends creating opportunities|Technical improvements|VELOCITY,RELIABILITY,DEV EXPERIENCE|Code analyzers|Why I'm the right Engineering Lead|Frame as engineering opportunity with benchmarks. Never angry Glassdoor reviews.
data_analytics|Data Scientist,BI Lead,ML Eng|Data maturity benchmarking|Job postings,eng blogs,industry maturity models|Data maturity gaps vs leaders|Data strategy initiatives|DECISION SPEED,DATA QUALITY,ADOPTION|Data quality tools|Why I'm the right Data Lead|Frame as maturity journey, not infrastructure criticism.
entrepreneurship_venture|VC Analyst,Founder,EIR|Market sizing,competitive landscape,unit economics|Crunchbase,PitchBook,a16z,YC data|Market opportunity gaps|Venture strategy|MARKET OPPORTUNITY,UNIT ECONOMICS,FUNDRAISING|Market calculators|Why I'm the right Venture Strategist|Frame as market insight. Never criticize fund performance.
real_estate_hospitality|RE Analyst,Hotel Mgmt|Market cycles,occupancy,competitive set|STR,CoStar,CBRE,TripAdvisor|Market conditions creating opportunities|Asset strategy|NOI,OCCUPANCY,ASSET VALUE|RevPAR simulators|Why I'm the right Asset Strategist|Frame as market cycle opportunity.
healthcare_pharma|Pharma Commercial,MedTech PM|Regulatory pipeline,market access,payer dynamics|FDA,ClinicalTrials.gov,PubMed,healthcare press|Market access challenges|Commercial strategy|MARKET ACCESS,PATIENT REACH,REVENUE|Market access simulators|Why I'm the right Healthcare Strategist|Patient-centric framing only. Never internal compliance criticism.
sustainability_impact|ESG Analyst,CSR Lead|Peer ESG benchmarking,regulatory readiness|CDP,MSCI,sustainability reports,SASB|ESG gaps vs peers and regulation|Sustainability improvements|ESG SCORE,REGULATORY RISK,STAKEHOLDER TRUST|ESG benchmark tools|Why I'm the right Sustainability Strategist|Constructive benchmarking only. NEVER greenwashing accusations.

FORMAT: domain|roles|research_focus|sources|diagnosis_frame|proposal_frame|impacts(3)|prototypes|about_title|tone_rule

GLOBAL: Never profanity. Never attack internal culture. Always frame as opportunity. Field signal quotes must be professional.

Return JSON: {"domain":"string","role_type":"string","audit_label":"Provocative specific title like 'Pipeline Conversion Audit'. NEVER generic like 'Market Analysis'.","diagnosis_frame":"string","diagnosis_tone":"string","pain_source":"string","field_signal_rule":"string","proposal_frame":"string","proposal_constraint":"string","impact_types":["3"],"about_title":"string","prototype_frame":"string"}`
        }], { system: SYS + " Match job to closest domain. Be specific.", model: HAIKU, max_tokens: 800, tools: WEB_SEARCH }),

        callClaudeWithRetry([{
          role: "user",
          content: `Research this company AND find real user/market complaints in one pass.
JOB: ${jobLink}

Return JSON with TWO top-level keys:
{"company":{"company":"string","role":"string","role_url":"${jobLink}","company_desc":"1 sentence","product_desc":"1 sentence","competitors":["3 names"],"funding":"string","valuation":"string","team_size":"string","accent_color":"hex brand color","stats":[8 items: {"value":"Max 3 words","label":"max 3 words uppercase","delta":"max 5 words or empty","source_url":"REQUIRED real URL"}]},
"pains":{"pain_points":[{"issue":"string","source_url":"real URL"}],"key_quote":"MAX 2 sentences under 40 words. Professional tone, no profanity.","quote_source":"source name","quote_url":"real URL"}}`
        }], { system: SYS + " Use web search extensively. Stats: exactly 8, all with source_url. No filler stats. Also search for real user complaints, reviews, and market friction points for this company. Include real source URLs for everything.", max_tokens: 3000, tools: WEB_SEARCH })
      ]);

      const roleCtx = safeParse(extractText(roleCtxRaw)) || {
        domain: "tech_product", audit_label: "Product Audit", diagnosis_frame: "product-layer gaps",
        diagnosis_tone: "Direct critique of the product from user perspective.",
        pain_source: "Reddit, Trustpilot, G2, App Store reviews, X/Twitter, ProductHunt",
        field_signal_rule: "Real user complaints. Never inflammatory about team or culture.",
        proposal_frame: "product interventions", proposal_constraint: "All product-layer. None require model work.",
        impact_types: ["REVENUE IMPACT", "RETENTION IMPACT", "GROWTH IMPACT"],
        about_title: "Why I'm the right PM", prototype_frame: "Claude API product demos"
      };

      const companyPains = safeParse(extractText(companyPainsRaw)) || {};
      const company = companyPains.company || { company: "Company", role: "Role", stats: [], accent_color: "#8a9a8a" };
      const pains = companyPains.pains || { pain_points: [], key_quote: "" };
      const accent = safeAccent(company.accent_color) || "#8a9a8a";
      up(1, "done");

      /* ══ Stage 3: Diagnosis (Sonnet — needs reasoning) ══ */
      up(2, "active");
      const personalCtx = personal ? `\nCandidate insight: "${personal}"` : "";
      const companyBrief = { company: company.company, product_desc: company.product_desc, competitors: company.competitors };
      let diagnosis = safeParse(extractText(await callClaudeWithRetry([{
        role: "user",
        content: `Diagnose ${company.company}:
COMPANY: ${JSON.stringify(companyBrief)}
PAINS: ${JSON.stringify(pains.pain_points?.slice(0,5))}
DOMAIN: ${roleCtx.domain || "tech_product"}
FRAME: ${roleCtx.diagnosis_frame || "product-layer gaps"}
TONE: ${roleCtx.diagnosis_tone || "Frame as opportunity."}${personalCtx}

Return JSON:
{"headline":"EXACTLY 2 lines separated by \\n. Line 1: key stat, MAX 7 words. Line 2: opportunity, MAX 7 words. 14 words max total.",
"sub":"1 sentence, max 20 words",
"findings":[3 items: {"number":"01","title":"max 8 words","evidence":"max 35 words","evidence_sources":[{"name":"string","url":"real https:// URL"}],"impact_type":"one of: ${(roleCtx.impact_types || ["REVENUE IMPACT","RETENTION IMPACT","GROWTH IMPACT"]).join(", ")}","impact":"max 25 words. MUST include specific number or percentage.","why_not_fixed":"max 35 words. They made the right call given X, Y is opportunity.","tag":"MAX 2 WORDS"}]}`
      }], { system: SYS + ` CRITICAL OBJECTIVITY RULE: Findings must describe company or market problems observable from public data and user complaints. Never build findings around the candidate's specific background, skills, or industry experience. A good test: could any smart analyst identify this problem without knowing who the candidate is? If not, it is not a real finding. Never reference the candidate in diagnosis findings. 3 findings. ${roleCtx.diagnosis_tone || "Frame as opportunity."}. NEVER attack culture or leadership.`, max_tokens: 2500 }))) || { headline: "", findings: [] };
      up(2, "done");

      /* ══ Stage 4: Proposals (Sonnet — needs reasoning + seniority awareness) ══ */
      up(3, "active");
      const findingsBrief = (diagnosis.findings || []).map(f => ({ title: f.title, tag: f.tag, impact_type: f.impact_type }));
      let proposals = safeParse(extractText(await callClaudeWithRetry([{
        role: "user",
        content: `Proposals for ${company.company}:
FINDINGS: ${JSON.stringify(findingsBrief)}
DOMAIN: ${roleCtx.domain || "tech_product"}
ROLE: ${company.role || roleCtx.role_type || ""}

3 phased ${roleCtx.proposal_frame || "product interventions"}. Return JSON:
{"headline":"2 lines with \\n. Line 1: max 5 words. Line 2: constraint, max 8 words.",
"sub":"max 25 words",
"proposals":[{"phase":1,"title":"max 8 words","problem":"max 25 words","solution":"max 25 words","how_it_works":"max 25 words","target_effort_impact":"Target: metric · Effort: level · Impact: level"}]}`
      }], { system: SYS + ` 90-DAY ACTION PLAN RULE: Every proposal must describe a specific action the candidate would execute in their first 90 days. Use concrete verbs: launch, partner, build, deploy, pitch, create, host. NEVER use abstract language like: playbook, framework, system, engine, methodology, enablement, leverage, optimize. Proposals should read like 90-day plan entries, not consulting deliverables. BROAD MARKET RULE: Proposals must solve the diagnosed problems for the ENTIRE target customer segment described in the job posting, not just the candidate's specific niche. If the role targets 'startups' broadly, proposals must work for any startup (SaaS, AI-native, e-commerce, fintech), not only the candidate's industry vertical. The candidate's background appears in the About section to show credibility. It should NOT narrow the proposals to one vertical. 3 proposals. ${roleCtx.proposal_frame || "Product interventions"}. SENIORITY: "${company.role || ""}". Junior roles = "analysis I'd contribute". Senior = ambitious.`, max_tokens: 2500 }))) || { proposals: [] };
      up(3, "done");

      /* ══ Stage 5: Prototypes (Haiku, conditional) + About (Sonnet) + Contacts (Haiku+search) — PARALLEL ══ */
      const showProtos = PROTO_DOMAINS.includes(roleCtx.domain);
      if (!showProtos) up(4, "done");
      if (showProtos) up(4, "active");
      up(5, "active");
      up(6, "active");

      const parallelCalls = [];
      if (showProtos) {
        const proposalTitles = (proposals.proposals || []).map(p => ({ phase: p.phase, title: p.title }));
        parallelCalls.push(callClaudeWithRetry([{
          role: "user",
          content: `Design 3 prototype concepts for ${company.company}:
PROPOSALS: ${JSON.stringify(proposalTitles)}
DOMAIN: ${roleCtx.domain || "tech_product"}

Return JSON: {"prototypes":[{"phase":1,"title":"Phase 1 — Name","description":"1 sentence","input_label":"LABEL","placeholder":"example","button_label":"VERB →","hint":"1 sentence","system_prompt":"prompt for Claude API","fallback":"example output"}]}`
        }], { system: SYS + " Functional prototypes. Clear system prompts.", model: HAIKU, max_tokens: 2000 }));
      } else {
        parallelCalls.push(Promise.resolve(null));
      }

      const proposalBrief = (proposals.proposals || []).map(p => ({ phase: p.phase, title: p.title, problem: p.problem }));
      parallelCalls.push(
        callClaudeWithRetry([{
          role: "user",
          content: `Match candidate to proposals:
CANDIDATE: ${JSON.stringify({ name: cv.name, achievements: cv.achievements?.slice(0,4), companies: cv.companies?.map(c => ({ name: c.name, role: c.role })) })}
PROPOSALS: ${JSON.stringify(proposalBrief)}
COMPANY: ${company.company}, ROLE: ${company.role}

Return JSON:
{"headline":"${roleCtx.about_title || "Why I'm the right PM"}","headline_accent":"max 6 words","stats":[3: {"value":"string","label":"SHORT LABEL"}],"columns":[3: {"skill":"2 WORDS UPPERCASE","proof":"Max 30 words. Ties skill to proposal."}]}`
        }], { system: SYS + ` HEADLINE RULE: The headline field must be 12 words maximum. Write it as a punchy title, not a sentence. Good: "Why I'm the Right AE for EMEA Startup Growth". Bad: "You are positioned as a founder-credible bridge who speaks technical architecture and commercial velocity simultaneously". Never start with "You're" or "You are". 3 stats, 3 columns. Most relevant numbers for ${roleCtx.role_type || "role"}.`, max_tokens: 1500 }),

        callClaudeWithRetry([{
          role: "user",
          content: `Find 3 LinkedIn profiles at ${company.company} for hiring "${company.role}". VP/Director level + recruiters. Return JSON: [{"name":"string","title":"string","url":"linkedin URL","why":"1 sentence"}]`
        }], { system: SYS + " Real LinkedIn URLs from search.", model: HAIKU, max_tokens: 800, tools: WEB_SEARCH })
      );

      const [protosRaw, aboutRaw, contactsRaw] = await Promise.all(parallelCalls);

      let prototypes = { prototypes: [] };
      if (showProtos && protosRaw) {
        const rawProtos = safeParse(extractText(protosRaw));
        prototypes = { prototypes: Array.isArray(rawProtos) ? rawProtos : (rawProtos?.prototypes || []) };
        if (prototypes.prototypes.length === 0) {
          prototypes.prototypes = (proposals.proposals || []).map((p, i) => ({
            phase: i + 1,
            title: `Phase ${i + 1} — ${p.title}`,
            description: `Interactive demo for: ${p.title}`,
            input_label: "DESCRIBE YOUR USE CASE",
            placeholder: "e.g. a typical scenario...",
            button_label: "ANALYZE →",
            hint: "This would appear as a feature within the product.",
            system_prompt: `You are an analysis tool for ${company.company}. The user is testing "${p.title}". Provide: 1) Current State, 2) Proposed Change, 3) Expected Impact.`,
            fallback: `[Demo] ${p.title}: This prototype would analyze your input and show impact.`
          }));
        }
      }
      if (showProtos) up(4, "done");

      let about = safeParse(extractText(aboutRaw)) || { stats: [], columns: [] };
      up(5, "done");

      let contacts = safeParse(extractText(contactsRaw)) || [];
      up(6, "done");

      /* ══ Validation Gate: retry any section with missing critical data ══ */
      const missingSections = validateSections({ company, diagnosis, proposals, about, contacts });
      if (missingSections.length > 0) {
        console.warn("Validation gate: missing sections, retrying:", missingSections);
        for (const section of missingSections) {
          try {
            if (section === "about") {
              const retryAbout = await callClaudeWithRetry([{
                role: "user",
                content: `Match candidate to proposals:
CANDIDATE: ${JSON.stringify({ name: cv.name, achievements: cv.achievements?.slice(0,4), companies: cv.companies?.map(c => ({ name: c.name, role: c.role })) })}
PROPOSALS: ${JSON.stringify((proposals.proposals || []).map(p => ({ phase: p.phase, title: p.title, problem: p.problem })))}
COMPANY: ${company.company}, ROLE: ${company.role}

Return JSON:
{"headline":"${roleCtx.about_title || "Why I'm the right PM"}","headline_accent":"max 6 words","stats":[3: {"value":"string","label":"SHORT LABEL"}],"columns":[3: {"skill":"2 WORDS UPPERCASE","proof":"Max 30 words. Ties skill to proposal."}]}`
              }], { system: SYS + ` HEADLINE RULE: The headline field must be 12 words maximum. Write it as a punchy title, not a sentence. Good: "Why I'm the Right AE for EMEA Startup Growth". Bad: "You are positioned as a founder-credible bridge who speaks technical architecture and commercial velocity simultaneously". Never start with "You're" or "You are". 3 stats, 3 columns. Most relevant numbers for ${roleCtx.role_type || "role"}.`, max_tokens: 1500 });
              about = safeParse(extractText(retryAbout)) || about;
            }
            if (section === "contacts") {
              const retryContacts = await callClaudeWithRetry([{
                role: "user",
                content: `Find 3 LinkedIn profiles at ${company.company} for hiring "${company.role}". VP/Director level + recruiters. Return JSON: [{"name":"string","title":"string","url":"linkedin URL","why":"1 sentence"}]`
              }], { system: SYS + " Real LinkedIn URLs from search.", model: HAIKU, max_tokens: 800, tools: WEB_SEARCH });
              contacts = safeParse(extractText(retryContacts)) || contacts;
            }
            if (section === "diagnosis") {
              const retryDiag = await callClaudeWithRetry([{
                role: "user",
                content: `Diagnose ${company.company}:
COMPANY: ${JSON.stringify({ company: company.company, product_desc: company.product_desc, competitors: company.competitors })}
PAINS: ${JSON.stringify(pains.pain_points?.slice(0,5))}
DOMAIN: ${roleCtx.domain || "tech_product"}
FRAME: ${roleCtx.diagnosis_frame || "product-layer gaps"}
TONE: ${roleCtx.diagnosis_tone || "Frame as opportunity."}

Return JSON:
{"headline":"EXACTLY 2 lines separated by \\n. Line 1: key stat, MAX 7 words. Line 2: opportunity, MAX 7 words.",
"sub":"1 sentence, max 20 words",
"findings":[3 items: {"number":"01","title":"max 8 words","evidence":"max 35 words","evidence_sources":[{"name":"string","url":"real https:// URL"}],"impact_type":"one of: ${(roleCtx.impact_types || ["REVENUE IMPACT","RETENTION IMPACT","GROWTH IMPACT"]).join(", ")}","impact":"max 25 words.","why_not_fixed":"max 35 words.","tag":"MAX 2 WORDS"}]}`
              }], { system: SYS + ` CRITICAL OBJECTIVITY RULE: Findings must describe company or market problems observable from public data and user complaints. Never build findings around the candidate's specific background, skills, or industry experience. A good test: could any smart analyst identify this problem without knowing who the candidate is? If not, it is not a real finding. Never reference the candidate in diagnosis findings. 3 findings. ${roleCtx.diagnosis_tone || "Frame as opportunity."}.`, max_tokens: 2500 });
              diagnosis = safeParse(extractText(retryDiag)) || diagnosis;
            }
            if (section === "proposals") {
              const retryProps = await callClaudeWithRetry([{
                role: "user",
                content: `Proposals for ${company.company}:
FINDINGS: ${JSON.stringify((diagnosis.findings || []).map(f => ({ title: f.title, tag: f.tag, impact_type: f.impact_type })))}
DOMAIN: ${roleCtx.domain || "tech_product"}
ROLE: ${company.role || roleCtx.role_type || ""}

3 phased ${roleCtx.proposal_frame || "product interventions"}. Return JSON:
{"headline":"2 lines with \\n. Line 1: max 5 words. Line 2: constraint, max 8 words.",
"sub":"max 25 words",
"proposals":[{"phase":1,"title":"max 8 words","problem":"max 25 words","solution":"max 25 words","how_it_works":"max 25 words","target_effort_impact":"Target: metric · Effort: level · Impact: level"}]}`
              }], { system: SYS + ` 90-DAY ACTION PLAN RULE: Every proposal must describe a specific action the candidate would execute in their first 90 days. Use concrete verbs: launch, partner, build, deploy, pitch, create, host. NEVER use abstract language like: playbook, framework, system, engine, methodology, enablement, leverage, optimize. Proposals should read like 90-day plan entries, not consulting deliverables. BROAD MARKET RULE: Proposals must solve the diagnosed problems for the ENTIRE target customer segment described in the job posting, not just the candidate's specific niche. If the role targets 'startups' broadly, proposals must work for any startup (SaaS, AI-native, e-commerce, fintech), not only the candidate's industry vertical. The candidate's background appears in the About section to show credibility. It should NOT narrow the proposals to one vertical. 3 proposals. ${roleCtx.proposal_frame || "Product interventions"}.`, max_tokens: 2500 });
              proposals = safeParse(extractText(retryProps)) || proposals;
            }
          } catch (retryErr) {
            console.warn(`Validation retry for ${section} failed:`, retryErr.message);
          }
        }
        const stillMissing = validateSections({ company, diagnosis, proposals, about, contacts });
        if (stillMissing.length > 0) {
          console.warn("Some sections still incomplete after retries:", stillMissing);
        }
      }

      const validated = validateOutput({ company, diagnosis, proposals, about });
      const finalData = { cv, company: validated.company, pains, diagnosis: validated.diagnosis, proposals: validated.proposals, prototypes, about: validated.about, contacts: Array.isArray(contacts) ? contacts : [], accent, roleCtx, showProtos };
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
  };

  const accent = safeAccent(data.accent) || "#8a9a8a";
  const showProtos = data.showProtos || false;
  const NAV_LINKS = showProtos
    ? ["research","diagnosis","proposals","prototypes","about"]
    : ["research","diagnosis","proposals","about"];
  const ABOUT_NUM = showProtos ? "05" : "04";
  const PROTO_NUM = "04";

  return (
    <>
      <style>{makeCSS(dark, accent)}</style>

      {/* ─── NAV ─── */}
      <div className="nav">
        <span className="nav-title" style={{ cursor: stage === "results" ? "pointer" : "default" }} onClick={() => stage === "results" && scrollTo("hero")}>
          {(stage === "results" || stage === "hub") ? `${data.company?.company || ""} ${data.roleCtx?.audit_label || "Product Audit"}` : "auditjob.me"}
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
                    <a
                      href={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/audit-pdfs/${a.pdf_path}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ fontSize: ".55rem", color: safeAccent(a.accent_color) || "#8a8780", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", textDecoration: "none" }}
                    >
                      PDF ↗
                    </a>
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
            {/* Audit counter — show usage vs total limit (free + purchased) */}
            <div style={{ marginBottom: 12 }}>
              {(() => {
                const displayCount = Math.max(auditCount, purchasedCredits === 0 ? deviceAuditCount : auditCount);
                const deviceExceeds = deviceAuditCount > auditCount && !isWhitelisted && purchasedCredits === 0;
                return (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: ".55rem", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#8a8780" }}>
                        {purchasedCredits > 0 ? "Audits" : "Free audits"}
                      </span>
                      <span style={{ fontSize: ".6rem", fontWeight: 700, color: atLimit ? "#e84c2b" : accent }}>
                        {displayCount}/{totalLimit}
                      </span>
                    </div>
                    <div style={{ width: "100%", height: 3, background: "#2a2825", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", background: atLimit ? "#e84c2b" : accent, width: `${Math.min((displayCount / totalLimit) * 100, 100)}%`, transition: "width .3s ease", borderRadius: 2 }} />
                    </div>
                    {deviceExceeds && (
                      <p style={{ fontSize: ".52rem", color: "#8a8780", marginTop: 5, letterSpacing: ".02em" }}>
                        Includes audits from another email
                      </p>
                    )}
                  </>
                );
              })()}
              {atLimit && (
                <button
                  onClick={() => { setShowPaywall(true); setShowHistory(false); }}
                  style={{ width: "100%", marginTop: 8, padding: "7px", borderRadius: 6, border: "none", background: accent, color: textOn(accent), fontSize: ".55rem", fontWeight: 700, cursor: "pointer", fontFamily: "'Plus Jakarta Sans',sans-serif", letterSpacing: ".08em", textTransform: "uppercase" }}
                >
                  Upgrade
                </button>
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
                onClick={async () => { await supabase.auth.signOut(); setShowHistory(false); }}
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
              <p className="input-sub">Upload. Paste. Stand out.</p>
            </Anim>

            {error && (
              <div style={{ padding: "12px 16px", borderRadius: 8, background: dark ? "rgba(220,38,38,.1)" : "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", marginBottom: 20, fontSize: ".8rem" }}>
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
                className={`gen-btn ${cvBase64 && jobLink.trim() ? "ready" : "disabled"}`}
                onClick={generate}
                disabled={!cvBase64 || !jobLink.trim()}
              >
                Generate Audit
              </button>
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
        <div style={{ paddingTop: 48, minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
                <button className="hub-btn" style={{ background: accent, color: textOn(accent) }} onClick={() => downloadPDF(data)}>
                  Download PDF
                </button>
                <button className="hub-btn" style={{ background: "transparent", color: "var(--text)", border: "1px solid var(--border)" }} onClick={() => setStage("results")}>
                  View Interactive Audit
                </button>
                {shareUrl && (
                  <button
                    className="hub-btn"
                    style={{ background: "transparent", color: accent, border: `1px solid ${accent}` }}
                    onClick={() => { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  >
                    {copied ? "✓ Copied!" : "Copy Share Link"}
                  </button>
                )}
              </div>
              {shareUrl && (
                <p style={{ fontSize: ".62rem", color: "var(--muted)", marginTop: 8, wordBreak: "break-all" }}>
                  🔗 <a href={shareUrl} target="_blank" rel="noopener noreferrer" style={{ color: accent, textDecoration: "none" }}>{shareUrl}</a>
                </p>
              )}
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
                {(data.roleCtx?.audit_label || "PRODUCT AUDIT").toUpperCase()} — MARCH 2026
              </div>
            </Anim>
            <Anim delay={0.4}>
              <h1 dangerouslySetInnerHTML={{ __html: (() => {
                const h = data.diagnosis?.headline || `Product Audit: ${data.company.company}`;
                const lines = h.split('\n').filter(Boolean);
                if (lines.length >= 2) return lines[0] + '<br/><span class="accent">' + lines.slice(1).join(' ') + '</span>';
                return h;
              })() }} />
            </Anim>
            <Anim delay={0.5}>
              <p className="hero-sub">{data.diagnosis?.sub || data.company.company_desc}</p>
            </Anim>
            <Anim delay={0.7}>
              <div className="hero-bottom">
                <span className="scroll-label">SCROLL ↓</span>
                <div className="hero-author">
                  <strong>{data.cv?.name || "Roberto Quintero"}</strong>
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
              <div className="sec-h2" dangerouslySetInnerHTML={{ __html: (() => {
                const h = data.proposals?.headline || `${data.proposals?.proposals?.length || 3} interventions.`;
                const lines = h.split('\n').filter(Boolean);
                if (lines.length >= 2) return lines[0] + '<br/><span class="accent">' + lines.slice(1).join(' ') + '</span>';
                return h;
              })() }} />
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

      {/* ─── PAYWALL MODAL ─── */}
      {showPaywall && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)" }} onClick={() => setShowPaywall(false)} />
          <div style={{ position: "relative", background: "#1a1916", border: "1px solid #2a2825", borderRadius: 10, padding: "32px 28px", width: "min(420px, 90vw)", animation: "fadeUp .25s ease" }}>
            <button onClick={() => setShowPaywall(false)} style={{ position: "absolute", top: 12, right: 14, background: "none", border: "none", color: "#8a8780", cursor: "pointer", fontSize: "1rem" }}>×</button>
            <p style={{ fontSize: ".62rem", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: accent, marginBottom: 12 }}>Upgrade</p>
            <h2 style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 800, fontSize: "1.4rem", color: "#f0ede8", lineHeight: 1.1, marginBottom: 8, letterSpacing: "-.02em" }}>
              You've used your<br/><span style={{ color: accent }}>free audits.</span>
            </h2>
            <p style={{ fontSize: ".78rem", color: "#8a8780", lineHeight: 1.6, marginBottom: 24 }}>
              Unlock unlimited audits and keep standing out.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
              <div style={{ padding: "16px", borderRadius: 8, border: `1px solid ${accent}`, background: "rgba(138,154,138,.06)", position: "relative" }}>
                <span style={{ position: "absolute", top: -8, right: 12, fontSize: ".5rem", fontWeight: 700, background: accent, color: textOn(accent), padding: "2px 8px", borderRadius: 4, letterSpacing: ".06em", textTransform: "uppercase" }}>Popular</span>
                <p style={{ fontSize: ".72rem", fontWeight: 700, color: "#f0ede8", marginBottom: 4 }}>Pro</p>
                <p style={{ fontSize: ".65rem", color: "#8a8780" }}>Unlimited audits · Priority generation</p>
                <button style={{ marginTop: 10, width: "100%", padding: "9px", borderRadius: 6, border: "none", background: accent, color: textOn(accent), fontSize: ".6rem", fontWeight: 700, cursor: "pointer", fontFamily: "'Plus Jakarta Sans',sans-serif", letterSpacing: ".1em", textTransform: "uppercase" }}>
                  Coming Soon
                </button>
              </div>
              <div style={{ padding: "16px", borderRadius: 8, border: "1px solid #2a2825" }}>
                <p style={{ fontSize: ".72rem", fontWeight: 700, color: "#f0ede8", marginBottom: 4 }}>Credit Packs</p>
                <p style={{ fontSize: ".65rem", color: "#8a8780" }}>Buy 5, 10, or 20 audits</p>
                <button style={{ marginTop: 10, width: "100%", padding: "9px", borderRadius: 6, border: "1px solid #2a2825", background: "transparent", color: "#f0ede8", fontSize: ".6rem", fontWeight: 700, cursor: "pointer", fontFamily: "'Plus Jakarta Sans',sans-serif", letterSpacing: ".1em", textTransform: "uppercase" }}>
                  Coming Soon
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
