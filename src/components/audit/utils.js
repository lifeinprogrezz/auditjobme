export function slugifyPersonName(value) {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getPublicAuditOwner(user, profile) {
  return slugifyPersonName(
    profile?.username ||
    profile?.display_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    ""
  );
}

/* Post-processing: fix common LLM output issues */
export function validateOutput(data) {
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

/* Light/dark text helper based on accent brightness */
export function textOn(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return (r*299 + g*587 + b*114) / 1000 > 150 ? "#0f0e0c" : "#f0ede8";
}

/* Color safety: prevent accent colors invisible on dark background */
export function safeAccent(hex) {
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
