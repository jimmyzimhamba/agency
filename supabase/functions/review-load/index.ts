// ============================================================================
// STUDIO X COMMAND — Edge Function: review-load
// ============================================================================
// What this does, in plain language:
//   The public, no-login client review page (app/review.html) calls this to
//   load a grid plan by its share_token. Nobody calling this is signed in —
//   there's no user session, no profile, nothing — so this function is the
//   ONLY thing standing between "someone has a link" and "someone can see
//   that plan's posts and media." It runs entirely server-side with the
//   service-role key, which bypasses RLS completely, which is exactly why
//   every check RLS would normally do (does this token belong to this plan?
//   is it expired?) has to be done by hand, right here, instead.
//
//   On the client's FIRST successful load of a plan still sitting at
//   status='shared', this also flips it to 'in_review' and logs that in
//   grid_activity — that's how the agency side finds out "the client has
//   actually opened the link" instead of it just sitting unread.
//
//   Media: grid-media is a PRIVATE bucket (see migration_grid_plans.sql) —
//   there is no public URL for any file in it. This function mints a
//   short-lived signed URL (1 hour) for each piece of media, server-side,
//   using the service-role key. The token itself never gets anywhere near
//   Supabase Storage's public surface.
//
//   Rate-limited against migration_grid_rate_limit.sql so a leaked/guessed
//   token (or a buggy client stuck retrying) can't be hammered indefinitely.
//   This is a best-effort defense, not the primary one — the primary defense
//   is that share_token is a 192-bit random value, not something brute-
//   forceable in any practical sense.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RATE_LIMIT = 30; // requests
const RATE_WINDOW_SECONDS = 60;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { token } = await req.json();
    if (!token || typeof token !== "string" || token.length < 16) {
      return json({ error: "Invalid or expired link" }, 404);
    }

    const allowed = await checkRateLimit(admin, `load:${token}`, RATE_LIMIT, RATE_WINDOW_SECONDS);
    if (!allowed) return json({ error: "Too many requests — please wait a moment and try again" }, 429);

    const plan = await resolvePlan(admin, token);
    if (!plan) return json({ error: "Invalid or expired link" }, 404);

    const { data: posts, error: postsErr } = await admin
      .from("grid_posts")
      .select("id, position, caption, client_note, status, post_date, platform, updated_at")
      .eq("plan_id", plan.id)
      .order("position");
    if (postsErr) throw postsErr;

    const { data: media, error: mediaErr } = await admin
      .from("grid_post_media")
      .select("id, post_id, storage_path, media_type, position")
      .in("post_id", (posts || []).map((p: any) => p.id).length ? (posts || []).map((p: any) => p.id) : ["00000000-0000-0000-0000-000000000000"])
      .order("position");
    if (mediaErr) throw mediaErr;

    // Sign every media file's URL server-side — the only way a browser with
    // no Supabase credentials at all can ever actually see the image/video.
    const signedMedia = await Promise.all(
      (media || []).map(async (m: any) => {
        const { data: signed } = await admin.storage.from("grid-media").createSignedUrl(m.storage_path, 3600);
        return { id: m.id, post_id: m.post_id, url: signed?.signedUrl || null, media_type: m.media_type, position: m.position };
      })
    );

    const postsOut = (posts || []).map((p: any) => ({
      ...p,
      media: signedMedia.filter((m) => m.post_id === p.id).sort((a, b) => a.position - b.position),
    }));

    // First time the client actually opens a shared-but-unopened plan —
    // record it, both as a plan-level status flip and as an audit entry.
    // Everything else about this call is read-only.
    if (plan.status === "shared") {
      await admin.from("grid_plans").update({ status: "in_review" }).eq("id", plan.id);
      await admin.from("grid_activity").insert({
        org_id: plan.org_id,
        plan_id: plan.id,
        actor_type: "client",
        action: "review_opened",
        message: "Client opened the review link",
      });
      plan.status = "in_review";
    }

    return json({
      plan: {
        id: plan.id,
        client_name: plan.client_name,
        accent_color: plan.accent_color,
        status: plan.status,
      },
      posts: postsOut,
    });
  } catch (err: any) {
    console.error("review-load error", err);
    return json({ error: "Something went wrong loading this plan" }, 500);
  }
});

// Looks up a plan by share_token and rejects anything that isn't a live,
// currently-shareable plan. Deliberately returns the SAME "not found" shape
// for "no such token," "token expired," and "plan in draft with no token
// yet" — a real attacker fishing for which is which learns nothing from the
// response either way.
async function resolvePlan(admin: any, token: string) {
  const { data: plan, error } = await admin.from("grid_plans").select("*").eq("share_token", token).maybeSingle();
  if (error || !plan) return null;
  if (plan.share_token_expires_at && new Date(plan.share_token_expires_at) < new Date()) return null;
  return plan;
}

// Best-effort persistent rate limiter — a row-per-request table (see
// migration_grid_rate_limit.sql), not an in-memory counter, specifically so
// it still works across Edge Function cold starts/multiple instances,
// unlike a plain in-process Map. Opportunistically prunes its own old rows
// on every call so the table never grows unbounded under real usage.
async function checkRateLimit(admin: any, bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count } = await admin
    .from("grid_rate_limit")
    .select("id", { count: "exact", head: true })
    .eq("bucket", bucket)
    .gte("created_at", since);
  if ((count || 0) >= limit) return false;
  await admin.from("grid_rate_limit").insert({ bucket });
  // Prune anything older than 10x the window for this bucket — keeps the
  // table small without needing a separate scheduled cleanup job.
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
