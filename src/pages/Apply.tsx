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
import { tailorSummary, tailorCover, answerQuestion, HAIKU, MAX_ANSWERS, type CoverJson } from "@/lib/tailor";
import { downloadCvPdf, downloadCoverPdf } from "@/lib/pdf";
import { ensureCvStructured } from "@/lib/cvParse";
import type { CvStructured } from "@/lib/cvStructured";
import { domainFor } from "@/lib/logodev";
import { cityOf } from "@/lib/geo";
import { auditHref } from "@/lib/auditLink";
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
  // The parsed CV (issue #150). Null keeps the tailored PDF on the plain-text render,
  // so this page works exactly as before while a profile is unparsed.
  const [cvStructured, setCvStructured] = useState<CvStructured | null>(null);
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
  // Warm contacts (issue #41): who the user knows at THIS company, from their own
  // LinkedIn connections upload. Own-row read; empty for users without an upload.
  const [warmContacts, setWarmContacts] = useState<WarmContact[]>([]);
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
    setWarmContacts([]);
    setCvStructured(null);
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
        // Warm contacts (issue #41) ride along: the stored company_key was computed by
        // the same companyKey() at upload time, so the two sides always agree.
        const [{ data: app }, { data: scoreRow }, { data: savedRow }, { data: connRows }] = await Promise.all([
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
      }
      if (active) setLoading(false);
      // Lazy migration (issue #150): a CV uploaded before the structured parse
      // shipped is parsed once, here, and stored. It runs after the page is
      // usable and never blocks it: a failure just leaves the old render.
      if (profile?.cv_text?.trim()) {
        const cv = await ensureCvStructured(user.id, profile.cv_text);
        if (active && cv) setCvStructured(cv);
      }
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
      await downloadCvPdf({ name, summary, cvText, company: job.company, structured: cvStructured });
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
      track("cv_tailored");
      await downloadCvPdf({ name, summary: s, cvText, company: job.company, structured: cvStructured });
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
      await downloadCoverPdf({ name, company: job.company, cover: c });
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

          {/* 3 — Company audit (issue #82): a public page about this company that the
              user generates and sends themselves, entirely INDEPENDENT of the CV and
              cover letter above — its link is never wired into any generated text, and
              generating one never touches what's already downloaded (Rober 7-26,
              explicitly rejected coupling the two). This is a plain link to the
              standalone audit tool at /audit, prefilled with this job's posting: no
              generation call happens here, so opening this page never spends anything.
              The button is the ONLY way it fires; there is no auto-generation on
              mount or on this step's own render. */}
          <Section eyebrow="Step 3" title="Company audit">
            <p className="mt-2 text-caption text-muted-foreground text-pretty">
              A public page built for {job.company}: the diagnosis, a few proposals, and why you're the right fit. It
              doesn't touch your cover letter or your answers below, and it costs nothing until you generate it. Once
              it's ready you get a link, and it's yours to send wherever you like: a message, an email, the
              application itself.
            </p>
            <div className="mt-4">
              <Button variant="outline" size="sm" className={SECONDARY_CTA} asChild>
                <a href={auditHref(job.url)} target="_blank" rel="noopener noreferrer">
                  Prepare an audit for this company
                </a>
              </Button>
            </div>
          </Section>

          {/* 4 — Application-form questions (Rober 7-16; was Step 3 until the company
              audit stepped in ahead of it, Rober 7-26 — issue #82): paste ONE question
              from the real form, get an answer grounded in the CV + JD. One at a time
              keeps the UI clean and each call cheap; MAX_ANSWERS bounds the sponsored
              spend. */}
          <Section eyebrow="Step 4" title="Answer the form's questions">
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
