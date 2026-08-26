// Dev-only verification fixture (NOT a product surface).
//
// `VITE_E2E_BYPASS_AUTH=1` already lets an automated walk past RequireAuth, but the
// mock user carries no JWT, so every own-row query comes back empty and /today
// renders its "add your CV" empty state. Three checklist surfaces then have no live
// coverage at all: the New-today section (daily_matches), the dismiss control, and
// the cap-1 "+N more from {company}" affordance. The 2026-07-26 verification pass
// reported exactly that gap.
//
// So under the SAME double gate, this module supplies obviously-synthetic scores and
// a synthetic nightly batch over the REAL public job pool, and the dismiss write is
// kept local. `import.meta.env.DEV` is a literal false in a production `vite build`,
// so the gate folds and every helper below tree-shakes out of the shipped bundle.
// Nothing here touches the database, and RLS remains the only real enforcement.
import { AUTH_BYPASSED } from "@/components/AuthProvider";
import type { DailyMatchRow } from "@/lib/product";
import type { ScoreableProfile } from "@/lib/score";
import type { CvStructured } from "@/lib/cvStructured";
import { hasReadableJd } from "@/lib/scorePrefilter";

/** Single gate, borrowed from AuthProvider so the two can never drift. */
export const DEV_FIXTURE = AUTH_BYPASSED;

/** Said out loud on every fixture row so no walk mistakes this for real scoring. */
export const DEV_FIXTURE_REASON =
  "Dev fixture: a synthetic score for UI verification, not a real match.";

/**
 * A synthetic CV with real sections, so the surfaces that READ a CV have something
 * to read: the structured editor in Settings (#150) and the tailored-CV download on
 * an apply page. The mock user has no profiles row, so without this both show their
 * "add your CV first" empty state and neither can be walked.
 *
 * Every bullet and date below appears here word for word, the same grounding the
 * real parse is held to (validateCvStructured) — a fixture that broke that rule
 * would teach a walk the wrong thing about what the product prints.
 */
export const DEV_FIXTURE_CV_TEXT = `DEV FIXTURE CV - synthetic, used only by the E2E auth bypass.

Ada Fixture
Product Manager - Berlin, Germany
ada@example.invalid | +49 30 000000
linkedin.com/in/ada-fixture

SUMMARY
Product Manager, Europe. Ten years building consumer products end to end.

EXPERIENCE

Fixture Labs - Senior Product Manager
Berlin, Germany | 03/2022 - Present
- Led the checkout rebuild that lifted completed orders by 18 percent.
- Ran weekly discovery calls with 12 customers and turned them into a quarterly roadmap.

Sample Works - Product Manager
Amsterdam, Netherlands | 06/2019 - 02/2022
- Shipped the mobile onboarding flow used by 40,000 people a month.
- Set the activation metric the whole team planned against.

EDUCATION

Fixture University - MSc Product Management
Barcelona, Spain | 09/2017 - 06/2019

SKILLS
Product: discovery, roadmapping, experimentation
Tools: SQL, Figma, Amplitude

OTHER
Volunteer mentor at a local product community.`;

/** A CV on file is what flips /today out of its empty state (`scored`). */
export const DEV_FIXTURE_PROFILE: ScoreableProfile = {
  target_seniority: "senior",
  target_cities: ["London", "Berlin", "Barcelona", "Amsterdam", "Stockholm"],
  open_to_remote: true,
  citizenship: "ES",
  eu_work_authorized: true,
  languages: ["English", "Spanish"],
  cv_text: DEV_FIXTURE_CV_TEXT,
};

/**
 * What a parse of DEV_FIXTURE_CV_TEXT produces. Stands in for the stored
 * profiles.cv_structured, which the mock user has no row to hold — so the Settings
 * editor and the apply-page download both render without a database write and
 * without buying the one parse call (the mock user has no JWT for the proxy either).
 */
export const DEV_FIXTURE_CV_STRUCTURED: CvStructured = {
  contact: {
    name: "Ada Fixture",
    email: "ada@example.invalid",
    phone: "+49 30 000000",
    location: "Berlin, Germany",
    links: ["linkedin.com/in/ada-fixture"],
  },
  summary: "Product Manager, Europe. Ten years building consumer products end to end.",
  experience: [
    {
      company: "Fixture Labs",
      role: "Senior Product Manager",
      start: "03/2022",
      end: "Present",
      location: "Berlin, Germany",
      bullets: [
        "Led the checkout rebuild that lifted completed orders by 18 percent.",
        "Ran weekly discovery calls with 12 customers and turned them into a quarterly roadmap.",
      ],
    },
    {
      company: "Sample Works",
      role: "Product Manager",
      start: "06/2019",
      end: "02/2022",
      location: "Amsterdam, Netherlands",
      bullets: [
        "Shipped the mobile onboarding flow used by 40,000 people a month.",
        "Set the activation metric the whole team planned against.",
      ],
    },
  ],
  education: [
    {
      school: "Fixture University",
      degree: "MSc Product Management",
      start: "09/2017",
      end: "06/2019",
      location: "Barcelona, Spain",
    },
  ],
  skills: [
    { group: "Product", items: ["discovery", "roadmapping", "experimentation"] },
    { group: "Tools", items: ["SQL", "Figma", "Amplitude"] },
  ],
  extras: ["Volunteer mentor at a local product community."],
};

/**
 * Stands in for the ONE per-role model call on an apply page (the professional
 * summary). The proxy needs a session and the mock user has none, so the real call
 * answers "Not authenticated" and the tailored-CV download — the whole point of the
 * structured render — cannot be walked. Says out loud that it is a fixture, and
 * borrows only numbers DEV_FIXTURE_CV_TEXT already carries.
 */
export const DEV_FIXTURE_TAILORED_SUMMARY =
  "Dev fixture summary, not a real tailored line. Product Manager in Europe who led a checkout rebuild that lifted completed orders by 18 percent and shipped a mobile onboarding flow used by 40,000 people a month.";

/**
 * A synthetic invite token, in the real token's shape (REF_TOKEN_RE: 32 hex chars).
 * get_or_create_referral_token() is server-side and RLS-guarded, and the mock user
 * carries no JWT, so the real call answers 401 and the invite line renders its
 * failed state on every dev walk of /settings.
 */
export const DEV_FIXTURE_REFERRAL_TOKEN = "deadbeefdeadbeefdeadbeefdeadbeef";

/** Deterministic 4.0–9.5 from the job id (FNV-1a): the same walk twice ranks the
 *  same way, so a screenshot diff means a real change, not a reshuffle. */
export function devFixtureScore(jobId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < jobId.length; i++) {
    h ^= jobId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return Math.round((4 + (h % 5501) / 1000) * 10) / 10;
}

/** Fill ONLY the unscored rows, so a real signed-in score always wins. A row with
 *  no readable description stays unscored, as the real paths leave it (#130). */
export function devFixtureScores<
  T extends { id: string; score: number | null; reason: string | null; has_jd?: boolean | null },
>(jobs: T[]): T[] {
  return jobs.map((j) =>
    j.score == null && hasReadableJd(j)
      ? { ...j, score: devFixtureScore(j.id), reason: DEV_FIXTURE_REASON }
      : j,
  );
}

/** A nightly batch over the best fixture-scored roles, dated today so the section
 *  renders its "New today" heading — the exact shape useDailyMatches returns. */
export function devFixtureBatch(
  jobs: { id: string; url: string; score: number | null }[],
  batchDate: string,
  rubricVersion: string,
  topN = 8,
): DailyMatchRow[] {
  return [...jobs]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, topN)
    .map((j, i) => ({
      job_url: j.url,
      batch_date: batchDate,
      rank: i + 1,
      seen_at: null,
      score: j.score,
      reason: DEV_FIXTURE_REASON,
      rubric_version: rubricVersion,
    }));
}
