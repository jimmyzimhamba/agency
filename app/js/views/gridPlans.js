import { sb } from "../supabaseClient.js";
import { store, on, emit } from "../state.js";
import { el, esc, fmtDate, toast, enablePointerReorder, downloadTextFile, todayISO } from "../utils.js";
import { openModal, closeModal, confirmModal } from "../ui.js";

const STATUS_LABELS = { draft: "Draft", shared: "Shared", in_review: "In Review", changes_requested: "Changes Requested", approved: "Approved" };

// Contracts and invoices both flag a record that's been sitting untouched
// too long (contracts.js's STALE_DAYS, invoices.js's STALE_DRAFT_DAYS) —
// grid plans had no equivalent, even though a plan stuck in "draft" or
// "shared" with nobody moving it forward is the same kind of thing quietly
// falling through the cracks. updated_at is auto-bumped by the DB trigger
// on every edit/post change, so it's already the right "last touched"
// signal — same proxy projects.js's isIdleProject relies on.
const STALE_PLAN_DAYS = 5;
function daysSinceTouched(plan) {
  const ref = plan.updated_at || plan.created_at;
  if (!ref) return 0;
  return Math.floor((new Date(todayISO() + "T00:00:00") - new Date(ref.slice(0, 10) + "T00:00:00")) / 86400000);
}
function isStalePlan(plan) {
  return ["draft", "shared"].includes(plan.status) && daysSinceTouched(plan) >= STALE_PLAN_DAYS;
}
const POST_STATUS_LABELS = { pending: "Pending", approved: "Approved", changes_requested: "Changes Requested" };
const PLATFORMS = ["Instagram", "Facebook", "TikTok", "LinkedIn", "X / Twitter", "Other"];

// null = plans-list mode; a plan id = builder mode for that plan. Kept as
// module state (not store) since it's pure navigation, same idiom pipeline.js
// uses for its own filter/sort state.
let openPlanId = null;

// Status filter for the plans list — same "all" + per-status chip-row idiom
// contracts.js/invoices.js/projects.js already use, persisted at module
// scope so it survives switching tabs and back. Before this, the list had no
// aggregate view at all: a bare stack of client cards each with its own
// status pill, no way to see "how many plans are stuck in review" without
// scrolling and eyeballing every pill individually.
let filterStatus = "all";

// Lets another view (e.g. Dashboard's "Grid Plans Needing Changes" card)
// prime this module's own navigation state before switching into this view,
// same "set target-view state, then switchView" pattern dashboard.js already
// uses for pipeline.js's setStatusFilter. renderGridPlans() (called by
// switchView right after) picks this up via the openPlanId check below.
export function openGridPlanId(id) {
  openPlanId = id;
}

// --- Slice 5: realtime presence + soft locking (per open plan) -------------
// One Supabase Realtime channel per plan, joined only while that plan is
// open in the builder (see ensurePlanChannel/teardownPlanChannel below).
// It carries no post content at all — just Presence (who's currently
// editing which post, for the soft-lock badges) and a tiny "changed"
// broadcast ping so other open tabs know to refetch/re-render. The public,
// no-login review page (review.js) joins this SAME channel name with its
// own anon Realtime client, which is what makes cross-side awareness work
// (the agency sees the client editing, and vice versa) without ever
// granting the client's anon key any actual table access — see the
// security note in migration_grid_plans.sql for why that boundary matters.
let planChannel = null;
let planChannelId = null;
let presenceHeartbeat = null;
let editingPostId = null;
const sessionKey = crypto.randomUUID();
const PRESENCE_STALE_MS = 30000;

// 'agent' is treated as manager-equivalent for grid-plan purposes (agents
// already have full non-owner access everywhere else in the app) — mirrors
// grid_can_manage()/grid_can_edit() in migration_grid_roles.sql exactly, so
// a button that's hidden here would also be rejected by RLS if someone
// forced it through anyway.
function canManage() {
  return ["owner", "manager", "agent"].includes(store.profile?.role);
}
function canEdit() {
  return ["owner", "manager", "agent", "designer"].includes(store.profile?.role);
}

export function renderGridPlans() {
  const root = document.getElementById("view-gridplans");
  if (!root) return;
  root.innerHTML = "";
  if (openPlanId && store.gridPlans.some((p) => p.id === openPlanId)) {
    root.appendChild(buildBuilder(openPlanId));
  } else {
    openPlanId = null;
    teardownPlanChannel();
    root.appendChild(buildList());
  }
}

function buildList() {
  const staleCount = store.gridPlans.filter(isStalePlan).length;
  const wrap = el(`
    <div>
      <div class="flex-between">
        <div class="page-title mt-0">Grid Plans<span class="accent">.</span></div>
        ${canManage() ? `<span class="small-link" id="gp-new">+ New Plan</span>` : ""}
      </div>
      <div class="text-faint" style="font-size:12px;margin:-4px 0 14px;line-height:1.4;">Build a grid of upcoming posts and share a private review link with the client.</div>
      ${staleCount ? `
      <div class="card glow-card" style="margin-bottom:10px;">
        <div class="flex-between">
          <div>
            <div style="font-size:22px;font-weight:800;">${staleCount}</div>
            <div class="text-faint" style="font-size:11.5px;">Plan${staleCount === 1 ? "" : "s"} sitting untouched ${STALE_PLAN_DAYS}+ days, worth a nudge before the client wonders what's happening</div>
          </div>
          <span class="status-pill dead">Stale</span>
        </div>
      </div>
      ` : ""}
      ${store.gridPlans.length ? `<div class="chip-row" id="gp-status-chips" style="margin-bottom:10px;"></div>` : ""}
      <div id="gp-list"></div>
    </div>
  `);
  const newBtn = wrap.querySelector("#gp-new");
  if (newBtn) newBtn.addEventListener("click", openNewPlanModal);

  if (!store.gridPlans.length) filterStatus = "all";
  const chipRow = wrap.querySelector("#gp-status-chips");
  if (chipRow) {
    const counts = {};
    store.gridPlans.forEach((p) => { counts[p.status] = (counts[p.status] || 0) + 1; });
    [["all", "All"], ...Object.keys(STATUS_LABELS).map((s) => [s, STATUS_LABELS[s]])]
      .filter(([val]) => val === "all" || counts[val])
      .forEach(([val, label]) => {
        const chip = el(`<span class="chip ${filterStatus === val ? "active" : ""}">${label}${val === "all" ? "" : ` (${counts[val]})`}</span>`);
        chip.addEventListener("click", () => { filterStatus = val; renderGridPlans(); });
        chipRow.appendChild(chip);
      });
  }

  const listEl = wrap.querySelector("#gp-list");
  const plans = store.gridPlans.slice().filter((p) => filterStatus === "all" || p.status === filterStatus);
  if (!plans.length) {
    listEl.appendChild(el(`
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg>
        <p>${store.gridPlans.length ? "No grid plans match this filter." : canManage() ? "No grid plans yet. Start one for a client." : "No grid plans yet."}</p>
      </div>
    `));
    return wrap;
  }

  plans.forEach((plan) => {
    const postCount = store.gridPosts.filter((p) => p.plan_id === plan.id).length;
    const stale = isStalePlan(plan);
    const card = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="display:flex;align-items:center;gap:9px;min-width:0;">
            <span class="plan-accent-dot" style="background:${esc(plan.accent_color || "#7b2ff7")};"></span>
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(plan.client_name)}</div>
              <div class="text-faint" style="font-size:11.5px;">${postCount} post${postCount === 1 ? "" : "s"}</div>
            </div>
          </div>
          ${stale ? `<span class="status-pill dead">Untouched ${daysSinceTouched(plan)}d</span>` : `<span class="status-pill ${esc(plan.status)}">${STATUS_LABELS[plan.status] || plan.status}</span>`}
        </div>
      </div>
    `);
    card.addEventListener("click", () => { openPlanId = plan.id; renderGridPlans(); });
    listEl.appendChild(card);
  });
  return wrap;
}

function openNewPlanModal() {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:14px;">New Grid Plan</div>
      <div class="field">
        <label>Client name *</label>
        <input id="ngp-name" type="text" placeholder="e.g. Acme Coffee" />
      </div>
      <div class="field">
        <label>Accent color</label>
        <input id="ngp-color" type="color" value="#7b2ff7" style="height:40px;padding:4px;" />
      </div>
      <button class="btn btn-primary" id="ngp-save" style="margin-top:6px;">Create Plan</button>
    </div>
  `);
  box.querySelector("#ngp-save").addEventListener("click", async () => {
    const client_name = box.querySelector("#ngp-name").value.trim();
    if (!client_name) return toast("Client name is required", "error");
    const accent_color = box.querySelector("#ngp-color").value || "#7b2ff7";
    const { data, error } = await sb
      .from("grid_plans")
      .insert({ client_name, accent_color, created_by: store.profile.id })
      .select()
      .maybeSingle();
    if (error) return toast(error.message, "error");
    toast("Plan created", "success");
    closeModal();
    if (data) { openPlanId = data.id; renderGridPlans(); }
  });
  openModal(box);
}

function currentPlan(id) {
  return store.gridPlans.find((p) => p.id === id);
}

// Joins (or confirms we're already on) the Realtime channel for this one
// plan. Cheap to call on every render — it's a no-op once already joined.
function ensurePlanChannel(planId) {
  if (planChannel && planChannelId === planId) return;
  teardownPlanChannel();
  planChannelId = planId;
  planChannel = sb
    .channel(`grid-plan-${planId}`, { config: { presence: { key: sessionKey } } })
    .on("broadcast", { event: "changed" }, () => {
      // Our own writes already land via the grid_plans/grid_posts
      // postgres_changes handlers in state.js — this ping is what tells us
      // to re-render for the CLIENT's writes too, since the client's
      // anon-key session has no table access and so produces no
      // postgres_changes event for us to hear on this side at all.
      if (isActive()) renderGridPlans();
    })
    .on("presence", { event: "sync" }, () => {
      if (isActive()) renderGridPlans();
    })
    .subscribe();
}

// Leaves the current plan channel (if any) and stops the presence
// heartbeat. Safe to call even if nothing is currently joined.
function teardownPlanChannel() {
  stopEditingHeartbeat();
  if (planChannel) {
    sb.removeChannel(planChannel);
    planChannel = null;
    planChannelId = null;
  }
}

// Exported so main.js's switchView() can call this when the user navigates
// away from Grid Plans to somewhere else entirely, WITHOUT having closed an
// open post-edit modal first — otherwise the channel/heartbeat would keep
// running in the background indefinitely (renderGridPlans() already tears
// it down when going back to the plan list, but that code path only runs
// when the user clicks "All Plans," not when they tap a different tab).
export function leaveGridPlansView() {
  teardownPlanChannel();
}

// Tells everyone else on this plan's channel "something changed, you
// should refetch/re-render" — carries no actual post content, just a ping.
function pingPlanChannel() {
  if (planChannel) planChannel.send({ type: "broadcast", event: "changed", payload: {} });
}

// Starts (or restarts) a ~8s heartbeat that re-tracks our Presence entry —
// {editing_post_id, ...} — for as long as the post-edit modal stays open.
// ui.js's closeModal() has no onClose hook to key off of, so instead this
// checks the modal's own open/closed CSS state on every tick and quietly
// untracks/stops itself the moment it notices the modal is gone, regardless
// of *how* it closed (Save, Delete, or just tapping the backdrop).
function startEditingHeartbeat(postId) {
  stopEditingHeartbeat(); // clears any previous interval before starting a fresh one
  editingPostId = postId;
  const tick = () => {
    if (!document.getElementById("modal-backdrop")?.classList.contains("open")) {
      stopEditingHeartbeat();
      return;
    }
    planChannel?.track({
      actor_type: "agency",
      actor_name: store.profile?.full_name || "A teammate",
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
  planChannel?.untrack();
}

// Soft-lock lookup: is anyone ELSE (not us) currently editing this post,
// per a fresh-enough Presence entry? Returns that entry (for its
// actor_name) or null. "Soft" per the spec's exact wording — this is
// advisory only and never blocks a save, it just informs the UI.
function editorFor(postId) {
  if (!planChannel) return null;
  const state = planChannel.presenceState();
  const now = Date.now();
  for (const key in state) {
    if (key === sessionKey) continue;
    for (const entry of state[key] || []) {
      if (entry.editing_post_id === postId && now - entry.ts < PRESENCE_STALE_MS) return entry;
    }
  }
  return null;
}

// Atomic optimistic-concurrency save: only applies `payload` if the row's
// updated_at still matches what we captured when the editor opened
// (baselineUpdatedAt). Chaining .eq("updated_at", ...) onto the update
// makes the check-and-write a single atomic round trip — if the row moved
// in between, zero rows match and .select().maybeSingle() comes back null,
// which is how we detect the conflict with no separate read-then-write
// race window.
async function saveWithConflictCheck(post, baselineUpdatedAt, payload) {
  const { data, error } = await sb
    .from("grid_posts")
    .update(payload)
    .eq("id", post.id)
    .eq("updated_at", baselineUpdatedAt)
    .select()
    .maybeSingle();
  if (error) { toast(error.message, "error"); return; }
  if (!data) {
    handleSaveConflict(post, payload);
    return;
  }
  toast("Post saved", "success");
  pingPlanChannel();
  stopEditingHeartbeat();
  closeModal();
}

// A teammate (or the client) saved a change to this exact post while we
// had it open — offer "Save Anyway" (last-write-wins, overwriting theirs;
// the existing trg_log_grid_post_changes trigger already logs their
// overwritten value to grid_activity, so nothing is silently lost) or
// "Cancel & Reload" (discard our local edits and reopen with the latest
// version).
function handleSaveConflict(post, payload) {
  confirmModal({
    title: "This post changed elsewhere",
    body: "A teammate or the client saved a change to this post while you had it open. You can overwrite their change with yours, or reload to see the latest version first.",
    confirmLabel: "Save Anyway",
    cancelLabel: "Cancel & Reload",
    danger: true,
    onConfirm: async () => {
      const { error } = await sb.from("grid_posts").update(payload).eq("id", post.id);
      if (error) return toast(error.message, "error");
      toast("Saved: your version overwrote theirs", "success");
      pingPlanChannel();
      stopEditingHeartbeat();
    },
    onCancel: () => {
      stopEditingHeartbeat();
      const fresh = store.gridPosts.find((p) => p.id === post.id) || post;
      openPostModal(fresh);
    },
  });
}

function buildBuilder(planId) {
  const plan = currentPlan(planId);
  if (!plan) { openPlanId = null; return buildList(); }
  ensurePlanChannel(planId);
  const posts = store.gridPosts.filter((p) => p.plan_id === planId).sort((a, b) => a.position - b.position);
  const editable = canEdit();
  const manageable = canManage();

  const wrap = el(`
    <div>
      <span class="small-link" id="gp-back">&larr; All Plans</span>
      <div class="flex-between" style="margin-top:8px;margin-bottom:2px;">
        <div style="display:flex;align-items:center;gap:9px;min-width:0;">
          <span class="plan-accent-dot" style="background:${esc(plan.accent_color || "#7b2ff7")};"></span>
          <div class="page-title mt-0" style="margin-bottom:0;">${esc(plan.client_name)}</div>
        </div>
        <span class="status-pill ${esc(plan.status)}">${STATUS_LABELS[plan.status] || plan.status}</span>
      </div>
      <div class="text-faint" style="font-size:11.5px;margin-bottom:14px;">${posts.length} post${posts.length === 1 ? "" : "s"}${plan.shared_at ? " · shared " + fmtDate(plan.shared_at) : ""}</div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
        ${manageable ? `<button class="btn btn-ghost btn-sm" id="gp-share" style="width:auto;">${plan.share_token ? "Copy Share Link" : "Share with Client"}</button>` : ""}
        <button class="btn btn-ghost btn-sm" id="gp-export-json" style="width:auto;">Export JSON</button>
        <button class="btn btn-ghost btn-sm" id="gp-export-whatsapp" style="width:auto;">Export for WhatsApp</button>
        ${editable ? `<button class="btn btn-ghost btn-sm" id="gp-import-json" style="width:auto;">Import JSON</button>` : ""}
        ${editable ? `<input type="file" id="gp-import-file" accept="application/json,.json" style="display:none;" />` : ""}
        ${manageable ? `<button class="btn btn-ghost btn-sm" id="gp-delete-plan" style="width:auto;color:#e05d5d;">Delete Plan</button>` : ""}
      </div>

      <div class="grid-tile-grid" id="gp-tiles"></div>
    </div>
  `);

  wrap.querySelector("#gp-back").addEventListener("click", () => { openPlanId = null; renderGridPlans(); });

  const shareBtn = wrap.querySelector("#gp-share");
  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      if (plan.share_token) copyShareLink(plan);
      else shareWithClient(plan);
    });
  }
  const deletePlanBtn = wrap.querySelector("#gp-delete-plan");
  if (deletePlanBtn) {
    deletePlanBtn.addEventListener("click", () => {
      confirmModal({
        title: "Delete this plan?",
        body: `This permanently removes <b>${esc(plan.client_name)}</b>'s grid plan and every post in it. This can't be undone.`,
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
          const { error } = await sb.from("grid_plans").delete().eq("id", plan.id);
          if (error) return toast(error.message, "error");
          toast("Plan deleted", "success");
          openPlanId = null;
          renderGridPlans();
        },
      });
    });
  }

  wrap.querySelector("#gp-export-json").addEventListener("click", () => exportPlanJSON(plan, posts));
  wrap.querySelector("#gp-export-whatsapp").addEventListener("click", () => exportPlanWhatsApp(plan, posts));
  const importBtn = wrap.querySelector("#gp-import-json");
  const importFile = wrap.querySelector("#gp-import-file");
  if (importBtn && importFile) {
    importBtn.addEventListener("click", () => importFile.click());
    importFile.addEventListener("change", async () => {
      const file = importFile.files?.[0];
      importFile.value = "";
      if (!file) return;
      await handleImportFile(file, planId, posts.length);
    });
  }

  renderTiles(wrap.querySelector("#gp-tiles"), planId, posts, editable);
  return wrap;
}

function renderTiles(tilesEl, planId, posts, editable) {
  tilesEl.innerHTML = "";
  posts.forEach((post) => {
    const media = store.gridPostMedia.filter((m) => m.post_id === post.id).sort((a, b) => a.position - b.position)[0];
    const editor = editorFor(post.id);
    const tile = el(`
      <div class="grid-tile" data-id="${post.id}">
        ${editable ? `<span class="grid-tile-drag-handle">⠿</span>` : ""}
        <span class="grid-tile-status status-pill ${esc(post.status)}">${POST_STATUS_LABELS[post.status] || post.status}</span>
        ${editor ? `<span class="grid-tile-lock-badge">✎ ${esc(editor.actor_name || "Someone")} editing</span>` : ""}
        ${media ? `<img alt="" />` : `<div class="grid-tile-empty">No media yet</div>`}
        <div class="grid-tile-caption">${post.caption ? esc(post.caption) : "<em>No caption yet</em>"}</div>
      </div>
    `);
    tile.addEventListener("click", (e) => {
      if (e.target.closest(".grid-tile-drag-handle")) return;
      openPostModal(post);
    });
    const img = tile.querySelector("img");
    if (img && media) loadSignedThumb(img, media.storage_path);
    tilesEl.appendChild(tile);
  });

  if (editable) {
    const addTile = el(`
      <div class="grid-tile-add" id="gp-add-tile">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="26" height="26"><path d="M12 5v14M5 12h14"/></svg>
        <span style="font-size:11.5px;">Add Post</span>
      </div>
    `);
    addTile.addEventListener("click", () => addPost(planId, posts.length));
    tilesEl.appendChild(addTile);

    enablePointerReorder(tilesEl, ".grid-tile", ".grid-tile-drag-handle", handleReorder);
  }

  if (!posts.length && !editable) {
    tilesEl.appendChild(el(`<div class="text-faint" style="font-size:12.5px;">No posts on this plan yet.</div>`));
  }
}

async function loadSignedThumb(imgEl, path) {
  const { data, error } = await sb.storage.from("grid-media").createSignedUrl(path, 3600);
  if (error || !data) return;
  imgEl.src = data.signedUrl;
}

async function addPost(planId, position) {
  const { data, error } = await sb.from("grid_posts").insert({ plan_id: planId, position }).select().maybeSingle();
  if (error) return toast(error.message, "error");
  toast("Post added", "success");
  pingPlanChannel();
  if (data) openPostModal(data);
}

// Reordering deliberately gets NO conflict check — last-write-wins here is
// the intended behavior (per spec), not an oversight, since position has
// no meaningful "your edit vs. their edit" content to protect.
async function handleReorder(orderedIds) {
  const results = await Promise.all(orderedIds.map((id, idx) => sb.from("grid_posts").update({ position: idx }).eq("id", id)));
  const failed = results.find((r) => r.error);
  if (failed) toast(failed.error.message, "error");
  else pingPlanChannel();
}

// Client-side random token — long and unguessable enough that brute-forcing
// it isn't practical, same spirit as the org invite_code but wider (this one
// gates a public no-login page, not just a signup flow). The actual public
// review page (Slice 4b) isn't built yet, so the link this produces doesn't
// resolve to anything live yet — the toast below says so explicitly.
function generateShareToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function shareWithClient(plan) {
  const token = generateShareToken();
  const { error } = await sb
    .from("grid_plans")
    .update({
      share_token: token,
      status: plan.status === "draft" ? "shared" : plan.status,
      shared_at: new Date().toISOString(),
    })
    .eq("id", plan.id);
  if (error) return toast(error.message, "error");
  toast("Share link ready, the client review page ships in a follow-up update", "success");
}

async function copyShareLink(plan) {
  const url = `${location.origin}/review.html?t=${plan.share_token}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied (client review page is coming soon)", "success");
  } catch {
    toast(url, "");
  }
}

// --- Slice 6: JSON export/import + WhatsApp text export -------------------
// Export/import is deliberately caption-and-schedule only, never media:
// grid_post_media rows just point at private objects in the "grid-media"
// Storage bucket (see loadSignedThumb above), so there's no portable way to
// carry the actual image/video bytes inside a JSON file without a whole
// separate re-upload pipeline — out of scope here. `status` is included on
// export for reference/record-keeping but deliberately IGNORED on import
// (see handleImportFile): status is supposed to reflect the CLIENT's live
// review state, not something a re-import should be able to fabricate, so
// every imported post starts life the normal way, as 'pending'.
function slugify(name) {
  return (name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "") || "grid-plan";
}

function exportPlanJSON(plan, posts) {
  const payload = {
    format: "studio-x-grid-plan",
    version: 1,
    exported_at: new Date().toISOString(),
    plan: { client_name: plan.client_name, accent_color: plan.accent_color },
    posts: posts
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((p) => ({
        position: p.position,
        caption: p.caption || "",
        client_note: p.client_note || "",
        platform: p.platform || null,
        post_date: p.post_date || null,
        status: p.status, // informational only — never re-applied on import
      })),
  };
  downloadTextFile(`${slugify(plan.client_name)}-grid-plan.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8;");
  toast("Plan exported as JSON", "success");
}

function buildWhatsAppText(plan, posts) {
  const lines = [`📋 ${plan.client_name}: Content Plan`, ""];
  posts
    .slice()
    .sort((a, b) => a.position - b.position)
    .forEach((p, idx) => {
      const when = p.post_date ? fmtDate(p.post_date) : "No date set";
      const platform = p.platform || "Platform TBD";
      lines.push(`${idx + 1}. [${platform}] ${when}`);
      lines.push(p.caption?.trim() ? p.caption.trim() : "(no caption yet)");
      lines.push("");
    });
  return lines.join("\n").trim();
}

// Clipboard-first (that's the actual point — paste straight into a WhatsApp
// chat) with a plain-text-file download as the fallback for browsers/contexts
// where clipboard access is blocked, same defensive pattern copyShareLink()
// above already uses for the share link itself.
async function exportPlanWhatsApp(plan, posts) {
  const text = buildWhatsAppText(plan, posts);
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied, paste it straight into WhatsApp", "success");
  } catch {
    downloadTextFile(`${slugify(plan.client_name)}-whatsapp.txt`, text, "text/plain;charset=utf-8;");
    toast("Clipboard unavailable, downloaded as a text file instead", "");
  }
}

// Reads + validates the picked file, then hands off to a preview modal —
// nothing is written to the database until the user explicitly confirms in
// that modal. Accepts either `{posts: [...]}` (our own export shape) or a
// bare `[...]` array, so a hand-edited or hand-written JSON file still works.
async function handleImportFile(file, planId, startPosition) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return toast("That file isn't valid JSON", "error");
  }
  const rawPosts = Array.isArray(parsed?.posts) ? parsed.posts : Array.isArray(parsed) ? parsed : null;
  if (!rawPosts || !rawPosts.length) return toast("No posts found in that file", "error");

  let unrecognizedPlatformCount = 0;
  const rows = rawPosts.map((p, idx) => {
    const platform = typeof p?.platform === "string" && PLATFORMS.includes(p.platform) ? p.platform : null;
    if (p?.platform && !platform) unrecognizedPlatformCount++;
    return {
      plan_id: planId,
      position: startPosition + idx,
      caption: typeof p?.caption === "string" ? p.caption.slice(0, 2200) : "",
      client_note: typeof p?.client_note === "string" ? p.client_note.slice(0, 2200) : "",
      platform,
      post_date: typeof p?.post_date === "string" && p.post_date ? p.post_date : null,
    };
  });

  openImportPreviewModal(rows, unrecognizedPlatformCount);
}

function openImportPreviewModal(rows, unrecognizedPlatformCount) {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:6px;">Import ${rows.length} Post${rows.length === 1 ? "" : "s"}</div>
      <div class="text-faint" style="font-size:12px;margin-bottom:12px;line-height:1.5;">
        These get added to the end of this plan as new pending posts, nothing is saved until you confirm below. Media isn't part of JSON import; add images/video on each post afterward.
        ${unrecognizedPlatformCount ? `<br>⚠ ${unrecognizedPlatformCount} post${unrecognizedPlatformCount === 1 ? "" : "s"} had a platform not in the list, imported without a platform tag.` : ""}
      </div>
      <div id="gpi-preview" style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:16px;"></div>
      <button class="btn btn-primary" id="gpi-confirm">Import ${rows.length} Post${rows.length === 1 ? "" : "s"}</button>
    </div>
  `);
  const previewEl = box.querySelector("#gpi-preview");
  rows.forEach((r, idx) => {
    previewEl.appendChild(el(`
      <div style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;">
        <div class="text-faint" style="font-size:11px;margin-bottom:2px;">${idx + 1}. ${esc(r.platform || "No platform")}${r.post_date ? " · " + esc(fmtDate(r.post_date)) : ""}</div>
        <div>${r.caption ? esc(r.caption).slice(0, 160) : "<em>No caption</em>"}</div>
      </div>
    `));
  });
  box.querySelector("#gpi-confirm").addEventListener("click", async () => {
    const { data, error } = await sb.from("grid_posts").insert(rows).select("id");
    if (error) return toast(error.message, "error");
    toast(`Imported ${rows.length} post${rows.length === 1 ? "" : "s"}`, "success");
    pingPlanChannel();
    showImportDoneState(box, data || []);
  });
  openModal(box);
}

// Keeps the just-inserted ids around for a single one-tap "Undo Import" —
// same escape hatch bulkImport.js's prospect import offers, applied here so
// a bad/duplicate JSON file doesn't mean manually deleting posts one by one.
function showImportDoneState(box, insertedRows) {
  box.innerHTML = "";
  box.appendChild(el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:6px;">Imported ${insertedRows.length} Post${insertedRows.length === 1 ? "" : "s"}</div>
      <div class="text-faint" style="font-size:12px;margin-bottom:16px;">Changed your mind? You can undo this import as long as you haven't closed this window.</div>
      <button class="btn btn-ghost btn-sm" id="gpi-undo" style="width:auto;color:#e05d5d;margin-right:8px;">Undo Import</button>
      <button class="btn btn-primary" id="gpi-done" style="width:auto;">Done</button>
    </div>
  `));
  box.querySelector("#gpi-done").addEventListener("click", () => closeModal());
  box.querySelector("#gpi-undo").addEventListener("click", async () => {
    const ids = insertedRows.map((r) => r.id);
    const { error } = await sb.from("grid_posts").delete().in("id", ids);
    if (error) return toast(error.message, "error");
    toast("Import undone", "success");
    pingPlanChannel();
    closeModal();
  });
}

async function refetchGridPostMedia() {
  const { data } = await sb.from("grid_post_media").select("*").order("position");
  store.gridPostMedia = data || [];
  emit("gridPostMedia");
}

function renderMediaList(container, mediaList, editable) {
  container.innerHTML = "";
  if (!mediaList.length) {
    container.appendChild(el(`<div class="text-faint" style="font-size:12px;">No media yet.</div>`));
    return;
  }
  mediaList.forEach((m) => {
    const item = el(`
      <div style="position:relative;width:64px;height:64px;border-radius:8px;overflow:hidden;background:var(--black-card);border:1px solid var(--line);flex:0 0 auto;">
        ${m.media_type === "video"
          ? `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text-faint);">Video</div>`
          : `<img style="width:100%;height:100%;object-fit:cover;" alt="" />`}
        ${editable ? `<span data-remove style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.6);border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;color:#fff;">×</span>` : ""}
      </div>
    `);
    const img = item.querySelector("img");
    if (img) loadSignedThumb(img, m.storage_path);
    const removeBtn = item.querySelector("[data-remove]");
    if (removeBtn) {
      removeBtn.addEventListener("click", async () => {
        const { error: storageErr } = await sb.storage.from("grid-media").remove([m.storage_path]);
        if (storageErr) return toast(storageErr.message, "error");
        const { error: dbErr } = await sb.from("grid_post_media").delete().eq("id", m.id);
        if (dbErr) return toast(dbErr.message, "error");
        toast("Media removed", "success");
        pingPlanChannel();
        await refetchGridPostMedia();
        const freshMedia = store.gridPostMedia.filter((mm) => mm.post_id === m.post_id).sort((a, b) => a.position - b.position);
        renderMediaList(container, freshMedia, editable);
      });
    }
    container.appendChild(item);
  });
}

function openPostModal(post0) {
  const post = store.gridPosts.find((p) => p.id === post0.id) || post0;
  const editable = canEdit();
  const manageable = canManage();
  const media = store.gridPostMedia.filter((m) => m.post_id === post.id).sort((a, b) => a.position - b.position);
  // Baseline for the optimistic-concurrency check on save — captured now,
  // at the moment the editor opens, not re-read at save time.
  const baselineUpdatedAt = post.updated_at;
  const otherEditor = editorFor(post.id);

  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:2px;">Edit Post</div>
      <span class="status-pill ${esc(post.status)}" style="margin-bottom:14px;display:inline-block;">${POST_STATUS_LABELS[post.status] || post.status}</span>
      ${otherEditor ? `<div class="grid-tile-lock-badge" style="position:static;display:inline-block;margin:0 0 14px 8px;">✎ ${esc(otherEditor.actor_name || "Someone")} is also viewing this post right now</div>` : ""}

      <div class="section-title mt-0">Media</div>
      <div id="gpm-media-list" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;"></div>
      ${editable ? `
        <input type="file" id="gpm-file-input" accept="image/*,video/*" style="display:none;" />
        <button class="btn btn-ghost btn-sm" id="gpm-upload-btn" style="width:auto;margin-bottom:16px;">+ Add Media</button>
      ` : ""}

      <div class="field">
        <label>Caption</label>
        <textarea id="gpm-caption" placeholder="What the post will say...">${esc(post.caption || "")}</textarea>
      </div>

      <div class="field client-note-field">
        <label>Client note</label>
        <div class="client-note-warning">⚠ A private note for the client, not the caption itself.</div>
        <textarea id="gpm-note" placeholder="A note for the client about this post (not the caption)...">${esc(post.client_note || "")}</textarea>
      </div>

      <div class="field-row" style="margin-top:14px;">
        <div class="field" style="margin-bottom:0;">
          <label>Platform</label>
          <select id="gpm-platform">
            <option value="">Select platform</option>
            ${PLATFORMS.map((pl) => `<option value="${pl}" ${post.platform === pl ? "selected" : ""}>${pl}</option>`).join("")}
          </select>
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>Post date</label>
          <input id="gpm-date" type="date" value="${post.post_date || ""}" />
        </div>
      </div>

      ${editable ? `<button class="btn btn-primary" id="gpm-save" style="margin-top:16px;">Save Changes</button>` : ""}
      ${manageable ? `<button class="btn btn-danger" id="gpm-delete" style="margin-top:10px;">Delete Post</button>` : ""}
    </div>
  `);

  renderMediaList(box.querySelector("#gpm-media-list"), media, editable);

  if (editable) {
    // Soft-lock heartbeat: lets everyone else on this plan's channel see
    // "editing this post" for as long as this modal stays open, however it
    // eventually closes (Save, Delete, or just tapping the backdrop).
    startEditingHeartbeat(post.id);

    box.querySelector("#gpm-save").addEventListener("click", async () => {
      const payload = {
        caption: box.querySelector("#gpm-caption").value.trim(),
        client_note: box.querySelector("#gpm-note").value.trim(),
        platform: box.querySelector("#gpm-platform").value || null,
        post_date: box.querySelector("#gpm-date").value || null,
      };
      await saveWithConflictCheck(post, baselineUpdatedAt, payload);
    });

    const fileInput = box.querySelector("#gpm-file-input");
    box.querySelector("#gpm-upload-btn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return toast("Please choose an image or video file", "error");
      if (file.size > 25 * 1024 * 1024) return toast("File must be under 25MB", "error");

      const extMatch = /\.([a-z0-9]+)$/i.exec(file.name || "");
      const ext = (extMatch ? extMatch[1] : "jpg").toLowerCase();
      const path = `${store.profile.org_id}/${post.plan_id}/${post.id}-${Date.now()}.${ext}`;

      const { error: upErr } = await sb.storage.from("grid-media").upload(path, file, { cacheControl: "3600" });
      if (upErr) return toast(upErr.message || "Upload failed", "error");

      const currentMedia = store.gridPostMedia.filter((m) => m.post_id === post.id);
      const media_type = file.type.startsWith("video/") ? "video" : "image";
      const { error: dbErr } = await sb
        .from("grid_post_media")
        .insert({ post_id: post.id, storage_path: path, media_type, position: currentMedia.length });
      if (dbErr) return toast(dbErr.message, "error");

      toast("Media added", "success");
      pingPlanChannel();
      await refetchGridPostMedia();
      const freshMedia = store.gridPostMedia.filter((m) => m.post_id === post.id).sort((a, b) => a.position - b.position);
      renderMediaList(box.querySelector("#gpm-media-list"), freshMedia, editable);
    });
  }

  const deleteBtn = box.querySelector("#gpm-delete");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      confirmModal({
        title: "Delete this post?",
        body: "This removes the post and its media from the grid. This can't be undone.",
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
          const { error } = await sb.from("grid_posts").delete().eq("id", post.id);
          if (error) return toast(error.message, "error");
          toast("Post deleted", "success");
          pingPlanChannel();
          stopEditingHeartbeat();
          closeModal();
        },
      });
    });
  }

  openModal(box);
}

export function initGridPlansView() {
  on("gridPlans", () => { if (isActive()) renderGridPlans(); });
  on("gridPosts", () => { if (isActive()) renderGridPlans(); });
  on("gridPostMedia", () => { if (isActive()) renderGridPlans(); });
}
function isActive() {
  return document.getElementById("view-gridplans")?.classList.contains("active");
}
