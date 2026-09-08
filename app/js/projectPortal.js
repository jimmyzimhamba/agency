// ============================================================================
// STUDIO X COMMAND, Public client project page (app/project.html)
// ============================================================================
// What this does, in plain language:
//   The page a client lands on when the agency sends them their project link.
//   No login and no account, the ?t=<token> in the URL is their access. It
//   shows what's been done, what's still to do, and how far along the whole
//   thing is. It is strictly read-only: there is nothing here for a client to
//   change, so there is nothing here that can be abused.
//
// Why this doesn't go through an Edge Function, unlike review.js next door:
//   review.js talks to four review-* Edge Functions because a client can
//   actually change things there (reordering posts, approving them), and
//   writes from an anonymous visitor need real server-side checking. This page
//   only reads, and it reads exactly one row. That fits in a single database
//   function, public.project_portal in
//   supabase/migration_money_and_portal.sql, which arrives with the SQL and
//   needs no separate deploy. Given there is already one Edge Function in this
//   project that was written and never deployed, "no deploy step" is a
//   feature, not a shortcut.
//
//   The security property is the same either way, and it's worth being precise
//   about: the projects table itself stays completely unreadable to anonymous
//   visitors. The only thing anon is allowed to run is that one function, and
//   the only thing it will ever return is the single project whose token
//   matches exactly. There is no query in this file that could be widened.
//
// Deliberately self-contained, same as review.js: it uses only the pure-DOM
// helpers from utils.js and never imports state.js or any view, because there
// is no session and no store on this page to hang off.
// ============================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { el, esc, fmtDate } from "./utils.js";

const STATUS_LABELS = {
  not_started: "Not started yet",
  in_progress: "In progress",
  blocked: "Paused",
  complete: "Complete",
};

// "blocked" is shown to a client as "Paused", not "Blocked". Internally
// blocked usually means the agency is waiting on the client, and a red-sounding
// word on a page the client opens invites a defensive reply to a status that
// was only ever meant as a note to self.
const STATUS_PILL = {
  not_started: "",
  in_progress: "stale",
  blocked: "stale",
  complete: "signed",
};

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

async function load() {
  if (!token) {
    return centerState("This link is incomplete", "Ask your agency to send the link again. Part of it seems to have been cut off.");
  }

  centerState("Loading your project", "One moment.");

  let json = null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/project_portal`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ p_token: token }),
    });
    if (!res.ok) throw new Error("bad status");
    json = await res.json();
  } catch {
    return centerState("Couldn't load your project", "Check your connection and try again. If it keeps happening, let your agency know.");
  }

  // The database function answers null for anything it doesn't recognise,   // expired, revoked, mistyped, or never real. They are one message here on
  // purpose: telling a stranger which kind of wrong their guess was is the
  // only thing that would make guessing worthwhile.
  if (!json || !json.project) {
    return centerState("This link isn't active", "It may have been replaced with a newer one. Ask your agency for an up-to-date link.");
  }

  render(json);
}

function render(data) {
  const p = data.project;
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const done = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : null;
  const agency = data.agency?.name || "Your agency";
  const clientName = data.client?.name || "";

  root.innerHTML = "";
  root.appendChild(el(`
    <div>
      <div class="review-header-card">
        <div class="name">${esc(p.name)}</div>
      </div>
      <div class="review-subtext">
        ${clientName ? esc(clientName) + " · " : ""}Prepared by ${esc(agency)}
      </div>

      <div class="card" style="margin-bottom:14px;">
        <div class="flex-between" style="margin-bottom:10px;">
          <span style="font-weight:700;font-size:14px;">${pct === null ? "Getting started" : pct + "% complete"}</span>
          <span class="status-pill ${STATUS_PILL[p.status] || ""}">${esc(STATUS_LABELS[p.status] || p.status)}</span>
        </div>
        ${pct === null ? "" : `
          <div style="height:8px;border-radius:99px;background:var(--surface-2, rgba(127,127,127,.18));overflow:hidden;">
            <div style="height:100%;width:${pct}%;border-radius:99px;background:var(--accent, #7c3aed);transition:width .4s ease;"></div>
          </div>
          <div class="text-faint" style="font-size:11.5px;margin-top:8px;">${done} of ${tasks.length} steps done</div>
        `}
        ${p.due_date ? `<div class="text-faint" style="font-size:11.5px;margin-top:8px;">Target date ${esc(fmtDate(p.due_date))}</div>` : ""}
      </div>

      ${tasks.length ? `
        <div class="section-title">What's happening</div>
        <div id="portal-tasks"></div>
      ` : `
        <div class="card">
          <div class="text-faint" style="font-size:13px;line-height:1.5;">
            Your agency hasn't added the step-by-step breakdown yet. This page will fill in as
            work gets underway.
          </div>
        </div>
      `}

      <div class="review-subtext" style="margin-top:20px;">
        This page updates itself as work progresses. Keep the link and check back any time.
        ${p.updated_at ? "Last updated " + esc(fmtDate(p.updated_at.slice(0, 10))) + "." : ""}
      </div>
    </div>
  `));

  const listEl = root.querySelector("#portal-tasks");
  if (!listEl) return;

  tasks.forEach((t) => {
    listEl.appendChild(el(`
      <div class="card" style="margin-bottom:8px;display:flex;align-items:center;gap:10px;${t.done ? "opacity:.72;" : ""}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex:0 0 auto;color:${t.done ? "var(--accent, #7c3aed)" : "var(--text-faint, #888)"};">
          ${t.done
            ? '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-4.9"/>'
            : '<circle cx="12" cy="12" r="9"/>'}
        </svg>
        <span style="font-size:13.5px;${t.done ? "text-decoration:line-through;" : "font-weight:600;"}">${esc(t.title)}</span>
      </div>
    `));
  });
}

load();
