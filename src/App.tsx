import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/components/AuthProvider";
import Index from "./pages/Index.tsx"; // eager: the landing is the first paint

// Route-level code-splitting: each page loads on navigation, so a landing
// visitor never downloads the authed app (digest/apply/audit/profile/...).
const PublicAudit = lazy(() => import("./pages/PublicAudit.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Privacy = lazy(() => import("./pages/Privacy.tsx"));
const Terms = lazy(() => import("./pages/Terms.tsx"));
const Digest = lazy(() => import("./pages/Digest.tsx"));
const AuditGenerator = lazy(() => import("@/components/AuditGenerator"));
const Tracker = lazy(() => import("./pages/Tracker.tsx"));
const Profile = lazy(() => import("./pages/Profile.tsx"));
const Apply = lazy(() => import("./pages/Apply.tsx"));
const RequestCompany = lazy(() => import("./pages/RequestCompany.tsx"));
const RolesMap = lazy(() => import("./pages/RolesMap.tsx"));

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
              <Route path="/" element={<Index />} />
              <Route path="/a/:username/:slug" element={<PublicAudit />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/digest" element={<Digest />} />
              <Route path="/audit" element={<AuditGenerator />} />
              <Route path="/apply" element={<Apply />} />
              <Route path="/tracker" element={<Tracker />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/request" element={<RequestCompany />} />
              <Route path="/roles" element={<RolesMap />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
