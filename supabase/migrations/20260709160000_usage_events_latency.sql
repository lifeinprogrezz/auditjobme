-- Benchmark instrumentation (2026-07-09): record inference latency (proxy→Anthropic
-- round-trip, in ms) alongside the existing token/cost metering, so scoring benchmarks
-- read REAL latency instead of an estimate. usage_events already holds real input/output
-- tokens + cost per call (written service-role by anthropic-proxy) — this is the one
-- missing dimension. Nullable: historical rows stay NULL; the proxy populates it going
-- forward. Written service-role only (same write-lock as the rest of the row). Idempotent.
alter table public.usage_events add column if not exists latency_ms integer;
alter table public.usage_events drop constraint if exists usage_events_latency_nonneg;
alter table public.usage_events
  add constraint usage_events_latency_nonneg check (latency_ms is null or latency_ms >= 0);
