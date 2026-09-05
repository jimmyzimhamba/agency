// ============================================================================
// STUDIO X COMMAND — Public client grid-plan review page (app/review.html)
// ============================================================================
// What this does, in plain language:
//   The page a client lands on when they tap the private link the agency
//   sends them. No login, no account — the ?t=<token> in the URL IS their
//   access. Everything here talks to the four review-* Edge Functions
//   (supabase/functions/review-load|update|reorder|complete) over plain
//   fetch() with the public anon key, never to the database directly — this
//   file has no Supabase client at all, on purpose, since the whole point of
//   those Edge Functions is to be the one narrow, checked doorway a
//   no-login visitor is allowed to use.
//
//   Deliberately self-contained: reuses only the pure-DOM helpers from
//   utils.js (el/esc/toast/enablePointerReorder/fmtDate — none of which
//   touch auth or Supabase), not gridPlans.js or state.js, since this page
//   has no session/store to hang off of.
//
//   Slice 5 adds one exception to "never talks to Supabase directly": a
//   second, Realtime-only client (rtClient below) used exclusively for
//   .channel() — Presence (soft-lock "editing" indicators) and Broadcast
//   ("something changed, please refetch") pings. This client NEVER calls
//   .from()/.storage/.auth for anything; those calls would be blocked by
//   RLS anyway (see migration_grid_plans.sql's security model comment), but
//   the real safeguard is architectural — this file simply never makes
//   them. All actual plan/post data still flows exclusively through the
//   four review-* Edge Functions via callFn() below.
// ============================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { el, esc, toast, enablePointerReorder, fmtDate } from "./utils.js";

const STATUS_LABELS = { draft: "Draft", shared: "Shared", in_review: "In Review", changes_requested: "Changes Requested", approved: "Approved" };
const POST_STATUS_LABELS = { pending: "Pending", approved: "Approved", changes_requested: "Changes Requested" };

const token = new URLSearchParams(location.search).get("t");
const root = document.getElementById("review-root");
const FN_BASE = `${SUPABASE_URL}/functions/v1`;

// persistSession: false — there's no login here, and this is often a
// shared/borrowed device, so nothing about this visit should linger in
// localStorage after the tab closes.
const rtClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  : null;

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
  try { json = await res.json(); } catch { /* non-JSON body — json stays null */ }
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

// --- Slice 5: realtime presence + soft locking -----------------------------
// One channel per plan, named identically to the one gridPlans.js joins on
// the agency side (grid-plan-<id>) — that shared name is what makes
// cross-side awareness work at all. Carries no post content, only presence
// metadata and a bare "changed" ping.
let channel = null;
let channelPlanId = null;
let presenceHeartbeat = null;
let editingPostId = null;
const sessionKey = crypto.randomUUID();
const PRESENCE_STALE_MS = 30000;

function ensureChannel(planId) {
  if (!rtClient || (channel && channelPlanId === planId)) return;
  teardownChannel();
  channelPlanId = planId;
  channel = rtClient
    .channel(`grid-plan-${planId}`, { config: { presence: { key: sessionKey } } })
    .on("broadcast", { event: "changed" }, () => {
      // The agency (or another tab of ours) saved something. This is the
      // ONLY way this no-login page can ever hear about an agency-side
      // change — it has no table access at all to receive a
      // postgres_changes event from, unlike the authenticated app.
      loadPlan();
    })
    .on("presence", { event: "sync" }, () => {
      render();
    })
    .subscribe();
}

function teardownChannel() {
  stopEditingHeartbeat();
  if (channel && rtClient) {
    rtClient.removeChannel(channel);
    channel = null;
    channelPlanId = null;
  }
}

function pingChannel() {
  if (channel) channel.send({ type: "broadcast", event: "changed", payload: {} });
}

// Re-tracks a Presence entry every ~8s for as long as the post-edit modal
// stays open, self-stopping the moment it notices the modal has closed
// (however it closed — Save, Approve/Request Changes, or backdrop tap).
function startEditingHeartbeat(postId) {
  stopEditingHeartbeat();
  editingPostId = postId;
  const tick = () => {
    if (!document.getElementById("modal-backdrop")?.classList.contains("open")) {
      stopEditingHeartbeat();
      return;
    }
    channel?.track({
      actor_type: "client",
      actor_name: state.plan?.client_name ? `${state.plan.client_name}` : "The client",
      editing_post_id: editingPostId,
      ts: Date.now(),
    });
  };
  tick();
  presenceHeartbeat = setInterval(tick, 8000);
}

function stopEditingHeartbeat() {
  if (presenceHeartbeat) {
    clearInterval(presenceHeartbeat);
    presenceHeartbeat = null;
  }
  editingPostId = null;
  channel?.untrack();
}

// Soft-lock lookup — is anyone else (i.e. an agency teammate) currently
// editing this post, per a fresh-enough Presence entry? Advisory only,
// never blocks a save.
function editorFor(postId) {
  if (!channel) return null;
  const presenceState = channel.presenceState();
  const now = Date.now();
  for (const key in presenceState) {
    if (key === sessionKey) continue;
    for (const entry of presenceState[key] || []) {
      if (entry.editing_post_id === postId && now - entry.ts < PRESENCE_STALE_MS) return entry;
    }
  }
  return null;
}

// ---- tiny modal controller — mirrors js/ui.js's openModal/closeModal, but
// standalone so this one page doesn't need the rest of the app shell (the
// bottom sheet, its markup, initGlobalUI, etc.) it would otherwise require.
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
document.getElementById("modal-backdrop").addEventListener("click", (e) => {
  if (e.target.id === "modal-backdrop") closeModal();
});

const state = { plan: null, posts: [], loading: true, error: null, submitted: false, lastStatus: null };

async function loadPlan() {
  state.loading = true;
  state.error = null;
  render();
  try {
    const data = await callFn("review-load", { token });
    state.plan = data.plan;
    state.posts = data.posts;
    ensureChannel(data.plan.id);
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  root.innerHTML = "";
  if (state.loading && !state.plan) { root.appendChild(renderCenterState(true, "Loading your review…")); return; }
  if (state.error && !state.plan) { root.appendChild(renderCenterState(false, state.error)); return; }
  if (state.submitted) { root.appendChild(renderSubmitted()); return; }
  root.appendChild(renderBuilder());
}

function renderCenterState(isLoading, message) {
  const wrap = el(`
    <div class="review-center-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg>
      <h1>${isLoading ? "One moment…" : "Can't open this review"}</h1>
      <p>${esc(message)}</p>
      ${!isLoading && token ? `<button class="btn btn-ghost btn-sm" id="rc-retry">Try Again</button>` : ""}
    </div>
  `);
  const retryBtn = wrap.querySelector("#rc-retry");
  if (retryBtn) retryBtn.addEventListener("click", loadPlan);
  return wrap;
}

function renderBuilder() {
  const plan = state.plan;
  const posts = state.posts.slice().sort((a, b) => a.position - b.position);
  const wrap = el(`
    <div>
      <div class="review-header-card">
        <span class="plan-accent-dot" style="width:14px;height:14px;background:${esc(plan.accent_color || "#7b2ff7")};"></span>
        <div style="min-width:0;flex:1;">
          <div class="name">${esc(plan.client_name)}'s Grid Plan</div>
        </div>
        <span class="status-pill ${esc(plan.status)}">${STATUS_LABELS[plan.status] || plan.status}</span>
      </div>
      <div class="review-subtext">
        Drag a tile to reorder it, tap one to edit the caption or approve it.
        <span class="small-link" id="rv-refresh" style="display:inline-block;margin-left:4px;">↻ Refresh</span>
      </div>
      <div class="grid-tile-grid" id="rv-tiles"></div>
      <div class="review-footer-bar">
        <button class="btn btn-primary" id="rv-submit">Submit My Review</button>
      </div>
    </div>
  `);

  wrap.querySelector("#rv-refresh").addEventListener("click", loadPlan);
  wrap.querySelector("#rv-submit").addEventListener("click", openSubmitModal);
  renderTiles(wrap.querySelector("#rv-tiles"), posts);
  return wrap;
}

function renderTiles(tilesEl, posts) {
  tilesEl.innerHTML = "";
  if (!posts.length) {
    tilesEl.appendChild(el(`<div class="text-faint" style="font-size:12.5px;grid-column:1/-1;">No posts on this plan yet. Check back soon.</div>`));
    return;
  }
  posts.forEach((post) => {
    const media = (post.media || [])[0];
    const editor = editorFor(post.id);
    const tile = el(`
      <div class="grid-tile" data-id="${post.id}">
        <span class="grid-tile-drag-handle">⠿</span>
        <span class="grid-tile-status status-pill ${esc(post.status)}">${POST_STATUS_LABELS[post.status] || post.status}</span>
        ${editor ? `<span class="grid-tile-lock-badge">✎ Agency editing</span>` : ""}
        ${media ? (media.media_type === "video" ? `<video muted playsinline style="width:100%;height:100%;object-fit:cover;"></video>` : `<img alt="" />`) : `<div class="grid-tile-empty">No media yet</div>`}
        <div class="grid-tile-caption">${post.caption ? esc(post.caption) : "<em>No caption yet</em>"}</div>
      </div>
    `);
    if (media) {
      const mediaEl = tile.querySelector(media.media_type === "video" ? "video" : "img");
      if (mediaEl) mediaEl.src = media.url || "";
    }
    tile.addEventListener("click", (e) => {
      if (e.target.closest(".grid-tile-drag-handle")) return;
      openPostModal(post);
    });
    tilesEl.appendChild(tile);
  });

  enablePointerReorder(tilesEl, ".grid-tile", ".grid-tile-drag-handle", handleReorder);
}

// Reordering deliberately gets NO conflict check — last-write-wins here is
// the intended behavior, not an oversight. A full refetch after success
// (rather than an optimistic local patch) is needed because reordering
// also bumps each post's updated_at server-side, and this page has no
// postgres_changes subscription to otherwise pick up that new canonical
// value — the next caption/status save needs the fresh updated_at as its
// conflict-check baseline, or it would misfire as a false conflict.
async function handleReorder(orderedIds) {
  try {
    await callFn("review-reorder", { token, order: orderedIds });
    toast("Order saved", "success");
    pingChannel();
    await loadPlan();
  } catch (err) {
    toast(err.message, "error");
    // The DOM may now disagree with what actually got saved (or didn't) —
    // resync from the server rather than leave it silently wrong.
    await loadPlan();
  }
}

function openPostModal(post0) {
  const post = state.posts.find((p) => p.id === post0.id) || post0;
  const media = post.media || [];
  // Captured now, at the moment the editor opens — the baseline the
  // eventual save is checked against, not re-read at save time.
  const baselineUpdatedAt = post.updated_at;
  const otherEditor = editorFor(post.id);
  startEditingHeartbeat(post.id);

  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:2px;">Edit Post</div>
      <span class="status-pill ${esc(post.status)}" style="margin-bottom:14px;display:inline-block;">${POST_STATUS_LABELS[post.status] || post.status}</span>
      ${otherEditor ? `<div class="grid-tile-lock-badge" style="position:static;display:inline-block;margin:0 0 14px 8px;">✎ Someone from the agency is also viewing this post right now</div>` : ""}

      ${media.length ? `<div id="rvm-media-list" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;"></div>` : ""}

      <div class="field">
        <label>Caption</label>
        <textarea id="rvm-caption" placeholder="No caption yet">${esc(post.caption || "")}</textarea>
      </div>

      ${post.client_note ? `
        <div class="field client-note-field review-note-readonly">
          <label>Note from the agency</label>
          <div class="client-note-warning">⚠ A private note about this post, not part of the caption.</div>
          <textarea readonly>${esc(post.client_note)}</textarea>
        </div>
      ` : ""}

      ${post.post_date || post.platform ? `<div class="text-faint" style="font-size:11.5px;margin:-4px 0 14px;">${post.post_date ? "Planned for " + esc(fmtDate(post.post_date)) : ""}${post.post_date && post.platform ? " · " : ""}${post.platform ? esc(post.platform) : ""}</div>` : ""}

      <button class="btn btn-ghost" id="rvm-save-caption">Save Caption</button>

      <div class="btn-block-row" style="margin-top:12px;">
        <button class="btn btn-success" id="rvm-approve">Approve</button>
        <button class="btn btn-danger" id="rvm-changes">Request Changes</button>
      </div>
    </div>
  `);

  if (media.length) {
    const list = box.querySelector("#rvm-media-list");
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

  box.querySelector("#rvm-save-caption").addEventListener("click", async () => {
    const caption = box.querySelector("#rvm-caption").value.trim();
    const ok = await submitUpdate(post, baselineUpdatedAt, { caption });
    if (ok) toast("Caption saved", "success");
  });
  box.querySelector("#rvm-approve").addEventListener("click", () => setPostStatus(post, baselineUpdatedAt, "approved"));
  box.querySelector("#rvm-changes").addEventListener("click", () => setPostStatus(post, baselineUpdatedAt, "changes_requested"));

  openModal(box);
}

async function setPostStatus(post, baselineUpdatedAt, status) {
  const ok = await submitUpdate(post, baselineUpdatedAt, { status });
  if (ok) {
    toast(status === "approved" ? "Marked approved" : "Changes requested", "success");
    stopEditingHeartbeat();
    closeModal();
  }
}

// Shared save path for both caption edits and approve/request-changes,
// with optimistic-concurrency conflict handling. `force: true` (used only
// from the conflict prompt's "Save Anyway") skips the expected_updated_at
// check entirely — last-write-wins, same as the agency side, and the
// existing trg_log_grid_post_changes trigger already logs whatever gets
// overwritten to grid_activity, so nothing is silently lost.
async function submitUpdate(post, baselineUpdatedAt, patch, { force = false } = {}) {
  try {
    const body = { token, post_id: post.id, ...patch };
    if (force) body.force = true;
    else body.expected_updated_at = baselineUpdatedAt;
    const result = await callFn("review-update", body);
    applyPostPatch(post.id, { ...patch, updated_at: result.post?.updated_at });
    pingChannel();
    return true;
  } catch (err) {
    if (err.conflict) {
      showConflictPrompt(post, patch);
      return false;
    }
    toast(err.message, "error");
    return false;
  }
}

// The agency changed this exact post while the client had it open. Offers
// "Save Anyway" (overwrite their change with ours) or "Reload Latest"
// (discard our local edit and refetch) — same choice gridPlans.js offers
// on the agency side for the mirror-image conflict.
function showConflictPrompt(post, patch) {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:8px;">This post just changed</div>
      <div style="font-size:13.5px;color:var(--text-dim);margin-bottom:16px;line-height:1.4;">The agency made a change to this post while you had it open. You can save your change anyway, or reload to see their latest version first.</div>
      <div class="btn-block-row">
        <button class="btn btn-ghost" id="cf-cancel">Reload Latest</button>
        <button class="btn btn-danger" id="cf-save">Save Anyway</button>
      </div>
    </div>
  `);
  box.querySelector("#cf-cancel").addEventListener("click", async () => {
    closeModal();
    stopEditingHeartbeat();
    await loadPlan();
  });
  box.querySelector("#cf-save").addEventListener("click", async () => {
    closeModal();
    const ok = await submitUpdate(post, null, patch, { force: true });
    stopEditingHeartbeat();
    if (ok) toast("Saved: your version overwrote theirs", "success");
  });
  openModal(box);
}

// Patches one post's local state and re-renders the page behind the modal
// (the modal itself lives outside #review-root, so this doesn't close it).
function applyPostPatch(postId, patch) {
  state.posts = state.posts.map((p) => (p.id === postId ? { ...p, ...patch } : p));
  render();
}

function openSubmitModal() {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:8px;">Submit your review</div>
      <div style="font-size:13.5px;color:var(--text-dim);margin-bottom:14px;line-height:1.4;">If everything looks good, the agency will get it ready to publish. If anything still needs work, they'll see that too. Add a note below if it helps.</div>
      <div class="field">
        <label>Anything else to add? (optional)</label>
        <textarea id="rvs-message" placeholder="Optional message for the agency..."></textarea>
      </div>
      <button class="btn btn-primary" id="rvs-confirm">Submit Review</button>
    </div>
  `);
  box.querySelector("#rvs-confirm").addEventListener("click", async () => {
    const message = box.querySelector("#rvs-message").value.trim();
    const btn = box.querySelector("#rvs-confirm");
    btn.disabled = true;
    try {
      const result = await callFn("review-complete", { token, message });
      state.lastStatus = result.status;
      state.submitted = true;
      closeModal();
      render();
    } catch (err) {
      btn.disabled = false;
      toast(err.message, "error");
    }
  });
  openModal(box);
}

function renderSubmitted() {
  const approved = state.lastStatus === "approved";
  const wrap = el(`
    <div class="review-center-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 6L9 17l-5-5"/></svg>
      <h1>${approved ? "Plan approved!" : "Review submitted"}</h1>
      <p>${approved ? "Thanks. The agency has been notified and will get these posts ready to go." : "Thanks. The agency has been notified and will follow up on what you flagged."}</p>
      <button class="btn btn-ghost btn-sm" id="rs-back">Back to Review</button>
    </div>
  `);
  wrap.querySelector("#rs-back").addEventListener("click", () => { state.submitted = false; render(); });
  return wrap;
}

function init() {
  if (!token) {
    state.error = "This link is missing its access code. Ask the agency to resend the review link.";
    state.loading = false;
    render();
    return;
  }
  loadPlan();
}
init();
