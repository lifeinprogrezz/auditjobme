
-- Add username to profiles
ALTER TABLE public.profiles ADD COLUMN username text UNIQUE;

-- Add slug and published flag to audits (public by default)
ALTER TABLE public.audits ADD COLUMN slug text;
ALTER TABLE public.audits ADD COLUMN is_published boolean DEFAULT true NOT NULL;

-- Unique constraint: one slug per user
ALTER TABLE public.audits ADD CONSTRAINT audits_user_slug_unique UNIQUE (user_id, slug);

-- Public can view published audits (for shareable links)
CREATE POLICY "Anyone can view published audits"
  ON public.audits FOR SELECT
  TO anon
  USING (is_published = true);

-- Public can view profiles (for username lookup)
CREATE POLICY "Anyone can view profiles"
  ON public.profiles FOR SELECT
  TO anon
  USING (true);

-- Update the trigger to auto-generate username
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_username text;
  final_username text;
  counter int := 0;
BEGIN
  -- Generate username from name or email
  base_username := lower(regexp_replace(
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    '[^a-z0-9]', '-', 'g'
  ));
  -- Remove leading/trailing/double dashes
  base_username := regexp_replace(base_username, '-+', '-', 'g');
  base_username := trim(both '-' from base_username);
  
  -- Handle uniqueness
  final_username := base_username;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    counter := counter + 1;
    final_username := base_username || counter;
  END LOOP;

  INSERT INTO public.profiles (id, email, display_name, avatar_url, username)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    final_username
  );
  RETURN NEW;
END;
$$;

-- Helper function to generate audit slug
CREATE OR REPLACE FUNCTION public.generate_audit_slug(p_user_id uuid, p_company text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_slug text;
  final_slug text;
  counter int := 0;
BEGIN
  base_slug := lower(regexp_replace(p_company, '[^a-z0-9]', '-', 'gi'));
  base_slug := regexp_replace(base_slug, '-+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  
  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM public.audits WHERE user_id = p_user_id AND slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;
  
  RETURN final_slug;
END;
$$;
