---
description: Deploy auditjob.me to Vercel production, confirm the deploy is healthy, and report
allowed-tools: Bash
---
Ship the current state of the auditjob.me web app to Vercel production. Run from the repo root; stop and report at the first hard failure. This is the deploy half of the deploy→check→iterate loop (`/verify` is the local half).

1. **Gate on a local verify first** — `npm run build && npm test`, then smoke-walk a local preview: `npm run preview -- --port 8080 &`, wait ~3s for it to bind, `node scripts/verify-smoke.mjs http://localhost:8080`, then kill the server (`fuser -k 8080/tcp`). Do NOT deploy if any hard check fails — quote the exact failure and stop.
2. **Deploy to production** — `vercel deploy --prod --yes` (the repo is linked to the `auditjobme` Vercel project; the auth'd CLI handles the rest). Capture the deployment URL it prints.
3. **Confirm healthy** — the command returns once the build finishes; confirm `readyState`/`state` is `READY`, not `ERROR`. If ERROR, fetch build logs (`vercel inspect <url> --logs`, or open the inspector URL) and report the failing step — do not claim shipped.
4. **Report** — a short summary: production URL, inspector URL, READY/ERROR, and the commit SHA deployed. Never claim shipped without the READY evidence.

**Note — live-URL smoke is currently blocked by Vercel deployment protection** (deployments return 401 to unauthenticated clients, so a headless smoke against the live URL can't load it). Until protection is turned off (at launch) or a Protection-Bypass-for-Automation token is configured, the functional gate is the *local* smoke in step 1, and step 3 confirms only that the deployment built and is live. Once a bypass token exists, extend this skill to also run `node scripts/verify-smoke.mjs <prod-url>` with the `x-vercel-protection-bypass` header.
