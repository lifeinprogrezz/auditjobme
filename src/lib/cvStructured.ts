// src/lib/cvStructured.ts — the structured CV profile: schema, parse prompt, and the
// validator that keeps it honest. PURE (no network, no supabase, no React) so the
// whole contract is unit-testable; the call and the writes live in cvParse.ts.
//
// WHY THIS EXISTS (#150): the tailored CV printed cv_text as one paragraph, because
// the PDF text extractor flattens a page and the renderer had nothing but that
// paragraph to work with. Parsing the CV once, at upload, gives the renderer real
// sections, bullets and dates, and the render itself stays deterministic.
//
// THE TRUST RULE, ENFORCED HERE: the parse re-shapes the user's own words, it never
// writes new ones. Every bullet and every date must appear verbatim in cv_text (the
// same grounding check the score citations use, isGroundedQuote). Anything that does
// not is DROPPED and counted, never stored. Cite or refuse.
import { isGroundedQuote } from "./scorePrompt";

export type CvContact = {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  /** Portfolio, LinkedIn, GitHub and the like, as written in the CV. */
  links: string[];
};

export type CvExperience = {
  company: string;
  role: string;
  /** Dates exactly as the CV writes them ("09/2021", "September 2021", ""). */
  start: string;
  end: string;
  location?: string;
  bullets: string[];
  /**
   * The owner's own call, made in the editor: print these bullets under the entry
   * ABOVE instead of as a job of its own. A CV that gives a side project its own
   * title and dates parses as a job, because that is what the CV says, and the parse
   * must keep mirroring the CV. So the parser NEVER sets this. Absent or false is
   * exactly the render as it was. A flag on the first entry is dropped: nothing sits
   * above it to join.
   */
  groupedIntoPrevious?: boolean;
};

export type CvEducation = {
  school: string;
  degree: string;
  start?: string;
  end?: string;
  location?: string;
};

export type CvSkillGroup = { group: string; items: string[] };

export type CvStructured = {
  contact: CvContact;
  /** The CV's OWN summary. Display only: the tailored summary replaces it at render. */
  summary: string;
  experience: CvExperience[];
  education: CvEducation[];
  skills: CvSkillGroup[];
  /** Anything real that fits no section: languages, awards, certifications. */
  extras: string[];
};

/** Bounds on the stored shape, so one odd parse can never produce a runaway document. */
export const CV_LIMITS = {
  experience: 20,
  bulletsPerRole: 30,
  education: 12,
  skillGroups: 16,
  itemsPerGroup: 40,
  extras: 20,
  links: 8,
  dateField: 60,
  shortField: 200,
  longField: 700,
} as const;

/** Output budget for the one parse call. A long CV fits inside this comfortably. */
export const CV_PARSE_MAX_TOKENS = 8000; // a 3-page CV with ~40 bullets overflowed 4000 and lost the tail of its skills section (2026-08-26)

/** How much of cv_text the parse call reads. Bounds cost; longer CVs are rare. */
export const CV_PARSE_INPUT_CHARS = 14000;

/**
 * Applicant-tracking-system text normalisation, ported from career-ops
 * generate-pdf.mjs. Typographic characters survive a PDF but confuse parsers, so
 * every string we print goes through this first.
 */
export function normalizeForAts(text: string): string {
  return (text || "")
    .replace(/[\u2014\u2013]/g, "-")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/\u2026/g, "...")
    .replace(/\u200B|\u200C|\u200D|\u2060|\uFEFF/g, "")
    .replace(/\u00A0/g, " ");
}

function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function strList(value: unknown, max: number, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => str(v, max))
    .filter(Boolean)
    .slice(0, cap);
}

export function emptyCvStructured(): CvStructured {
  return { contact: { name: "", links: [] }, summary: "", experience: [], education: [], skills: [], extras: [] };
}

export type CvValidation = {
  cv: CvStructured;
  /** How many bullets and dates were refused for not appearing in the CV. */
  drops: number;
  /** Short human-readable notes on what was refused (for logs, never for the user). */
  dropped: string[];
};

/**
 * Coerce any raw value into the schema: right types, trimmed strings, bounded
 * lengths. No grounding, no judgement about truth. Used on the way IN from the
 * model (before grounding) and on the way OUT of the database.
 */
export function coerceCvStructured(raw: unknown): CvStructured {
  const cv = emptyCvStructured();
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const contact = (obj.contact && typeof obj.contact === "object" ? obj.contact : {}) as Record<string, unknown>;
  cv.contact = {
    name: str(contact.name, CV_LIMITS.shortField),
    email: str(contact.email, CV_LIMITS.shortField) || undefined,
    phone: str(contact.phone, CV_LIMITS.shortField) || undefined,
    location: str(contact.location, CV_LIMITS.shortField) || undefined,
    links: strList(contact.links, CV_LIMITS.shortField, CV_LIMITS.links),
  };
  cv.summary = str(obj.summary, CV_LIMITS.longField * 2);

  const rawExp = Array.isArray(obj.experience) ? obj.experience : [];
  for (const item of rawExp.slice(0, CV_LIMITS.experience)) {
    const e = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const company = str(e.company, CV_LIMITS.shortField);
    const role = str(e.role, CV_LIMITS.shortField);
    if (!company && !role) continue;
    const entry: CvExperience = {
      company,
      role,
      start: str(e.start, CV_LIMITS.dateField),
      end: str(e.end, CV_LIMITS.dateField),
      location: str(e.location, CV_LIMITS.shortField) || undefined,
      bullets: strList(e.bullets, CV_LIMITS.longField, CV_LIMITS.bulletsPerRole),
    };
    // Only a real `true` is carried, and never on the first kept entry. An absent
    // flag leaves the stored shape identical to what it was before the flag existed.
    if (e.groupedIntoPrevious === true && cv.experience.length > 0) entry.groupedIntoPrevious = true;
    cv.experience.push(entry);
  }

  const rawEdu = Array.isArray(obj.education) ? obj.education : [];
  for (const item of rawEdu.slice(0, CV_LIMITS.education)) {
    const e = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const school = str(e.school, CV_LIMITS.shortField);
    const degree = str(e.degree, CV_LIMITS.shortField);
    if (!school && !degree) continue;
    cv.education.push({
      school,
      degree,
      start: str(e.start, CV_LIMITS.dateField) || undefined,
      end: str(e.end, CV_LIMITS.dateField) || undefined,
      location: str(e.location, CV_LIMITS.shortField) || undefined,
    });
  }

  const rawSkills = Array.isArray(obj.skills) ? obj.skills : [];
  for (const item of rawSkills.slice(0, CV_LIMITS.skillGroups)) {
    const s = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const group = str(s.group, CV_LIMITS.shortField);
    const items = strList(s.items, CV_LIMITS.shortField, CV_LIMITS.itemsPerGroup);
    if (!group && items.length === 0) continue;
    cv.skills.push({ group, items });
  }

  cv.extras = strList(obj.extras, CV_LIMITS.longField, CV_LIMITS.extras);
  return cv;
}

/**
 * Coerce, then REFUSE anything the CV does not say.
 *
 * A BULLET that is not a verbatim substring of cv_text is dropped. A DATE that is
 * not is blanked: the job itself is real, the date is the unsupported part, and
 * deleting a whole role would lose real history. Both count as drops.
 *
 * Company names, school names and skill labels are NOT grounded. A CV writes them
 * in a layout the text extraction can split, and they carry no claim about what the
 * person did. Bullets and dates are where a fabricated claim would live.
 *
 * groupedIntoPrevious is not grounded either, and never can be: it is a layout choice
 * the owner makes in the editor, not a claim the CV makes. coerceCvStructured has
 * already dropped it from the first entry by the time this returns.
 */
export function validateCvStructured(raw: unknown, cvText: string): CvValidation {
  const cv = coerceCvStructured(raw);
  const source = typeof cvText === "string" ? cvText : "";
  const dropped: string[] = [];

  const groundDate = (value: string, where: string): string => {
    if (!value) return "";
    if (isGroundedQuote(value, source)) return value;
    dropped.push(`date not in the CV (${where}): ${value}`);
    return "";
  };

  for (const e of cv.experience) {
    const where = e.company || e.role;
    e.start = groundDate(e.start, where);
    e.end = groundDate(e.end, where);
    e.bullets = e.bullets.filter((b) => {
      if (isGroundedQuote(b, source)) return true;
      dropped.push(`bullet not in the CV (${where}): ${b.slice(0, 60)}`);
      return false;
    });
  }

  for (const e of cv.education) {
    const where = e.school || e.degree;
    e.start = groundDate(e.start ?? "", where) || undefined;
    e.end = groundDate(e.end ?? "", where) || undefined;
  }

  return { cv, drops: dropped.length, dropped };
}

/** Is there enough here to render a CV from? Otherwise the caller keeps the text path. */
export function isCvStructuredUsable(cv: CvStructured | null | undefined): boolean {
  if (!cv) return false;
  const hasWork = cv.experience.some((e) => (e.company || e.role) && e.bullets.length > 0);
  const hasStudy = cv.education.some((e) => e.school || e.degree);
  return hasWork || hasStudy;
}

/**
 * Read a stored jsonb value back into the schema. Anything malformed or too thin to
 * render comes back as null, so the caller falls through to the plain text render
 * instead of printing an empty page. Grounding is NOT re-checked: the row was
 * validated before it was written, and the owner may have edited it in Settings,
 * which is their own word about themselves.
 */
export function readCvStructured(value: unknown): CvStructured | null {
  if (!value || typeof value !== "object") return null;
  const cv = coerceCvStructured(value);
  return isCvStructuredUsable(cv) ? cv : null;
}

// ── The one parse call's prompt (pure; the call itself is cvParse.ts) ─────────

const CV_PARSE_CONTRACT = `Return ONLY a JSON object, no other text, no code fence: {"contact": {"name": "<the person's full name, or an empty string>", "email": "<or empty>", "phone": "<or empty>", "location": "<city and country as written, or empty>", "links": ["<portfolio, LinkedIn, GitHub and similar, as written, at most 8>"]}, "summary": "<the CV's own summary or profile paragraph, copied, or an empty string if it has none>", "experience": [{"company": "<employer name>", "role": "<job title>", "start": "<start date EXACTLY as the CV writes it, e.g. 09/2021 or September 2021, or an empty string>", "end": "<end date exactly as written, or Present exactly as written, or an empty string>", "location": "<city, or empty>", "bullets": ["<each achievement line COPIED WORD FOR WORD from the CV, without the bullet character>"]}], "education": [{"school": "<institution>", "degree": "<qualification>", "start": "<exactly as written, or empty>", "end": "<exactly as written, or empty>", "location": "<or empty>"}], "skills": [{"group": "<the CV's own label, e.g. Languages or Tools>", "items": ["<each skill as written>"]}], "extras": ["<any real line that fits no section above: certifications, awards, volunteering>"]}`;

/**
 * The ONE language model call per CV. It re-shapes, it never writes: every bullet
 * and date it returns is checked against cv_text by validateCvStructured before
 * anything is stored, so an invented line is refused rather than shown.
 */
export function buildCvParsePrompt(cvText: string): string {
  return `You are converting one person's CV into structured JSON. You are a parser, not a writer.

HARD RULES:
- COPY, never compose. Every bullet must be a word-for-word copy of a line in the CV. Do not summarise, merge, reword, translate, fix grammar, or add a metric.
- Every date must be copied exactly as the CV writes it. If a date is missing, use an empty string. Never guess a year.
- Never invent an employer, a job title, a school, a skill or an achievement. If the CV does not say it, leave it out.
- Keep the CV's own order: most recent experience first, as it appears.
- Strip only the bullet character or dash that starts a line, plus surrounding spaces.
- A line the extraction ran together with the next one still counts: copy the part that belongs to the bullet.

${CV_PARSE_CONTRACT}

CV TEXT:
${(cvText || "").slice(0, CV_PARSE_INPUT_CHARS)}

JSON:`;
}

/** Pull the JSON object out of the model's raw text and validate it. Null when there is none. */
export function parseCvResponse(text: string, cvText: string): CvValidation | null {
  const match = (text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return validateCvStructured(JSON.parse(match[0]), cvText);
  } catch {
    return null;
  }
}
