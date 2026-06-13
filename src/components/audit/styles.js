/* ═══════════════════ CSS SYSTEM ═══════════════════ */
export function makeCSS(accent = "#8a9a8a") {
  const v = { bg: "#0f0e0c", surface: "#1a1916", text: "#f0ede8", muted: "#8a8780", border: "#2a2825", heroBg: "#0f0e0c" };
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
    .hero{min-height:100vh;display:flex;flex-direction:column;justify-content:flex-end;padding:0 clamp(1.2rem,4vw,3rem) clamp(2rem,4vw,3rem);background:var(--hero-bg);color:#f0ede8;position:relative}
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
    .step-row.active{border-color:var(--accent);background:rgba(232,76,43,.08)}
    .step-row.done{border-color:#2a3a2a;background:rgba(22,163,74,.06)}
    .step-row.pending{opacity:.4}
    .step-icon{font-size:1.1rem;width:24px;text-align:center}
    .step-text{font-size:.83rem;font-weight:500}
    .step-text.active{font-weight:700;color:var(--text)}
    .step-text.done{color:#16a34a}

    /* HUB */
    .hub{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 24px;text-align:center;min-height:calc(100vh - 48px)}
    .hub-title{font-family:'DM Sans',sans-serif;font-weight:400;font-size:clamp(1.8rem,4vw,2.8rem);line-height:1.1;letter-spacing:-.04em;margin-bottom:.6rem;color:var(--text)}
    .hub-sub{font-size:.75rem;color:var(--muted);max-width:380px;margin:0 auto 2.5rem;line-height:1.5;letter-spacing:.02em}
    .hub-actions{display:flex;flex-direction:column;gap:.8rem;align-items:center;margin-bottom:3rem;max-width:320px;margin-left:auto;margin-right:auto}
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
