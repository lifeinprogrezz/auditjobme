import { lovable } from "@/integrations/lovable/index";
import { useState } from "react";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError("");
    const { error } = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (error) {
      setError(error.message || "Login failed");
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "#0f0e0c",
      color: "#f0ede8",
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      padding: "24px",
    }}>
      <div style={{
        maxWidth: 400,
        width: "100%",
        textAlign: "center",
      }}>
        <h1 style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 400,
          fontSize: "clamp(1.9rem, 5.5vw, 3.4rem)",
          lineHeight: 1.08,
          letterSpacing: "-.04em",
          marginBottom: "1.5rem",
        }}>
          auditjob.me
        </h1>

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          style={{
            width: "100%",
            padding: "0.9rem",
            borderRadius: 8,
            border: "1px solid #2a2825",
            background: "#f0ede8",
            color: "#0f0e0c",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 600,
            fontSize: ".75rem",
            letterSpacing: ".08em",
            cursor: loading ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.6rem",
            opacity: loading ? 0.5 : 1,
            transition: "all .2s",
            marginBottom: "0.7rem",
          }}
        >
          {loading ? "Signing in..." : "Log in with Google"}
        </button>

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          style={{
            width: "100%",
            padding: "0.9rem",
            borderRadius: 8,
            border: "1px solid #2a2825",
            background: "transparent",
            color: "#f0ede8",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 500,
            fontSize: ".75rem",
            letterSpacing: ".08em",
            cursor: loading ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.6rem",
            opacity: loading ? 0.5 : 1,
            transition: "all .2s",
          }}
        >
          {loading ? "Creating account..." : "Create account with Google"}
        </button>

        {error && (
          <p style={{ color: "#e74c3c", fontSize: ".7rem", marginTop: "1rem" }}>{error}</p>
        )}
      </div>
    </div>
  );
}
