import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  build: {
    rollupOptions: {
      output: {
        // Split the big, stable vendors into their own cacheable chunks so the
        // app chunk stays small and a deploy doesn't re-ship react/radix/etc.
        // pdfjs is dynamically imported (see Onboarding/Profile) so it auto-splits.
        // Order matters: scoped packages whose paths contain "react" are matched
        // before the bare-react catch.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("maplibre")) return "maplibre";
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("@tanstack")) return "query";
          if (
            id.includes("/react-router") ||
            id.includes("/react-dom/") ||
            id.includes("/react/") ||
            id.includes("/scheduler/")
          )
            return "react-vendor";
        },
      },
    },
  },
}));
