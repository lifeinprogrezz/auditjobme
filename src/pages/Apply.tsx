// Apply — the apply bundle (issue #42), rebuilt as a D-class PAPER page (design
// direction §6.1): opaque `--card` sections on the `--background` stage, the
// two-layer ink page shadow, page grain (via AppShell), the §2 type/spacing
// tokens, and a CONTEXT HEADER so the fit score that motivated the apply travels
// with the user (logo + company/role + FitChip + city). Zero stock-shadcn card
// boilerplate; no `bg-secondary/40` alpha soup.
//
// It keeps the two steps the audit flagged: (1) CV EDIT-BEFORE-DOWNLOAD — the
// tailored summary lands in an editable box before it prints, so the one
// LLM-written line is reviewed, never blind; the CV BODY stays the user's own words,
// rendered from their parsed profile (the trust rule, in pdf.ts + cvStructured.ts).
// (2) PREFILL-NEVER-SUBMIT confirm card —
// we hand you the fields to paste and open the real posting; we never submit.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "@/components/ui/sonner";
import AppShell from "@/components/app/AppShell";
import PaperLogo from "@/components/app/PaperLogo";
import FitChip from "@/components/roles/FitChip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  tailorSummary,
  tailorCover,
  answerQuestion,
  answerCommonPack,
  COMMON_PACK_QUESTIONS,
  HAIKU,
  MAX_ANSWERS,
  type CoverJson,
  type CommonPackJson,
} from "@/lib/tailor";
import { downloadCvPdf, downloadCoverPdf } from "@/lib/pdf";
import { ensureCvStructured } from "@/lib/cvParse";
import type { CvStructured } from "@/lib/cvStructured";
import { latestRoleContext, buildNotesDeleteMatch, buildNotesInsertRow } from "@/lib/roleNotes";
import {
  DEV_FIXTURE,
  DEV_FIXTURE_CV_TEXT,
  DEV_FIXTURE_CV_STRUCTURED,
  DEV_FIXTURE_TAILORED_SUMMARY,
  DEV_FIXTURE_COMMON_PACK,
} from "@/lib/devFixture";
import { domainFor } from "@/lib/logodev";
import { cityOf } from "@/lib/geo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AUDIT_STAGES, runAudit, type AuditData, type AuditStageStatus } from "@/lib/audit/runAudit";
import { auditProgressOf } from "@/lib/audit/auditProgress";
import { atAuditLimit, AUDIT_LIMIT_REACHED } from "@/lib/audit/auditLimit";
import { loadAuditAllowance, type AuditAllowance } from "@/lib/audit/auditAllowance";
import { saveAuditPrivate } from "@/lib/audit/saveAudit";
import { downloadPDF } from "@/components/audit/pdfHtml.js";
import { companyKey, type WarmContact } from "@/lib/connections";
import { track } from "@/lib/analytics";
import type { Json } from "@/integrations/supabase/types";

// §3.3 secondary CTA — the ONE idiom for every non-primary action on the page:
// control type (13/600), radius 10, a hairline ink/20 border deepening to /30 on
// hover — a colour shift only, never the shadcn `hover:bg-accent` fill jump.
// There is no primary button on this page (Rober 7-16): the apply moment is the
// role-title link in the header, which opens the real posting.
const SECONDARY_CTA =
  "rounded-[10px] border border-foreground/20 bg-transparent text-control font-semibold text-foreground hover:border-foreground/30 hover:bg-transparent hover:text-foreground";

type Job = {
  id: string;
  company: string;
  title: string;
  url: string;
  jd_text: string | null;
  location: string | null;
  remote: boolean;
  source: string | null;
  /** Embedded companies row — the REAL logo domain (the name-guess fallback misses
   *  many brands, e.g. Novicap on Personio; Rober 7-16). */
  companies: { logo_domain: string | null } | null;
};

/** One-tap copy; returns whether it landed so the row can swap to a check. */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast.error("Couldn't copy. Select and copy manually.");
    return false;
  }
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// The old Step-3 "Submit it yourself" prefill card (CopyRow: name/email/link copy
// rows) was REMOVED (Rober 7-25): the posting opens from the header title, and
// copying your own name added a step without saving one. Applying now lives in
// the header — bookmark + "I've applied" side by side.

/** Copy affordance for a drafted answer (Step 4) — copied state swaps the button
 *  for a muted check, never a re-tinted button (§3.3). */
function AnswerCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (await copy(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return copied ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground">
      <CheckIcon />
      Copied
    </span>
  ) : (
    <Button variant="outline" size="sm" className={`shrink-0 ${SECONDARY_CTA}`} onClick={onCopy}>
      Copy
    </Button>
  );
}

/** Card section shell (§3.2 page idiom): opaque `--card`, radius 16, padding 24,
 *  the ink page shadow, a micro eyebrow above the section title. */
function Section({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-page">
      <div className="font-display text-micro uppercase text-muted-foreground">{eyebrow}</div>
      <h2 className="mt-1 font-display text-section text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function Apply() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const jobUrl = params.get("job") || "";

  const [job, setJob] = useState<Job | null>(null);
  const [cvText, setCvText] = useState<string | null>(null);
  // The parsed CV (issue #150). Null keeps the tailored PDF on the plain-text render,
  // so this page works exactly as before while a profile is unparsed.
  const [cvStructured, setCvStructured] = useState<CvStructured | null>(null);
  const [name, setName] = useState("");
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "cv" | "cover" | "answer" | "commonPack" | "audit">(null);
  const [error, setError] = useState("");
  // WHICH step surfaced the error, so the status line renders inline at that
  // card (design direction §3.4 status-as-whisper) instead of orphaned at the
  // page bottom.
  const [errStep, setErrStep] = useState<null | "cv" | "cover" | "apply" | "answer" | "audit">(null);
  const [summary, setSummary] = useState<string | null>(null); // editable tailored summary
  const [cover, setCover] = useState<CoverJson | null>(null);
  // Step 4 — application-form questions, answered one at a time (Rober 7-16).
  const [question, setQuestion] = useState("");
  const [qas, setQas] = useState<{ q: string; a: string }[]>([]);
  const [hasApplied, setHasApplied] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  // Warm contacts (issue #41): who the user knows at THIS company, from their own
  // LinkedIn connections upload. Own-row read; empty for users without an upload.
  const [warmContacts, setWarmContacts] = useState<WarmContact[]>([]);
  // Per-role context (issue #76): "anything specific for this one?" — feeds the
  // three generated surfaces for THIS role only, never the profile. Empty box =
  // every prompt stays byte-identical to before (pinned in tailor.test.ts).
  const [roleContext, setRoleContext] = useState("");
  // Persistence for the box above (issue #151 / D4): `notesDirty` is true from the
  // first edit since the last successful save or page load; the Save button and
  // autosave-on-blur both write through `saveRoleNotes`, which clears it. Saving
  // never regenerates anything — it is one Supabase write, nothing else.
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  // Company audit (issue #159). The whole step is one button: the seven-stage
  // pipeline in lib/audit/runAudit.ts runs here, the bar below reports it, and the
  // finished audit downloads as a PDF. `auditStages` is empty until a run starts.
  const [auditStages, setAuditStages] = useState<AuditStageStatus[]>([]);
  const [auditData, setAuditData] = useState<AuditData | null>(null);
  // How many free audits are left for this account and this device. Null while we
  // are still asking, and the button is disabled for exactly that window: this gate
  // is the only one there is (auditLimit.ts), so a click before it lands would run
  // a paid audit for somebody already at the limit.
  const [auditAllowance, setAuditAllowance] = useState<AuditAllowance | null>(null);

  useEffect(() => {
    let active = true;
    setError("");
    setErrStep(null);
    setBusy(null);
    setSummary(null);
    setCover(null);
    setScore(null);
    setQuestion("");
    setQas([]);
    setRoleContext("");
    setNotesDirty(false);
    setNotesSaving(false);
    setNotesSaved(false);
    setWarmContacts([]);
    setCvStructured(null);
    setAuditStages([]);
    setAuditData(null);
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      const [{ data: jobData }, { data: profile }] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, company, title, url, jd_text, location, remote, source, companies:company_id (logo_domain)")
          .eq("url", jobUrl)
          .maybeSingle(),
        supabase.from("profiles").select("cv_text, display_name").eq("id", user.id).maybeSingle(),
      ]);
      if (!active) return;
      setJob((jobData as Job) ?? null);
      // The E2E-bypass mock user has no profiles row, so this page could only ever
      // show "add your CV first" and the tailored-CV step was unwalkable. Dev-only
      // (lib/devFixture.ts); the gate folds out of a production build.
      const cvOnFile = profile?.cv_text ?? (DEV_FIXTURE ? DEV_FIXTURE_CV_TEXT : null);
      setCvText(cvOnFile);
      setName(profile?.display_name ?? "");
      if (jobData) {
        // The fit score + applied state both key on job_id — fetch them together so
        // the context header can show the FitChip that motivated the apply (§6.1 AP3).
        // Warm contacts (issue #41) ride along: the stored company_key was computed by
        // the same companyKey() at upload time, so the two sides always agree.
        const [{ data: app }, { data: scoreRow }, { data: savedRow }, { data: connRows }, { data: contextRows }] = await Promise.all([
          supabase.from("applications").select("id").eq("user_id", user.id).eq("job_id", (jobData as Job).id).maybeSingle(),
          supabase.from("scores").select("score").eq("user_id", user.id).eq("job_id", (jobData as Job).id).maybeSingle(),
          supabase.from("saved_jobs").select("id").eq("user_id", user.id).eq("job_id", (jobData as Job).id).maybeSingle(),
          // paging-ok: scoped to ONE company_key, so this is the user's connections at
          // a single employer. Reaching PostgREST's 1000-row cap would mean knowing a
          // thousand people at one company.
          supabase
            .from("connections")
            .select("full_name, company, company_key, position, linkedin_url")
            .eq("user_id", user.id)
            .eq("company_key", companyKey((jobData as Job).company)),
          // Every artifact kind carries the SAME per-role box (issue #76); the most
          // recently updated row's context is the last thing typed, whether it was
          // saved by the Save button or as a side effect of generating something
          // (issue #151 / D4 — the box used to be cleared on every page load).
          supabase.from("artifacts").select("context, updated_at").eq("user_id", user.id).eq("job_id", (jobData as Job).id),
        ]);
        if (active && app) setHasApplied(true);
        if (active && scoreRow) setScore(scoreRow.score ?? null);
        if (active && savedRow) setIsSaved(true);
        if (active)
          setWarmContacts(
            (connRows ?? []).map((r) => ({
              fullName: r.full_name,
              company: r.company,
              companyKey: r.company_key,
              position: r.position,
              linkedinUrl: r.linkedin_url,
            })),
          );
        if (active) {
          const savedContext = latestRoleContext(contextRows ?? []);
          if (savedContext) {
            setRoleContext(savedContext);
            setNotesSaved(true);
          }
        }
      }
      if (active) setLoading(false);
      // Lazy migration (issue #150): a CV uploaded before the structured parse
      // shipped is parsed once, here, and stored. It runs after the page is
      // usable and never blocks it: a failure just leaves the old render.
      if (DEV_FIXTURE) {
        // The fixture CV, already structured: the mock user has no row to store a
        // parse in and no session to buy one with.
        if (active) setCvStructured(DEV_FIXTURE_CV_STRUCTURED);
      } else if (profile?.cv_text?.trim()) {
        const cv = await ensureCvStructured(user.id, profile.cv_text);
        if (active && cv) setCvStructured(cv);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [user, jobUrl]);

  // The free-audit allowance (issue #159). Keyed on the user, not the role: two
  // free audits are two per person and per device, whatever they are spent on.
  useEffect(() => {
    if (!user) return;
    let active = true;
    loadAuditAllowance({ id: user.id, email: user.email }).then((a) => {
      if (active) setAuditAllowance(a);
    });
    return () => {
      active = false;
    };
  }, [user]);

  // Save / unsave for later (Rober 7-16): the header bookmark, same optimistic
  // idiom as useRolesData.toggleSaved (this page loads its own job row).
  async function toggleSaved() {
    if (!user || !job) return;
    const was = isSaved;
    setIsSaved(!was);
    const { error } = was
      ? await supabase.from("saved_jobs").delete().eq("user_id", user.id).eq("job_id", job.id)
      : await supabase.from("saved_jobs").upsert({ user_id: user.id, job_id: job.id }, { onConflict: "user_id,job_id" });
    if (error) {
      setIsSaved(was);
      toast.error(was ? "Couldn't remove from saved. Please try again." : "Couldn't save. Please try again.");
    }
  }

  /** Persist a generated artifact. Returns whether the write landed so callers can
   *  surface a failure instead of losing the ledger row silently (issue #54).
   *  Carries the per-role context (issue #76) on the artifact row itself, never
   *  on the profile — it's a record of what shaped THIS role's generated text.
   *
   *  Dev-only: same gate as saveRoleNotes — the mock user carries no JWT, so the
   *  real call 401s every time. Report success without the round-trip; this was
   *  already done ad hoc at the CV call site, applied here so cover-letter,
   *  single-answer, and common-pack saves stop surfacing a false "couldn't save
   *  a copy" toast under the fixture (issue #151 round 2, defect 3). */
  async function saveArtifact(kind: string, content: Json): Promise<boolean> {
    if (DEV_FIXTURE) return true;
    if (!user || !job) return false;
    await supabase.from("artifacts").delete().match({ user_id: user.id, job_id: job.id, kind });
    const { error } = await supabase
      .from("artifacts")
      .insert({ user_id: user.id, job_id: job.id, kind, content, model: HAIKU, context: roleContext.trim() || null });
    return !error;
  }

  /** Save button + autosave-on-blur for the "anything specific?" box (issue #151
   *  / D4). Writes the box on its own, independent of generating a CV, letter,
   *  or answer — one Supabase upsert, no LLM call, nothing regenerated. The next
   *  generation on this role picks it up through the usual `roleContext` state. */
  async function saveRoleNotes() {
    if (!user || !job) return;
    setNotesSaving(true);
    // delete+insert, not upsert (issue #151 fix round 1): the only
    // (user_id, job_id, kind) unique index is PARTIAL, so an upsert's
    // onConflict can never find an arbiter and 42P10s every time. See
    // roleNotes.ts for the full rationale — same fix saveArtifact already uses.
    //
    // Dev-only: the mock user carries no JWT, so both calls 401 under the same
    // gate every sibling save on this page already skips (e.g. the tailored-
    // summary save above). The Saved state is what's under test here, so report
    // it without the round-trip; there is no fixture-side store, so this can't
    // stand in for the reload-survives check — only a signed-in walk covers that.
    let error: { message: string } | null = null;
    if (!DEV_FIXTURE) {
      await supabase.from("artifacts").delete().match(buildNotesDeleteMatch(user.id, job.id));
      ({ error } = await supabase.from("artifacts").insert(buildNotesInsertRow(user.id, job.id, roleContext)));
    }
    setNotesSaving(false);
    if (error) {
      toast.error("Couldn't save your note. Please try again.");
      return;
    }
    setNotesDirty(false);
    setNotesSaved(true);
  }

  /** ONE click (Rober 7-16): tailor the summary, build the text-based PDF, and
   *  download it straight to disk. No edit box, no print dialog. A re-click
   *  re-downloads the already-generated version without a second LLM call. */
  async function generateAndDownloadCv() {
    if (!job || !cvText) return;
    if (summary != null) {
      await downloadCvPdf({ name, summary, cvText, company: job.company, structured: cvStructured });
      return;
    }
    setBusy("cv");
    setError("");
    setErrStep(null);
    try {
      // Dev-only: the proxy needs a session and the mock user has none, so the real
      // call answers "Not authenticated" and this download can never be walked. The
      // RENDER below is the thing under test, and it is the same code either way.
      // Written as an if, not a ternary: a ternary kept the fixture string in the
      // shipped chunk, an `if (false)` block is dropped whole.
      let s: string;
      if (DEV_FIXTURE) {
        s = DEV_FIXTURE_TAILORED_SUMMARY;
      } else {
        s = await tailorSummary(
          {
            role: job.title,
            company: job.company,
            jdText: job.jd_text,
            cvText,
            context: roleContext.trim() || undefined,
          },
          // The person's own summary, printed when the model returns anything
          // that is not a summary (issue: a refusal reached a real CV download).
          cvStructured?.summary,
          // The company names as the CV writes them, so the summary spells them
          // the way the body does (the body said GLIQUID, the summary "Gliquid").
          (cvStructured?.experience ?? []).map((job) => job.company),
        );
      }
      setSummary(s);
      track("cv_tailored");
      await downloadCvPdf({ name, summary: s, cvText, company: job.company, structured: cvStructured });
      // Same gate: there is no profiles row to hang an artifact off, and the write
      // would only fail and report a save problem that is not one. Now handled
      // inside saveArtifact itself (issue #151 round 2, defect 3).
      const saved = await saveArtifact("cv", { summary: s });
      if (!saved) {
        toast.error("Your CV downloaded, but we couldn't save a copy to your bundle.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "CV generation failed");
      setErrStep("cv");
    } finally {
      setBusy(null);
    }
  }

  /** Same one-click contract for the cover letter. Carries the parsed contact
   *  (issue #151): the letter gets the SAME letterhead + a dateline as the
   *  structured CV, so the two documents read as one bundle. */
  async function generateAndDownloadCover() {
    if (!job || !cvText) return;
    if (cover != null) {
      await downloadCoverPdf({ name, company: job.company, cover, contact: cvStructured?.contact ?? null });
      track("cover_letter_downloaded");
      return;
    }
    setBusy("cover");
    setError("");
    setErrStep(null);
    try {
      const c = await tailorCover(
        { role: job.title, company: job.company, jdText: job.jd_text, cvText, context: roleContext.trim() || undefined },
        name,
      );
      setCover(c);
      await downloadCoverPdf({ name, company: job.company, cover: c, contact: cvStructured?.contact ?? null });
      track("cover_letter_downloaded");
      const saved = await saveArtifact("letter", { cover: c as unknown as Json });
      if (!saved) {
        toast.error("Your letter downloaded, but we couldn't save a copy to your bundle.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cover letter generation failed");
      setErrStep("cover");
    } finally {
      setBusy(null);
    }
  }

  /** One click, one company audit, one PDF (issue #159, LOCKED decision 3).
   *
   *  It runs the SAME seven-stage pipeline the standalone /audit page runs
   *  (lib/audit/runAudit.ts), reports the stage it is on inline, saves the audit
   *  PRIVATE exactly as that page does, and downloads the PDF. There is no
   *  publish step here and no second page: publishing stays an explicit choice on
   *  the generator, so nothing this button makes is ever readable by anyone else.
   *
   *  The PDF is NOT fired from the async continuation. A run takes minutes, so by
   *  the time it lands the click's transient user activation is long gone and every
   *  mainstream browser blocks window.open. The run finishes into a ready state
   *  instead, and the button — now "Download PDF" — opens it on a real gesture.
   *
   *  A second click after a finished run re-downloads what it already built. It
   *  never buys a second audit by accident. */
  async function generateAudit() {
    if (!job || !cvText || busy !== null) return;
    if (auditData) {
      // A click IS user activation, so the popup is allowed. If the browser blocks
      // popups for the site outright, say so in a toast, not a native alert.
      if (!downloadPDF(auditData, { silent: true })) {
        toast.error("Your browser blocked the download window. Allow popups for this site, then press Download PDF.");
      }
      return;
    }
    // The gate is client-side and nothing behind it re-checks (see auditLimit.ts),
    // so a click while the allowance is still loading would buy a real audit for
    // somebody already at the limit. Refuse until we know; the button is disabled
    // over the same window.
    if (auditAllowance == null || atAuditLimit(auditAllowance)) return;
    setBusy("audit");
    setError("");
    setErrStep(null);
    setAuditStages(AUDIT_STAGES.map(() => "pending"));
    const startedAt = Date.now();
    try {
      const data = await runAudit({
        cv: { text: cvText },
        jobLink: job.url,
        personal: roleContext.trim() || undefined,
        onStage: (index, status) =>
          setAuditStages((prev) => {
            const next = [...prev];
            next[index] = status;
            return next;
          }),
      });
      setAuditData(data);
      track("audit_generated");
      // No download here on purpose: minutes have passed, the user activation from
      // the click that started this is spent, and window.open would return null.
      // The step flips to its ready state and the button does it on the next click.
      if (user && !DEV_FIXTURE) {
        const saved = await saveAuditPrivate({
          userId: user.id,
          user,
          auditData: data,
          jobLink: job.url,
          deviceFingerprint: auditAllowance?.fingerprint ?? null,
          durationSeconds: Math.round((Date.now() - startedAt) / 1000),
        });
        if (!saved) {
          toast.error("Your audit downloaded, but we couldn't save a copy to your bundle.");
        }
        setAuditAllowance((a) =>
          a
            ? {
                ...a,
                auditCount: a.auditCount + 1,
                deviceAuditCount: a.fingerprint ? a.deviceAuditCount + 1 : a.deviceAuditCount,
              }
            : a,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audit generation failed");
      setErrStep("audit");
      setAuditStages([]);
    } finally {
      setBusy(null);
    }
  }

  /** Draft one grounded answer to a pasted application-form question (Step 4).
   *  One question per call keeps the UI clean and the spend bounded (MAX_ANSWERS
   *  per role); every claim comes from the CV, never invented (tailor.ts rules). */
  async function genAnswer() {
    const q = question.trim();
    if (!job || !cvText || !q || qas.length >= MAX_ANSWERS) return;
    setBusy("answer");
    setError("");
    setErrStep(null);
    try {
      const a = await answerQuestion(
        { role: job.title, company: job.company, jdText: job.jd_text, cvText, context: roleContext.trim() || undefined },
        q,
      );
      const next = [...qas, { q, a }];
      setQas(next);
      setQuestion("");
      track("answer_drafted", { answer_count: next.length });
      const saved = await saveArtifact("answers", { qa: next as unknown as Json });
      if (!saved) {
        toast.error("Answer drafted, but we couldn't save a copy to your bundle.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Answer generation failed");
      setErrStep("answer");
    } finally {
      setBusy(null);
    }
  }

  /** One click, four answers in one call ("Answer the usual four", issue #151 /
   *  D4): why this company, why a fit, a product shipped, how success is
   *  measured — career-ops apply-sheet.mjs's common pack, the narrative half.
   *  Counts as 4 toward MAX_ANSWERS, same as drafting them one at a time would;
   *  MAX_ANSWERS was raised 8 -> 12 so Step 4's manual flow keeps its full 8
   *  after this runs once. */
  async function genCommonPack() {
    // The 4 common-pack answers count toward MAX_ANSWERS same as 4 manual drafts
    // would (issue #151 fix round 1, blocker 3) — without this a role with 9-12
    // manual answers already drafted could jump to 13-16 on one click.
    if (!job || !cvText || busy !== null || commonPackDone || qas.length + COMMON_PACK_QUESTIONS.length > MAX_ANSWERS) return;
    setBusy("commonPack");
    setError("");
    setErrStep(null);
    try {
      // Dev-only: same gate as the tailored-summary call above — the proxy
      // needs a session the mock user doesn't have, so the real call answers
      // "Not authenticated" and this render can never be walked otherwise.
      // Written as an if, not a ternary, for the same reason as above: a
      // ternary kept the fixture object in the shipped chunk.
      let pack: CommonPackJson;
      if (DEV_FIXTURE) {
        pack = DEV_FIXTURE_COMMON_PACK;
      } else {
        pack = await answerCommonPack({
          role: job.title,
          company: job.company,
          jdText: job.jd_text,
          cvText,
          context: roleContext.trim() || undefined,
        });
      }
      const next = [...qas, ...COMMON_PACK_QUESTIONS.map(({ key, label }) => ({ q: label, a: pack[key] }))];
      setQas(next);
      track("common_pack_drafted", { answer_count: next.length });
      const saved = await saveArtifact("answers", { qa: next as unknown as Json });
      if (!saved) {
        toast.error("Answered, but we couldn't save a copy to your bundle.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Common pack generation failed");
      setErrStep("answer");
    } finally {
      setBusy(null);
    }
  }

  async function markApplied() {
    if (!user || !job) return;
    setHasApplied(true);
    setError("");
    setErrStep(null);
    const { error } = await supabase
      .from("applications")
      .upsert({ user_id: user.id, job_id: job.id }, { onConflict: "user_id,job_id" });
    if (error) {
      setHasApplied(false);
      setError("Couldn't mark as applied. Please try again.");
      setErrStep("apply");
      return;
    }
    track("application_marked_applied", { from: "apply" });
    // Applied ⇒ leaves Saved (Rober 7-16): it lives on the applications board now,
    // keeping it bookmarked too is clutter. Best-effort — never blocks the apply.
    if (isSaved) {
      setIsSaved(false);
      await supabase.from("saved_jobs").delete().eq("user_id", user.id).eq("job_id", job.id);
    }
  }

  /** Reversible mark-as-applied (Rober 7-16): undo deletes the board row. */
  async function unmarkApplied() {
    if (!user || !job) return;
    setHasApplied(false);
    setError("");
    setErrStep(null);
    const { error } = await supabase.from("applications").delete().eq("user_id", user.id).eq("job_id", job.id);
    if (error) {
      setHasApplied(true);
      setError("Couldn't undo. Please try again.");
      setErrStep("apply");
    }
  }

  if (loading) {
    return (
      <AppShell title="Prepare application">
        <p className="mt-6 text-body text-muted-foreground">Loading your apply bundle…</p>
      </AppShell>
    );
  }

  if (!job) {
    // First-class empty state (§6.1): a designed paper card, not raw text.
    return (
      <AppShell title="Prepare application">
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-page">
          <p className="text-body text-muted-foreground text-pretty">
            We couldn't find that role. Open it from Today and we'll bring its details across.
          </p>
          <Button variant="outline" size="sm" className={`mt-4 ${SECONDARY_CTA}`} onClick={() => navigate("/today")}>
            Back to Today
          </Button>
        </div>
      </AppShell>
    );
  }

  // Real logo domain from the companies row; the name-guess is only the fallback.
  const domain = job.companies?.logo_domain ?? domainFor(job.company, job.source);
  const city = cityOf(job.location) ?? job.location ?? (job.remote ? "Remote" : null);
  // Derived, not stored: the common pack is "done" once every one of its four
  // labels already sits in qas — covers both a fresh generation and a reload
  // from a saved "answers" artifact, with nothing to keep in sync.
  const commonPackDone = COMMON_PACK_QUESTIONS.every((q) => qas.some((qa) => qa.q === q.label));
  // Same cap check as genCommonPack itself (issue #151 fix round 1, blocker 3) —
  // the button disables before the click, not just inside the handler.
  const commonPackWouldExceed = qas.length + COMMON_PACK_QUESTIONS.length > MAX_ANSWERS;
  // The audit bar, from the same pure mapping the stage list uses (issue #159).
  const auditProgress = auditProgressOf(auditStages);
  const auditAtLimit = auditAllowance != null && atAuditLimit(auditAllowance);

  return (
    <AppShell>
      {/* Context header (§6.1 AP3 fix): the score that motivated the apply travels
          with the user — logo vertically centered with the company/role/city block
          (Rober 7-16), FitChip + the bookmark on the right (the X-style save). */}
      <header className="flex items-center gap-4">
        <PaperLogo domain={domain} company={job.company} size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-micro uppercase text-muted-foreground">{job.company}</div>
          {/* The title IS the link to the real posting (Rober 7-16), with an explicit
              ↗ glyph (Rober 7-25 — a DELIBERATE exception to the no-arrows call:
              with the step-3 link row gone, the title is the ONLY door to the
              posting, so it earns the affordance). */}
          <h1 className="text-balance font-display text-page text-foreground">
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-4 hover:underline"
            >
              {job.title}
              <svg
                className="ml-1.5 inline-block align-baseline text-muted-foreground"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                aria-hidden="true"
              >
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </a>
          </h1>
          {city && <p className="text-caption text-muted-foreground">{city}</p>}
          {/* Post-applied state surfaces in the HEADER (Rober 7-16): the tracked
              confirmation + board link + the reversible Undo (Rober 7-25 — the
              apply action moved fully into the header, so its undo lives here too). */}
          {hasApplied && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
              <CheckIcon />
              Applied · tracked on your{" "}
              <button
                type="button"
                className="text-foreground underline underline-offset-2"
                onClick={() => navigate("/tracker")}
              >
                applications board
              </button>
              <button
                type="button"
                onClick={unmarkApplied}
                className="font-medium underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Undo
              </button>
            </p>
          )}
          {errStep === "apply" && (
            <p className="mt-1.5 text-caption text-destructive" role="status">
              {error}
            </p>
          )}
        </div>
        {score != null && <FitChip score={score} size="sm" />}
        {/* Save + I've-applied side by side (Rober 7-25): the two role-state actions
            live together in the header, clean and unmissable. */}
        <button
          type="button"
          onClick={toggleSaved}
          aria-pressed={isSaved}
          aria-label={isSaved ? "Remove from saved" : "Save for later"}
          title={isSaved ? "Saved" : "Save for later"}
          className="inline-flex shrink-0 items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
          </svg>
        </button>
        {!hasApplied && (
          <Button variant="outline" size="sm" className={`shrink-0 ${SECONDARY_CTA}`} onClick={markApplied}>
            I've applied
          </Button>
        )}
      </header>

      {/* Warm contacts panel (issue #41): who you already know here, from your own
          LinkedIn connections upload. Independent of the CV and of every generated
          artifact below — it renders whenever there is a match, changes nothing
          else, and stays private to the signed-in user (own-row read). */}
      {warmContacts.length > 0 && (
        <div className="mt-8">
          <Section eyebrow="Your network" title={`Who you know at ${job.company}`}>
            <p className="mt-2 text-caption text-muted-foreground text-pretty">
              From the connections file you uploaded in Settings. Only you can see this, and it doesn't change your
              match score. A short message to one of them often does more than a perfect cover letter.
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {warmContacts.map((c, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  {c.linkedinUrl ? (
                    <a
                      href={c.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-display text-body text-foreground underline-offset-2 hover:underline"
                    >
                      {c.fullName}
                    </a>
                  ) : (
                    <span className="font-display text-body text-foreground">{c.fullName}</span>
                  )}
                  {c.position && <span className="text-caption text-muted-foreground">{c.position}</span>}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      {!cvText ? (
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-page">
          <p className="text-body text-muted-foreground text-pretty">
            Add your CV on the map first, then come back here to prepare a tailored version.
          </p>
          <Button variant="outline" size="sm" className={`mt-4 ${SECONDARY_CTA}`} onClick={() => navigate("/")}>
            Go to the map
          </Button>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-6">
          {/* Per-role context (issue #76), above Step 1: feeds the tailored summary,
              cover letter, and drafted answers below with a fact the candidate
              supplies, never invents. Never touches the CV body. Saved with a
              Save button and autosave-on-blur, and reloaded on the next visit
              (issue #151 / D4) — saving never regenerates anything. */}
          <Section eyebrow="Optional" title="Anything specific for this one?">
            <p className="mt-2 text-caption text-muted-foreground text-pretty">
              Why this company, a referral, a hook, anything that's specific to this application. We'll only use
              what you write here, never invent beyond it, and it won't touch your CV.
            </p>
            <Textarea
              className="mt-4 min-h-20 rounded-[10px] font-sans text-body"
              placeholder={`e.g. "A former colleague on the team pointed me here" or "I've been following your product closely and have a specific idea for it."`}
              value={roleContext}
              onChange={(e) => {
                setRoleContext(e.target.value);
                setNotesDirty(true);
                setNotesSaved(false);
              }}
              onBlur={() => {
                if (notesDirty) saveRoleNotes();
              }}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" className={SECONDARY_CTA} onClick={saveRoleNotes} disabled={notesSaving}>
                {notesSaving ? "Saving…" : "Save"}
              </Button>
              {!notesSaving && !notesDirty && notesSaved && (
                <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                  <CheckIcon />
                  Saved
                </span>
              )}
            </div>
          </Section>

          {/* 1 — Tailored CV: ONE click, PDF straight to disk (Rober 7-16). */}
          <Section eyebrow="Step 1" title="Tailored CV">
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" className={SECONDARY_CTA} onClick={generateAndDownloadCv} disabled={busy !== null}>
                {busy === "cv" ? "Tailoring your CV…" : summary != null ? "Download again" : "Download tailored CV (PDF)"}
              </Button>
              {summary != null && (
                <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                  <CheckIcon />
                  Downloaded
                </span>
              )}
            </div>
            {errStep === "cv" && (
              <p className="mt-3 text-caption text-destructive" role="status">
                {error}
              </p>
            )}
          </Section>

          {/* 2 — Cover letter (optional): same one-click contract. */}
          <Section eyebrow="Step 2" title="Cover letter">
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" className={SECONDARY_CTA} onClick={generateAndDownloadCover} disabled={busy !== null}>
                {busy === "cover" ? "Writing your letter…" : cover != null ? "Download again" : "Download cover letter (PDF)"}
              </Button>
              {cover != null && (
                <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                  <CheckIcon />
                  Downloaded
                </span>
              )}
            </div>
            {errStep === "cover" && (
              <p className="mt-3 text-caption text-destructive" role="status">
                {error}
              </p>
            )}
          </Section>

          {/* 3 — Company audit (issue #159, LOCKED decisions 3 and 4). It used to be
              a link to the generator's own page and five sentences of explanation.
              Now it is one line, one button shaped like the two above it, and the
              explanation lives in the info control beside the title.

              The button runs the seven-stage pipeline in lib/audit/runAudit.ts —
              the same one /audit runs — and hands back a PDF. The audit is saved
              PRIVATE, exactly as the generator saves it; there is no publish step
              here, so nothing this button makes is readable by anyone but its
              owner. It stays independent of the CV and the letter above: its
              content is never wired into them, and running it changes nothing
              already downloaded (Rober 7-26). Nothing fires on mount: the button
              is the only thing that spends anything. */}
          <Section
            eyebrow="Step 3"
            title={
              <span className="inline-flex items-center gap-2">
                Company audit
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="What the company audit is"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border font-mono text-caption text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      i
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 text-caption text-muted-foreground" align="start">
                    <p className="text-pretty">
                      <b className="text-foreground">What you get:</b> we read what's public about {job.company}, write
                      a short diagnosis, three things you'd do first, and the two or three people whose public profiles
                      put them closest to this hire. It comes back as a PDF you can read, send, or bring to a call.
                    </p>
                    <p className="mt-2 text-pretty">
                      <b className="text-foreground">What it costs you:</b> nothing. It's the most expensive thing we
                      run, so it's two audits free, and the button tells you when they're gone. The audit is private to
                      you unless you publish it yourself on the full audit page.
                    </p>
                  </PopoverContent>
                </Popover>
              </span>
            }
          >
            <p className="mt-2 text-caption text-muted-foreground text-pretty">
              Get a company audit as a PDF, with two or three people to reach out to.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                className={SECONDARY_CTA}
                onClick={generateAudit}
                disabled={busy !== null || auditAllowance == null || (auditAtLimit && auditData == null)}
              >
                {busy === "audit"
                  ? "Building your audit…"
                  : auditData != null
                    ? "Download PDF"
                    : "Prepare company audit"}
              </Button>
              {auditData != null && busy !== "audit" && (
                <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                  <CheckIcon />
                  Your audit is ready
                </span>
              )}
              {auditData == null && auditAtLimit && (
                <span className="text-caption text-muted-foreground">{AUDIT_LIMIT_REACHED}</span>
              )}
            </div>
            {/* Same bar and the same tokens as the scoring progress on Today, so a
                long wait reads the same way everywhere in the product. */}
            {busy === "audit" && auditProgress && (
              <div className="mt-3 flex items-center gap-3" role="status" aria-live="polite">
                <div className="h-1 w-28 shrink-0 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-foreground/45 transition-[width] duration-500"
                    style={{ width: `${Math.round(auditProgress.fraction * 100)}%` }}
                  />
                </div>
                <span className="font-mono text-caption text-muted-foreground">
                  {auditProgress.headline} · {auditProgress.detail}
                </span>
              </div>
            )}
            {errStep === "audit" && (
              <p className="mt-3 text-caption text-destructive" role="status">
                {error}
              </p>
            )}
          </Section>

          {/* 4 — Application-form questions (Rober 7-16; was Step 3 until the company
              audit stepped in ahead of it, Rober 7-26 — issue #82): paste ONE question
              from the real form, get an answer grounded in the CV + JD. One at a time
              keeps the UI clean and each call cheap; MAX_ANSWERS bounds the sponsored
              spend. The common pack (issue #151 / D4) covers the four questions almost
              every form asks in one click, ahead of the manual flow below. */}
          <Section eyebrow="Step 4" title="Answer the form's questions">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                className={`mt-4 ${SECONDARY_CTA}`}
                onClick={genCommonPack}
                disabled={busy !== null || commonPackDone || commonPackWouldExceed}
              >
                {busy === "commonPack" ? "Answering the usual four…" : commonPackDone ? "Answered the usual four" : "Answer the usual four"}
              </Button>
              {!commonPackDone && commonPackWouldExceed && (
                <span className="text-caption text-muted-foreground">
                  That's the limit for this role ({MAX_ANSWERS} answers).
                </span>
              )}
            </div>
            <p className="mt-2 text-caption text-muted-foreground text-pretty">
              Why this company, why you're a fit, a product you shipped, how you measure success. The four
              questions almost every form asks, drafted together.
            </p>
            <Textarea
              className="mt-4 min-h-20 rounded-[10px] font-sans text-body"
              placeholder={`Paste one question from the application form, e.g. "Why do you want to work at ${job.company}?"`}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={qas.length >= MAX_ANSWERS}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                className={SECONDARY_CTA}
                onClick={genAnswer}
                disabled={busy !== null || !question.trim() || qas.length >= MAX_ANSWERS}
              >
                {busy === "answer" ? "Drafting your answer…" : "Draft answer"}
              </Button>
              {qas.length >= MAX_ANSWERS && (
                <span className="text-caption text-muted-foreground">
                  That's the limit for this role ({MAX_ANSWERS} answers).
                </span>
              )}
            </div>
            {errStep === "answer" && (
              <p className="mt-3 text-caption text-destructive" role="status">
                {error}
              </p>
            )}
            {qas.length > 0 && (
              <ul className="mt-4 flex flex-col gap-3">
                {qas.map((qa, i) => (
                  <li key={i} className="rounded-[10px] border border-border bg-secondary p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-micro uppercase text-muted-foreground">{qa.q}</p>
                      <AnswerCopy text={qa.a} />
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-body text-foreground">{qa.a}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </AppShell>
  );
}
