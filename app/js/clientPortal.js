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
//
// The content calendar section (added in migration_client_portal_gridplan.sql)
// is the one exception to "two database functions is the whole networking
// layer": public.client_portal() can tell this page WHICH grid plan belongs
// to this client (by share_token), but the actual posts/media still have to
// come from the review-load Edge Function, the same one review.html already
// uses, since that's the only thing that knows how to mint signed URLs into
// the private grid-media bucket. Approving a post or requesting changes from
// here calls review-update, again identical to review.html. Deliberately
// NOT ported here: drag-to-reorder and the realtime presence/soft-lock
// indicators, both of which stay exclusive to the full review.html page
// (linked from this section as "Open Full Grid Plan").
// ============================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { el, esc, fmtDate, toast } from "./utils.js";

const STATUS_LABELS = { sent: "Sent", paid: "Paid" };
const STATUS_PILL = { sent: "stale", paid: "signed" };
const GRID_STATUS_LABELS = { draft: "Draft", shared: "Shared", in_review: "In Review", changes_requested: "Changes Requested", approved: "Approved" };
const POST_STATUS_LABELS = { pending: "Pending", approved: "Approved", changes_requested: "Changes Requested" };

const token = new URLSearchParams(location.search).get("t");
const root = document.getElementById("portal-root");
const FN_BASE = `${SUPABASE_URL}/functions/v1`;

// Holds the grid plan's own posts/media, fetched separately from the main
// client_portal() payload (see the big comment above). Kept as simple
// module-level state, same reasoning as review.js: this page has no
// store/session to hang it off of.
const gridState = { shareToken: null, plan: null, posts: [] };

async function callFn(name, body) {
  let res;
  try {
    res = await fetch(`${FN_BASE}/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the server, check your connection and try again");
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body, json stays null */ }
  if (!res.ok) {
    const err = new Error((json && json.error) || "Something went wrong, please try again");
    err.status = res.status;
    if (json && json.conflict) {
      err.conflict = true;
      err.current = json.current;
    }
    throw err;
  }
  return json;
}

// Tiny modal controller, identical in shape to review.js's own, needed here
// for the same reason: tapping a post opens an edit/approve modal, and this
// page has no app shell (ui.js's openModal) to borrow one from.
function openModal(contentEl) {
  const box = document.getElementById("modal-box");
  box.innerHTML = "";
  box.appendChild(contentEl);
  document.getElementById("modal-backdrop").classList.add("open");
}
function closeModal() {
  document.getElementById("modal-backdrop").classList.remove("open");
  document.getElementById("modal-box").innerHTML = "";
}
document.getElementById("modal-backdrop")?.addEventListener("click", (e) => {
  if (e.target.id === "modal-backdrop") closeModal();
});

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
  const gridPlan = data.gridPlan || null;

  root.innerHTML = "";
  root.appendChild(el(`
    <div>
      <div class="review-header-card">
        <div class="name">Welcome${clientName ? ", " + esc(clientName) : ""}</div>
      </div>
      <div class="review-subtext">Your dashboard, prepared by ${esc(agency)}</div>

      ${gridPlan ? `
        <div class="section-title">Content Calendar</div>
        <div id="portal-gridplan"></div>
      ` : ""}

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

  if (gridPlan) loadGridPlan(gridPlan.shareToken);
}

// ---- Content Calendar (grid plan) ------------------------------------------
// Fetches the client's grid plan posts/media the exact same way review.html
// does, via the review-load Edge Function, then renders them here sorted by
// due date (soonest first, undated posts last) instead of the drag-orderable
// list review.html shows. This view is read-first with just enough
// interactivity to approve or request changes without leaving the
// dashboard; the full drag-reorder experience stays one tap away via
// "Open Full Grid Plan".
async function loadGridPlan(shareToken) {
  const container = root.querySelector("#portal-gridplan");
  if (!container) return;
  container.innerHTML = `<div class="card" style="margin-bottom:14px;"><div class="text-faint" style="font-size:13px;">Loading your content calendar...</div></div>`;
  try {
    const data = await callFn("review-load", { token: shareToken });
    gridState.shareToken = shareToken;
    gridState.plan = data.plan;
    gridState.posts = data.posts || [];
    renderGridPlan(container);
  } catch {
    container.innerHTML = `<div class="card" style="margin-bottom:14px;"><div class="text-faint" style="font-size:13px;">Couldn't load your content calendar right now. Refresh the page to try again.</div></div>`;
  }
}

function renderGridPlan(container) {
  const plan = gridState.plan;
  // Soonest due date first; posts with no date yet sink to the bottom
  // (ties broken by their position in the agency's own ordering), since a
  // due-date calendar should read like a schedule, not the builder's
  // drag-order.
  const posts = gridState.posts.slice().sort((a, b) => {
    if (a.post_date && b.post_date) return a.post_date.localeCompare(b.post_date);
    if (a.post_date) return -1;
    if (b.post_date) return 1;
    return a.position - b.position;
  });

  container.innerHTML = "";
  container.appendChild(el(`
    <div class="card" style="margin-bottom:14px;">
      <div class="flex-between" style="margin-bottom:12px;">
        <span class="status-pill ${esc(plan.status)}">${GRID_STATUS_LABELS[plan.status] || plan.status}</span>
        <a class="small-link" href="review.html?t=${esc(gridState.shareToken)}" target="_blank" rel="noopener noreferrer">Open Full Grid Plan ↗</a>
      </div>
      ${posts.length ? `<div class="grid-tile-grid" id="portal-gp-tiles"></div>` : `<div class="text-faint" style="font-size:13px;">No posts scheduled yet. Check back soon.</div>`}
    </div>
  `));

  const tilesEl = container.querySelector("#portal-gp-tiles");
  if (!tilesEl) return;

  posts.forEach((post) => {
    const media = (post.media || []).find((m) => m.media_type === "image") || (post.media || [])[0];
    const dueLine = post.post_date ? `Due ${fmtDate(post.post_date)}` : "No date set";
    const tile = el(`
      <div class="grid-tile" data-id="${post.id}">
        <span class="grid-tile-status status-pill ${esc(post.status)}">${POST_STATUS_LABELS[post.status] || post.status}</span>
        ${media ? `<img alt="" />` : `<div class="grid-tile-empty">No media yet</div>`}
        ${post.video_link ? `<span class="rv-video-cover-badge">▶</span>` : ""}
        <div class="grid-tile-caption">
          <div style="font-weight:700;font-size:10.5px;opacity:0.85;margin-bottom:2px;">${esc(dueLine)}${post.platform ? " · " + esc(post.platform) : ""}</div>
          ${post.caption ? esc(post.caption) : "<em>No caption yet</em>"}
        </div>
      </div>
    `);
    if (media) {
      const img = tile.querySelector("img");
      if (img) img.src = media.url || "";
    }
    tile.addEventListener("click", () => openGridPostModal(post));
    tilesEl.appendChild(tile);
  });
}

function openGridPostModal(post0) {
  const post = gridState.posts.find((p) => p.id === post0.id) || post0;
  const media = post.media || [];
  // Captured now, at the moment the modal opens, the baseline the eventual
  // save is checked against, exactly like review.js's own post modal.
  const baselineUpdatedAt = post.updated_at;

  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:2px;">Edit Post</div>
      <span class="status-pill ${esc(post.status)}" style="margin-bottom:14px;display:inline-block;">${POST_STATUS_LABELS[post.status] || post.status}</span>

      ${media.length ? `<div id="gpm-media-list" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;"></div>` : ""}
      ${post.video_link ? `<a class="rv-video-link" href="${esc(post.video_link)}" target="_blank" rel="noopener noreferrer">▶ Watch full video</a>` : ""}

      <div class="field" style="margin-top:14px;">
        <label>Caption</label>
        <textarea id="gpm-caption" placeholder="No caption yet">${esc(post.caption || "")}</textarea>
      </div>

      ${post.post_date || post.platform ? `<div class="text-faint" style="font-size:11.5px;margin:-4px 0 14px;">${post.post_date ? "Due " + esc(fmtDate(post.post_date)) : ""}${post.post_date && post.platform ? " · " : ""}${post.platform ? esc(post.platform) : ""}</div>` : ""}

      <button class="btn btn-ghost" id="gpm-save-caption">Save Caption</button>

      <div class="btn-block-row" style="margin-top:12px;">
        <button class="btn btn-success" id="gpm-approve">Approve</button>
        <button class="btn btn-danger" id="gpm-changes">Request Changes</button>
      </div>
    </div>
  `);

  if (media.length) {
    const list = box.querySelector("#gpm-media-list");
    media.forEach((m) => {
      const item = el(`
        <div style="width:64px;height:64px;border-radius:8px;overflow:hidden;background:var(--black-card);border:1px solid var(--line);flex:0 0 auto;">
          ${m.media_type === "video" ? `<video muted playsinline style="width:100%;height:100%;object-fit:cover;"></video>` : `<img style="width:100%;height:100%;object-fit:cover;" alt="" />`}
        </div>
      `);
      const mediaEl = item.querySelector(m.media_type === "video" ? "video" : "img");
      if (mediaEl) mediaEl.src = m.url || "";
      list.appendChild(item);
    });
  }

  box.querySelector("#gpm-save-caption").addEventListener("click", async () => {
    const caption = box.querySelector("#gpm-caption").value.trim();
    const ok = await submitGridUpdate(post, baselineUpdatedAt, { caption });
    if (ok) toast("Caption saved", "success");
  });
  box.querySelector("#gpm-approve").addEventListener("click", () => setGridPostStatus(post, baselineUpdatedAt, "approved"));
  box.querySelector("#gpm-changes").addEventListener("click", () => setGridPostStatus(post, baselineUpdatedAt, "changes_requested"));

  openModal(box);
}

async function setGridPostStatus(post, baselineUpdatedAt, status) {
  const ok = await submitGridUpdate(post, baselineUpdatedAt, { status });
  if (ok) {
    toast(status === "approved" ? "Marked approved" : "Changes requested", "success");
    closeModal();
  }
}

// Shared save path for both caption edits and approve/request-changes. On a
// conflict (the agency changed this exact post at the same time), this
// dashboard doesn't offer review.js's "save anyway" prompt, it's simpler to
// just reload the latest version and let the client redo their edit, since
// unlike the full review page this section isn't meant to be someone's main
// working view for a long editing session.
async function submitGridUpdate(post, baselineUpdatedAt, patch) {
  try {
    const result = await callFn("review-update", { token: gridState.shareToken, post_id: post.id, ...patch, expected_updated_at: baselineUpdatedAt });
    gridState.posts = gridState.posts.map((p) => (p.id === post.id ? { ...p, ...patch, updated_at: result.post?.updated_at } : p));
    const container = root.querySelector("#portal-gridplan");
    if (container) renderGridPlan(container);
    return true;
  } catch (err) {
    if (err.conflict) {
      toast("This post just changed, reloading the latest version", "error");
      await loadGridPlan(gridState.shareToken);
      return false;
    }
    toast(err.message, "error");
    return false;
  }
}

load();
