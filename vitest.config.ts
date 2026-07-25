import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Placeholder client config so the suite never depends on real project values.
    // src/integrations/supabase/client.ts builds a client at import time, so any
    // test importing a module that reaches it needs a syntactically valid URL and
    // key. These are deliberately fake — unit tests must not touch a live project.
    // Until .env was untracked (1f06a78) these came from the committed file, which
    // quietly coupled the whole suite to real infrastructure.
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-anon-key",
      VITE_SUPABASE_PROJECT_ID: "test",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
