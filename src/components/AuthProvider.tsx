import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { markSessionSeen } from "@/lib/deviceSession";
import { captureRefToken, claimStoredReferral, type ClaimRpc } from "@/lib/referral";

// Issue #78 (attribution only) — landing on `/?ref={token}` stashes the token in
// localStorage (Google OAuth redirects back to the bare origin, so the query string
// alone would not survive sign-up), and once a session exists the stashed token is
// handed to the server-side claim_referral() RPC exactly once. Both are best-effort
// and fire-and-forget: RLS + the RPC's own rules are the enforcement, this is just
// the courier. claim_referral is not in the generated types until the migration is
// applied and types.ts is regenerated (same note as delete_own_account).
function claimReferralIfStashed() {
  const rpc = ((fn: string, args: object) => supabase.rpc(fn as never, args as never)) as unknown as ClaimRpc;
  void claimStoredReferral(rpc, window.localStorage).catch(() => {
    /* best-effort — never in the way of sign-in */
  });
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  signOut: async () => {},
});

// eslint-disable-next-line react-refresh/only-export-components -- context hook intentionally colocated with its provider
export const useAuth = () => useContext(AuthContext);

// Dev-only auth bypass for automated UI verification. A git-worktree Playwright pass
// can't obtain the seeded E2E Supabase credentials (blocked by the secrets guardrail),
// so with VITE_E2E_BYPASS_AUTH=1 under `vite dev` we hand RequireAuth a mock user to
// render the authed shells (Today / Tracker / Apply). DOUBLE-gated on import.meta.env.DEV
// so a production `vite build` statically dead-code-eliminates it. The client gate is
// only decoration — RLS is the real enforcement and this mock carries no JWT, so every
// protected query still returns empty; the data layer stays locked regardless.
const BYPASS_AUTH =
  import.meta.env.DEV && import.meta.env.VITE_E2E_BYPASS_AUTH === "1";

// Exported so dev-only consumers (the post-sign-in CV gate) can skip flows that
// make no sense for the mock user — it has no profile, so the gate would pop the
// CV modal over every bypassed UI-verification walk.
// eslint-disable-next-line react-refresh/only-export-components -- dev-only const colocated with its gate
export const AUTH_BYPASSED = BYPASS_AUTH;

const MOCK_USER = {
  id: "00000000-0000-0000-0000-000000000000",
  aud: "authenticated",
  role: "authenticated",
  email: "e2e-dev@auditjob.me",
  app_metadata: {},
  user_metadata: { display_name: "E2E Dev" },
  created_at: new Date(0).toISOString(),
} as unknown as User;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!BYPASS_AUTH);

  useEffect(() => {
    if (BYPASS_AUTH) return;

    // Referral capture must run BEFORE the sign-in it hopes to attribute.
    try {
      captureRefToken(window.location.search, window.localStorage);
    } catch {
      /* ignore — attribution is best-effort */
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          markSessionSeen();
          claimReferralIfStashed();
        }
        setSession(session);
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        markSessionSeen();
        claimReferralIfStashed();
      }
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Returning-user sign-in (Rober 7-15): the header's "Sign in" and the CV modal's
  // returning-user line both route through Google OAuth. redirectTo lands the user
  // back on the map; the post-sign-in gate re-opens the CV modal if the profile has
  // no CV, so the CV-mandatory invariant holds.
  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const user = BYPASS_AUTH ? MOCK_USER : (session?.user ?? null);

  return (
    <AuthContext.Provider value={{ session, user, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
