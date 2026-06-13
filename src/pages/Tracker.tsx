import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";

const BG = "#0f0e0c";
const TEXT = "#f0ede8";
const MUTED = "#8a8780";
const ACCENT = "#8a9a8a";
const BORDER = "#2a2825";
const SURFACE = "#1a1916";

const STATUSES = ["applied", "responded", "interview", "offer", "rejected"];

interface AppRow {
  id: string;
  status: string;
  applied_at: string;
  job_id: string;
  company: string;
  title: string;
  url: string;
}

export default function Tracker() {
  const { user } = useAuth();
  const [apps, setApps] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: appsData } = await supabase
        .from("applications")
        .select("id, status, applied_at, job_id")
        .eq("user_id", user.id)
        .order("applied_at", { ascending: false });
      const ids = (appsData ?? []).map((a) => a.job_id);
      const jobsById: Record<string, { company: string; title: string; url: string }> = {};
      if (ids.length) {
        const { data: jobsData } = await supabase.from("jobs").select("id, company, title, url").in("id", ids);
        (jobsData ?? []).forEach((j) => {
          jobsById[j.id] = { company: j.company, title: j.title, url: j.url };
        });
      }
      const rows: AppRow[] = (appsData ?? []).map((a) => ({
        id: a.id,
        status: a.status,
        applied_at: a.applied_at,
        job_id: a.job_id,
        company: jobsById[a.job_id]?.company ?? "Unknown",
        title: jobsById[a.job_id]?.title ?? "Unknown role",
        url: jobsById[a.job_id]?.url ?? "#",
      }));
      if (active) {
        setApps(rows);
        setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [user]);

  const updateStatus = async (id: string, status: string) => {
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    await supabase.from("applications").update({ status }).eq("id", id);
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "'Plus Jakarta Sans', sans-serif", padding: "3rem 1.5rem" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: "clamp(1.7rem, 4vw, 2.6rem)", letterSpacing: "-.03em", marginBottom: ".5rem" }}>
          Applications.
        </h1>
        <p style={{ fontSize: ".8rem", color: MUTED, lineHeight: 1.7, marginBottom: "2rem" }}>
          Every role you've marked applied, newest first. Move the status as things progress.{" "}
          <a href="/" style={{ color: ACCENT, textDecoration: "underline", textUnderlineOffset: "2px" }}>Back to your digest</a>.
        </p>

        {loading ? (
          <p style={{ fontSize: ".75rem", color: MUTED }}>Loading...</p>
        ) : apps.length === 0 ? (
          <p style={{ fontSize: ".8rem", color: MUTED }}>
            No applications yet. Open a role from your digest, apply, then hit "Mark applied" and it shows up here.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: ".8rem" }}>
            {apps.map((a) => (
              <div
                key={a.id}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", padding: "1rem 1.2rem", borderRadius: 10, border: `1px solid ${BORDER}`, background: SURFACE }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: ".88rem", marginBottom: ".2rem" }}>{a.company}</div>
                  <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: ".8rem", color: TEXT, textDecoration: "none" }}>
                    {a.title}
                  </a>
                  <div style={{ fontSize: ".64rem", color: MUTED, marginTop: ".3rem" }}>
                    Applied {new Date(a.applied_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                </div>
                <select
                  value={a.status}
                  onChange={(e) => updateStatus(a.id, e.target.value)}
                  style={{ background: BG, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: ".5rem .6rem", fontFamily: "inherit", fontSize: ".72rem", cursor: "pointer", flexShrink: 0 }}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
