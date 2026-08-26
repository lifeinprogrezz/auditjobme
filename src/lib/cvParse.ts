// src/lib/cvParse.ts — the ONE parse call per CV, and the reads and writes around it.
// The schema, the prompt and the validator are pure and live in cvStructured.ts.
//
// Shape (#150): a CV is parsed once, when it is uploaded, and the result is stored on
// the profile. Every tailored CV after that renders from the stored structure, so the
// only language model call per ROLE stays the professional summary (CLAUDE.md hard
// rule 1). Users who uploaded before this shipped are parsed lazily on their next
// visit to Settings or to an apply page, with no re-upload.
//
// PRE-MIGRATION SAFE: cv_structured is read and written defensively. Until the
// migration is applied, the column is unknown, the query returns an error rather than
// throwing, and every caller falls back to the plain cv_text render.
import { supabase } from "@/integrations/supabase/client";
import { callProxy } from "./tailor";
import {
  buildCvParsePrompt,
  parseCvResponse,
  readCvStructured,
  CV_PARSE_MAX_TOKENS,
  type CvStructured,
} from "./cvStructured";

/**
 * The generated Database types do not carry cv_structured until the migration is
 * applied and types.ts is regenerated (same pattern as delete_own_account in
 * src/pages/Settings.tsx). This is the narrow slice of the client this module uses.
 */
type ProfilesClient = {
  from(table: "profiles"): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): Promise<{ error: { message: string } | null }>;
    };
  };
};

const db = supabase as unknown as ProfilesClient;

/** One parse per user per session, even if two surfaces ask at the same moment. */
const inFlight = new Set<string>();

/** Read the stored structure. Null when absent, unparsed, or pre-migration. */
export async function loadCvStructured(userId: string): Promise<CvStructured | null> {
  const { data, error } = await db.from("profiles").select("cv_structured").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return readCvStructured(data.cv_structured);
}

/** Persist a structure (the parse's, or the owner's edit). False on failure. */
export async function saveCvStructured(userId: string, cv: CvStructured): Promise<boolean> {
  const { error } = await db
    .from("profiles")
    .update({ cv_structured: cv as unknown, cv_structured_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) {
    console.warn("could not save the structured CV", error.message);
    return false;
  }
  return true;
}

/**
 * The ONE language model call per CV. Returns the validated structure, or null when
 * the call or the response fails. Anything the CV does not say is dropped by the
 * validator before this returns, so a refused line never reaches the database.
 */
export async function parseCvText(cvText: string): Promise<CvStructured | null> {
  const text = (cvText || "").trim();
  if (!text) return null;
  const raw = await callProxy([{ role: "user", content: buildCvParsePrompt(text) }], CV_PARSE_MAX_TOKENS, "cv");
  const result = parseCvResponse(raw, text);
  if (!result) return null;
  if (result.drops > 0) {
    // Not a user-facing message: the render is correct either way, and a dropped
    // line is the guardrail working. It is worth seeing in a console during a run.
    console.info(`structured CV: dropped ${result.drops} ungrounded item(s)`, result.dropped.slice(0, 5));
  }
  return result.cv;
}

/**
 * Parse and store, for a CV that was just saved. Fire and forget: the caller reveals
 * the map without waiting, and a failure leaves the tailored CV on its old text path
 * rather than blocking anything. Model calls are never retried here.
 */
export async function parseAndSaveCv(userId: string, cvText: string): Promise<CvStructured | null> {
  if (inFlight.has(userId)) return null;
  inFlight.add(userId);
  try {
    const cv = await parseCvText(cvText);
    if (!cv) return null;
    await saveCvStructured(userId, cv);
    return cv;
  } catch (err) {
    console.warn("structured CV parse failed", err);
    return null;
  } finally {
    inFlight.delete(userId);
  }
}

/**
 * Lazy migration for CVs uploaded before this shipped: return the stored structure
 * when there is one, otherwise parse the CV once and store it. Called on the
 * Settings and Apply loads, so an existing user gets the new render with no
 * re-upload, and pays for one parse rather than one per role.
 */
export async function ensureCvStructured(userId: string, cvText: string | null): Promise<CvStructured | null> {
  const stored = await loadCvStructured(userId);
  if (stored) return stored;
  if (!cvText?.trim()) return null;
  return parseAndSaveCv(userId, cvText);
}
