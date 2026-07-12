// Auth gate for the routed product surfaces (issue #42). A signed-out visitor who
// deep-links to /today, /tracker, or /apply gets a token-layer sign-in card that
// returns them to the SAME page after Google OAuth, instead of a dead-end redirect.
// The map (/) stays the public front door; only personalized surfaces gate here.
import { useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground" role="status" aria-live="polite">
        Loading…
      </div>
    );
  }

  if (!user) {
    const signIn = async () => {
      setBusy(true);
      setError("");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        // Return to exactly where they were headed.
        options: { redirectTo: window.location.href },
      });
      if (error) {
        setError(error.message || "Sign-in failed. Please try again.");
        setBusy(false);
      }
    };
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="font-display text-xl font-semibold text-foreground">Sign in to continue</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your matches, tracker, and apply bundle are private to you. Sign in to pick up where you left off.
          </p>
          <Button className="mt-6 w-full" onClick={signIn} disabled={busy}>
            <GoogleMark />
            {busy ? "One moment…" : "Continue with Google"}
          </Button>
          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
          <a href="/" className="mt-6 block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Back to the map
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
