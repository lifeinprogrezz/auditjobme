import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { renderSite, type SiteInput } from "./src/lib/geo-pages";

// Public GEO surface prerender (Track D F2, issue #39). SSG-in-Vite: after the SPA
// build writes dist/, this plugin fetches the F3 static dataplane artifact ONCE and
// emits real, crawler-visible HTML for the finite city×vertical page set plus
// sitemap.xml and llms.txt. The authed SPA is untouched (these are standalone
// content pages, not React routes) and the Vercel SPA rewrite never shadows them —
// Vercel serves a matching dist/ file before the (?!api/) → index.html rewrite fires.
//
// Data source order: GEO_DATAPLANE_FILE (a local dataplane.json, for offline/CI
// determinism) → else fetch {VITE_SUPABASE_URL}/storage/v1/object/public/dataplane/
// dataplane.json. On ANY failure the build still succeeds with a baseline sitemap +
// llms.txt (never break the deploy over a discovery-surface artifact).
function geoPrerenderPlugin(env: Record<string, string>): Plugin {
  const origin = env.GEO_SITE_ORIGIN || "https://auditjob.me";
  const localFile = env.GEO_DATAPLANE_FILE || process.env.GEO_DATAPLANE_FILE;
  const supabaseUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";

  async function loadDataplane(): Promise<SiteInput | null> {
    if (localFile) {
      try {
        return JSON.parse(await readFile(localFile, "utf8")) as SiteInput;
      } catch (e) {
        console.warn(`[geo-prerender] could not read GEO_DATAPLANE_FILE (${localFile}):`, (e as Error).message);
        return null;
      }
    }
    if (!supabaseUrl) {
      console.warn("[geo-prerender] no VITE_SUPABASE_URL and no GEO_DATAPLANE_FILE → baseline only.");
      return null;
    }
    const url = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/dataplane/dataplane.json`;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15_000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) {
        console.warn(`[geo-prerender] dataplane fetch ${res.status} → baseline only.`);
        return null;
      }
      return (await res.json()) as SiteInput;
    } catch (e) {
      console.warn("[geo-prerender] dataplane fetch failed → baseline only:", (e as Error).message);
      return null;
    }
  }

  let outDir = "dist";
  return {
    name: "geo-prerender",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      const plane = await loadDataplane();
      const input: SiteInput = plane ?? { jobs: [], companies: [], generated_at: new Date().toISOString() };
      const files = renderSite(input, { origin });
      for (const f of files) {
        const abs = path.resolve(outDir, f.path);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, f.content, "utf8");
      }
      const pageCount = files.filter((f) => f.path.startsWith("jobs/") && f.path.endsWith("index.html") && f.path !== "jobs/index.html").length;
      console.log(`[geo-prerender] wrote ${pageCount} city page(s) + sitemap.xml + llms.txt to ${outDir}/`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load VITE_* + the GEO_* build knobs (empty prefix = all keys).
  const env = loadEnv(mode, process.cwd(), "");
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), geoPrerenderPlugin(env)],
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
  };
});
