const sectionStyle: React.CSSProperties = {
  marginBottom: "2rem",
  paddingLeft: "1rem",
  borderLeft: "2px solid #2a2825",
};

const h2Style: React.CSSProperties = {
  color: "#e8e6e1",
  fontSize: "1rem",
  fontWeight: 600,
  marginBottom: ".6rem",
  letterSpacing: "-.01em",
};

const Privacy = () => {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#000000",
      color: "#c4c0b8",
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      padding: "3rem 1.5rem",
      maxWidth: "720px",
      margin: "0 auto",
      lineHeight: 1.8,
    }}>
      <a onClick={() => window.history.back()} style={{ color: "#a09a90", fontSize: ".7rem", cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px", marginBottom: "2rem", padding: "6px 14px", border: "1px solid #2a2825", borderRadius: "6px", letterSpacing: ".04em", textTransform: "uppercase" as const, transition: "border-color .2s" }}>
        ← Back
      </a>
      <h1 style={{ fontFamily: "'DM Sans', sans-serif", color: "#f0ede8", fontSize: "clamp(1.6rem, 4vw, 2.2rem)", fontWeight: 400, letterSpacing: "-0.03em", marginBottom: ".4rem" }}>
        Privacy Policy
      </h1>
      <p style={{ fontSize: ".8rem", color: "#6b6860", marginBottom: "2.5rem" }}>
        Last updated: March 26, 2026
      </p>

      <section style={sectionStyle}>
        <h2 style={h2Style}>1. What we collect</h2>
        <p>When you sign in with Google, we receive your name, email address, and profile picture. We use this information solely to identify your account and display your profile within the app.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>2. How we use your data</h2>
        <p>Your data is used to generate and store audit reports you create. We do not sell, share, or distribute your personal information to third parties.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>3. Data storage</h2>
        <p>Your audit data and account information are stored securely in our cloud infrastructure. Published audits are accessible via their unique shareable URLs.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>4. Cookies & analytics</h2>
        <p>We use device fingerprinting to manage free audit limits. We do not use third-party tracking cookies or analytics platforms.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>5. Your rights</h2>
        <p>You can request deletion of your account and all associated data at any time by contacting us at hello@lifeinprogrezz.com.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>6. Contact</h2>
        <p>For any privacy-related questions, reach out to <a href="mailto:hello@lifeinprogrezz.com" style={{ color: "#c9a461" }}>hello@lifeinprogrezz.com</a>.</p>
      </section>
    </div>
  );
};

export default Privacy;