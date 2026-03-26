const Privacy = () => {
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
      <a onClick={() => window.history.back()} style={{ color: "#6b6860", fontSize: ".8rem", cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px", marginBottom: "1.5rem" }}>
        ← Back
      </a>
      <h1 style={{ color: "#e8e6e1", fontSize: "1.5rem", marginBottom: "2rem", letterSpacing: "-0.02em" }}>
        Privacy Policy
      </h1>
      <p style={{ fontSize: ".85rem", color: "#8a8780", marginBottom: "1.5rem" }}>
        Last updated: March 26, 2026
      </p>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>What we collect</h2>
        <p>When you sign in with Google, we receive your name, email address, and profile picture. We use this information solely to identify your account and display your profile within the app.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>How we use your data</h2>
        <p>Your data is used to generate and store audit reports you create. We do not sell, share, or distribute your personal information to third parties.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>Data storage</h2>
        <p>Your audit data and account information are stored securely in our cloud infrastructure. Published audits are accessible via their unique shareable URLs.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>Cookies & analytics</h2>
        <p>We use device fingerprinting to manage free audit limits. We do not use third-party tracking cookies or analytics platforms.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>Your rights</h2>
        <p>You can request deletion of your account and all associated data at any time by contacting us at hello@lifeinprogrezz.com.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ color: "#e8e6e1", fontSize: "1.1rem", marginBottom: ".75rem" }}>Contact</h2>
        <p>For any privacy-related questions, reach out to <a href="mailto:hello@lifeinprogrezz.com" style={{ color: "#c9a461" }}>hello@lifeinprogrezz.com</a>.</p>
      </section>
    </div>
  );
};

export default Privacy;
