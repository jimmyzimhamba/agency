// ============================================================================
// STUDIO X COMMAND, Edge Function: review-complete
// ============================================================================
// What this does, in plain language:
//   The client's "I'm done reviewing" button. Looks at every post on the
//   plan: if every single one is 'approved', the whole plan becomes
//   'approved'; if even one post is still 'pending' or 'changes_requested',
//   the plan becomes 'changes_requested', the agency needs to look at it
//   again either way. Either outcome also stamps client_completed_at, which
//   is deliberately a SEPARATE field from status: it's the answer to "did
//   the client actually finish a review pass," independent of whether that
//   pass ended in approval or a change request.
//
//   Unlike review-update/review-reorder, this isn't a plain row UPDATE on
//   grid_posts, so the auto-logging trigger on that table doesn't cover it, //   this function writes its own grid_activity row by hand.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 60;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { token, message } = await req.json();
    if (!token || typeof token !== "string" || token.length < 16) {
      return json({ error: "Invalid or expired link" }, 404);
    }

    const allowed = await checkRateLimit(admin, `complete:${token}`, RATE_LIMIT, RATE_WINDOW_SECONDS);
    if (!allowed) return json({ error: "Too many requests, please wait a moment and try again" }, 429);

    const plan = await resolvePlan(admin, token);
    if (!plan) return json({ error: "Invalid or expired link" }, 404);

    const { data: posts, error: postsErr } = await admin.from("grid_posts").select("status").eq("plan_id", plan.id);
    if (postsErr) throw postsErr;
    if (!posts || !posts.length) {
      return json({ error: "This plan doesn't have any posts yet" }, 400);
    }

    const allApproved = posts.every((p: any) => p.status === "approved");
    const newStatus = allApproved ? "approved" : "changes_requested";
    const safeMessage = typeof message === "string" ? message.slice(0, 1000) : "";

    const { error: updErr } = await admin
      .from("grid_plans")
      .update({ status: newStatus, client_completed_at: new Date().toISOString() })
      .eq("id", plan.id);
    if (updErr) throw updErr;

    await admin.from("grid_activity").insert({
      org_id: plan.org_id,
      plan_id: plan.id,
      actor_type: "client",
      action: "client_completed_review",
      after_value: { status: newStatus },
      message: safeMessage || (allApproved ? "Client approved the plan" : "Client requested changes"),
    });

    return json({ ok: true, status: newStatus });
  } catch (err: any) {
    console.error("review-complete error", err);
    return json({ error: "Something went wrong submitting your review" }, 500);
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
