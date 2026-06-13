import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { scoreJob, RUBRIC_VERSION, type ScoreableProfile } from "@/lib/score";

const BG = "#0f0e0c";
const TEXT = "#f0ede8";
const MUTED = "#8a8780";
const ACCENT = "#8a9a8a";
const BORDER = "#2a2825";
const SURFACE = "#1a1916";

const FILTER_LEVELS: { value: string | null; label: string }[] = [
  { value: null, label: "All levels" },
  { value: "apm", label: "Associate" },
  { value: "pm", label: "Product Manager" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead" },
  { value: "founding", label: "Founding" },
];

const pillStyle = (active: boolean): React.CSSProperties => ({
  padding: ".4rem .7rem",
  borderRadius: 999,
  border: `1px solid ${active ? ACCENT : BORDER}`,
  background: active ? ACCENT : "transparent",
  color: active ? "#0f0e0c" : MUTED,
  fontFamily: "inherit",
  fontSize: ".66rem",
  fontWeight: 700,
  letterSpacing: ".04em",
  cursor: "pointer",
  whiteSpace: "nowrap",
});

interface JobRow {
  id: string;
  company: string;
  title: string;
  url: string;
  location: string | null;
  remote: boolean;
  source: string | null;
  seniority: string | null;
  jd_text: string | null;
  score: number | null;
  reason: string | null;
}

const byScore = (a: JobRow, b: JobRow) => (b.score ?? -1) - (a.score ?? -1);

export default function Digest() {
  const { user, signOut } = useAuth();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<string | null>(null);
  const [remoteOnly, setRemoteOnly] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: jobsData } = await supabase
        .from("jobs")
        .select("id, company, title, url, location, remote, source, seniority, jd_text")
        .eq("is_live", true);
      const { data: scoresData } = await supabase
        .from("scores")
        .select("job_id, score, signals")
        .eq("user_id", user.id)
        .eq("rubric_version", RUBRIC_VERSION);

      const scoreByJob: Record<string, { score: number | null; reason: string | null }> = {};
      (scoresData ?? []).forEach((s) => {
        const sig = s.signals as { reason?: string } | null;
        scoreByJob[s.job_id] = { score: s.score, reason: sig?.reason ?? null };
      });
      const merged: JobRow[] = (jobsData ?? []).map((j) => ({
        ...j,
        score: scoreByJob[j.id]?.score ?? null,
        reason: scoreByJob[j.id]?.reason ?? null,
      }));
      merged.sort(byScore);
      if (!active) return;
      setJobs(merged);
      setLoading(false);

      const { data: appsData } = await supabase.from("applications").select("job_id").eq("user_id", user.id);
      if (active) setApplied(new Set((appsData ?? []).map((a) => a.job_id)));

      // Score any unscored roles against the profile (capped; cached after the first pass).
      const { data: profile } = await supabase
        .from("profiles")
        .select("target_seniority, target_cities, open_to_remote, citizenship, eu_work_authorized, languages, cv_text")
        .eq("id", user.id)
        .maybeSingle();
      const unscored = merged.filter((j) => j.score == null).slice(0, 40);
      if (!profile || unscored.length === 0 || !active) return;
      setScoring(true);
      for (const j of unscored) {
        if (!active) return;
        const result = await scoreJob(profile as ScoreableProfile, j);
        if (!result || !active) continue;
        await supabase.from("scores").upsert(
          {
            user_id: user.id,
            job_id: j.id,
            score: result.score,
            rubric_version: RUBRIC_VERSION,
            signals: { reason: result.reason },
          },
          { onConflict: "user_id,job_id,rubric_version" },
        );
        if (!active) return;
        setJobs((prev) =>
          prev.map((x) => (x.id === j.id ? { ...x, score: result.score, reason: result.reason } : x)).sort(byScore),
        );
      }
      if (active) setScoring(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [user]);

  const markApplied = async (jobId: string) => {
    if (!user) return;
    setApplied((prev) => new Set(prev).add(jobId));
    await supabase.from("applications").upsert({ user_id: user.id, job_id: jobId }, { onConflict: "user_id,job_id" });
  };

  const q = query.trim().toLowerCase();
  const visible = jobs.filter((j) => {
    if (level && j.seniority !== level) return false;
    if (remoteOnly && !j.remote) return false;
    if (q && !`${j.company} ${j.title} ${j.location ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "'Plus Jakarta Sans', sans-serif", padding: "3rem 1.5rem" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: ".75rem" }}>
          <button
            onClick={async () => { await signOut(); window.location.href = "/"; }}
            style={{ background: "transparent", border: "none", color: MUTED, fontFamily: "inherit", fontSize: ".64rem", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", cursor: "pointer" }}
          >
            Sign out
          </button>
        </div>
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: "clamp(1.7rem, 4vw, 2.6rem)", letterSpacing: "-.03em", marginBottom: ".5rem" }}>
          Your roles.
        </h1>
        <p style={{ fontSize: ".8rem", color: MUTED, lineHeight: 1.7, marginBottom: "1.5rem" }}>
          Product Manager roles across Europe, scored against your profile. Highest match first.{" "}
          <a href="/tracker" style={{ color: ACCENT, textDecoration: "underline", textUnderlineOffset: "2px" }}>Your applications</a>
          {" · "}
          <a href="/profile" style={{ color: ACCENT, textDecoration: "underline", textUnderlineOffset: "2px" }}>Edit profile</a>
          {" · "}
          <a href="/audit" style={{ color: ACCENT, textDecoration: "underline", textUnderlineOffset: "2px" }}>Build a company audit</a>.
        </p>

        {scoring && (
          <div style={{ fontSize: ".7rem", color: ACCENT, marginBottom: "1.2rem", letterSpacing: ".04em" }}>
            Scoring roles against your profile...
          </div>
        )}

        {loading ? (
          <p style={{ fontSize: ".75rem", color: MUTED }}>Loading roles...</p>
        ) : jobs.length === 0 ? (
          <p style={{ fontSize: ".8rem", color: MUTED }}>No roles in the pool yet. The daily scrape will fill this in.</p>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem", alignItems: "center", marginBottom: "1rem" }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by company, role, or location..."
                style={{ flex: "1 1 220px", minWidth: 0, padding: ".55rem .7rem", borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT, fontFamily: "inherit", fontSize: ".75rem" }}
              />
              <button onClick={() => setRemoteOnly((v) => !v)} style={pillStyle(remoteOnly)}>Remote only</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem", marginBottom: ".9rem" }}>
              {FILTER_LEVELS.map((o) => (
                <button key={o.label} onClick={() => setLevel(o.value)} style={pillStyle(level === o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: ".66rem", color: MUTED, marginBottom: "1.1rem", letterSpacing: ".04em" }}>
              Showing {visible.length} of {jobs.length} roles{visible.length === 0 ? " — try clearing filters" : ""}
            </div>
            {visible.length === 0 ? (
              <p style={{ fontSize: ".8rem", color: MUTED }}>No roles match these filters.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: ".8rem" }}>
                {visible.map((j) => (
              <a
                key={j.id}
                href={j.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "1rem",
                  padding: "1rem 1.2rem",
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  background: SURFACE,
                  textDecoration: "none",
                  color: TEXT,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: ".6rem", marginBottom: ".25rem" }}>
                    <span style={{ fontWeight: 700, fontSize: ".9rem" }}>{j.company}</span>
                    {j.seniority && (
                      <span style={{ fontSize: ".56rem", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: ACCENT, border: `1px solid ${BORDER}`, borderRadius: 4, padding: ".1rem .4rem" }}>
                        {j.seniority}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: ".82rem", color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.title}</div>
                  <div style={{ fontSize: ".68rem", color: MUTED, marginTop: ".3rem" }}>
                    {j.location || (j.remote ? "Remote" : "Location unknown")}
                    {j.remote && j.location ? " · Remote-friendly" : ""}
                  </div>
                  {j.reason && (
                    <div style={{ fontSize: ".7rem", color: MUTED, marginTop: ".5rem", lineHeight: 1.5, fontStyle: "italic" }}>
                      {j.reason}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "1.2rem", color: j.score != null ? ACCENT : MUTED }}>
                    {j.score != null ? j.score.toFixed(1) : "—"}
                  </div>
                  <div style={{ fontSize: ".58rem", color: MUTED, letterSpacing: ".06em", textTransform: "uppercase" }}>
                    {j.score != null ? "match" : "view"}
                  </div>
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); markApplied(j.id); }}
                    disabled={applied.has(j.id)}
                    style={{ marginTop: ".5rem", fontSize: ".55rem", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", padding: ".25rem .5rem", borderRadius: 6, border: `1px solid ${applied.has(j.id) ? ACCENT : BORDER}`, background: applied.has(j.id) ? ACCENT : "transparent", color: applied.has(j.id) ? "#0f0e0c" : MUTED, cursor: applied.has(j.id) ? "default" : "pointer", whiteSpace: "nowrap" }}
                  >
                    {applied.has(j.id) ? "Applied" : "Mark applied"}
                  </button>
                </div>
              </a>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
