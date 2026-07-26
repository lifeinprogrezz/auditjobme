-- #90 (Rober's call, issue comment 2026-07-26): "audits start private" has to
-- be true for every existing row too, not just ones generated after this fix.
-- Every audit created before this commit carries is_published = true (the bug
-- this issue closes -- AuditGenerator hard-coded it on every insert). Flipping
-- them to private is the safer default and costs nothing today: nobody has
-- shared one publicly yet, so no live link breaks. Any owner who wants their
-- existing audit shareable again just presses the new "Publish & Get Link"
-- control once.
UPDATE public.audits SET is_published = false WHERE is_published = true;
