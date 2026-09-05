// ============================================================================
// STUDIO X COMMAND — Edge Function: send-push
// ============================================================================
// What this does, in plain language:
//   The app calls this function right after two specific moments:
//     1. A teammate adds a new prospect -> we tell every owner.
//     2. The owner assigns a prospect to a teammate -> we tell that teammate.
//   For each person who should be told, we look up their saved push
//   subscriptions (one per phone/browser they've turned notifications on
//   from) and send each one a pop-up via the Web Push protocol. Nobody gets
//   a pop-up unless they've explicitly turned notifications on themselves
//   from the Team screen.
//   Runs entirely server-side — the private VAPID signing key never touches
//   the app or the browser. See SETUP.md for how to deploy this and set
//   that key as a secret.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
  const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
  const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:you@studioxmarketing.com";

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      // Notifications simply aren't configured yet — fail quietly so this
      // never blocks the actual prospect add/assign action that triggered it.
      return json({ sent: 0, skipped: "VAPID keys not configured" }, 200);
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const { type, prospect_id, agent_id } = await req.json();
    if (!type || !prospect_id) return json({ error: "type and prospect_id are required" }, 400);

    // Identify the caller from their login token (never trust a
    // client-supplied user id for who's sending this).
    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not signed in" }, 401);
    const callerId = userData.user.id;

    const { data: prospect } = await admin
      .from("prospects")
      .select("business_name, city, area")
      .eq("id", prospect_id)
      .single();
    if (!prospect) return json({ error: "Prospect not found" }, 404);

    let targetUserIds: string[] = [];
    let title = "";
    let body = "";

    if (type === "new_prospect") {
      const { data: owners } = await admin.from("profiles").select("id").eq("role", "owner");
      targetUserIds = (owners || []).map((o: any) => o.id).filter((id: string) => id !== callerId);
      title = "New Prospect Added";
      body = `${prospect.business_name}${prospect.city ? " · " + prospect.city : ""} was just added to the pipeline.`;
    } else if (type === "assigned") {
      if (agent_id && agent_id !== callerId) targetUserIds = [agent_id];
      title = "Prospect Assigned to You";
      body = `${prospect.business_name}${prospect.area ? " · " + prospect.area : ""} is now yours to work.`;
    } else {
      return json({ error: "Unknown notification type" }, 400);
    }

    if (!targetUserIds.length) return json({ sent: 0 }, 200);

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", targetUserIds);

    if (!subs || !subs.length) return json({ sent: 0 }, 200);

    // "/app.html", not "/" — the site root is now the public marketing
    // landing page (see app/index.html); a push notification should always
    // open straight into the real app.
    const payload = JSON.stringify({ title, body, url: "/app.html" });
    let sent = 0;
    const staleIds: string[] = [];

    await Promise.all(
      subs.map(async (sub: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
          sent++;
        } catch (err: any) {
          // 404/410 means the browser has unsubscribed or the subscription
          // expired — clean it up so we stop wasting sends on it.
          const status = err?.statusCode;
          if (status === 404 || status === 410) staleIds.push(sub.id);
        }
      })
    );

    if (staleIds.length) {
      await admin.from("push_subscriptions").delete().in("id", staleIds);
    }

    return json({ sent }, 200);
  } catch (err: any) {
    console.error("send-push error", err);
    return json({ error: err.message || "Unexpected error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
