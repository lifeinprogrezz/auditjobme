import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center",
      justifyContent: "center",
      background: "#0f0e0c",
      color: "#f0ede8",
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      gap: 12,
    }}>
      <p style={{ fontSize: "1.5rem", fontFamily: "'DM Sans', sans-serif", fontWeight: 800 }}>404</p>
      <p style={{ fontSize: ".75rem", color: "#8a8780" }}>Page not found</p>
      <a href="/" style={{ fontSize: ".65rem", color: "#8a9a8a", textDecoration: "none", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase" as const, marginTop: 8 }}>
        ← Back to home
      </a>
    </div>
  );
};

export default NotFound;