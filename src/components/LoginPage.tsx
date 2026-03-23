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
          marginBottom: "0.6rem",
        }}>
          Audit Generator
        </h1>
        <p style={{
          fontSize: ".7rem",
          color: "#8a8780",
          maxWidth: 320,
          margin: "0 auto 2rem",
          lineHeight: 1.5,
          letterSpacing: ".04em",
          fontWeight: 500,
        }}>
          Generate personalized company audits with AI.
        </p>

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
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
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
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {loading ? "Creating account..." : "Create account with Google"}
        </button>

        {error && (
          <p style={{ color: "#e74c3c", fontSize: ".7rem", marginTop: "1rem" }}>{error}</p>
        )}
      </div>
    </div>
  );
}
