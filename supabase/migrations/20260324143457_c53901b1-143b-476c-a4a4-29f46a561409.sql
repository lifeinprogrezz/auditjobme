CREATE TABLE public.whitelisted_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whitelisted_emails ENABLE ROW LEVEL SECURITY;

INSERT INTO public.whitelisted_emails (email) VALUES ('quinterostudio3@gmail.com');
