// Pure, side-effect-free logic for the JD structured-data extraction pass
// (scripts/extract-jd.mjs). GROUNDED discipline, same as enrich-lib.mjs: every
// value is a fact quoted from the JD body (or the deterministic salary/yoe
// heuristics) or it is null — never guessed. Kept pure (no network / no db) so it
// can be unit-tested offline (scripts/extract-lib.test.mjs).
//
// Design mirror: extract-jd.mjs feeds jd_text through heuristicExtract (free
// regex) + ONE Haiku call, then mergeExtraction. Spec: planning repo
// docs/specs/2026-07-09-jd-data-extraction-design.md.

// Bump this to force a full re-extract next run (rows whose extraction_version
// predates it are re-processed). A jd_text edit re-extracts independently via jdHash.
export const EXTRACTION_VERSION = "v1";

// Matches the house model const (scripts/enrich-lib.mjs) exactly — the pinned
// Haiku 4.5 snapshot, so extraction and enrichment never diverge on model id.
export const MODEL = "claude-haiku-4-5-20251001";

/**
 * Deterministic, dependency-free hash of a JD's trimmed text — the SAME djb2 xor
 * variant, base36, as src/lib/labels.ts `hashCv`. Same jd_text → same hash (a
 * re-run is a no-op); any edit → a new hash (re-extract). Whitespace-invariant.
 */
export function jdHash(text) {
  const s = String(text ?? "").trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// ─── Salary heuristic (ported from career-ops lib/answer-fields.mjs) ──────────

/**
 * Pull an employer-STATED salary band out of the JD, deterministically. Ports
 * career-ops `parseStatedSalary`: the 20K–400K annual-equivalent plausibility
 * gate (so perks like "£1,000 training allowance" are ignored), monthly ×12
 * annualisation, and currency detection. Differs in the return shape only —
 * structured `{ salary_min, salary_max, salary_currency, salary_period }` (ISO-ish
 * currency, always annualised so salary_period is "year") instead of a formatted
 * string, and a symbol-attached fallback for bands with no explicit period word
 * ("Starting at £45,000"). All-null when the JD states no salary.
 */
export function parseSalary(jdText = "") {
  let t = String(jdText).replace(/ /g, " ");
  // Scope to the role's OWN section: LinkedIn scrapes append a "similar jobs"
  // block whose bands belong to OTHER roles. Cut before matching.
  const sidebar = t.search(
    /\b(similar jobs|more jobs|people also viewed|related jobs|recommended jobs|empleos similares|otras ofertas|ofertas similares)\b/i,
  );
  if (sidebar >= 0) t = t.slice(0, sidebar);

  const toNum = (s, k) => {
    let n = parseFloat(String(s).replace(/[.,](?=\d{3}\b)/g, ""));
    if (k) n *= 1000;
    return n;
  };
  const isoOf = (raw) => {
    const s = (raw || "").toLowerCase();
    if (s.includes("£") || s.includes("gbp")) return "GBP";
    if (s.includes("$") || s.includes("usd")) return "USD";
    return "EUR";
  };
  const ok = (a) => a >= 20000 && a <= 400000;
  const empty = { salary_min: null, salary_max: null, salary_currency: null, salary_period: null };

  // 1) explicit RANGE with a trailing period word (can annualise monthly).
  const RANGE =
    /([£€$])?\s?(\d{2,3}(?:[.,]\d{3})*|\d{2,6})\s?(k)?\s?(eur|usd|gbp)?\s?(?:\/?\s?(?:yr|year|annum|mo|month))?\s?(?:[-–—]|to)\s?([£€$])?\s?(\d{2,3}(?:[.,]\d{3})*|\d{2,6})\s?(k)?\s?(eur|usd|gbp|€|£|\$)?\s?(?:\/|\bper\b|\ba\b)?\s?(yr|year|annum|mo|month)/i;
  let m = t.match(RANGE);
  if (m) {
    let lo = toNum(m[2], !!m[3]),
      hi = toNum(m[6], !!m[7]);
    if (/mo|month/i.test(m[9])) {
      lo *= 12;
      hi *= 12;
    }
    const cur = isoOf(m[1] || m[4] || m[5] || m[8]);
    const a = Math.round(Math.min(lo, hi)),
      b = Math.round(Math.max(lo, hi));
    if (ok(a) && ok(b)) return { salary_min: a, salary_max: b, salary_currency: cur, salary_period: "year" };
  }

  // 2) SINGLE amount + period word (can annualise monthly).
  const SINGLE =
    /([£€$])?\s?(\d{2,3}(?:[.,]\d{3})*|\d{2,6})\s?(k)?\s?(eur|usd|gbp|€|£|\$)?\s?(?:\/|\bper\b|\ba\b)?\s?(yr|year|annum|mo|month)\b/i;
  m = t.match(SINGLE);
  if (m) {
    let v = toNum(m[2], !!m[3]);
    if (/mo|month/i.test(m[5])) v *= 12;
    if (ok(v)) return { salary_min: Math.round(v), salary_max: null, salary_currency: isoOf(m[1] || m[4]), salary_period: "year" };
  }

  // 3) RANGE with a currency SYMBOL but no period word (assume annual).
  const RANGE_SYM =
    /([£€$])\s?(\d{2,3}(?:[.,]\d{3})*|\d{2,6})\s?(k)?\s?(?:[-–—]|to)\s?([£€$])?\s?(\d{2,3}(?:[.,]\d{3})*|\d{2,6})\s?(k)?/i;
  m = t.match(RANGE_SYM);
  if (m) {
    const lo = toNum(m[2], !!m[3]),
      hi = toNum(m[5], !!m[6]);
    const cur = isoOf(m[1] || m[4]);
    const a = Math.round(Math.min(lo, hi)),
      b = Math.round(Math.max(lo, hi));
    if (ok(a) && ok(b)) return { salary_min: a, salary_max: b, salary_currency: cur, salary_period: "year" };
  }

  // 4) SINGLE currency-symbol amount, no period (assume annual). Iterate matches
  //    so a leading perk ("under £500 …") doesn't shadow the real band.
  const SINGLE_SYM = /([£€$])\s?(\d{2,3}(?:[.,]\d{3})*|\d{2,6})\s?(k)?/gi;
  for (const mm of t.matchAll(SINGLE_SYM)) {
    const v = toNum(mm[2], !!mm[3]);
    if (ok(v)) return { salary_min: Math.round(v), salary_max: null, salary_currency: isoOf(mm[1]), salary_period: "year" };
  }

  return { ...empty };
}

// ─── YoE + remote-policy heuristics ───────────────────────────────────────────

/** Minimum plausible (1–20) "N years" figure appearing near "experience"/"exp". */
function heuristicYoe(jdText) {
  const t = String(jdText || "");
  const re = /(\d+)\+?\s*years?/gi;
  const cands = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = parseInt(m[1], 10);
    if (!(n >= 1 && n <= 20)) continue;
    const ctx = t.slice(Math.max(0, m.index - 40), Math.min(t.length, m.index + m[0].length + 40));
    if (/\b(?:experience|exp)\b/i.test(ctx)) cands.push(n);
  }
  return cands.length ? Math.min(...cands) : null;
}

/** remote_policy from UNAMBIGUOUS keywords only, else null. */
function heuristicRemote(jdText) {
  const t = String(jdText || "");
  if (/\bfully remote\b|\bremote[-\s]?first\b/i.test(t)) return "remote";
  if (/\bhybrid\b|\b\d+\s*days?\s*(?:in[-\s]?)?(?:the\s+)?office\b|\b\d+\s*days?\s*(?:on[-\s]?site|onsite)\b/i.test(t))
    return "hybrid";
  if (/\bin[-\s]?office\b|\bon[-\s]?site only\b/i.test(t)) return "onsite";
  return null;
}

/**
 * Free regex pre-pass. Returns a PARTIAL of the extraction shape — the fields a
 * deterministic reader can settle without an LLM. Any field may be null.
 */
export function heuristicExtract(jdText) {
  const sal = parseSalary(jdText);
  return {
    yoe_min: heuristicYoe(jdText),
    salary_min: sal.salary_min,
    salary_max: sal.salary_max,
    salary_currency: sal.salary_currency,
    salary_period: sal.salary_period,
    remote_policy: heuristicRemote(jdText),
  };
}

// ─── Haiku structured-output schema + message builder ─────────────────────────

/** Enum vocabularies — the single source of truth for coercion + the schema. */
const ENUMS = {
  visa_sponsorship: ["offered", "not_offered"],
  geo_eligibility: ["eu", "emea_remote", "global_remote", "uk", "us", "us_remote_only", "far"],
  remote_policy: ["onsite", "hybrid", "remote"],
  customer_type: ["b2c", "b2b", "b2b2c", "marketplace", "internal"],
};

/** JSON Schema for the Haiku extraction. additionalProperties:false, every field
 *  nullable (`type: [..., "null"]`), all keys required so the shape is total. */
export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    yoe_min: { type: ["integer", "null"] },
    languages_required: { type: ["array", "null"], items: { type: "string" } },
    salary_min: { type: ["number", "null"] },
    salary_max: { type: ["number", "null"] },
    salary_currency: { type: ["string", "null"] },
    salary_period: { type: ["string", "null"] },
    visa_sponsorship: { type: ["string", "null"], enum: [...ENUMS.visa_sponsorship, null] },
    geo_eligibility: { type: ["string", "null"], enum: [...ENUMS.geo_eligibility, null] },
    is_product_role: { type: ["boolean", "null"] },
    remote_policy: { type: ["string", "null"], enum: [...ENUMS.remote_policy, null] },
    onsite_days_per_week: { type: ["integer", "null"] },
    customer_type: { type: ["string", "null"], enum: [...ENUMS.customer_type, null] },
    company_stage: { type: ["string", "null"] },
  },
  required: [
    "yoe_min",
    "languages_required",
    "salary_min",
    "salary_max",
    "salary_currency",
    "salary_period",
    "visa_sponsorship",
    "geo_eligibility",
    "is_product_role",
    "remote_policy",
    "onsite_days_per_week",
    "customer_type",
    "company_stage",
  ],
};

/**
 * Build the {system, user} pair for one Haiku extraction call. Feeds the
 * heuristic fields in as hints (trust-where-non-null), embeds the schema, and
 * caps jd_text at 3000 chars.
 */
export function buildExtractionMessages(jdText, heur = {}) {
  const system =
    "Extract ONLY facts EXPLICITLY stated in the JD. Never guess or infer from company name/size/location. Use null when the JD is silent. English is the implicit default — only list languages that are explicitly REQUIRED beyond English.";

  const hints = {
    yoe_min: heur.yoe_min ?? null,
    salary_min: heur.salary_min ?? null,
    salary_max: heur.salary_max ?? null,
    salary_currency: heur.salary_currency ?? null,
    salary_period: heur.salary_period ?? null,
    remote_policy: heur.remote_policy ?? null,
  };

  const user = [
    "Extract structured facts from the job description below into ONE JSON object.",
    "Return ONLY the JSON object — no prose, no markdown code fences.",
    "",
    "Every field below is REQUIRED in the output; use null when the JD does not state a value:",
    JSON.stringify(EXTRACTION_SCHEMA.properties),
    "",
    "Field notes:",
    "- yoe_min: minimum years of experience required (integer), else null.",
    "- languages_required: array of non-English languages explicitly REQUIRED; English is implicit so usually null.",
    "- salary_min/salary_max/salary_currency/salary_period: only if a band is stated; salary_period one of year|month|day|hour.",
    "- visa_sponsorship: 'offered' | 'not_offered' | null.",
    "- geo_eligibility: eu | emea_remote | global_remote | uk | us | us_remote_only | far | null.",
    "- is_product_role: false ONLY when the JD is clearly an eng-IC / non-product discipline; else true or null.",
    "- remote_policy: onsite | hybrid | remote | null.",
    "- onsite_days_per_week: integer, else null.",
    "- customer_type: b2c | b2b | b2b2c | marketplace | internal | null.",
    "- company_stage: short hint like 'series_b', else null.",
    "",
    "Deterministic hints already parsed from this JD (trust where non-null; still return the full object):",
    JSON.stringify(hints),
    "",
    "JOB DESCRIPTION:",
    String(jdText || "").slice(0, 3000),
  ].join("\n");

  return { system, user };
}

// ─── Tolerant response parsing + merge ────────────────────────────────────────

const coerceInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const coerceNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const coerceStr = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const coerceEnum = (v, allowed) => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : null;
  return s && allowed.includes(s) ? s : null;
};
const coerceBool = (v) => {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
};

/** Coerce a raw parsed object to the exact extraction shape (unknown keys dropped,
 *  invalid values → null). Always returns the full 13-field shape. */
function coerceExtraction(o) {
  let langs = Array.isArray(o.languages_required) ? o.languages_required.map(coerceStr).filter(Boolean) : null;
  if (Array.isArray(langs) && langs.length === 0) langs = null;
  return {
    yoe_min: o.yoe_min == null ? null : coerceInt(o.yoe_min),
    languages_required: langs,
    salary_min: o.salary_min == null ? null : coerceNum(o.salary_min),
    salary_max: o.salary_max == null ? null : coerceNum(o.salary_max),
    salary_currency: coerceStr(o.salary_currency),
    salary_period: coerceStr(o.salary_period),
    visa_sponsorship: coerceEnum(o.visa_sponsorship, ENUMS.visa_sponsorship),
    geo_eligibility: coerceEnum(o.geo_eligibility, ENUMS.geo_eligibility),
    is_product_role: o.is_product_role == null ? null : coerceBool(o.is_product_role),
    remote_policy: coerceEnum(o.remote_policy, ENUMS.remote_policy),
    onsite_days_per_week: o.onsite_days_per_week == null ? null : coerceInt(o.onsite_days_per_week),
    customer_type: coerceEnum(o.customer_type, ENUMS.customer_type),
    company_stage: coerceStr(o.company_stage),
  };
}

/** Pull the JSON out of a Haiku response body (or a raw text string). */
function firstText(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  const blocks = Array.isArray(raw.content) ? raw.content : [];
  const block = blocks.find((b) => b && b.type === "text" && typeof b.text === "string") || blocks[0];
  return block && typeof block.text === "string" ? block.text : "";
}

/**
 * Tolerant parse of the Haiku response (prose-tolerant, like enrich-lib
 * parseEnrichment): pull the first text content block, slice the first {…} span,
 * JSON.parse, coerce to the schema shape. Returns {} on ANY failure — never throws.
 */
export function parseExtraction(rawApiJson) {
  try {
    const text = firstText(rawApiJson);
    if (!text) return {};
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return {};
    const obj = JSON.parse(text.slice(start, end + 1));
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    return coerceExtraction(obj);
  } catch {
    return {};
  }
}

/**
 * Merge the free heuristic with the LLM extraction. The deterministic heuristic
 * WINS for salary + yoe_min where present (regex beats a language model on a
 * stated number); the LLM fills every other field. remote_policy: the LLM value
 * wins, with the deterministic keyword hit as a fallback so the free signal is
 * never lost. Always returns the full schema shape.
 */
export function mergeExtraction(heur = {}, llm = {}) {
  const pref = (a, b) => (a != null ? a : b != null ? b : null);
  return {
    yoe_min: pref(heur.yoe_min, llm.yoe_min),
    languages_required: llm.languages_required ?? null,
    salary_min: pref(heur.salary_min, llm.salary_min),
    salary_max: pref(heur.salary_max, llm.salary_max),
    salary_currency: pref(heur.salary_currency, llm.salary_currency),
    salary_period: pref(heur.salary_period, llm.salary_period),
    visa_sponsorship: llm.visa_sponsorship ?? null,
    geo_eligibility: llm.geo_eligibility ?? null,
    is_product_role: llm.is_product_role ?? null,
    remote_policy: pref(llm.remote_policy, heur.remote_policy),
    onsite_days_per_week: llm.onsite_days_per_week ?? null,
    customer_type: llm.customer_type ?? null,
    company_stage: llm.company_stage ?? null,
  };
}
