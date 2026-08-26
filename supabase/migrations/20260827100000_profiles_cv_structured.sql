-- Structured CV profile (#150). The tailored CV used to print cv_text as one
-- paragraph under "CURRICULUM VITAE": no sections, no bullets, no dates.
--
-- The fix parses the CV ONCE at upload into a structured profile and renders every
-- tailored CV from that JSON, deterministically. The parse is a single language
-- model call whose output is validated against cv_text before it is stored: a
-- bullet or a date the CV does not contain is dropped, never saved. So this column
-- holds the user's own words, re-shaped, and never new claims about them.
--
-- The per-role language model call stays the professional summary and nothing else
-- (the CV trust rule, README + CLAUDE.md hard rule 1).

alter table public.profiles
  add column if not exists cv_structured jsonb;

comment on column public.profiles.cv_structured is
  'Structured parse of cv_text: {contact, summary, experience[], education[], skills[], extras[]} (src/lib/cvStructured.ts). Written once per CV at upload, editable by the owner in Settings. NULL means not parsed yet: the tailored CV falls back to the plain cv_text render. Every bullet and date in here is a verbatim substring of cv_text, enforced by the validator before the write.';

alter table public.profiles
  add column if not exists cv_structured_at timestamptz;

comment on column public.profiles.cv_structured_at is
  'When a parse last RAN, or the owner last edited the structure in Settings. Two jobs (src/lib/cvParse.ts readCvStructuredState). (1) Older than cv_changed_at means the structure was parsed from a PREVIOUS cv_text: it is thrown away rather than printed, so a re-parse that never landed can never put the old CV''s jobs on the new one. (2) Set and current means the parse already ran, EVEN IF cv_structured is null or too thin to render: the parse is a paid call on a page that loads every visit, so it is decided once, not retried forever. A CV upload clears both columns together.';
