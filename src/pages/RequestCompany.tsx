import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";

const BG = "#0f0e0c";
const TEXT = "#f0ede8";
const MUTED = "#8a8780";
const ACCENT = "#8a9a8a";
const BORDER = "#2a2825";
const SURFACE = "#1a1916";

const linkStyle: React.CSSProperties = { color: ACCENT, textDecoration: "underline", textUnderlineOffset: "2px" };

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: ".7rem .9rem",
  borderRadius: 10,
  border: `1px solid ${BORDER}`,
  background: SURFACE,
  color: TEXT,
  fontFamily: "inherit",
  fontSize: ".85rem",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: ".7rem",
  textTransform: "uppercase",
  letterSpacing: ".06em",
  color: MUTED,
  marginBottom: ".4rem",
};

export default function RequestCompany() {
  const { user } = useAuth();

  const [companyName, setCompanyName] = useState("");
  const [careersUrl, setCareersUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const page = (inner: React.ReactNode) => (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "'Plus Jakarta Sans', sans-serif", padding: "3rem 1.5rem" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <a href="/digest" style={{ ...linkStyle, fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".06em" }}>← Back to your roles</a>
        {inner}
      </div>
    </div>
  );

  if (!user) {
    return page(
      <p style={{ marginTop: "1.5rem", fontSize: ".85rem", color: MUTED }}>
        Please <a href="/" style={linkStyle}>sign in</a> to request a company.
      </p>,
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !companyName.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const { error: insertError } = await supabase.from("company_requests").insert({
        user_id: user.id,
        company_name: companyName.trim(),
        careers_url: careersUrl.trim() || null,
        note: note.trim() || null,
      });
      if (insertError) throw insertError;
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCompanyName("");
    setCareersUrl("");
    setNote("");
    setError("");
    setDone(false);
  }

  const heading = (
    <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 400, fontSize: "clamp(1.5rem, 4vw, 2.2rem)", letterSpacing: "-.03em", margin: "1.2rem 0 .3rem" }}>
      Request a company
    </h1>
  );

  if (done) {
    return page(
      <>
        {heading}
        <p style={{ fontSize: ".85rem", color: TEXT, lineHeight: 1.6, margin: "1rem 0 1.5rem" }}>
          Thanks — we'll review it and add it to the pool.
        </p>
        <button
          onClick={reset}
          style={{
            padding: ".7rem 1.2rem",
            borderRadius: 10,
            border: `1px solid ${BORDER}`,
            background: SURFACE,
            color: TEXT,
            fontFamily: "inherit",
            fontSize: ".85rem",
            cursor: "pointer",
          }}
        >
          Request another
        </button>
      </>,
    );
  }

  return page(
    <>
      {heading}
      <p style={{ fontSize: ".72rem", color: MUTED, marginBottom: "1.8rem", lineHeight: 1.6 }}>
        Know a company we don't track yet? Tell us about it and we'll look at adding its roles to the pool.
      </p>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
        <div>
          <label htmlFor="company_name" style={labelStyle}>Company name</label>
          <input
            id="company_name"
            type="text"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Acme Inc."
            style={fieldStyle}
          />
        </div>

        <div>
          <label htmlFor="careers_url" style={labelStyle}>Careers URL (optional)</label>
          <input
            id="careers_url"
            type="url"
            value={careersUrl}
            onChange={(e) => setCareersUrl(e.target.value)}
            placeholder="https://acme.com/careers"
            style={fieldStyle}
          />
        </div>

        <div>
          <label htmlFor="note" style={labelStyle}>Note (optional)</label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything that helps us — what they do, why they're a fit..."
            rows={4}
            style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.5 }}
          />
        </div>

        <button
          type="submit"
          disabled={busy || !companyName.trim()}
          style={{
            alignSelf: "flex-start",
            padding: ".7rem 1.4rem",
            borderRadius: 10,
            border: `1px solid ${BORDER}`,
            background: SURFACE,
            color: ACCENT,
            fontFamily: "inherit",
            fontSize: ".85rem",
            fontWeight: 700,
            cursor: busy || !companyName.trim() ? "default" : "pointer",
            opacity: busy || !companyName.trim() ? 0.6 : 1,
          }}
        >
          {busy ? "Submitting..." : "Submit request"}
        </button>
      </form>

      {error && <p style={{ marginTop: "1rem", fontSize: ".75rem", color: "#c98a8a" }}>{error}</p>}
    </>,
  );
}
