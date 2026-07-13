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
import { tailorSummary, tailorCover, HAIKU, type CoverJson } from "@/lib/tailor";
import { buildCvHtml, buildCoverHtml } from "@/lib/cvHtml";
import { domainFor } from "@/lib/logodev";
import { cityOf } from "@/lib/geo";
import type { Json } from "@/integrations/supabase/types";

// §3.3 secondary CTA — the ONE idiom for every non-primary action on the page:
// control type (13/600), radius 10, a hairline ink/20 border deepening to /30 on
// hover — a colour shift only, never the shadcn `hover:bg-accent` fill jump. The
// page's single PRIMARY (ink fill) is "Open the application page" (the actual
// apply moment); everything else is secondary (§3.3 one-primary-per-viewport).
const SECONDARY_CTA =
  "rounded-[10px] border border-foreground/20 bg-transparent text-control font-semibold text-foreground hover:border-foreground/30 hover:bg-transparent hover:text-foreground";

/** Open the generated HTML in a new window and trigger the browser's print-to-PDF. */
function printHtml(html: string) {
  const w = window.open("", "_blank");
  if (!w) {
    toast.error("Please allow popups to download the PDF.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 500);
}

type Job = {
  id: string;
  company: string;
  title: string;
  url: string;
  jd_text: string | null;
  location: string | null;
  remote: boolean;
  source: string | null;
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

// Prefill row (§6.1): a definition-list pair on the shared `max-content 1fr` grid
// — micro caps key, mono value, secondary copy button. Copied state is the
// affordance removed (a muted check), not a re-tinted button (§3.3).
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (await copy(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <>
      <dt className="self-center text-micro uppercase text-muted-foreground">{label}</dt>
      <dd className="flex items-start justify-between gap-3">
        <span className="min-w-0 break-words font-mono text-dense text-foreground">{value}</span>
        {copied ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground">
            <CheckIcon />
            Copied
          </span>
        ) : (
          <Button variant="outline" size="sm" className={`shrink-0 ${SECONDARY_CTA}`} onClick={onCopy}>
            Copy
          </Button>
        )}
      </dd>
    </>
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
  const [busy, setBusy] = useState<null | "cv" | "cover">(null);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<string | null>(null); // editable tailored summary
  const [cover, setCover] = useState<CoverJson | null>(null);
  const [hasApplied, setHasApplied] = useState(false);

  useEffect(() => {
    let active = true;
    setError("");
    setBusy(null);
    setSummary(null);
    setCover(null);
    setScore(null);
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      const [{ data: jobData }, { data: profile }] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, company, title, url, jd_text, location, remote, source")
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
        const [{ data: app }, { data: scoreRow }] = await Promise.all([
          supabase.from("applications").select("id").eq("user_id", user.id).eq("job_id", (jobData as Job).id).maybeSingle(),
          supabase.from("scores").select("score").eq("user_id", user.id).eq("job_id", (jobData as Job).id).maybeSingle(),
        ]);
        if (active && app) setHasApplied(true);
        if (active && scoreRow) setScore(scoreRow.score ?? null);
      }
      if (active) setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [user, jobUrl]);

  /** Persist a generated artifact. Returns whether the write landed so callers can
   *  surface a failure instead of losing the ledger row silently (issue #54). */
  async function saveArtifact(kind: string, content: Json): Promise<boolean> {
    if (!user || !job) return false;
    await supabase.from("artifacts").delete().match({ user_id: user.id, job_id: job.id, kind });
    const { error } = await supabase
      .from("artifacts")
      .insert({ user_id: user.id, job_id: job.id, kind, content, model: HAIKU });
    return !error;
  }

  async function genSummary() {
    if (!job || !cvText) return;
    setBusy("cv");
    setError("");
    try {
      const s = await tailorSummary({ role: job.title, company: job.company, jdText: job.jd_text, cvText });
      setSummary(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "CV generation failed");
    } finally {
      setBusy(null);
    }
  }

  async function downloadCv() {
    if (!job || !cvText || summary == null) return;
    printHtml(buildCvHtml({ name, summary, cvText }));
    // Persist the reviewed summary (the version the user actually downloaded). If the
    // write fails, say so — the PDF is fine, but it won't show up in the saved bundle
    // (issue #54: don't lose the ledger row silently).
    const saved = await saveArtifact("cv", { summary });
    if (!saved) {
      toast.error("Your CV is downloading, but we couldn't save a copy to your bundle. Try again to keep it on file.");
    }
  }

  async function genCover() {
    if (!job || !cvText) return;
    setBusy("cover");
    setError("");
    try {
      const c = await tailorCover({ role: job.title, company: job.company, jdText: job.jd_text, cvText }, name);
      setCover(c);
      const saved = await saveArtifact("letter", { cover: c as unknown as Json });
      if (!saved) {
        toast.error("We drafted your letter, but couldn't save a copy to your bundle. Try again to keep it on file.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cover letter generation failed");
    } finally {
      setBusy(null);
    }
  }

  async function markApplied() {
    if (!user || !job) return;
    setHasApplied(true);
    const { error } = await supabase
      .from("applications")
      .upsert({ user_id: user.id, job_id: job.id }, { onConflict: "user_id,job_id" });
    if (error) {
      setHasApplied(false);
      setError("Couldn't mark as applied. Please try again.");
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

  const domain = domainFor(job.company, job.source);
  const city = cityOf(job.location) ?? job.location ?? (job.remote ? "Remote" : null);

  return (
    <AppShell>
      {/* Context header (§6.1 AP3 fix): the score that motivated the apply travels
          with the user — logo + company/role + FitChip + city, all in one row. */}
      <header className="flex items-start gap-4">
        <PaperLogo domain={domain} company={job.company} size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-micro uppercase text-muted-foreground">{job.company}</div>
          <h1 className="mt-0.5 text-balance font-display text-page text-foreground">{job.title}</h1>
          {city && <p className="mt-1 text-caption text-muted-foreground">{city}</p>}
        </div>
        {score != null && <FitChip score={score} size="sm" />}
      </header>
      <p className="mt-4 text-body text-muted-foreground text-pretty">
        Your apply bundle. The CV body is rendered exactly from your saved CV. Only the summary and cover letter are
        tailored to this role, and you review them before anything downloads.{" "}
        <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2">
          View the original posting
        </a>
        .
      </p>

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
          {/* 1 — Tailored CV: generate → EDIT → download */}
          <Section eyebrow="Step 1" title="Tailored CV">
            <p className="mt-2 text-body text-muted-foreground text-pretty">
              We write only the professional summary for this role. Your CV body stays word-for-word as you wrote it.
            </p>
            {summary == null ? (
              <Button variant="outline" size="sm" className={`mt-4 ${SECONDARY_CTA}`} onClick={genSummary} disabled={busy !== null}>
                {busy === "cv" ? "Tailoring your summary…" : "Generate tailored summary"}
              </Button>
            ) : (
              <>
                <label className="mt-4 block text-micro uppercase text-muted-foreground">
                  Professional summary (edit before you download)
                </label>
                <Textarea
                  className="mt-2 min-h-32 rounded-[10px] font-sans text-body"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className={SECONDARY_CTA} onClick={downloadCv} disabled={busy !== null || !summary.trim()}>
                    Download CV (PDF)
                  </Button>
                  <Button variant="outline" size="sm" className={SECONDARY_CTA} onClick={genSummary} disabled={busy !== null}>
                    {busy === "cv" ? "Rewriting…" : "Rewrite summary"}
                  </Button>
                </div>
              </>
            )}
          </Section>

          {/* 2 — Cover letter (optional) */}
          <Section eyebrow="Step 2" title="Cover letter">
            <p className="mt-2 text-body text-muted-foreground text-pretty">
              A short, warm letter drawn from your CV. Optional, only if the role asks for one.
            </p>
            {cover == null ? (
              <Button variant="outline" size="sm" className={`mt-4 ${SECONDARY_CTA}`} onClick={genCover} disabled={busy !== null}>
                {busy === "cover" ? "Writing your cover letter…" : "Generate cover letter"}
              </Button>
            ) : (
              <>
                <div className="mt-4 space-y-3 rounded-[10px] border border-border bg-secondary p-4 text-body text-foreground">
                  <p>{cover.greeting}</p>
                  <p>{cover.p1}</p>
                  <p>{cover.p2}</p>
                  <p>{cover.p3}</p>
                  <p>{cover.sign}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className={SECONDARY_CTA} onClick={() => printHtml(buildCoverHtml({ name, company: job.company, cover }))}>
                    Download letter (PDF)
                  </Button>
                  <Button variant="outline" size="sm" className={SECONDARY_CTA} onClick={genCover} disabled={busy !== null}>
                    Rewrite letter
                  </Button>
                </div>
              </>
            )}
          </Section>

          {/* 3 — Prefill, never submit: the confirm card. The page's ONE primary
              action (ink fill) is "Open the application page" — the apply moment. */}
          <Section eyebrow="Step 3" title="Submit it yourself">
            <p className="mt-2 text-body text-muted-foreground text-pretty">
              We prefill what we can and open the real posting. We never submit an application for you. Review every
              field on their form, then send it.
            </p>
            <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-4 rounded-[10px] border border-border bg-secondary p-4">
              {name && <CopyRow label="Full name" value={name} />}
              {user?.email && <CopyRow label="Email" value={user.email} />}
              {summary && <CopyRow label="Summary" value={summary} />}
              <CopyRow label="Role link" value={job.url} />
            </dl>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button asChild>
                <a href={job.url} target="_blank" rel="noopener noreferrer">
                  Open the application page
                </a>
              </Button>
              {hasApplied ? (
                <span className="inline-flex items-center gap-1.5 text-control text-muted-foreground">
                  <CheckIcon />
                  Marked as applied
                </span>
              ) : (
                <Button variant="outline" size="sm" className={SECONDARY_CTA} onClick={markApplied}>
                  I've applied
                </Button>
              )}
            </div>
            {hasApplied && (
              <p className="mt-3 text-body text-muted-foreground">
                Tracked on your{" "}
                <button className="text-foreground underline underline-offset-2" onClick={() => navigate("/tracker")}>
                  applications board
                </button>
                .
              </p>
            )}
          </Section>
        </div>
      )}

      {error && <p className="mt-4 text-body text-destructive">{error}</p>}
    </AppShell>
  );
}
