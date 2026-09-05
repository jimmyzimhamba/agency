// ============================================================================
// STUDIO X COMMAND — Edge Function: send-email
// ============================================================================
// What this does, in plain language:
//   The app calls this function right after the exact same two moments
//   send-push does:
//     1. A teammate adds a new prospect -> we email every owner.
//     2. The owner assigns a prospect to a teammate -> we email that
//        teammate.
//   For each person who should be told, we check they haven't turned email
//   notifications off (Team screen), then send them a short email via
//   Resend. Runs entirely server-side — the Resend API key never touches
//   the app or the browser. See SETUP.md Step 145 for how to deploy this
//   and set that key as a secret.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const RESEND_FROM = Deno.env.get("RESEND_FROM_EMAIL") || "Studio X Command <onboarding@resend.dev>";
  const APP_URL = Deno.env.get("APP_URL");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (!RESEND_API_KEY) {
      // Not configured yet — fail quietly so this never blocks the actual
      // prospect add/assign action that triggered it.
      return json({ sent: 0, skipped: "RESEND_API_KEY not configured" }, 200);
    }

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
    let subject = "";
    let heading = "";
    let line = "";

    if (type === "new_prospect") {
      const { data: owners } = await admin.from("profiles").select("id").eq("role", "owner");
      targetUserIds = (owners || []).map((o: any) => o.id).filter((id: string) => id !== callerId);
      subject = `New prospect added — ${prospect.business_name}`;
      heading = "New Prospect Added";
      line = `${prospect.business_name}${prospect.city ? " · " + prospect.city : ""} was just added to the pipeline.`;
    } else if (type === "assigned") {
      if (agent_id && agent_id !== callerId) targetUserIds = [agent_id];
      subject = `Assigned to you — ${prospect.business_name}`;
      heading = "Prospect Assigned to You";
      line = `${prospect.business_name}${prospect.area ? " · " + prospect.area : ""} is now yours to work.`;
    } else {
      return json({ error: "Unknown notification type" }, 400);
    }

    if (!targetUserIds.length) return json({ sent: 0 }, 200);

    const { data: targets } = await admin
      .from("profiles")
      .select("email, email_notifications_enabled")
      .in("id", targetUserIds)
      .eq("email_notifications_enabled", true);

    const recipients = (targets || []).map((t: any) => t.email).filter(Boolean);
    if (!recipients.length) return json({ sent: 0 }, 200);

    const html = buildEmailHtml(heading, line, APP_URL);
    let sent = 0;
    await Promise.all(
      recipients.map(async (to: string) => {
        const ok = await sendViaResend(RESEND_API_KEY, RESEND_FROM, to, subject, html, line);
        if (ok) sent++;
      })
    );

    return json({ sent }, 200);
  } catch (err: any) {
    console.error("send-email error", err);
    return json({ error: err.message || "Unexpected error" }, 500);
  }
});

function buildEmailHtml(heading: string, line: string, appUrl?: string) {
  // The site root is now the public marketing landing page (app/index.html),
  // not the app itself — append /app.html so this button always deep-links
  // straight into the real app instead of dropping someone back onto a
  // sales pitch they've already seen.
  const button = appUrl
    ? `<a href="${appUrl.replace(/\/$/, "")}/app.html" style="display:inline-block;margin-top:18px;padding:10px 20px;border-radius:999px;background:#7b2ff7;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">Open Studio X Command</a>`
    : "";
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;background:#ffffff;border:1px solid #e8e6ee;border-radius:16px;">
    <div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#7b2ff7;font-weight:700;margin-bottom:10px;">Studio X Command</div>
    <div style="font-size:18px;font-weight:700;color:#17151d;margin-bottom:8px;">${escapeHtml(heading)}</div>
    <div style="font-size:14px;line-height:1.5;color:#4a4655;">${escapeHtml(line)}</div>
    ${button}
  </div>`;
}

async function sendViaResend(apiKey: string, from: string, to: string, subject: string, html: string, text: string) {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    return resp.ok;
  } catch (err) {
    console.error("Resend send failed", err);
    return false;
  }
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
