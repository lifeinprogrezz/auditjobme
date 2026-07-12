import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const user = BYPASS_AUTH ? MOCK_USER : (session?.user ?? null);

  return (
    <AuthContext.Provider value={{ session, user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
