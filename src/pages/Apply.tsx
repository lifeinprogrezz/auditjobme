import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { useNavigate, useSearchParams } from "react-router-dom";
import { tailorSummary, tailorCover, HAIKU } from "@/lib/tailor";
import { buildCvHtml, buildCoverHtml } from "@/lib/cvHtml";
import type { Json } from "@/integrations/supabase/types";

const BG = "#0f0e0c";
const TEXT = "#f0ede8";
const MUTED = "#8a8780";
const ACCENT = "#8a9a8a";
const BORDER = "#2a2825";
const SURFACE = "#1a1916";

/** Open the generated HTML in a new window and trigger the browser's print-to-PDF. */
function printHtml(html: string) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("Please allow popups to download the PDF.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 500);
}

type Job = { id: string; company: string; title: string; url: string; jd_text: string | null };

const linkStyle: React.CSSProperties = { color: ACCENT, textDecoration: "underline", textUnderlineOffset: "2px" };

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
  const [done, setDone] = useState<Set<string>>(new Set());
  const [hasApplied, setHasApplied] = useState(false);

  useEffect(() => {
    let active = true;
    setError("");
    setBusy(null);
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
        const [{ data: arts }, { data: app }] = await Promise.all([
          supabase.from("artifacts").select("kind").eq("user_id", user.id).eq("job_id", (jobData as Job).id),
          supabase
            .from("applications")
            .select("id")
            .eq("user_id", user.id)
            .eq("job_id", (jobData as Job).id)
            .maybeSingle(),
        ]);
        if (active && arts) setDone(new Set(arts.map((a) => a.kind)));
        if (active && app) setHasApplied(true);
      }
      if (active) setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [user, jobUrl]);

  async function saveArtifact(kind: string, content: Json) {
    if (!user || !job) return;
    await supabase.from("artifacts").delete().match({ user_id: user.id, job_id: job.id, kind });
    await supabase.from("artifacts").insert({ user_id: user.id, job_id: job.id, kind, content, model: HAIKU });
  }

  async function genCv() {
    if (!job || !cvText) return;
    setBusy("cv");
    setError("");
    try {
      const summary = await tailorSummary({ role: job.title, company: job.company, jdText: job.jd_text, cvText });
      printHtml(buildCvHtml({ name, summary, cvText }));
      await saveArtifact("cv", { summary });
      setDone((p) => new Set(p).add("cv"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "CV generation failed");
    } finally {
      setBusy(null);
    }
  }

  async function genCover() {
    if (!job || !cvText) return;
    setBusy("cover");
    setError("");
    try {
      const cover = await tailorCover({ role: job.title, company: job.company, jdText: job.jd_text, cvText }, name);
      printHtml(buildCoverHtml({ name, company: job.company, cover }));
      await saveArtifact("letter", { cover });
      setDone((p) => new Set(p).add("letter"));
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

  const page = (inner: React.ReactNode) => (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "'Plus Jakarta Sans', sans-serif", padding: "3rem 1.5rem" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <a href="/digest" style={{ ...linkStyle, fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".06em" }}>← Back to your roles</a>
        {inner}
      </div>
    </div>
  );

  if (!loading && !user) return page(<p style={{ marginTop: "1.5rem", fontSize: ".85rem", color: MUTED }}>Please <a href="/" style={linkStyle}>sign in</a> to prepare an application.</p>);
  if (loading) return page(<p style={{ marginTop: "1.5rem", fontSize: ".8rem", color: MUTED }}>Loading...</p>);
  if (!job) return page(<p style={{ marginTop: "1.5rem", fontSize: ".85rem", color: MUTED }}>Role not found. Open it from <a href="/digest" style={linkStyle}>your roles</a>.</p>);

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    width: "100%",
    textAlign: "left",
    padding: "1rem 1.2rem",
    borderRadius: 10,
    border: `1px solid ${BORDER}`,
    background: SURFACE,
    color: TEXT,
    fontFamily: "inherit",
    fontSize: ".85rem",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  });

  return page(
    <>
      <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: "clamp(1.5rem, 4vw, 2.2rem)", letterSpacing: "-.03em", margin: "1.2rem 0 .3rem" }}>
        {job.company}
      </h1>
      <p style={{ fontSize: ".85rem", color: TEXT, marginBottom: ".3rem" }}>{job.title}</p>
      <p style={{ fontSize: ".72rem", color: MUTED, marginBottom: "1.8rem", lineHeight: 1.6 }}>
        Your apply bundle. The CV body is rendered exactly from your saved CV; only the summary and the cover letter are tailored to this role.{" "}
        <a href={job.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>View the original posting</a>.
      </p>

      {!cvText ? (
        <p style={{ fontSize: ".82rem", color: MUTED, lineHeight: 1.6, padding: "1rem 1.2rem", borderRadius: 10, border: `1px solid ${BORDER}`, background: SURFACE }}>
          Add your CV to your profile first, then come back here to generate a tailored version.{" "}
          <a href="/profile" style={linkStyle}>Go to your profile</a>.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: ".8rem" }}>
          <button onClick={() => navigate(`/audit?job=${encodeURIComponent(job.url)}`)} disabled={busy !== null} style={btnStyle(busy !== null)}>
            <span style={{ fontWeight: 700, color: ACCENT }}>Build a company audit</span>
            <div style={{ fontSize: ".68rem", color: MUTED, marginTop: ".25rem" }}>A short product audit of {job.company} to send with your application — the thing that gets you noticed.</div>
          </button>
          <button onClick={genCv} disabled={busy !== null} style={btnStyle(busy !== null)}>
            <span style={{ fontWeight: 700 }}>{busy === "cv" ? "Tailoring your CV..." : done.has("cv") ? "Regenerate tailored CV" : "Generate tailored CV"}</span>
            <div style={{ fontSize: ".68rem", color: MUTED, marginTop: ".25rem" }}>Your CV, with a summary written for this role. Opens a print dialog (save as PDF).</div>
          </button>
          <button onClick={genCover} disabled={busy !== null} style={btnStyle(busy !== null)}>
            <span style={{ fontWeight: 700 }}>{busy === "cover" ? "Writing your cover letter..." : done.has("letter") ? "Regenerate cover letter" : "Generate cover letter"}</span>
            <div style={{ fontSize: ".68rem", color: MUTED, marginTop: ".25rem" }}>A short, warm cover letter drawn from your CV. Opens a print dialog (save as PDF).</div>
          </button>
          {hasApplied ? (
            <button disabled style={{ ...btnStyle(true), color: ACCENT, borderColor: ACCENT, opacity: 1 }}>
              <span style={{ fontWeight: 700 }}>✓ Marked as applied</span>
              <div style={{ fontSize: ".68rem", color: MUTED, marginTop: ".25rem" }}>It's in your applications tracker.</div>
            </button>
          ) : (
            <button onClick={markApplied} disabled={busy !== null} style={btnStyle(busy !== null)}>
              <span style={{ fontWeight: 700 }}>Mark as applied</span>
              <div style={{ fontSize: ".68rem", color: MUTED, marginTop: ".25rem" }}>Once you've sent it — tracks it in your applications.</div>
            </button>
          )}
        </div>
      )}

      {error && <p style={{ marginTop: "1rem", fontSize: ".75rem", color: "#c98a8a" }}>{error}</p>}
    </>,
  );
}
