import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/components/AuthProvider";

// Route-level code-splitting. Pre-launch, the app serves ONLY the interactive map
// and the coming-soon placeholder; the rest of the product (digest/apply/audit/
// profile/…) is built but not routed yet — re-add routes here to bring a page back.
const RolesMap = lazy(() => import("./pages/RolesMap.tsx"));
const UnderConstruction = lazy(() => import("./pages/UnderConstruction.tsx"));

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
              <Route path="/roles" element={<RolesMap />} />
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
