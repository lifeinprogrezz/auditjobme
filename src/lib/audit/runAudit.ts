// The company-audit pipeline (issue #159) — extracted from AuditGenerator.jsx so
// the Apply page and the standalone /audit route run the SAME seven stages.
//
// Nothing about the pipeline changed in the move: same models, same prompts, same
// parallelism, same validation gate and retries. Two things are parameters now
// rather than component state: where the CV comes from (a PDF the generator page
// uploads, or the CV text already on the user's profile when Apply runs it), and
// where stage progress goes (a callback, so each surface draws its own bar).
//
// The generator keeps its own page, its history and its publish control. Apply
// keeps one button and a PDF. Both call runAudit and neither owns a second copy.
import { safeAccent, validateOutput } from "@/components/audit/utils.js";
import { HAIKU, callClaudeWithRetry, validateSections, extractText, safeParse } from "@/components/audit/api.js";

/** The seven stages, in order. The labels are what the user reads while it runs.
 *  Stage 7 is named for what it produces (LOCKED decision 4, issue #159): the
 *  two or three people to reach out to are a headline feature, not a panel. */
export const AUDIT_STAGES = [
  "Parsing your CV",
  "Researching the company",
  "Building diagnosis",
  "Generating proposals",
  "Designing prototypes",
  "Matching your profile",
  "Finding the people to reach out to",
] as const;

export type AuditStageStatus = "pending" | "active" | "done";

const WEB_SEARCH = [{ type: "web_search_20250305", name: "web_search" }];

/* Domains that get interactive prototypes */
const PROTO_DOMAINS = ["tech_product", "engineering_technical", "data_analytics"];

/** Where the candidate's CV comes from. The generator page uploads a PDF; Apply
 *  hands over the CV text already on the profile, so nobody re-uploads anything. */
export type AuditCvSource = { pdfBase64: string } | { text: string };

export type AuditContact = { name?: string; title?: string; url?: string; why?: string };

/** The model-written shapes the pipeline passes between stages. Every field is
 *  optional: the stage that fills it can come back thin, and the validation gate
 *  below is what decides whether that is good enough to ship. */
export type AuditCvJson = { name?: string; summary?: string; skills?: string[]; achievements?: unknown[]; companies?: { name?: string; role?: string }[]; [k: string]: unknown };
export type AuditFinding = { title?: string; tag?: string; impact_type?: string; [k: string]: unknown };
export type AuditDiagnosis = { headline?: string; sub?: string; findings?: AuditFinding[]; [k: string]: unknown };
export type AuditProposal = { phase?: number; title?: string; problem?: string; [k: string]: unknown };
export type AuditProposals = { headline?: string; sub?: string; proposals?: AuditProposal[]; [k: string]: unknown };

/** The finished audit. Loosely shaped on purpose: every field below is model
 *  output that has been through validateOutput, and the renderers read it
 *  defensively (see pdfHtml.js). */
export type AuditData = {
  cv: AuditCvJson;
  company: Record<string, unknown> | null;
  pains: Record<string, unknown> | null;
  diagnosis: AuditDiagnosis;
  proposals: AuditProposals;
  prototypes: { prototypes: unknown[] };
  about: Record<string, unknown> | null;
  contacts: AuditContact[];
  accent: string;
  roleCtx: Record<string, unknown> | null;
  showProtos: boolean;
};

export type RunAuditInput = {
  cv: AuditCvSource;
  /** The job posting the audit is built around. */
  jobLink: string;
  /** The candidate's own note for this role. Never invented, never required. */
  personal?: string;
  /** Called as each stage opens and closes, so a surface can draw progress. */
  onStage?: (index: number, status: AuditStageStatus) => void;
};

/** Run the seven stages and return the finished audit. Throws on failure: the
 *  caller decides what the error looks like on its own page. */
export async function runAudit(input: RunAuditInput): Promise<AuditData> {
  const { jobLink, onStage } = input;
  const personal = input.personal || "";
  const up = (i: number, s: AuditStageStatus) => onStage?.(i, s);
  const cvContent =
    "pdfBase64" in input.cv
      ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.cv.pdfBase64 } }]
      : [{ type: "text", text: `CV:\n${input.cv.text}` }];

  const SYS = "Return ONLY valid JSON. No markdown fences, no explanation, no preamble. Raw JSON only. NEVER use em-dashes (—) in any text. Use commas, periods, or semicolons instead.";

      up(0, "active");
      const cv: AuditCvJson = safeParse(extractText(await callClaudeWithRetry([{
        role: "user",
        content: [
          ...cvContent,
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
      let diagnosis: AuditDiagnosis = safeParse(extractText(await callClaudeWithRetry([{
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
      let proposals: AuditProposals = safeParse(extractText(await callClaudeWithRetry([{
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

      let prototypes: { prototypes: unknown[] } = { prototypes: [] };
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
            console.warn(`Validation retry for ${section} failed:`, retryErr instanceof Error ? retryErr.message : retryErr);
          }
        }
        const stillMissing = validateSections({ company, diagnosis, proposals, about, contacts });
        if (stillMissing.length > 0) {
          console.warn("Some sections still incomplete after retries:", stillMissing);
        }
      }


  const validated = validateOutput({ company, diagnosis, proposals, about });
  return {
    cv,
    company: validated.company,
    pains,
    diagnosis: validated.diagnosis,
    proposals: validated.proposals,
    prototypes,
    about: validated.about,
    contacts: Array.isArray(contacts) ? contacts : [],
    accent,
    roleCtx,
    showProtos,
  };
}
