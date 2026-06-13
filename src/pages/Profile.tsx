import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";

const SENIORITY_OPTIONS = [
  { value: "apm", label: "Associate / APM" },
  { value: "pm", label: "Product Manager" },
  { value: "senior", label: "Senior Product Manager" },
  { value: "lead", label: "Lead / Principal" },
  { value: "founding", label: "Founding Product Manager" },
];
const CITY_OPTIONS = ["Barcelona", "London", "Berlin", "Stockholm", "Amsterdam", "Madrid", "Paris"];
const LANGUAGE_OPTIONS = ["English", "Spanish", "German", "French", "Portuguese", "Dutch"];

const BG = "#0f0e0c";
const TEXT = "#f0ede8";
const MUTED = "#8a8780";
const ACCENT = "#8a9a8a";
const BORDER = "#2a2825";

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "0.5rem 0.9rem",
        borderRadius: 8,
        border: `1px solid ${active ? ACCENT : BORDER}`,
        background: active ? ACCENT : "transparent",
        color: active ? "#0f0e0c" : TEXT,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        fontWeight: 600,
        fontSize: ".72rem",
        cursor: "pointer",
        transition: "all .15s",
      }}
    >
      {label}
    </button>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: ".62rem",
  fontWeight: 700,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: MUTED,
  marginBottom: ".7rem",
};

export default function Profile() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [seniority, setSeniority] = useState("pm");
  const [cities, setCities] = useState<string[]>([]);
  const [openToRemote, setOpenToRemote] = useState(true);
  const [citizenship, setCitizenship] = useState("");
  const [euAuthorized, setEuAuthorized] = useState(false);
  const [languages, setLanguages] = useState<string[]>(["English"]);
  const [cvText, setCvText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("target_seniority, target_cities, open_to_remote, citizenship, eu_work_authorized, languages, cv_text")
        .eq("id", user.id)
        .maybeSingle();
      if (!active) return;
      if (data) {
        setSeniority(data.target_seniority ?? "pm");
        setCities(data.target_cities ?? []);
        setOpenToRemote(data.open_to_remote ?? true);
        setCitizenship(data.citizenship ?? "");
        setEuAuthorized(data.eu_work_authorized ?? false);
        setLanguages(data.languages ?? ["English"]);
        setCvText(data.cv_text ?? "");
      }
      setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    if (cities.length === 0 && !openToRemote) {
      setError("Pick at least one target city, or tick open to remote.");
      return;
    }
    setSaving(true);
    setError("");
    setSaved(false);
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        target_seniority: seniority,
        target_cities: cities,
        open_to_remote: openToRemote,
        citizenship: citizenship.trim() || null,
        eu_work_authorized: euAuthorized,
        languages,
        cv_text: cvText.trim() || null,
      })
      .eq("id", user.id);
    if (updateError) {
      setError(updateError.message || "Could not save. Try again.");
      setSaving(false);
      return;
    }
    // Clear cached scores so the digest re-scores every role against the new profile.
    await supabase.from("scores").delete().eq("user_id", user.id);
    setSaving(false);
    setSaved(true);
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "'Plus Jakarta Sans', sans-serif", padding: "3rem 1.5rem" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: "clamp(1.7rem, 4vw, 2.6rem)", letterSpacing: "-.03em", marginBottom: ".6rem" }}>
          Your profile.
        </h1>
        <p style={{ fontSize: ".82rem", color: MUTED, lineHeight: 1.7, marginBottom: "2.5rem" }}>
          Change what we score roles against. When you save, your digest re-scores every role to match.{" "}
          <a href="/" style={{ color: ACCENT, textDecoration: "underline", textUnderlineOffset: "2px" }}>Back to your digest</a>.
        </p>

        {loading ? (
          <p style={{ fontSize: ".75rem", color: MUTED }}>Loading your profile...</p>
        ) : (
          <>
            <div style={{ marginBottom: "2rem" }}>
              <label style={labelStyle}>Target level</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: ".6rem" }}>
                {SENIORITY_OPTIONS.map((o) => (
                  <Chip key={o.value} label={o.label} active={seniority === o.value} onClick={() => setSeniority(o.value)} />
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <label style={labelStyle}>Target cities</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: ".6rem" }}>
                {CITY_OPTIONS.map((c) => (
                  <Chip key={c} label={c} active={cities.includes(c)} onClick={() => setCities(toggle(cities, c))} />
                ))}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: ".5rem", marginTop: "1rem", fontSize: ".8rem", color: TEXT, cursor: "pointer" }}>
                <input type="checkbox" checked={openToRemote} onChange={(e) => setOpenToRemote(e.target.checked)} />
                Open to Europe-remote roles
              </label>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <label style={labelStyle}>Work authorization</label>
              <input
                value={citizenship}
                onChange={(e) => setCitizenship(e.target.value)}
                placeholder="Citizenship (e.g. Spain)"
                style={{ width: "100%", padding: ".8rem", borderRadius: 8, border: `1px solid ${BORDER}`, background: "#1a1916", color: TEXT, fontFamily: "inherit", fontSize: ".82rem", marginBottom: ".8rem" }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: ".5rem", fontSize: ".8rem", color: TEXT, cursor: "pointer" }}>
                <input type="checkbox" checked={euAuthorized} onChange={(e) => setEuAuthorized(e.target.checked)} />
                I'm authorized to work in the European Union
              </label>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <label style={labelStyle}>Languages you work in</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: ".6rem" }}>
                {LANGUAGE_OPTIONS.map((l) => (
                  <Chip key={l} label={l} active={languages.includes(l)} onClick={() => setLanguages(toggle(languages, l))} />
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "2rem" }}>
              <label style={labelStyle}>Your CV</label>
              <p style={{ fontSize: ".72rem", color: MUTED, marginBottom: ".7rem", lineHeight: 1.6 }}>
                Paste the text of your curriculum vitae. We use it to match roles. We never rewrite it.
              </p>
              <textarea
                value={cvText}
                onChange={(e) => setCvText(e.target.value)}
                rows={8}
                placeholder="Paste your CV text here..."
                style={{ width: "100%", padding: ".8rem", borderRadius: 8, border: `1px solid ${BORDER}`, background: "#1a1916", color: TEXT, fontFamily: "inherit", fontSize: ".8rem", lineHeight: 1.6, resize: "vertical" }}
              />
            </div>

            {error && <p style={{ color: "#e07a5f", fontSize: ".76rem", marginBottom: "1rem" }}>{error}</p>}
            {saved && (
              <p style={{ color: ACCENT, fontSize: ".78rem", marginBottom: "1rem", lineHeight: 1.6 }}>
                Saved. Your roles are re-scoring against the new profile —{" "}
                <a href="/" style={{ color: ACCENT, textDecoration: "underline", textUnderlineOffset: "2px" }}>open your digest</a>.
              </p>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                width: "100%",
                padding: "1rem",
                borderRadius: 8,
                border: "none",
                background: ACCENT,
                color: "#0f0e0c",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                fontWeight: 700,
                fontSize: ".8rem",
                letterSpacing: ".04em",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1,
                transition: "all .2s",
              }}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
