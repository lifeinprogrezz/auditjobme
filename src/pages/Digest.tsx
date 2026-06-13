import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";

const BG = "#0f0e0c";
const TEXT = "#f0ede8";
const MUTED = "#8a8780";
const ACCENT = "#8a9a8a";
const BORDER = "#2a2825";
const SURFACE = "#1a1916";

interface JobRow {
  id: string;
  company: string;
  title: string;
  url: string;
  location: string | null;
  remote: boolean;
  source: string | null;
  seniority: string | null;
  score: number | null;
}

export default function Digest() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: jobsData } = await supabase
        .from("jobs")
        .select("id, company, title, url, location, remote, source, seniority")
        .eq("is_live", true);

      const scoreByJob: Record<string, number | null> = {};
      if (user) {
        const { data: scoresData } = await supabase
          .from("scores")
          .select("job_id, score")
          .eq("user_id", user.id);
        (scoresData ?? []).forEach((s) => {
          scoreByJob[s.job_id] = s.score;
        });
      }

      const merged: JobRow[] = (jobsData ?? []).map((j) => ({ ...j, score: scoreByJob[j.id] ?? null }));
      merged.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      setJobs(merged);
      setLoading(false);
    }
    load();
  }, [user]);

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "'Plus Jakarta Sans', sans-serif", padding: "3rem 1.5rem" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: "clamp(1.7rem, 4vw, 2.6rem)", letterSpacing: "-.03em", marginBottom: ".5rem" }}>
          Your roles.
        </h1>
        <p style={{ fontSize: ".8rem", color: MUTED, lineHeight: 1.7, marginBottom: "2rem" }}>
          Product Manager roles across Europe. Scoring them against your profile is the next piece we're building, so they're unranked for now.
        </p>

        {loading ? (
          <p style={{ fontSize: ".75rem", color: MUTED }}>Loading roles...</p>
        ) : jobs.length === 0 ? (
          <p style={{ fontSize: ".8rem", color: MUTED }}>No roles in the pool yet. The daily scrape will fill this in.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: ".8rem" }}>
            {jobs.map((j) => (
              <a
                key={j.id}
                href={j.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "1rem",
                  padding: "1rem 1.2rem",
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  background: SURFACE,
                  textDecoration: "none",
                  color: TEXT,
                  transition: "border-color .15s",
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
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "1.1rem", color: j.score != null ? ACCENT : MUTED }}>
                    {j.score != null ? j.score.toFixed(1) : "—"}
                  </div>
                  <div style={{ fontSize: ".58rem", color: MUTED, letterSpacing: ".06em", textTransform: "uppercase" }}>
                    {j.score != null ? "match" : "view"}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
