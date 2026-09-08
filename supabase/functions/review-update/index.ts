// ============================================================================
// STUDIO X COMMAND, Edge Function: review-update
// ============================================================================
// What this does, in plain language:
//   Lets the public, no-login client review page edit ONE post's caption
//   and/or approval status. Nothing else, not client_note (that's the
//   agency writing TO the client, not the other way around), not platform,
//   not post_date, not position (that's review-reorder's job). The field
//   whitelist below is the actual security boundary, not just a convenience:
//   even if someone crafted a request with extra fields in the body, only
//   caption/status ever reach the database.
//
//   Every real change here also gets picked up automatically by the
//   trg_log_grid_post_changes trigger on grid_posts (see
//   migration_grid_plans.sql), it logs to grid_activity as actor_type
//   'client' because this call has no auth.uid() (service-role key, no
//   user session). No manual activity-log insert needed in this file.
//
//   Cross-plan isolation: the post_id in the request has to actually belong
//   to the plan the token resolves to, checked explicitly below, so a
//   client with a valid token for Plan A can never touch a post that
//   belongs to Plan B just by guessing/copying its id.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_STATUSES = ["pending", "approved", "changes_requested"];
const RATE_LIMIT = 60;
const RATE_WINDOW_SECONDS = 60;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { token, post_id, caption, status, expected_updated_at, force } = await req.json();
    if (!token || typeof token !== "string" || token.length < 16) {
      return json({ error: "Invalid or expired link" }, 404);
    }
    if (!post_id) return json({ error: "post_id is required" }, 400);
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return json({ error: "Invalid status" }, 400);
    }
    if (caption === undefined && status === undefined) {
      return json({ error: "Nothing to update" }, 400);
    }

    const allowed = await checkRateLimit(admin, `update:${token}`, RATE_LIMIT, RATE_WINDOW_SECONDS);
    if (!allowed) return json({ error: "Too many requests, please wait a moment and try again" }, 429);

    const plan = await resolvePlan(admin, token);
    if (!plan) return json({ error: "Invalid or expired link" }, 404);

    // The actual cross-plan isolation check: this post must belong to THIS
    // token's plan, not just exist somewhere in the database.
    const { data: post } = await admin.from("grid_posts").select("id, plan_id").eq("id", post_id).maybeSingle();
    if (!post || post.plan_id !== plan.id) {
      return json({ error: "Post not found on this plan" }, 404);
    }

    // Field whitelist, only these two keys are ever written, regardless of
    // what else the request body contains.
    const patch: Record<string, unknown> = {};
    if (typeof caption === "string") patch.caption = caption.slice(0, 2200);
    if (typeof status === "string") patch.status = status;

    // Optimistic-concurrency check: if the caller tells us what updated_at
    // it last saw (expected_updated_at) and didn't explicitly ask to
    // override (force), only apply the write if the row hasn't moved since
    // then. Chaining .eq("updated_at", expected_updated_at) onto the update
    // makes this atomic, no separate read-then-write race window, and if
    // zero rows match, .select().maybeSingle() below comes back null, which
    // is how we detect "someone else changed this in the meantime" without
    // any extra round trip.
    let query = admin.from("grid_posts").update(patch).eq("id", post_id);
    if (expected_updated_at && !force) {
      query = query.eq("updated_at", expected_updated_at);
    }
    const { data: updated, error: updErr } = await query
      .select("id, caption, client_note, status, updated_at")
      .maybeSingle();
    if (updErr) throw updErr;

    if (!updated) {
      // The row exists (checked above) but didn't match expected_updated_at
      //, a teammate or the client in another tab saved a change in
      // between this page loading the post and this save. Hand back the
      // current values so the caller can show what changed and offer
      // "Save Anyway" (a retry with force: true).
      const { data: current } = await admin
        .from("grid_posts")
        .select("id, caption, client_note, status, updated_at")
        .eq("id", post_id)
        .maybeSingle();
      return json({ error: "This post was changed elsewhere just now", conflict: true, current }, 409);
    }

    return json({ ok: true, post: updated });
  } catch (err: any) {
    console.error("review-update error", err);
    return json({ error: "Something went wrong saving that change" }, 500);
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
