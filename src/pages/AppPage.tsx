import { useAuth } from "@/components/AuthProvider";
import AuditGenerator from "@/components/AuditGenerator";

const AppPage = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f0e0c",
        color: "#8a8780",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        fontSize: ".7rem",
        letterSpacing: ".1em",
        textTransform: "uppercase" as const,
      }}>
        Loading...
      </div>
    );
  }

  if (!user) {
    window.location.href = "/";
    return null;
  }

  return <AuditGenerator />;
};

export default AppPage;
