// ============================================================================
// STUDIO X COMMAND, Edge Function: manage-team-member
// ============================================================================
// What this does, in plain language:
//   Only the Owner can call this, from the Team screen's "Remove access" /
//   "Restore access" button next to a teammate's name. It does two things
//   together so a "removed" teammate is actually locked out, not just
//   hidden in the UI:
//     1. Bans their login (Supabase Auth) so they can't sign back in, and
//        so their session stops refreshing once its current token expires.
//     2. Flips their `profiles.active` flag so the app can show a "Removed"
//        badge and leave them out of future "assign to" pickers.
//   Nothing about the teammate is deleted, their name still shows up
//   correctly on every prospect, note, and activity-log entry they ever
//   touched. "Restore access" (same function, opposite action) undoes both
//   steps and lets them log back in immediately.
//   Runs entirely server-side, the service-role key never touches the app
//   or the browser. See SETUP.md for how to deploy this.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ~100 years, effectively "forever" without Supabase's ban API needing a
// dedicated "permanent" option. "Restore access" sets ban_duration back to
// "none" to lift it.
const BAN_FOREVER = "876000h";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { user_id, action } = await req.json();
    if (!user_id || !["deactivate", "reactivate"].includes(action)) {
      return json({ error: "user_id and a valid action ('deactivate' or 'reactivate') are required" }, 400);
    }

    // Identify the caller from their login token and confirm they're the
    // owner, never trust a client-supplied "I'm the owner" flag.
    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not signed in" }, 401);
    const callerId = userData.user.id;

    const { data: callerProfile } = await admin.from("profiles").select("role, org_id").eq("id", callerId).single();
    if (callerProfile?.role !== "owner") return json({ error: "Only the owner can manage team access" }, 403);

    if (user_id === callerId) {
      return json({ error: "You can't change your own access" }, 400);
    }

    // Using the service-role key bypasses RLS entirely, so this endpoint has
    // to enforce the organization boundary itself, otherwise an owner of
    // one agency could deactivate/reactivate a user_id belonging to a
    // completely different agency just by guessing/supplying their id.
    const { data: target } = await admin.from("profiles").select("role, active, org_id").eq("id", user_id).single();
    if (!target) return json({ error: "Team member not found" }, 404);
    if (target.org_id !== callerProfile.org_id) {
      return json({ error: "Team member not found" }, 404);
    }

    if (action === "deactivate") {
      // Never let the team get locked out of ownership entirely.
      if (target.role === "owner") {
        const { count } = await admin
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "owner")
          .eq("active", true)
          .eq("org_id", callerProfile.org_id);
        if ((count || 0) <= 1) {
          return json({ error: "Can't remove the last remaining owner's access" }, 400);
        }
      }

      const { error: banErr } = await admin.auth.admin.updateUserById(user_id, { ban_duration: BAN_FOREVER });
      if (banErr) throw banErr;

      const { error: updErr } = await admin.from("profiles").update({ active: false }).eq("id", user_id);
      if (updErr) throw updErr;

      // No point keeping stale push subscriptions around for someone who
      // can no longer sign in to receive them.
      await admin.from("push_subscriptions").delete().eq("user_id", user_id);

      return json({ ok: true, active: false }, 200);
    }

    // action === "reactivate"
    const { error: unbanErr } = await admin.auth.admin.updateUserById(user_id, { ban_duration: "none" });
    if (unbanErr) throw unbanErr;

    const { error: updErr } = await admin.from("profiles").update({ active: true }).eq("id", user_id);
    if (updErr) throw updErr;

    return json({ ok: true, active: true }, 200);
  } catch (err: any) {
    console.error("manage-team-member error", err);
    return json({ error: err.message || "Unexpected error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
