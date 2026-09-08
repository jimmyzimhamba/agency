// ============================================================================
// STUDIO X COMMAND, Edge Function: review-reorder
// ============================================================================
// What this does, in plain language:
//   Lets the public client review page drag-reorder the grid tiles, same
//   pointer-drag interaction as the agency builder (Slice 3), just hitting
//   this endpoint instead of writing to Supabase directly.
//
//   Takes the FULL ordered list of post ids for the plan (same shape
//   enablePointerReorder's onReorder callback already produces on the
//   agency side) rather than a single "move post X to position Y", that
//   makes the validation simple and airtight: the set of ids sent has to be
//   EXACTLY the set of post ids that already belong to this plan, no more,
//   no less. Anything else (an id from another plan, a missing id, a
//   duplicate) is rejected outright rather than partially applied.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RATE_LIMIT = 30;
const RATE_WINDOW_SECONDS = 60;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { token, order } = await req.json();
    if (!token || typeof token !== "string" || token.length < 16) {
      return json({ error: "Invalid or expired link" }, 404);
    }
    if (!Array.isArray(order) || !order.length || !order.every((id) => typeof id === "string")) {
      return json({ error: "order must be a non-empty array of post ids" }, 400);
    }

    const allowed = await checkRateLimit(admin, `reorder:${token}`, RATE_LIMIT, RATE_WINDOW_SECONDS);
    if (!allowed) return json({ error: "Too many requests, please wait a moment and try again" }, 429);

    const plan = await resolvePlan(admin, token);
    if (!plan) return json({ error: "Invalid or expired link" }, 404);

    const { data: existingPosts, error: postsErr } = await admin.from("grid_posts").select("id").eq("plan_id", plan.id);
    if (postsErr) throw postsErr;

    const existingIds = new Set((existingPosts || []).map((p: any) => p.id));
    const orderIds = new Set(order);
    const sameSize = existingIds.size === orderIds.size;
    const sameMembers = sameSize && order.every((id) => existingIds.has(id));
    if (!sameSize || !sameMembers) {
      return json({ error: "The post list doesn't match this plan. Refresh and try again" }, 409);
    }

    const results = await Promise.all(
      order.map((id: string, idx: number) => admin.from("grid_posts").update({ position: idx }).eq("id", id))
    );
    const failed = results.find((r: any) => r.error);
    if (failed) throw failed.error;

    return json({ ok: true });
  } catch (err: any) {
    console.error("review-reorder error", err);
    return json({ error: "Something went wrong saving that order" }, 500);
  }
});

async function resolvePlan(admin: any, token: string) {
  const { data: plan, error } = await admin.from("grid_plans").select("*").eq("share_token", token).maybeSingle();
  if (error || !plan) return null;
  if (plan.share_token_expires_at && new Date(plan.share_token_expires_at) < new Date()) return null;
  return plan;
}

async function checkRateLimit(admin: any, bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count } = await admin
    .from("grid_rate_limit")
    .select("id", { count: "exact", head: true })
    .eq("bucket", bucket)
    .gte("created_at", since);
  if ((count || 0) >= limit) return false;
  await admin.from("grid_rate_limit").insert({ bucket });
  const pruneCutoff = new Date(Date.now() - windowSeconds * 10 * 1000).toISOString();
  admin.from("grid_rate_limit").delete().eq("bucket", bucket).lt("created_at", pruneCutoff).then(() => {});
  return true;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
