-- Track D F7 (auditjobme #38): close the RUBRIC_VERSION re-score gap on the nightly
-- matches path. The in-app (/roles) and score-backlog paths already filter cached
-- scores by rubric_version, so a rubric bump re-scores them lazily. daily_matches had
-- no such stamp, so the nightly worker (api/nightly.ts) could serve scores produced
-- under a superseded rubric forever. Record the rubric each batch was scored under;
-- decideNightlyAction() now re-scores a stale-rubric batch under the current rubric.
-- Additive + nullable: existing rows read as NULL → "stale" → re-scored once.
-- Written but NOT auto-applied — the orchestrator applies to prod via Supabase MCP.
ALTER TABLE public.daily_matches
  ADD COLUMN IF NOT EXISTS rubric_version text;

COMMENT ON COLUMN public.daily_matches.rubric_version IS
  'scorePrompt.ts RUBRIC_VERSION the batch was scored under; NULL/older = stale → re-scored by the nightly worker (F7).';
