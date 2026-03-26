
CREATE OR REPLACE FUNCTION public.get_global_avg_duration()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT ROUND(AVG(ds))::integer
     FROM (
       SELECT duration_seconds AS ds
       FROM public.audits
       WHERE duration_seconds IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 20
     ) recent),
    120
  );
$$;
