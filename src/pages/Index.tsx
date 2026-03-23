import { useAuth } from "@/components/AuthProvider";
import AuditGenerator from "@/components/AuditGenerator";
import LoginPage from "@/components/LoginPage";

const Index = () => {
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
    return <LoginPage />;
  }

  return <AuditGenerator />;
};

export default Index;
