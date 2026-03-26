
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  raw_name text;
  base_username text;
  final_username text;
  counter int := 0;
BEGIN
  -- Prefer display name from OAuth, fall back to email prefix
  raw_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );
  
  -- Transliterate accented characters to ASCII equivalents
  base_username := lower(raw_name);
  base_username := translate(base_username,
    'àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ',
    'aaaaaaaceeeeiiiidnoooooouuuuyty');
  -- Remove any remaining non-alphanumeric characters
  base_username := regexp_replace(base_username, '[^a-z0-9]+', '-', 'g');
  -- Remove leading/trailing dashes
  base_username := trim(both '-' from base_username);
  
  -- If result is empty or too short, fall back to email prefix
  IF length(base_username) < 2 THEN
    base_username := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9]+', '-', 'g'));
    base_username := trim(both '-' from base_username);
  END IF;
  
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
$function$;
