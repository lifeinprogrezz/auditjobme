
CREATE TABLE public.device_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_id text NOT NULL,
  user_id uuid NOT NULL,
  audit_id uuid REFERENCES public.audits(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_fingerprints_fp ON public.device_fingerprints(fingerprint_id);
CREATE INDEX idx_device_fingerprints_user ON public.device_fingerprints(user_id);

ALTER TABLE public.device_fingerprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own fingerprints"
  ON public.device_fingerprints FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own fingerprints"
  ON public.device_fingerprints FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to count total free audits by device fingerprint across ALL accounts
CREATE OR REPLACE FUNCTION public.count_audits_by_fingerprint(p_fingerprint text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.device_fingerprints
  WHERE fingerprint_id = p_fingerprint;
$$;
