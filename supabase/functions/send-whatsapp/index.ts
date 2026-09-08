// ============================================================================
// STUDIO X COMMAND, Edge Function: send-whatsapp
// ============================================================================
// What this does, in plain language:
//   Once a prospect has replied to you on WhatsApp at least once, the
//   prospect detail page shows a real in-app conversation thread instead of
//   just a one-shot "Send WhatsApp" deep link. This function is what sends
//   a reply typed into that thread, it calls Twilio's API server-side (the
//   Twilio credentials never touch the app or the browser) and logs the
//   message so it shows up in the thread for every teammate who can see
//   this prospect.
//
//   WhatsApp itself only allows a business to send free-form text within 24
//   hours of the customer's last message, outside that window, only
//   pre-approved template messages are allowed, which this app doesn't
//   support (that's what the "Send WhatsApp" deep-link button is still for:
//   the teammate's own WhatsApp app sends that first message, so it's never
//   subject to this 24-hour rule). This function enforces that same
//   24-hour rule before ever calling Twilio, so nobody accidentally tries
//   to send a message WhatsApp would just reject anyway.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// How many WhatsApp messages a single teammate can send per hour. Twilio
// bills per message, so this is the hard ceiling that stops a burst of
// sends (accidental or otherwise) from running up the bill.
const RATE_LIMIT_PER_HOUR = 30;

// Turns any Zimbabwe-style number into the digits-only international format
// Twilio's WhatsApp API needs (e.g. 0771234567 -> 263771234567). Kept in
// sync with toWhatsAppDigits() in app/js/utils.js, same logic, duplicated
// here since edge functions are deployed standalone with no shared imports.
function toWhatsAppDigits(raw: string): string {
  let digits = (raw || "").replace(/[^\d+]/g, "");
  digits = digits.replace(/^\+/, "");
  if (digits.startsWith("0")) digits = "263" + digits.slice(1);
  if (!digits.startsWith("263") && digits.length === 9) digits = "263" + digits;
  return digits;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
  const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
  const TWILIO_WHATSAPP_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM"); // e.g. "whatsapp:+14155238886"

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
      return json({ error: "WhatsApp isn't set up yet. Ask the owner to add the Twilio secrets in Supabase (see SETUP.md Step 146)." }, 501);
    }

    const { prospect_id, body } = await req.json();
    const message = (body || "").trim();
    if (!prospect_id || !message) return json({ error: "prospect_id and body are required" }, 400);

    // Identify the caller from their login token (never trust a
    // client-supplied user id for who's sending this).
    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not signed in" }, 401);
    const userId = userData.user.id;

    // Load the prospect through the CALLER's own client, not the admin
    // client, that way Postgres RLS itself decides whether this teammate
    // is even allowed to see this prospect (owner, or assigned/created by
    // them), the exact same rule enforced everywhere else in the app,
    // instead of re-implementing it by hand here and risking a mismatch.
    const { data: prospect, error: prospectErr } = await callerClient
      .from("prospects")
      .select("id, org_id, business_name, whatsapp_number, whatsapp_last_inbound_at, status")
      .eq("id", prospect_id)
      .single();
    if (prospectErr || !prospect) return json({ error: "Prospect not found, or you don't have access to it" }, 404);
    if (!prospect.whatsapp_number) return json({ error: "No WhatsApp number saved for this prospect" }, 400);

    if (!prospect.whatsapp_last_inbound_at) {
      return json(
        { error: "This prospect hasn't messaged you on WhatsApp yet. Use the Send WhatsApp button to start the conversation, and once they reply, you can chat right here." },
        409
      );
    }
    const hoursSinceReply = (Date.now() - new Date(prospect.whatsapp_last_inbound_at).getTime()) / 3600000;
    if (hoursSinceReply > 24) {
      return json(
        { error: "It's been more than 24 hours since they last messaged you. WhatsApp requires them to message first before you can reply here again. Use the Send WhatsApp button instead." },
        409
      );
    }

    // Rate limit: cap messages per teammate per hour.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("whatsapp_send_requests")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", userId)
      .gte("created_at", oneHourAgo);
    if ((count || 0) >= RATE_LIMIT_PER_HOUR) {
      return json(
        { error: `Message limit reached (${RATE_LIMIT_PER_HOUR}/hour). This keeps Twilio costs in check. Try again shortly.` },
        429
      );
    }
    await admin.from("whatsapp_send_requests").insert({ org_id: prospect.org_id, requested_by: userId });

    const toNumber = `whatsapp:+${toWhatsAppDigits(prospect.whatsapp_number)}`;

    const form = new URLSearchParams();
    form.set("From", TWILIO_WHATSAPP_FROM);
    form.set("To", toNumber);
    form.set("Body", message);

    const twilioResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
      },
      body: form.toString(),
    });
    const twilioData = await twilioResp.json();
    if (!twilioResp.ok) {
      return json({ error: twilioData?.message || "Twilio couldn't send that message" }, 502);
    }

    const { data: inserted, error: insertErr } = await admin
      .from("whatsapp_messages")
      .insert({
        prospect_id,
        direction: "outbound",
        body: message,
        status: "sent",
        twilio_sid: twilioData.sid || null,
        sent_by: userId,
      })
      .select()
      .single();
    if (insertErr) return json({ error: insertErr.message }, 500);

    const { data: sender } = await admin.from("profiles").select("full_name, email").eq("id", userId).single();
    const senderName = sender?.full_name || sender?.email || "A teammate";
    await admin.from("activity_log").insert({
      org_id: prospect.org_id,
      actor_id: userId,
      prospect_id,
      message: `${senderName} sent a WhatsApp message to ${prospect.business_name}`,
    });

    return json({ message: inserted }, 200);
  } catch (err: any) {
    console.error("send-whatsapp error", err);
    return json({ error: err.message || "Unexpected error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
