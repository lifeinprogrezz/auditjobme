# Should Northgoing expose an MCP server?

Decide-once evaluation, 2026-07-25, closing part 2 of issue #60.
**Recommendation: PARK** — with one cheap precursor worth doing now.
Final call is Rober's; this document exists so the question is answered once and not
re-litigated in conversation.

## The question

Expose Northgoing's capabilities over the Model Context Protocol so agents and external
tools can consume the product programmatically — role and company queries, per-user scored
matches, and generation (tailored CV, cover letter, form answers, company audit).

## What the asset actually is

The differentiated thing here is not the screens. It is the **enriched European catalog**:
roughly 840 live roles across 350 companies, each carrying fields nobody else joins together
— workplace mode, job-description language, years-of-experience floor, visa and relocation
signals, United Kingdom sponsor-licence status, company size band, and per-city offices.
That is genuinely worth querying from an agent.

## Why the read half is already shipped

`scripts/build-dataplane.mjs` publishes the entire catalog daily to a **public** Storage
bucket:

```
{SUPABASE_URL}/storage/v1/object/public/dataplane/dataplane.json
{SUPABASE_URL}/storage/v1/object/public/dataplane/jobs.ndjson
```

No authentication, no rate limit, one HTTP GET. Any agent that can fetch a URL already has
the whole catalog, in a newline-delimited format that streams cleanly into a model context.
An MCP server wrapping read queries would be a thin convenience layer over something a
capable agent can already do — real work, marginal gain.

## Why the write half can't ship yet

Generation endpoints route to `anthropic-proxy`, which spends against Rober's Anthropic key.
**Spend caps were deliberately removed pre-launch** (issue #35), leaving `usage_events`
metering as the only spend surface. An MCP tool that generates a tailored CV is therefore an
uncapped, externally-triggerable cost on a personal API key.

That is not a reason to build caps now — the removal is a settled decision. It is a reason
the generation half of an MCP server is **blocked on #35**, not on engineering effort.

Two further costs that land the same way:

- **Authentication.** Anything per-user (your scores, your saved roles, your tracker) needs
  OAuth against Supabase. That is a real authorization surface on a product whose security
  model is "row-level security is the enforcement layer" — a new token path is exactly where
  that model gets holes.
- **Maintenance.** A published tool contract is a promise. Today the schema still moves
  (`role_family` is nullable pending the all-vertical engine, #34); freezing a public surface
  over a moving schema buys churn.

## What tips it to PARK rather than KILL

The strategic case is real, just not yet. Agent-mediated job search is a plausible way this
product gets used, and an MCP server is how it would participate. It also rhymes with two
items already on the board — the zero-CAC content funnel (#46), which bets on answer engines
citing us, and the persistent agent shell (#45), which would make an internal agent a
first-class surface. If either of those gets picked up, revisit this together with it rather
than separately.

**Revisit when any of these is true:** #35 economics is designed and caps exist · #45 is
chosen and needs a tool layer anyway · real demand appears (someone asks, or the dataplane
artifact shows meaningful agent traffic) · the schema settles after #34.

## The cheap precursor, worth doing now

The catalog is already public but effectively undiscoverable — nothing tells an agent it
exists. The build already emits `llms.txt` for exactly this audience (the geo-prerender step
in `vite.config.ts`, shipped with #39).

**Advertise the dataplane artifacts in `llms.txt`** with a one-line field description and the
two URLs. That is a handful of lines, no new surface, no authentication, no spend, and it
captures most of the agent-consumption value an MCP read server would have delivered. It also
directly serves #46, whose whole thesis is being the citable source.

Not done in this pass — it belongs to whoever picks up #46 or a follow-up to this evaluation,
and it should ship alongside a decision about how much of the schema we want to commit to
publicly.

## Verdict

**PARK the MCP server.** The read half is redundant against a public artifact that already
exists, the write half is blocked on launch economics, and the schema is still moving. Do the
`llms.txt` precursor when #46 or a discovery pass comes up. Reopen deliberately against one
of the four triggers above, not on impulse.
