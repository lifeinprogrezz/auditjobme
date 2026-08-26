-- Issue #151 (D4): the per-role "anything specific for this one?" box needs to
-- persist on its own, independent of generating a CV, letter, or answer — a new
-- artifact kind ('notes') carries just that, content '{}', the note in the
-- existing `context` column (issue #76).
--
-- While widening this constraint: src/pages/Apply.tsx has called
-- saveArtifact("answers", ...) since the drafted-answers step shipped, but the
-- original artifacts_kind_check (20260614190000) only ever allowed
-- ('cv','letter','audit') — every answer save has been failing its insert and
-- surfacing "couldn't save a copy to your bundle" ever since. Fixed here too,
-- same table, same constraint, same feature area.
alter table public.artifacts
  drop constraint artifacts_kind_check;

alter table public.artifacts
  add constraint artifacts_kind_check
  check (kind in ('cv', 'letter', 'audit', 'answers', 'notes'));

comment on constraint artifacts_kind_check on public.artifacts is
  'cv/letter/audit = the original generated bundle (20260614190000). answers = drafted form-question answers, including the common pack (src/pages/Apply.tsx saveArtifact("answers", ...) predates this constraint update — issue #151). notes = the per-role "anything specific?" box saved on its own via Save / autosave-on-blur, independent of generating anything (issue #151, D4).';
