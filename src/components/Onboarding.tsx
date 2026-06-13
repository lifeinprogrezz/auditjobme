import { useState } from "react";
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

export default function Onboarding({ onComplete }: { onComplete?: () => void }) {
  const { user } = useAuth();
  const [seniority, setSeniority] = useState("pm");
  const [cities, setCities] = useState<string[]>([]);
  const [openToRemote, setOpenToRemote] = useState(true);
  const [citizenship, setCitizenship] = useState("");
  const [euAuthorized, setEuAuthorized] = useState(false);
  const [languages, setLanguages] = useState<string[]>(["English"]);
  const [cvText, setCvText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!user) return;
    if (cities.length === 0 && !openToRemote) {
      setError("Pick at least one target city, or tick open to remote.");
      return;
    }
    setSaving(true);
    setError("");
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
        onboarded_at: new Date().toISOString(),
      })
      .eq("id", user.id);
    if (updateError) {
      setError(updateError.message || "Could not save. Try again.");
      setSaving(false);
      return;
    }
    onComplete?.();
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "'Plus Jakarta Sans', sans-serif", padding: "3rem 1.5rem" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: "clamp(1.7rem, 4vw, 2.6rem)", letterSpacing: "-.03em", marginBottom: ".6rem" }}>
          Let's set up your search.
        </h1>
        <p style={{ fontSize: ".82rem", color: MUTED, lineHeight: 1.7, marginBottom: "2.5rem" }}>
          A few quick things so we can score Product Manager roles in Europe against what you actually want. You can change any of this later.
        </p>

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

        <button
          onClick={handleSubmit}
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
          {saving ? "Saving..." : "Start finding roles"}
        </button>
      </div>
    </div>
  );
}
