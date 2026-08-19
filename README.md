# Northgoing

A live map of European tech roles, scored against your CV.

Roles are collected daily from applicant tracking systems, venture portfolio boards, and
startup directories, then ranked by how well each one fits the CV you upload. Once a role
looks worth it, the app prepares the application: a tailored CV that keeps your own words,
a cover letter, and answers to the form's questions.

The catalog opens with product roles — a wedge, not a ceiling. The schema and filtering
already carry a `role_family` dimension so further disciplines slot in without reshaping
the engine.

Live at **[northgoing.com](https://northgoing.com)**. The old address, `auditjob.me`,
redirects here permanently.

## Stack

Vite + React + TypeScript on Vercel, Supabase for Postgres and auth, Anthropic's Claude for
scoring and generation behind a single server-side proxy, and GitHub Actions for the
scheduled ingestion and scoring jobs.

## Getting started

```bash
npm ci
cp .env.example .env     # fill in the VITE_ values
npm run dev              # http://localhost:8080
```

Node 24. Then:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

## Documentation

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — how the system fits together, the data
  plane, the scoring paths, database and deploy conventions, and the invariants worth
  knowing before you change anything
- [`docs/DATA_CONTRACT.md`](./docs/DATA_CONTRACT.md) — the job-row schema
- [`docs/scoring-benchmarks.md`](./docs/scoring-benchmarks.md) — scorer calibration
- [`PRODUCT.md`](./PRODUCT.md) — what the product is and where it's going

## License

MIT — free to use, modify, and distribute. See [`LICENSE`](./LICENSE).
