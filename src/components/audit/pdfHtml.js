import { safeAccent } from "./utils.js";

/* ═══════════════════ PDF HTML GENERATOR ═══════════════════ */
export function generatePDFHTML(data) {
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
    @page{margin:0.4in 0.25in 0.25in 0.25in;size:A4}
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
  <div class="hero-label"><span class="hero-dot"></span>${auditLabel} \u2014 ${new Date().toLocaleString("en", { month: "long", year: "numeric" }).toUpperCase()}</div>
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
  <div style="margin-top:12px;font-size:.5rem;font-weight:400;letter-spacing:.08em;opacity:.5">MADE WITH AUDITJOB.ME</div>
</div>
</body></html>`;
  return html;
}

export function downloadPDF(data) {
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
