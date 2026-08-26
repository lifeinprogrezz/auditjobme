import { lazy, Suspense, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/components/AuthProvider";
import RequireAuth from "@/components/app/RequireAuth";

// Route-level code-splitting. The interactive map owns the root domain; the dark
// product surfaces (Today / Tracker / Apply, issue #42) hang off it, auth-gated,
// and the legal pages are public. Everything else still shows the coming-soon page.
const RolesMap = lazy(() => import("./pages/RolesMap.tsx"));
const UnderConstruction = lazy(() => import("./pages/UnderConstruction.tsx"));
const Today = lazy(() => import("./pages/Today.tsx"));
const Tracker = lazy(() => import("./pages/Tracker.tsx"));
const Apply = lazy(() => import("./pages/Apply.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));
const Privacy = lazy(() => import("./pages/Privacy.tsx"));
const Terms = lazy(() => import("./pages/Terms.tsx"));
// The standalone company-audit generator (issue #82) — Apply Step 3 links here
// with ?job=<url> prefilled; nothing on this route runs until its own explicit
// "Generate" button is pressed. Gated like the rest of the product surfaces
// since it reads the signed-in user's audit history.
const Audit = lazy(() => import("@/components/AuditGenerator.jsx"));
// The public, shareable audit page (issue #82) — anyone with the link, signed
// in or not, so this route stays ungated.
const PublicAudit = lazy(() => import("./pages/PublicAudit.tsx"));

const gated = (node: ReactNode) => <RequireAuth>{node}</RequireAuth>;

const queryClient = new QueryClient();

const PageFallback = () => (
  <div
    className="flex min-h-screen items-center justify-center text-muted-foreground"
    role="status"
    aria-live="polite"
  >
    Loading…
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              {/* Pre-launch: the interactive roles map is the only live surface and
                  owns the root domain (/roles is an alias). EVERY other path — feature
                  pages, legal, shared audits, unknown URLs — shows the coming-soon
                  placeholder until those pages ship (Rober 7-06). */}
              <Route path="/" element={<RolesMap />} />
              {/* The globe IS the landing at the bare domain (Rober 7-12) —
                  /roles survives only as a redirect so old links keep working. */}
              <Route path="/roles" element={<Navigate to="/" replace />} />
              {/* Dark product surfaces (issue #42) — auth-gated. Reached from the map
                  shell: the avatar menu opens Today/Tracker, and a role card links to
                  /apply only once a CV is stored (RolesPanel.goApply, gated on hasCv).
                  A logged-out visitor gets the "Add your CV to see your fit" prompt
                  instead of a /apply link, so there is no dead nav path. */}
              <Route path="/today" element={gated(<Today />)} />
              <Route path="/digest" element={<Navigate to="/today" replace />} />
              <Route path="/tracker" element={gated(<Tracker />)} />
              <Route path="/apply" element={gated(<Apply />)} />
              {/* Company audit (issue #82): the generator itself is gated (it's tied to
                  the signed-in user's CV + audit history); the page it produces is a
                  public share link, so /a/:username/:slug stays open to anyone. */}
              <Route path="/audit" element={gated(<Audit />)} />
              <Route path="/a/:username/:slug" element={<PublicAudit />} />
              {/* Settings as a routed surface (Rober 7-25) — was the map ProfileModal. */}
              <Route path="/settings" element={gated(<Settings />)} />
              {/* Public legal pages (the noscript footer links these). */}
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/underconstruction" element={<UnderConstruction />} />
              <Route path="*" element={<Navigate to="/underconstruction" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
