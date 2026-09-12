// ============================================================================
// STUDIO X COMMAND, Public client dashboard (app/client.html)
// ============================================================================
// What this does, in plain language:
//   The page a client bookmarks after the agency sends them their portal
//   link. No login, no account, the ?t=<token> in the URL is their access,
//   same as project.html next door. A short welcome, whichever monthly
//   reports the team has PUBLISHED (drafts never show here), their invoices
//   that are sent or paid (never drafts or voided ones), and a small box to
//   leave feedback.
//
// Why this is two database functions instead of an Edge Function:
//   Same reasoning as projectPortal.js: reads fit a single SECURITY DEFINER
//   Postgres function (public.client_portal, in
//   supabase/migration_client_portal.sql) with no separate deploy step. The
//   one write this page allows, leaving feedback, is narrow and easy to
//   validate entirely in SQL (token shape, message length), so it gets the
//   same treatment (public.client_portal_feedback) rather than reaching for
//   an Edge Function for one text field.
//
//   The prospects, client_reports, client_feedback, and invoices tables all
//   stay completely unreadable to anonymous visitors. The only things anon
//   can do are: run client_portal() (which only ever returns the one client
//   whose token matches exactly), and run client_portal_feedback() (which
//   only ever inserts one row, for that same client).
//
// Deliberately self-contained, same as review.js/projectPortal.js: only the
// pure-DOM helpers from utils.js, no state.js, no session, nothing to hang
// a login off of.
// ============================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { el, esc, fmtDate, toast } from "./utils.js";

const STATUS_LABELS = { sent: "Sent", paid: "Paid" };
const STATUS_PILL = { sent: "stale", paid: "signed" };

const token = new URLSearchParams(location.search).get("t");
const root = document.getElementById("portal-root");

function centerState(title, body) {
  root.innerHTML = "";
  root.appendChild(el(`
    <div class="review-center-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2a2 2 0 0 1 1.6.8l1.1 1.5h7.1A2.5 2.5 0 0 1 21 9.8v7.7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/></svg>
      <h1>${esc(title)}</h1>
      <p>${esc(body)}</p>
    </div>
  `));
}

async function callRpc(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("bad status");
  return res.json();
}

async function load() {
  if (!token) {
    return centerState("This link is incomplete", "Ask your agency to send the link again. Part of it seems to have been cut off.");
  }

  centerState("Loading your dashboard", "One moment.");

  let json = null;
  try {
    json = await callRpc("client_portal", { p_token: token });
  } catch {
    return centerState("Couldn't load your dashboard", "Check your connection and try again. If it keeps happening, let your agency know.");
  }

  // Same "one message for every kind of wrong" reasoning as project.html:
  // telling a stranger whether a token was expired vs. mistyped vs. never
  // real is the only thing that would make guessing worthwhile.
  if (!json || !json.client) {
    return centerState("This link isn't active", "It may have been replaced with a newer one. Ask your agency for an up-to-date link.");
  }

  render(json);
}

function render(data) {
  const agency = data.agency?.name || "Your agency";
  const clientName = data.client?.name || "";
  const reports = Array.isArray(data.reports) ? data.reports : [];
  const invoices = Array.isArray(data.invoices) ? data.invoices : [];

  root.innerHTML = "";
  root.appendChild(el(`
    <div>
      <div class="review-header-card">
        <div class="name">Welcome${clientName ? ", " + esc(clientName) : ""}</div>
      </div>
      <div class="review-subtext">Your dashboard, prepared by ${esc(agency)}</div>

      <div class="section-title">Monthly reports</div>
      ${reports.length ? `<div id="portal-reports"></div>` : `
        <div class="card" style="margin-bottom:14px;">
          <div class="text-faint" style="font-size:13px;line-height:1.5;">
            Nothing's been published here yet. Your agency will add reports as they're ready.
          </div>
        </div>
      `}

      <div class="section-title">Invoices</div>
      ${invoices.length ? `<div id="portal-invoices"></div>` : `
        <div class="card" style="margin-bottom:14px;">
          <div class="text-faint" style="font-size:13px;line-height:1.5;">No invoices yet.</div>
        </div>
      `}

      <div class="section-title">Feedback</div>
      <div class="card" style="margin-bottom:14px;">
        <div class="text-faint" style="font-size:12.5px;line-height:1.5;margin-bottom:10px;">
          Anything you'd like ${esc(agency)} to know, about a report, an invoice, or anything else. They'll see this.
        </div>
        <div class="field">
          <textarea id="portal-feedback-text" placeholder="Type your feedback here..." style="min-height:90px;"></textarea>
        </div>
        <button class="btn btn-primary btn-sm" id="portal-feedback-send" style="width:auto;">Send Feedback</button>
      </div>

      <div class="review-subtext" style="margin-top:8px;">This page updates as new reports and invoices come in. Keep the link and check back any time.</div>
    </div>
  `));

  const reportsEl = root.querySelector("#portal-reports");
  if (reportsEl) {
    reports.forEach((r) => {
      reportsEl.appendChild(el(`
        <div class="card" style="margin-bottom:8px;">
          <div class="flex-between" style="margin-bottom:6px;">
            <span style="font-weight:700;font-size:14px;">${esc(r.title || "Report")}</span>
            ${r.published_at ? `<span class="text-faint" style="font-size:11px;">${esc(fmtDate(r.published_at.slice(0, 10)))}</span>` : ""}
          </div>
          <div style="font-size:13px;line-height:1.55;white-space:pre-wrap;">${esc(r.body || "")}</div>
        </div>
      `));
    });
  }

  const invoicesEl = root.querySelector("#portal-invoices");
  if (invoicesEl) {
    invoices.forEach((i) => {
      invoicesEl.appendChild(el(`
        <div class="card" style="margin-bottom:8px;">
          <div class="flex-between" style="margin-bottom:4px;">
            <span style="font-weight:700;font-size:13.5px;">${esc(i.invoice_number || "Invoice")}</span>
            <span class="status-pill ${STATUS_PILL[i.status] || ""}" style="font-size:9.5px;">${esc(STATUS_LABELS[i.status] || i.status)}</span>
          </div>
          <div class="text-faint" style="font-size:12px;">
            ${i.service_period ? esc(i.service_period) + " · " : ""}
            ${i.status === "paid" && i.paid_date ? "Paid " + esc(fmtDate(i.paid_date)) : (i.due_date ? "Due " + esc(fmtDate(i.due_date)) : "")}
          </div>
        </div>
      `));
    });
  }

  const sendBtn = root.querySelector("#portal-feedback-send");
  const textEl = root.querySelector("#portal-feedback-text");
  if (sendBtn && textEl) {
    sendBtn.addEventListener("click", async () => {
      const message = textEl.value.trim();
      if (!message) return toast("Type something first", "error");
      sendBtn.disabled = true;
      try {
        const ok = await callRpc("client_portal_feedback", { p_token: token, p_message: message });
        if (!ok) throw new Error("rejected");
        textEl.value = "";
        toast("Thanks, that's been sent", "success");
      } catch {
        toast("Couldn't send that, check your connection and try again", "error");
      } finally {
        sendBtn.disabled = false;
      }
    });
  }
}

load();
