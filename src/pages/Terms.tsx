const Terms = () => {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f0e0c",
      color: "#c4c0b8",
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      padding: "3rem 1.5rem",
      maxWidth: "720px",
      margin: "0 auto",
      lineHeight: 1.8,
    }}>
      <h1 style={{ color: "#e8e6e1", fontSize: "1.5rem", marginBottom: "2rem", letterSpacing: "-0.02em" }}>
        Terms of Service
      </h1>
      <p style={{ fontSize: ".85rem", color: "#8a8780", marginBottom: "1.5rem" }}>
        Last updated: March 26, 2026
      </p>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>1. Acceptance</h2>
        <p>By using auditjob.me, you agree to these terms. If you do not agree, please do not use the service.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>2. Service description</h2>
        <p>auditjob.me is a tool that generates AI-powered audit reports for job applications. Users can create, view, and share audit reports via unique URLs.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>3. Accounts</h2>
        <p>You sign in using your Google account. You are responsible for maintaining the security of your account. You must not share your account or use another person's account.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>4. Free & paid usage</h2>
        <p>Each user receives 2 free audit generations. Additional audits can be purchased in packs. All purchases are final and non-refundable unless required by applicable law.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>5. Content ownership</h2>
        <p>You retain ownership of the content you provide (company names, job links, etc.). The generated audit reports are yours to use and share as you see fit.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>6. Published audits</h2>
        <p>Audits are published with shareable URLs by default. You understand that anyone with the link can view a published audit.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>7. Prohibited use</h2>
        <p>You may not use the service for unlawful purposes, to harass others, or to submit misleading or fraudulent information.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>8. Limitation of liability</h2>
        <p>The service is provided "as is" without warranties. We are not responsible for decisions made based on generated audit reports. Use the reports at your own discretion.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>9. Changes</h2>
        <p>We may update these terms at any time. Continued use of the service constitutes acceptance of any changes.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>10. Contact</h2>
        <p>Questions? Reach out at <a href="mailto:hello@lifeinprogrezz.com" style={{ color: "#c9a461" }}>hello@lifeinprogrezz.com</a>.</p>
      </section>
    </div>
  );
};

export default Terms;
