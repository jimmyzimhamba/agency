// ============================================================================
// STUDIO X COMMAND, Edge Function: check-overdue-invoices
// ============================================================================
// What this does, in plain language:
//   Runs once a day on a timer (set up via pg_cron, see SETUP.md, "Turn on
//   overdue invoice alerts"). It looks for invoices that were marked "sent"
//   but never paid, and whose due date has already passed, and haven't been
//   flagged before. For each one, it pings whoever created the invoice plus
//   every owner with a pop-up, even if nobody has Agency Command open, //   then marks it as flagged so it only pings once, not every day it stays
//   overdue.
//   Uses the exact same Web Push setup as send-push (same VAPID secrets),
//   and also emails the same people via the same Resend setup as send-email
//   (same RESEND_API_KEY secret), whichever of the two (or both, or
//   neither) is configured just works, nothing here requires both.
//   Unlike send-push, nobody is logged in when this runs (it's woken up by a
//   timer, not a person), so instead of checking a login token it checks a
//   shared secret you set once as the CRON_SECRET. If you never set that
//   secret, it just skips the check, everything still works, just slightly
//   less locked down.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
  const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
  const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:you@studioxmarketing.com";
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const RESEND_FROM = Deno.env.get("RESEND_FROM_EMAIL") || "Studio X Command <onboarding@resend.dev>";
  const APP_URL = Deno.env.get("APP_URL");
  const CRON_SECRET = Deno.env.get("CRON_SECRET");

  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "Not authorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const pushConfigured = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
    const emailConfigured = !!RESEND_API_KEY;
    if (!pushConfigured && !emailConfigured) {
      // Neither notification channel is configured yet, fail quietly so
      // this never errors out the scheduled run, it just does nothing.
      return json({ sent: 0, skipped: "No notification channel configured" }, 200);
    }
    if (pushConfigured) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);

    const today = new Date().toISOString().slice(0, 10);

    const { data: overdue, error: invErr } = await admin
      .from("invoices")
      .select("id, invoice_number, amount, due_date, created_by, prospects(business_name)")
      .eq("status", "sent")
      .lt("due_date", today)
      .is("overdue_notified_at", null);

    if (invErr) return json({ error: invErr.message }, 500);
    if (!overdue || !overdue.length) return json({ sent: 0, overdue: 0 }, 200);

    const { data: owners } = await admin.from("profiles").select("id").eq("role", "owner");
    const ownerIds = (owners || []).map((o: any) => o.id);

    let totalSent = 0;
    let emailsSent = 0;
    const notifiedIds: string[] = [];

    for (const inv of overdue) {
      const targetUserIds = Array.from(new Set([...ownerIds, inv.created_by].filter(Boolean)));

      if (targetUserIds.length) {
        const businessName = (inv as any).prospects?.business_name || "A client";
        const label = inv.invoice_number ? `Invoice ${inv.invoice_number}` : "An invoice";
        const amountStr = Number(inv.amount || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
        const line = `${label} for ${businessName} (${amountStr}) is overdue.`;

        if (pushConfigured) {
          const { data: subs } = await admin
            .from("push_subscriptions")
            .select("id, endpoint, p256dh, auth")
            .in("user_id", targetUserIds);

          if (subs && subs.length) {
            const payload = JSON.stringify({ title: "Invoice Overdue", body: line, url: "/" });
            const staleIds: string[] = [];
            await Promise.all(
              subs.map(async (sub: any) => {
                try {
                  await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payload
                  );
                  totalSent++;
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
            const html = buildEmailHtml("Invoice Overdue", line, APP_URL);
            await Promise.all(
              recipients.map(async (to: string) => {
                const ok = await sendViaResend(RESEND_API_KEY!, RESEND_FROM, to, `Overdue: ${label} for ${businessName}`, html, line);
                if (ok) emailsSent++;
              })
            );
          }
        }
      }

      notifiedIds.push(inv.id);
    }

    // Mark every overdue invoice we looked at as flagged, whether or not a
    // push/email actually went out (e.g. nobody has notifications turned
    // on), otherwise we'd re-check and re-attempt the same invoices every
    // day.
    if (notifiedIds.length) {
      await admin.from("invoices").update({ overdue_notified_at: new Date().toISOString() }).in("id", notifiedIds);
    }

    return json({ sent: totalSent, emailsSent, overdue: overdue.length }, 200);
  } catch (err: any) {
    console.error("check-overdue-invoices error", err);
    return json({ error: err.message || "Unexpected error" }, 500);
  }
});

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function buildEmailHtml(heading: string, line: string, appUrl?: string) {
  // The site root is now the public marketing landing page (app/index.html),
  // not the app itself, append /app.html so this button always deep-links
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
