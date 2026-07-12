// Apply — the apply bundle (issue #42). Adds the two missing steps the audit flagged:
// (1) CV EDIT-BEFORE-DOWNLOAD — the tailored summary lands in an editable box before it
// prints, so the one LLM-written line is reviewed, never blind; the CV BODY stays
// verbatim from cv_text (the trust rule, in cvHtml.ts). (2) PREFILL-NEVER-SUBMIT confirm
// card — we hand you the fields to paste and open the real posting; we never submit for
// you. Ink-glass token layer, no inline hex.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "@/components/ui/sonner";
import AppShell from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { tailorSummary, tailorCover, HAIKU, type CoverJson } from "@/lib/tailor";
import { buildCvHtml, buildCoverHtml } from "@/lib/cvHtml";
import type { Json } from "@/integrations/supabase/types";

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

type Job = { id: string; company: string; title: string; url: string; jd_text: string | null };

/** One-tap copy with a toast confirmation (the confirm card's paste helpers). */
async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy. Select and copy manually.");
  }
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2 last:border-0">
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-0.5 break-words text-sm text-foreground">{value}</div>
      </div>
      <Button size="sm" variant="ghost" className="shrink-0" onClick={() => copy(value, label)}>
        Copy
      </Button>
    </div>
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
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      const [{ data: jobData }, { data: profile }] = await Promise.all([
        supabase.from("jobs").select("id, company, title, url, jd_text").eq("url", jobUrl).maybeSingle(),
        supabase.from("profiles").select("cv_text, display_name").eq("id", user.id).maybeSingle(),
      ]);
      if (!active) return;
      setJob((jobData as Job) ?? null);
      setCvText(profile?.cv_text ?? null);
      setName(profile?.display_name ?? "");
      if (jobData) {
        const { data: app } = await supabase
          .from("applications")
          .select("id")
          .eq("user_id", user.id)
          .eq("job_id", (jobData as Job).id)
          .maybeSingle();
        if (active && app) setHasApplied(true);
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
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  if (!job) {
    return (
      <AppShell title="Prepare application">
        <p className="mt-6 text-sm text-muted-foreground">
          Role not found. Open it from{" "}
          <button className="underline underline-offset-2" onClick={() => navigate("/today")}>
            Today
          </button>
          .
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{job.company}</h1>
      <p className="mt-1 text-sm text-foreground">{job.title}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Your apply bundle. The CV body is rendered exactly from your saved CV. Only the summary and cover letter are
        tailored to this role, and you review them before anything downloads.{" "}
        <a href={job.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          View the original posting
        </a>
        .
      </p>

      {!cvText ? (
        <div className="mt-8 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Add your CV on the map first, then come back here to prepare a tailored version.{" "}
          <button className="underline underline-offset-2 text-foreground" onClick={() => navigate("/")}>
            Go to the map
          </button>
          .
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-6">
          {/* 1 — Tailored CV: generate → EDIT → download */}
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-display text-lg font-semibold">Tailored CV</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We write only the professional summary for this role. Your CV body stays word-for-word as you wrote it.
            </p>
            {summary == null ? (
              <Button className="mt-4" onClick={genSummary} disabled={busy !== null}>
                {busy === "cv" ? "Tailoring your summary…" : "Generate tailored summary"}
              </Button>
            ) : (
              <>
                <label className="mt-4 block text-xs uppercase tracking-wide text-muted-foreground">
                  Professional summary (edit before you download)
                </label>
                <Textarea
                  className="mt-2 min-h-32 font-sans"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={downloadCv} disabled={busy !== null || !summary.trim()}>
                    Download CV (PDF)
                  </Button>
                  <Button variant="outline" onClick={genSummary} disabled={busy !== null}>
                    {busy === "cv" ? "Rewriting…" : "Rewrite summary"}
                  </Button>
                </div>
              </>
            )}
          </section>

          {/* 2 — Cover letter (optional) */}
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-display text-lg font-semibold">Cover letter</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A short, warm letter drawn from your CV. Optional, only if the role asks for one.
            </p>
            {cover == null ? (
              <Button className="mt-4" variant="outline" onClick={genCover} disabled={busy !== null}>
                {busy === "cover" ? "Writing your cover letter…" : "Generate cover letter"}
              </Button>
            ) : (
              <>
                <div className="mt-4 space-y-3 rounded-md border border-border bg-secondary/40 p-4 text-sm">
                  <p>{cover.greeting}</p>
                  <p>{cover.p1}</p>
                  <p>{cover.p2}</p>
                  <p>{cover.p3}</p>
                  <p>{cover.sign}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={() => printHtml(buildCoverHtml({ name, company: job.company, cover }))}>
                    Download letter (PDF)
                  </Button>
                  <Button variant="outline" onClick={genCover} disabled={busy !== null}>
                    Rewrite letter
                  </Button>
                </div>
              </>
            )}
          </section>

          {/* 3 — Prefill, never submit: the confirm card */}
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-display text-lg font-semibold">Submit it yourself</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We prefill what we can and open the real posting. We never submit an application for you. Review every
              field on their form, then send it.
            </p>
            <div className="mt-4 rounded-md border border-border bg-secondary/40 px-4">
              {name && <CopyRow label="Full name" value={name} />}
              {user?.email && <CopyRow label="Email" value={user.email} />}
              {summary && <CopyRow label="Summary to paste" value={summary} />}
              <CopyRow label="Role link" value={job.url} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild>
                <a href={job.url} target="_blank" rel="noopener noreferrer">
                  Open the application page
                </a>
              </Button>
              <Button variant="outline" disabled={hasApplied} onClick={markApplied}>
                {hasApplied ? "Marked as applied" : "I've applied"}
              </Button>
            </div>
            {hasApplied && (
              <p className="mt-3 text-sm text-muted-foreground">
                Tracked on your{" "}
                <button className="underline underline-offset-2 text-foreground" onClick={() => navigate("/tracker")}>
                  applications board
                </button>
                .
              </p>
            )}
          </section>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
    </AppShell>
  );
}
