import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const userToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!userToken) {
    return json({ error: "missing_authorization" }, 401);
  }

  let payload: { orderId?: string; paymentKey?: string; amount?: number };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const { orderId, paymentKey, amount } = payload;
  if (!orderId || !paymentKey || typeof amount !== "number") {
    return json({ error: "missing_fields" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const tossSecretKey = Deno.env.get("TOSS_SECRET_KEY");

  if (!tossSecretKey) {
    return json({ error: "toss_secret_key_not_configured" }, 500);
  }

  // RLS-scoped client using the caller's own token: only returns the order
  // if it actually belongs to this user (or the caller is the admin).
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  });

  const { data: order, error: orderError } = await userClient
    .from("orders")
    .select("id, user_id, order_id, amount, status")
    .eq("order_id", orderId)
    .maybeSingle();

  if (orderError || !order) {
    return json({ error: "order_not_found" }, 404);
  }
  if (order.status === "paid") {
    return json({ ok: true, alreadyPaid: true });
  }
  if (order.amount !== amount) {
    return json({ error: "amount_mismatch" }, 400);
  }

  const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${tossSecretKey}:`)}`,
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });

  const tossData = await tossRes.json();
  if (!tossRes.ok) {
    return json({ error: "toss_confirm_failed", detail: tossData }, 502);
  }

  // service_role bypasses RLS: this is the only path that can ever mark an
  // order as paid, so a client can never forge its own payment status.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error: updateError } = await adminClient
    .from("orders")
    .update({
      status: "paid",
      payment_key: paymentKey,
      method: tossData.method ?? null,
      approved_at: tossData.approvedAt ?? new Date().toISOString(),
    })
    .eq("order_id", orderId);

  if (updateError) {
    return json({ error: "order_update_failed", detail: updateError.message }, 500);
  }

  return json({ ok: true });
});
