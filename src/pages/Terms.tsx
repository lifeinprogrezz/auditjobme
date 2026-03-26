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

const Terms = () => {
  return (
    <div style={{ minHeight: "100vh", background: "#000000" }}>
    <div style={{
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
        Terms of Service
      </h1>
      <p style={{ fontSize: ".8rem", color: "#6b6860", marginBottom: "2.5rem" }}>
        Last updated: March 26, 2026
      </p>

      <section style={sectionStyle}>
        <h2 style={h2Style}>1. Acceptance</h2>
        <p>By using auditjob.me, you agree to these terms. If you do not agree, please do not use the service.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>2. Service description</h2>
        <p>auditjob.me is a tool that generates AI-powered audit reports for job applications. Users can create, view, and share audit reports via unique URLs.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>3. Accounts</h2>
        <p>You sign in using your Google account. You are responsible for maintaining the security of your account. You must not share your account or use another person's account.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>4. Free & paid usage</h2>
        <p>Each user receives 2 free audit generations. Additional audits can be purchased in packs. All purchases are final and non-refundable unless required by applicable law.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>5. Content ownership</h2>
        <p>You retain ownership of the content you provide (company names, job links, etc.). The generated audit reports are yours to use and share as you see fit.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>6. Published audits</h2>
        <p>Audits are published with shareable URLs by default. You understand that anyone with the link can view a published audit.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>7. Prohibited use</h2>
        <p>You may not use the service for unlawful purposes, to harass others, or to submit misleading or fraudulent information.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>8. Limitation of liability</h2>
        <p>The service is provided "as is" without warranties. We are not responsible for decisions made based on generated audit reports. Use the reports at your own discretion.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>9. Changes</h2>
        <p>We may update these terms at any time. Continued use of the service constitutes acceptance of any changes.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={h2Style}>10. Contact</h2>
        <p>Questions? Reach out at <a href="mailto:hello@lifeinprogrezz.com" style={{ color: "#c9a461" }}>hello@lifeinprogrezz.com</a>.</p>
      </section>
    </div>
  );
};

export default Terms;