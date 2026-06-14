-- #5: make audit-pdfs private + give owners SELECT so they can mint signed URLs.
-- audit-pdfs is owner-only (AuditGenerator upload + the owner's own audit-history view);
-- the anon published-audit page does NOT use the bucket, so no anon policy is needed.
-- The code reads stored audits via createSignedUrl (owner) instead of a public object URL.
update storage.buckets set public = false where id = 'audit-pdfs';

create policy "Users can view own PDFs" on storage.objects
  for select to authenticated
  using (bucket_id = 'audit-pdfs' and (storage.foldername(name))[1] = (auth.uid())::text);
