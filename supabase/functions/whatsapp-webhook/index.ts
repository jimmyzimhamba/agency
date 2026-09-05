// ============================================================================
// STUDIO X COMMAND — Edge Function: whatsapp-webhook
// ============================================================================
// What this does, in plain language:
//   Twilio calls this function directly — nobody is logged in, and it's
//   never called from inside the app. It fires in two situations, both
//   configured once against this same URL in your Twilio console (see
//   SETUP.md Step 146):
//     1. A prospect sends a WhatsApp message to your Twilio number. This
//        function matches it to a prospect by phone number, saves it to
//        that prospect's conversation thread, marks that prospect as
//        "replied" if they hadn't already, and notifies whoever's assigned
//        to them (push + email, same as every other notification in this
//        app) so a real person follows up.
//     2. Twilio reports a delivery status ("delivered", "read", "failed")
//        for a message this app sent earlier via send-whatsapp — this
//        function just updates that message's status in the thread.
//   Since nobody is logged in when Twilio calls this, it can't check a
//   login token like every other function in this app does. Instead it
//   verifies Twilio's own request signature (X-Twilio-Signature header) —
//   proof the request really came from Twilio and wasn't spoofed by
//   someone who found this URL.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Turns any Zimbabwe-style number into the digits-only international format
// used everywhere else in the app — kept in sync with toWhatsAppDigits() in
// app/js/utils.js (and the copy in send-whatsapp/index.ts). Used here to
// match an inbound "From" number back to a prospect's saved whatsapp_number,
// however it happened to be typed in.
function toWhatsAppDigits(raw: string): string {
  let digits = (raw || "").replace(/[^\d+]/g, "");
  digits = digits.replace(/^\+/, "");
  if (digits.startsWith("0")) digits = "263" + digits.slice(1);
  if (!digits.startsWith("263") && digits.length === 9) digits = "263" + digits;
  return digits;
}

// Twilio's signature is an HMAC-SHA1 of (the exact webhook URL you
// configured in Twilio, with every POST parameter's key+value appended in
// alphabetical-by-key order), base64-encoded, using your Auth Token as the
// key. This must be computed against the SAME url Twilio was told to call —
// TWILIO_WEBHOOK_URL should be set to that exact URL if it's ever different
// from the default guess below (e.g. behind a custom domain).
async function verifyTwilioSignature(authToken: string, url: string, params: URLSearchParams, signature: string): Promise<boolean> {
  const keys = Array.from(new Set(params.keys())).sort();
  let data = url;
  for (const key of keys) data += key + (params.get(key) || "");

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sigBuffer = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
  return computed === signature;
}

function twiml() {
  return new Response("<Response></Response>", { status: 200, headers: { "content-type": "text/xml" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" } });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
  const TWILIO_WEBHOOK_URL = Deno.env.get("TWILIO_WEBHOOK_URL") || `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
  const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
  const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
  const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:you@studioxmarketing.com";
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const RESEND_FROM = Deno.env.get("RESEND_FROM_EMAIL") || "Studio X Command <onboarding@resend.dev>";
  const APP_URL = Deno.env.get("APP_URL");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);

    if (TWILIO_AUTH_TOKEN) {
      const signature = req.headers.get("X-Twilio-Signature") || "";
      const valid = await verifyTwilioSignature(TWILIO_AUTH_TOKEN, TWILIO_WEBHOOK_URL, params, signature);
      if (!valid) {
        console.error("whatsapp-webhook: signature verification failed");
        return new Response("Forbidden", { status: 403 });
      }
    }

    const messageStatus = params.get("MessageStatus"); // delivery-status callback for an outbound send
    const messageSid = params.get("MessageSid") || params.get("SmsSid");

    if (messageStatus) {
      if (messageSid) {
        await admin.from("whatsapp_messages").update({ status: messageStatus }).eq("twilio_sid", messageSid);
      }
      return twiml();
    }

    // Otherwise this is a new inbound message from a prospect.
    const from = params.get("From") || ""; // "whatsapp:+263771234567"
    const body = params.get("Body");
    if (!from || body == null) return twiml();

    const fromDigits = toWhatsAppDigits(from.replace("whatsapp:", ""));

    const { data: prospects } = await admin
      .from("prospects")
      .select("id, org_id, business_name, whatsapp_number, assigned_to, created_by, status");
    const match = (prospects || []).find((p: any) => p.whatsapp_number && toWhatsAppDigits(p.whatsapp_number) === fromDigits);

    if (!match) {
      console.log("whatsapp-webhook: no prospect matches inbound number", from);
      return twiml();
    }

    // Twilio can retry a webhook delivery — the unique index on twilio_sid
    // means a second insert of the same message id is silently skipped
    // rather than duplicating it in the thread.
    await admin.from("whatsapp_messages").insert({
      prospect_id: match.id,
      direction: "inbound",
      body,
      status: "received",
      twilio_sid: messageSid || null,
    });

    const nowIso = new Date().toISOString();
    const statusUpdate: Record<string, unknown> = { whatsapp_last_inbound_at: nowIso };
    if (match.status === "not_contacted" || match.status === "sent") statusUpdate.status = "replied";
    await admin.from("prospects").update(statusUpdate).eq("id", match.id);

    await admin.from("activity_log").insert({
      org_id: match.org_id,
      actor_id: null,
      prospect_id: match.id,
      message: `${match.business_name} replied on WhatsApp`,
    });

    // Notify whoever's assigned to this prospect; if nobody is, notify
    // every owner instead — same target-resolution rule used for the
    // "new_prospect" notification type elsewhere in the app.
    let targetUserIds: string[] = [];
    if (match.assigned_to) {
      targetUserIds = [match.assigned_to];
    } else {
      const { data: owners } = await admin.from("profiles").select("id").eq("role", "owner");
      targetUserIds = (owners || []).map((o: any) => o.id);
    }

    if (targetUserIds.length) {
      const pushConfigured = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
      const emailConfigured = !!RESEND_API_KEY;
      const line = `${match.business_name} replied to you on WhatsApp: "${truncate(body, 120)}"`;

      if (pushConfigured) {
        webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
        const { data: subs } = await admin
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth")
          .in("user_id", targetUserIds);
        if (subs && subs.length) {
          const payload = JSON.stringify({ title: "WhatsApp Reply", body: line, url: "/" });
          const staleIds: string[] = [];
          await Promise.all(
            subs.map(async (sub: any) => {
              try {
                await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
              } catch (err: any) {
                const status = err?.statusCode;
                if (status === 404 || status === 410) staleIds.push(sub.id);
              }
            })
          );
          if (staleIds.length) await admin.from("push_subscriptions").delete().in("id", staleIds);
        }
      }

      if (emailConfigured) {
        const { data: targets } = await admin
          .from("profiles")
          .select("email")
          .in("id", targetUserIds)
          .eq("email_notifications_enabled", true);
        const recipients = (targets || []).map((t: any) => t.email).filter(Boolean);
        if (recipients.length) {
          const html = buildEmailHtml("WhatsApp Reply", line, APP_URL);
          await Promise.all(
            recipients.map((to: string) => sendViaResend(RESEND_API_KEY!, RESEND_FROM, to, `WhatsApp reply — ${match.business_name}`, html, line))
          );
        }
      }
    }

    return twiml();
  } catch (err: any) {
    console.error("whatsapp-webhook error", err);
    // Always respond 200/TwiML even on an internal hiccup — returning an
    // error here would make Twilio retry the same delivery repeatedly
    // instead of just logging the failure and moving on.
    return twiml();
  }
});

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function buildEmailHtml(heading: string, line: string, appUrl?: string) {
  const button = appUrl
    ? `<a href="${appUrl}" style="display:inline-block;margin-top:18px;padding:10px 20px;border-radius:999px;background:#7b2ff7;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">Open Studio X Command</a>`
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
