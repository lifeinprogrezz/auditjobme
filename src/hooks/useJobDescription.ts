import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// jd_text is heavy (up to 8000 chars/row) and absent from the bulk /roles fetch —
// it's pulled for ONE job the moment its detail opens (Rober 2026-07-06). Returns
// the text for the CURRENTLY-requested id only: a stale in-flight response for a
// previous job can't leak into the newly-opened one. null text = no JD stored for
// this source (VC-board / big-tech list endpoints) → the panel links out instead.
export function useJobDescription(jobId: string | null): { text: string | null; loading: boolean } {
  const [state, setState] = useState<{ id: string | null; text: string | null; loading: boolean }>({
    id: null,
    text: null,
    loading: false,
  });

  useEffect(() => {
    if (!jobId) {
      setState({ id: null, text: null, loading: false });
      return;
    }
    let cancelled = false;
    setState({ id: jobId, text: null, loading: true });
    supabase
      .from("jobs")
      .select("jd_text")
      .eq("id", jobId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setState({ id: jobId, text: (data?.jd_text as string) ?? null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  // Guard against a render between id-change and fetch resolving.
  return { text: state.id === jobId ? state.text : null, loading: state.loading && state.id === jobId };
}
