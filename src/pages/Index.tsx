import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import LandingPage from "@/components/LandingPage";
import Onboarding from "@/components/Onboarding";
import Digest from "@/pages/Digest";

const LoadingScreen = () => (
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

const Index = () => {
  const { user, loading } = useAuth();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) {
      setOnboarded(null);
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("onboarded_at")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setOnboarded(!!data?.onboarded_at);
      });
    return () => {
      active = false;
    };
  }, [user]);

  if (loading) return <LoadingScreen />;
  if (!user) return <LandingPage />;
  if (onboarded === null) return <LoadingScreen />; // fetching profile
  if (!onboarded) return <Onboarding onComplete={() => setOnboarded(true)} />;
  return <Digest />;
};

export default Index;
