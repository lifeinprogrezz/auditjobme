// Apply — the apply bundle (issue #42), rebuilt as a D-class PAPER page (design
// direction §6.1): opaque `--card` sections on the `--background` stage, the
// two-layer ink page shadow, page grain (via AppShell), the §2 type/spacing
// tokens, and a CONTEXT HEADER so the fit score that motivated the apply travels
// with the user (logo + company/role + FitChip + city). Zero stock-shadcn card
// boilerplate; no `bg-secondary/40` alpha soup.
//
// It keeps the two steps the audit flagged: (1) CV EDIT-BEFORE-DOWNLOAD — the
// tailored summary lands in an editable box before it prints, so the one
// LLM-written line is reviewed, never blind; the CV BODY stays verbatim from
// cv_text (the trust rule, in cvHtml.ts). (2) PREFILL-NEVER-SUBMIT confirm card —
// we hand you the fields to paste and open the real posting; we never submit.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "@/components/ui/sonner";
import AppShell from "@/components/app/AppShell";
import PaperLogo from "@/components/app/PaperLogo";
import FitChip from "@/components/roles/FitChip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { tailorSummary, tailorCover, answerQuestion, HAIKU, MAX_ANSWERS, type CoverJson } from "@/lib/tailor";
import { downloadCvPdf, downloadCoverPdf } from "@/lib/pdf";
import { domainFor } from "@/lib/logodev";
import { cityOf } from "@/lib/geo";
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

/** Copy affordance for a drafted answer (Step 3) — copied state swaps the button
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
function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
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
  const [name, setName] = useState("");
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "cv" | "cover" | "answer">(null);
  const [error, setError] = useState("");
  // WHICH step surfaced the error, so the status line renders inline at that
  // card (design direction §3.4 status-as-whisper) instead of orphaned at the
  // page bottom.
  const [errStep, setErrStep] = useState<null | "cv" | "cover" | "apply" | "answer">(null);
  const [summary, setSummary] = useState<string | null>(null); // editable tailored summary
  const [cover, setCover] = useState<CoverJson | null>(null);
  // Step 4 — application-form questions, answered one at a time (Rober 7-16).
  const [question, setQuestion] = useState("");
  const [qas, setQas] = useState<{ q: string; a: string }[]>([]);
  const [hasApplied, setHasApplied] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  // Per-role context (issue #76): "anything specific for this one?" — feeds the
  // three generated surfaces for THIS role only, never the profile. Empty box =
  // every prompt stays byte-identical to before (pinned in tailor.test.ts).
  const [roleContext, setRoleContext] = useState("");

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
      setCvText(profile?.cv_text ?? null);
      setName(profile?.display_name ?? "");
      if (jobData) {
        // The fit score + applied state both key on job_id — fetch them together so
        // the context header can show the FitChip that motivated the apply (§6.1 AP3).
        const [{ data: app }, { data: scoreRow }, { data: savedRow }] = await Promise.all([
          supabase.from("applications").select("id").eq("user_id", user.id).eq("job_id", (jobData as Job).id).maybeSingle(),
          supabase.from("scores").select("score").eq("user_id", user.id).eq("job_id", (jobData as Job).id).maybeSingle(),
          supabase.from("saved_jobs").select("id").eq("user_id", user.id).eq("job_id", (jobData as Job).id).maybeSingle(),
        ]);
        if (active && app) setHasApplied(true);
        if (active && scoreRow) setScore(scoreRow.score ?? null);
        if (active && savedRow) setIsSaved(true);
      }
      if (active) setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [user, jobUrl]);

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
   *  on the profile — it's a record of what shaped THIS role's generated text. */
  async function saveArtifact(kind: string, content: Json): Promise<boolean> {
    if (!user || !job) return false;
    await supabase.from("artifacts").delete().match({ user_id: user.id, job_id: job.id, kind });
    const { error } = await supabase
      .from("artifacts")
      .insert({ user_id: user.id, job_id: job.id, kind, content, model: HAIKU, context: roleContext.trim() || null });
    return !error;
  }

  /** ONE click (Rober 7-16): tailor the summary, build the text-based PDF, and
   *  download it straight to disk. No edit box, no print dialog. A re-click
   *  re-downloads the already-generated version without a second LLM call. */
  async function generateAndDownloadCv() {
    if (!job || !cvText) return;
    if (summary != null) {
      await downloadCvPdf({ name, summary, cvText, company: job.company });
      return;
    }
    setBusy("cv");
    setError("");
    setErrStep(null);
    try {
      const s = await tailorSummary({
        role: job.title,
        company: job.company,
        jdText: job.jd_text,
        cvText,
        context: roleContext.trim() || undefined,
      });
      setSummary(s);
      await downloadCvPdf({ name, summary: s, cvText, company: job.company });
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

  /** Same one-click contract for the cover letter. */
  async function generateAndDownloadCover() {
    if (!job || !cvText) return;
    if (cover != null) {
      await downloadCoverPdf({ name, company: job.company, cover });
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
      await downloadCoverPdf({ name, company: job.company, cover: c });
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
              supplies, never invents. Never touches the CV body. */}
          <Section eyebrow="Optional" title="Anything specific for this one?">
            <p className="mt-2 text-caption text-muted-foreground text-pretty">
              Why this company, a referral, a hook, anything that's specific to this application. We'll only use
              what you write here, never invent beyond it, and it won't touch your CV.
            </p>
            <Textarea
              className="mt-4 min-h-20 rounded-[10px] font-sans text-body"
              placeholder={`e.g. "A former colleague on the team pointed me here" or "I've been following your product closely and have a specific idea for it."`}
              value={roleContext}
              onChange={(e) => setRoleContext(e.target.value)}
            />
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

          {/* 3 — Application-form questions (Rober 7-16; was Step 4 until the prefill
              card was cut, Rober 7-25): paste ONE question from the real form, get an
              answer grounded in the CV + JD. One at a time keeps the UI clean and each
              call cheap; MAX_ANSWERS bounds the sponsored spend. */}
          <Section eyebrow="Step 3" title="Answer the form's questions">
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
