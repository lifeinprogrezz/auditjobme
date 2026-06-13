---
description: Build, test, and smoke-walk the canonical user path of the auditjob.me web app
allowed-tools: Bash
---
Verify the auditjob.me web app actually works, not just that it compiles. Run these steps in order from the repo root (`/home/roberto05/Documentos/Coding/auditjobme`); stop and report at the first hard failure.

1. **Static checks** — `npm run build` then `npm test`. Both must pass. (Lint has known pre-existing warnings; don't gate on it.)
2. **Start a preview server** in the background: `npm run build && npm run preview -- --port 8080 &` then wait ~3s for it to bind. (Use `preview`, not `dev`, so the smoke walk hits the production bundle.)
3. **Smoke-walk the canonical path** (what exists today): `node scripts/verify-smoke.mjs http://localhost:8080`. It asserts the landing hero + CTA, the privacy and terms pages, and the 404 fallback render. Exit 0 = pass.
4. **Stop the preview server** (kill the background job / `fuser -k 8080/tcp`).
5. **Report** a short pass/fail summary: build, test, and each smoke check. If anything failed, quote the exact failing output — never claim green without the evidence.

The canonical path is partial today (auth + onboarding + digest + apply aren't built). `scripts/verify-smoke.mjs` carries `CANONICAL-PATH TODO` markers; extend its `CHECKS` array as each step ships so /verify always walks the full path. This skill is the local half of the deploy→check→iterate loop; CI runs the same smoke against a Vercel preview.
