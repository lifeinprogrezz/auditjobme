-- Pre-CV anonymous browsing (the /roles globe, spec: glass-design skill —
-- "Pre-CV = anonymous browsable map + roles"): anyone may READ live job
-- postings. Approved by Rober 2026-07-05. Jobs are public postings scraped
-- from public boards — no user data. scores / profiles / applications stay
-- authenticated + own-row; anon still cannot write anything.
create policy "Anyone can read live jobs"
  on public.jobs
  for select
  to anon
  using (is_live = true);
