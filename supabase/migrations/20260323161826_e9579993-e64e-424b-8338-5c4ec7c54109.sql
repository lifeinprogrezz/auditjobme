
-- Audits table to store audit history
CREATE TABLE public.audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  company_name text NOT NULL,
  role_name text,
  audit_label text,
  accent_color text DEFAULT '#8a9a8a',
  job_link text,
  audit_data jsonb NOT NULL,
  pdf_path text,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own audits"
  ON public.audits FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own audits"
  ON public.audits FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own audits"
  ON public.audits FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Storage bucket for PDF files
INSERT INTO storage.buckets (id, name, public)
VALUES ('audit-pdfs', 'audit-pdfs', true);

-- Storage policies
CREATE POLICY "Users can upload own PDFs"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'audit-pdfs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Anyone can view PDFs"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'audit-pdfs');

CREATE POLICY "Users can delete own PDFs"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'audit-pdfs' AND (storage.foldername(name))[1] = auth.uid()::text);
