import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRODUCTS: Record<string, { credits: number }> = {
  price_1TFAx3EGIsQV5qrb6RPI0x4s: { credits: 1 },
  price_1TFAykEGIsQV5qrbA4Ooz0R5: { credits: 5 },
  price_1TFAztEGIsQV5qrbxyzW2vXF: { credits: 10 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  );

  try {
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabaseClient.auth.getUser(token);
    const user = userData.user;
    if (!user) throw new Error("User not authenticated");

    const { sessionId } = await req.json();
    if (!sessionId) throw new Error("Missing session ID");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return new Response(JSON.stringify({ success: false, error: "Payment not completed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Check if already recorded
    const { data: existing } = await supabaseClient
      .from("purchases")
      .select("id")
      .eq("stripe_session_id", sessionId)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ success: true, already_recorded: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Determine credits from line items
    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 1 });
    const priceId = lineItems.data[0]?.price?.id;
    const credits = PRODUCTS[priceId]?.credits || 1;
    const productId = lineItems.data[0]?.price?.product as string;

    // Record purchase
    const { error: insertError } = await supabaseClient
      .from("purchases")
      .insert({
        user_id: user.id,
        stripe_session_id: sessionId,
        credits,
        product_id: productId,
      });

    if (insertError) throw new Error(`Failed to record purchase: ${insertError.message}`);

    return new Response(JSON.stringify({ success: true, credits }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
