import { sb } from "../supabaseClient.js";
import { store, on, profileById, nicheById, nicheDotHTML, bestTemplateFor, knownCities } from "../state.js";
import { el, esc, avatarHTML, statusLabel, buildWhatsAppLink, personalizeMessage, toast, debounce, toCSV, downloadTextFile, findDuplicateProspect, fmtDate, todayISO } from "../utils.js";
import { openSheet, closeSheet, openModal, closeModal, confirmModal } from "../ui.js";
import { buildProspectForm } from "./prospectForm.js";
import { openProspectDetail } from "./prospectDetail.js";
import { openBulkImportSheet } from "./bulkImport.js";
import { patchProspect } from "../outbox.js";

const filters = {
  search: "",
  status: "all",
  tier: "all",
  niche: "all",
  city: "all",
  onlyMine: false,
  onlyStale: false,
  onlyNoFollowUp: false,
  onlyOverdueFollowUp: false,
  onlyUnreachable: false,
  onlyNoWebsite: false,
  onlyTopRated: false,
  onlyResearchFailed: false,
  sortHeat: false,
};

// Same "going cold" signal dashboard.js already computes for its aggregate
// stat card (active status + no update in 5+ days), just surfaced per-row
// here so a rep can actually spot and act on the cold ones while working the
// list, instead of only seeing a count that opens a separate read-only
// modal. Same 5-day threshold for consistency between the two views.
const STALE_DAYS = 5;
function daysSinceUpdate(p) {
  return Math.floor((Date.now() - new Date(p.updated_at).getTime()) / 86400000);
}
function isStaleProspect(p) {
  return !["signed", "dead"].includes(p.status) && daysSinceUpdate(p) >= STALE_DAYS;
}

// Same signal dashboard.js's "No Follow-up Date Set" Data Check card
// computes org-wide — surfaced here too so a rep can jump straight to one of
// these leads and set a reminder while working the list, same reasoning as
// "Going Cold" above.
function hasNoFollowUp(p) {
  return ["sent", "replied", "meeting_booked"].includes(p.status) && !p.follow_up_date;
}

// hasNoFollowUp above only catches a MISSING follow-up date. Once a date is
// actually set and then blown past, every per-row view here reads it as
// "handled" — the only place that catches a blown-past date today is
// main.js's dueTodayList() (the bell icon / "Due Today" sheet), a separate,
// read-only, org-wide modal disconnected from the working list. This
// surfaces the same blown-past signal right here so a rep can filter
// straight to it while actually working Pipeline — same reasoning Going
// Cold/No Follow-up above already established. Deliberately strictly-before-
// today (not due-today-or-earlier), matching projects.js's own
// isOverdueProject() convention: due today isn't overdue yet.
function hasOverdueFollowUp(p) {
  return !["signed", "dead"].includes(p.status) && !!p.follow_up_date && p.follow_up_date < todayISO();
}

// A prospect with no WhatsApp, email, or Instagram is a lead nobody can
// actually act on — no opener to send, no way to reach them at all — yet it
// sits in the pipeline looking like normal backlog. prospectDetail.js only
// surfaces this passively, one prospect at a time, as a "No contact details
// saved" note. This makes it visible and filterable across the whole list so
// it can be enriched or culled in a cleanup pass.
export function hasNoContactMethod(p) {
  return !["signed", "dead"].includes(p.status) && !p.whatsapp_number && !p.email && !p.instagram;
}

// Unlike the flags above (process/data-quality gaps), this one flags a
// sales opportunity: a prospect who visibly lacks the exact product this
// agency sells is a stronger pitch — "I noticed you don't have a website
// yet..." — worth surfacing as its own lens for building a call-list.
function hasNoWebsite(p) {
  return !["signed", "dead"].includes(p.status) && !p.website;
}

// `rating` is captured on every prospect (Add/Edit form) and shown once in
// Prospect Detail's subheader, but nothing ever uses it to prioritize
// outreach. A high public rating that's still sitting untouched is the
// strongest, most-proven kind of lead — an established business with real
// customer trust — so it deserves its own lens distinct from heat score,
// which is agency-assigned rather than public-signal-driven.
const TOP_RATED_THRESHOLD = 4.5;
function isTopRatedUncontacted(p) {
  return p.status === "not_contacted" && Number(p.rating) >= TOP_RATED_THRESHOLD;
}

// The AI Research edge function marks a prospect "failed" when the lookup
// errors out, but the client currently treats "failed" the same as "done"
// everywhere it's checked — a crashed run renders identically to a
// successful one that just came up empty. That leaves dead-end leads
// (no research summary, likely a weak generic outreach message) invisible
// unless someone opens every card one at a time. This makes them
// filterable so they can be batch-triaged and re-run.
function hasFailedResearch(p) {
  return p.research_status === "failed";
}

// ---- bulk select mode -------------------------------------------------------
// Lets someone check off several prospect cards and apply one change (status,
// assignment, or a quick "mark dead") to all of them at once via a single
// `.in("id", [...])` update — instead of opening each prospect one at a time.
let selectMode = false;
const selectedIds = new Set();

function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  renderPipeline();
}

// Lets other views (e.g. Dashboard tiles) deep-link into a filtered Pipeline
// — resets the other filters so the jump lands on a clean, predictable view.
export function setStatusFilter(status) {
  filters.search = "";
  filters.status = status;
  filters.tier = "all";
  filters.niche = "all";
  filters.city = "all";
  filters.onlyMine = false;
}

// ---- saved filter views ----------------------------------------------------
// Lets someone save a named combo of filter chips (status/tier/city/niche/
// assigned-to-me/sort) and re-apply it in one tap — e.g. "Harare, Tier A,
// cold" instead of re-clicking five chips every time. Deliberately a
// per-device preference stored in localStorage rather than a synced table:
// this is a personal shortcut, not shared pipeline data, so it doesn't need
// a migration, RLS, or Realtime — it just needs to survive a reload on the
// device it was saved on. Scoped by org + profile so a shared/kiosk browser
// with multiple people signing in and out doesn't mix up whose views are
// whose.
function viewsStorageKey() {
  return `sxc-saved-views:${store.organization?.id || "default"}:${store.profile?.id || "anon"}`;
}

function loadSavedViews() {
  try {
    const raw = localStorage.getItem(viewsStorageKey());
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistSavedViews(views) {
  try {
    localStorage.setItem(viewsStorageKey(), JSON.stringify(views));
  } catch {
    // Private-browsing / storage-full edge case — the view just won't
    // persist this session. Nothing else in the app depends on it.
  }
}

// ---- list density (Card view / List view) ----------------------------------
// Two ways to look at the same prospects. Card view is the original: every
// lead gets its heat bar and its WhatsApp/Details buttons, which is right when
// you are working one lead at a time. List view strips a row down to name,
// where they are, and status so roughly three times as many fit on a screen —
// which is what you want when you are scanning for a particular business or
// getting a feel for the whole pipeline. Tapping a row still opens the full
// detail panel, so nothing is actually lost by scanning in List view.
//
// This is markup-identical on purpose: both views render exactly the same
// card, and a class on the container hides the extra parts in List view. That
// means there is only one card to maintain, and a change to what a prospect
// shows can never land in one view and go missing from the other.
//
// Same reasoning as saved views for storing it per-device in localStorage:
// how you like to look at a list is a personal habit, not shared pipeline
// data, so it needs no table and no sync — just to survive a reload.
function densityStorageKey() {
  return `sxc-pipeline-density:${store.organization?.id || "default"}:${store.profile?.id || "anon"}`;
}

let compactList = false;

function loadDensity() {
  try {
    compactList = localStorage.getItem(densityStorageKey()) === "compact";
  } catch {
    compactList = false;
  }
}

function persistDensity() {
  try {
    localStorage.setItem(densityStorageKey(), compactList ? "compact" : "cards");
  } catch {
    // Private-browsing / storage-full edge case — the choice just won't
    // persist past this session. The list itself still works.
  }
}

// The free-text search box is deliberately left out of a saved view — a
// view is a reusable preset of structural filters, not a one-off search
// term someone happened to be typing when they hit Save.
function currentFilterSnapshot() {
  return {
    status: filters.status,
    tier: filters.tier,
    niche: filters.niche,
    city: filters.city,
    onlyMine: filters.onlyMine,
    sortHeat: filters.sortHeat,
  };
}

function applySavedView(view) {
  Object.assign(filters, view.filters);
  renderPipeline();
}

function openSaveViewModal() {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Save Current Filters</div>
      <div class="field">
        <label>View name</label>
        <input id="view-name-input" type="text" placeholder="e.g. Harare, Tier A, cold" maxlength="40" />
      </div>
      <button class="btn btn-primary" id="view-save-btn">Save View</button>
    </div>
  `);
  box.querySelector("#view-save-btn").addEventListener("click", () => {
    const name = box.querySelector("#view-name-input").value.trim();
    if (!name) return toast("Give this view a name first", "error");
    const views = loadSavedViews();
    views.push({ id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, name, filters: currentFilterSnapshot() });
    persistSavedViews(views);
    toast("View saved", "success");
    closeModal();
    renderPipeline();
  });
  openModal(box);
  box.querySelector("#view-name-input").focus();
}

async function bulkUpdate(fields, successMsg) {
  const ids = Array.from(selectedIds);
  if (!ids.length) return;
  const { error } = await sb.from("prospects").update(fields).in("id", ids);
  if (error) return toast(error.message, "error");
  toast(successMsg, "success");
  exitSelectMode();
}

function openBulkStatusModal() {
  const count = selectedIds.size;
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Set Status for ${count} Prospect${count === 1 ? "" : "s"}</div>
      <div class="btn-block-row" id="bulk-status-row" style="flex-wrap:wrap;gap:8px;margin:0;"></div>
    </div>
  `);
  const row = box.querySelector("#bulk-status-row");
  [["not_contacted", "Not Contacted"], ["sent", "Sent"], ["replied", "Replied"], ["meeting_booked", "Meeting Booked"], ["signed", "Signed"], ["dead", "Dead"]].forEach(([val, label]) => {
    const btn = el(`<button class="btn btn-ghost btn-sm" style="flex:0 0 auto;">${label}</button>`);
    btn.addEventListener("click", () => {
      closeModal();
      bulkUpdate({ status: val }, `Updated ${count} prospect${count === 1 ? "" : "s"} to ${label}`);
    });
    row.appendChild(btn);
  });
  openModal(box);
}

// Dashboard's "Unassigned Leads" and "Team Workload" cards already *detect*
// a pile of ungiven-out or lopsided-assigned leads, but nothing actually
// *fixes* it in one action — an owner had to bulk-assign in several manual
// passes (select 10, assign to A; select the next 10, assign to B...).
// Round-robins the selected batch across active teammates, always handing
// the next one to whoever currently has the fewest active (not signed/dead)
// leads, so a big batch doesn't tip workload lopsided the way one "assign to
// X" tap on the whole selection would.
async function distributeEvenly(ids) {
  const activeProfiles = store.profiles.filter((p) => p.active !== false);
  if (!activeProfiles.length) return toast("No active team members to assign to", "error");

  const counts = new Map(activeProfiles.map((p) => [p.id, 0]));
  store.prospects.forEach((p) => {
    if (!["signed", "dead"].includes(p.status) && counts.has(p.assigned_to)) {
      counts.set(p.assigned_to, counts.get(p.assigned_to) + 1);
    }
  });

  // Greedy round-robin: each prospect goes to whoever has the lowest running
  // count at that moment, then that count is bumped before the next pick —
  // same "worst-first" spirit as tasks.js's Team Checklist sort, just used to
  // decide *where work goes* instead of *what to show first*.
  const byAgent = new Map();
  ids.forEach((id) => {
    const [agentId] = Array.from(counts.entries()).sort((a, b) => a[1] - b[1])[0];
    counts.set(agentId, counts.get(agentId) + 1);
    if (!byAgent.has(agentId)) byAgent.set(agentId, []);
    byAgent.get(agentId).push(id);
  });

  const results = await Promise.all(
    Array.from(byAgent.entries()).map(([agentId, agentIds]) =>
      sb.from("prospects").update({ assigned_to: agentId }).in("id", agentIds)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed) return toast(failed.error.message, "error");

  const summary = Array.from(byAgent.entries())
    .map(([agentId, agentIds]) => `${profileById(agentId)?.full_name?.split(" ")[0] || "Someone"}: ${agentIds.length}`)
    .join(", ");
  toast(`Distributed ${ids.length} prospect${ids.length === 1 ? "" : "s"}: ${summary}`, "success");
  exitSelectMode();
}

function openBulkAssignModal() {
  const count = selectedIds.size;
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Assign ${count} Prospect${count === 1 ? "" : "s"}</div>
      <div id="bulk-assign-list"></div>
    </div>
  `);
  const list = box.querySelector("#bulk-assign-list");

  const distributeRow = el(`
    <div class="card" style="margin-bottom:8px;cursor:pointer;border:1px solid var(--gold-soft);">
      <div style="font-weight:700;font-size:13.5px;color:var(--gold-soft);">Distribute Evenly</div>
      <div class="text-faint" style="font-size:11px;margin-top:2px;">Round-robins across the team, starting with whoever has the fewest active leads</div>
    </div>
  `);
  distributeRow.addEventListener("click", () => {
    const ids = Array.from(selectedIds);
    closeModal();
    distributeEvenly(ids);
  });
  list.appendChild(distributeRow);

  store.profiles.forEach((prof) => {
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:10px;">
        ${avatarHTML(prof.full_name, prof.avatar_url, 28, 12)}<span>${esc(prof.full_name)}</span>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      bulkUpdate({ assigned_to: prof.id }, `Assigned ${count} prospect${count === 1 ? "" : "s"} to ${prof.full_name?.split(" ")[0] || "teammate"}`);
    });
    list.appendChild(row);
  });
  const unassignRow = el(`<div class="card text-faint" style="cursor:pointer;">Unassign</div>`);
  unassignRow.addEventListener("click", () => {
    closeModal();
    bulkUpdate({ assigned_to: null }, `Unassigned ${count} prospect${count === 1 ? "" : "s"}`);
  });
  list.appendChild(unassignRow);
  openModal(box);
}

function bulkMarkDead() {
  const count = selectedIds.size;
  confirmModal({
    title: `Mark ${count} prospect${count === 1 ? "" : "s"} as Dead?`,
    body: `This moves ${count === 1 ? "it" : "them"} out of the active pipeline. You can always change the status back later.`,
    confirmLabel: "Mark Dead",
    danger: true,
    onConfirm: () => bulkUpdate({ status: "dead" }, `Marked ${count} prospect${count === 1 ? "" : "s"} as Dead`),
  });
}

function renderBulkBar() {
  const bar = document.getElementById("pl-bulk-bar");
  if (!bar) return;
  const count = selectedIds.size;
  const listEl = document.getElementById("pl-list");
  if (!selectMode || count === 0) {
    bar.style.display = "none";
    if (listEl) listEl.classList.remove("has-bulk-bar");
    return;
  }
  bar.style.display = "flex";
  if (listEl) listEl.classList.add("has-bulk-bar");
  bar.querySelector("#pl-bulk-count").textContent = `${count} selected`;
}

export function renderPipeline() {
  const root = document.getElementById("view-pipeline");
  // Read the saved Card/List choice here rather than when this file first
  // loads: the storage key is scoped by org and profile, and neither of those
  // is known until sign-in has finished.
  loadDensity();
  // Every filter chip/sort/select-mode click above calls renderPipeline()
  // again, which wipes and rebuilds the whole view — including a brand new
  // #pl-search element. Unconditionally focusing that new element afterward
  // (further down) used to fire on *every single one* of those re-renders,
  // including the very first one when a user simply taps into the Pipeline
  // tab from the nav bar — which is what was popping the mobile keyboard
  // open every time someone just wanted to look at the list. Capturing
  // whether the search box actually had focus *before* the rebuild lets us
  // restore it only when the user was genuinely mid-search, not on a fresh
  // navigation or an unrelated chip tap.
  const hadSearchFocus = document.activeElement?.id === "pl-search";
  root.innerHTML = "";

  // Everything below search and the status chips lives behind one fold. On a
  // phone this screen was spending 380 of 812 pixels on filter controls before
  // the first lead, so an agent opening the app to make calls saw two leads
  // and a wall of chips.
  //
  // The count is what makes folding safe: a filter that is quietly on while
  // hidden would look like missing prospects, which is far worse than clutter.
  // So an active filter is always named on the closed header, and the panel
  // starts open whenever anything in it is on. Nothing is removed and nothing
  // is disabled: every control keeps its id and its handler.
  const advancedCount =
    (filters.tier !== "all" ? 1 : 0) +
    (filters.niche !== "all" ? 1 : 0) +
    (filters.city !== "all" ? 1 : 0) +
    (filters.sortHeat ? 1 : 0) +
    [
      filters.onlyMine, filters.onlyStale, filters.onlyNoFollowUp, filters.onlyOverdueFollowUp,
      filters.onlyUnreachable, filters.onlyNoWebsite, filters.onlyTopRated, filters.onlyResearchFailed,
    ].filter(Boolean).length;

  const wrap = el(`
    <div>
      <div class="flex-between">
        <div class="page-title mt-0">Pipeline<span class="accent">.</span></div>
        <div class="page-actions">
          <span class="small-link" id="pl-find-dupes">Find Duplicates</span>
          <span class="small-link" id="pl-export-csv">Export CSV</span>
          <span class="small-link" id="pl-bulk-import">Bulk Import</span>
          <span class="small-link" id="pl-density-toggle">${compactList ? "Card view" : "List view"}</span>
          <span class="small-link" id="pl-select-toggle">${selectMode ? "Cancel" : "Select"}</span>
        </div>
      </div>
      <div class="search-bar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="pl-search" type="text" placeholder="Search business, area, niche..." value="${esc(filters.search)}" />
      </div>
      <div class="chip-row" id="pl-status-chips"></div>

      <div class="card db-collapse-head ${advancedCount ? "open" : ""}" id="pl-filters-toggle" role="button" tabindex="0" aria-expanded="${advancedCount ? "true" : "false"}" aria-controls="pl-filters-body" style="margin-bottom:8px;padding:10px 12px;cursor:pointer;">
        <div class="flex-between">
          <div style="font-size:13px;font-weight:700;">${
            advancedCount
              ? `Filters: ${advancedCount} on`
              : "More filters"
          }</div>
          <span class="db-collapse-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></span>
        </div>
      </div>

      <div id="pl-filters-body" ${advancedCount ? "" : "hidden"}>
        <div class="chip-row" id="pl-view-chips"></div>
        <div class="chip-row" id="pl-tier-chips"></div>
        <div class="chip-row" id="pl-city-chips"></div>
        <div class="field-row" style="margin-bottom:10px;">
          <div class="field" style="margin-bottom:0;">
            <select id="pl-niche-filter"></select>
          </div>
          <button class="btn btn-ghost btn-sm" id="pl-sort-heat" style="flex:0 0 auto;width:auto;">Sort: <span id="pl-sort-label">Recent</span></button>
        </div>
        <div class="chip-row">
          <span class="chip ${filters.onlyMine ? "active" : ""}" id="pl-mine-chip">Assigned to me</span>
          <span class="chip ${filters.onlyStale ? "active" : ""}" id="pl-stale-chip">Going Cold</span>
          <span class="chip ${filters.onlyNoFollowUp ? "active" : ""}" id="pl-nofollowup-chip">No Follow-up</span>
          <span class="chip ${filters.onlyOverdueFollowUp ? "active" : ""}" id="pl-overdue-chip">Follow-up Overdue</span>
          <span class="chip ${filters.onlyUnreachable ? "active" : ""}" id="pl-unreachable-chip">Unreachable</span>
          <span class="chip ${filters.onlyNoWebsite ? "active" : ""}" id="pl-nowebsite-chip">No Website</span>
          <span class="chip ${filters.onlyTopRated ? "active" : ""}" id="pl-toprated-chip">Top Rated</span>
          <span class="chip ${filters.onlyResearchFailed ? "active" : ""}" id="pl-researchfailed-chip">Research Failed</span>
        </div>
      </div>

      <div id="pl-list" class="prospect-list ${compactList ? "compact" : ""}"></div>
      <div class="bulk-action-bar" id="pl-bulk-bar" style="display:none;">
        <span class="bulk-count" id="pl-bulk-count">0 selected</span>
        <div class="btn-block-row">
          <button class="btn btn-ghost btn-sm" id="pl-bulk-status">Status</button>
          <button class="btn btn-ghost btn-sm" id="pl-bulk-assign">Assign</button>
          <button class="btn btn-danger btn-sm" id="pl-bulk-dead">Mark Dead</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(wrap);
  wrap.querySelector("#pl-find-dupes").addEventListener("click", openDuplicateAuditSheet);
  wrap.querySelector("#pl-bulk-import").addEventListener("click", openBulkImportSheet);
  wrap.querySelector("#pl-export-csv").addEventListener("click", exportFilteredCSV);
  // Switching density is deliberately not a full re-render: the cards are
  // already identical in both views, so flipping one class on the container
  // is the whole change. That also means the switch never loses your scroll
  // position, your filters, or a part-finished multi-select.
  const densityToggle = wrap.querySelector("#pl-density-toggle");
  densityToggle.addEventListener("click", () => {
    compactList = !compactList;
    persistDensity();
    wrap.querySelector("#pl-list").classList.toggle("compact", compactList);
    densityToggle.textContent = compactList ? "Card view" : "List view";
  });
  wrap.querySelector("#pl-select-toggle").addEventListener("click", () => {
    if (selectMode) exitSelectMode();
    else { selectMode = true; renderPipeline(); }
  });
  wrap.querySelector("#pl-bulk-status").addEventListener("click", openBulkStatusModal);
  wrap.querySelector("#pl-bulk-assign").addEventListener("click", openBulkAssignModal);
  wrap.querySelector("#pl-bulk-dead").addEventListener("click", bulkMarkDead);

  // saved views
  const viewRow = wrap.querySelector("#pl-view-chips");
  loadSavedViews().forEach((v) => {
    const chip = el(`<span class="chip view-chip">${esc(v.name)}<span class="view-chip-x" title="Delete this view">✕</span></span>`);
    chip.addEventListener("click", (e) => {
      if (e.target.closest(".view-chip-x")) return;
      applySavedView(v);
    });
    chip.querySelector(".view-chip-x").addEventListener("click", (e) => {
      e.stopPropagation();
      confirmModal({
        title: "Delete this view?",
        body: `Remove <b>${esc(v.name)}</b> from your saved views? This only lives on this device, nothing shared gets touched.`,
        confirmLabel: "Delete",
        danger: true,
        onConfirm: () => {
          persistSavedViews(loadSavedViews().filter((x) => x.id !== v.id));
          renderPipeline();
        },
      });
    });
    viewRow.appendChild(chip);
  });
  const saveViewChip = el(`<span class="chip" id="pl-save-view">+ Save View</span>`);
  saveViewChip.addEventListener("click", openSaveViewModal);
  viewRow.appendChild(saveViewChip);

  // status chips
  const statuses = [["all", "All"], ["not_contacted", "Not Contacted"], ["sent", "Sent"], ["replied", "Replied"], ["meeting_booked", "Meeting"], ["signed", "Signed"], ["dead", "Dead"]];
  const statusRow = wrap.querySelector("#pl-status-chips");
  statuses.forEach(([val, label]) => {
    const chip = el(`<span class="chip ${filters.status === val ? "active" : ""}">${label}</span>`);
    chip.addEventListener("click", () => { filters.status = val; renderPipeline(); });
    statusRow.appendChild(chip);
  });

  // tier chips
  const tiers = [["all", "All Tiers"], ["A", "Tier A"], ["B", "Tier B"], ["C", "Tier C"]];
  const tierRow = wrap.querySelector("#pl-tier-chips");
  tiers.forEach(([val, label]) => {
    const chip = el(`<span class="chip gold ${filters.tier === val ? "active" : ""}">${label}</span>`);
    chip.addEventListener("click", () => { filters.tier = val; renderPipeline(); });
    tierRow.appendChild(chip);
  });

  // city chips — lets any agent who just logged on narrow straight down to
  // the city they're working (e.g. Harare vs Bulawayo) instead of scrolling
  // past every prospect in the other market.
  const cityRow = wrap.querySelector("#pl-city-chips");
  const cities = knownCities();
  [["all", "All Cities"], ...cities.map((c) => [c, c])].forEach(([val, label]) => {
    const chip = el(`<span class="chip ${filters.city === val ? "active" : ""}">${esc(label)}</span>`);
    chip.addEventListener("click", () => { filters.city = val; renderPipeline(); });
    cityRow.appendChild(chip);
  });

  // niche filter dropdown
  const nicheSelect = wrap.querySelector("#pl-niche-filter");
  nicheSelect.innerHTML = `<option value="all">All Niches</option>` +
    store.niches.map((n) => `<option value="${n.id}" ${filters.niche === n.id ? "selected" : ""}>${esc(n.name)}</option>`).join("");
  nicheSelect.value = filters.niche;
  nicheSelect.addEventListener("change", () => { filters.niche = nicheSelect.value; renderPipeline(); });

  wrap.querySelector("#pl-sort-heat").addEventListener("click", () => {
    filters.sortHeat = !filters.sortHeat;
    renderPipeline();
  });
  wrap.querySelector("#pl-sort-label").textContent = filters.sortHeat ? "Heat" : "Recent";

  wrap.querySelector("#pl-mine-chip").addEventListener("click", () => {
    filters.onlyMine = !filters.onlyMine;
    renderPipeline();
  });

  wrap.querySelector("#pl-stale-chip").addEventListener("click", () => {
    filters.onlyStale = !filters.onlyStale;
    renderPipeline();
  });

  wrap.querySelector("#pl-nofollowup-chip").addEventListener("click", () => {
    filters.onlyNoFollowUp = !filters.onlyNoFollowUp;
    renderPipeline();
  });

  wrap.querySelector("#pl-overdue-chip").addEventListener("click", () => {
    filters.onlyOverdueFollowUp = !filters.onlyOverdueFollowUp;
    renderPipeline();
  });

  wrap.querySelector("#pl-unreachable-chip").addEventListener("click", () => {
    filters.onlyUnreachable = !filters.onlyUnreachable;
    renderPipeline();
  });

  wrap.querySelector("#pl-nowebsite-chip").addEventListener("click", () => {
    filters.onlyNoWebsite = !filters.onlyNoWebsite;
    renderPipeline();
  });

  wrap.querySelector("#pl-toprated-chip").addEventListener("click", () => {
    filters.onlyTopRated = !filters.onlyTopRated;
    renderPipeline();
  });

  wrap.querySelector("#pl-researchfailed-chip").addEventListener("click", () => {
    filters.onlyResearchFailed = !filters.onlyResearchFailed;
    renderPipeline();
  });

  // The fold. Every chip tap inside it calls renderPipeline(), which rebuilds
  // this whole screen, so the open/closed state is deliberately NOT stored in
  // a variable here: the panel re-opens on rebuild because advancedCount is
  // then non-zero. Closed with nothing on, open the moment something is on.
  const filtersToggle = wrap.querySelector("#pl-filters-toggle");
  const filtersBody = wrap.querySelector("#pl-filters-body");
  const toggleFilters = () => {
    const open = filtersBody.hasAttribute("hidden");
    if (open) filtersBody.removeAttribute("hidden");
    else filtersBody.setAttribute("hidden", "");
    filtersToggle.setAttribute("aria-expanded", open ? "true" : "false");
    filtersToggle.classList.toggle("open", open);
  };
  filtersToggle.addEventListener("click", toggleFilters);
  filtersToggle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleFilters(); }
  });

  const searchInput = wrap.querySelector("#pl-search");
  const onSearch = debounce((val) => { filters.search = val; renderList(); }, 200);
  searchInput.addEventListener("input", (e) => onSearch(e.target.value));
  if (hadSearchFocus) {
    searchInput.focus({ preventScroll: true });
    // keep cursor position after re-render
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }

  renderList();
  renderBulkBar();
}

function getFilteredProspects() {
  let items = store.prospects.slice();

  if (filters.status !== "all") items = items.filter((p) => p.status === filters.status);
  if (filters.tier !== "all") items = items.filter((p) => p.tier === filters.tier);
  if (filters.city !== "all") items = items.filter((p) => p.city === filters.city);
  if (filters.niche !== "all") items = items.filter((p) => p.niche_id === filters.niche);
  if (filters.onlyMine) items = items.filter((p) => p.assigned_to === store.profile?.id);
  if (filters.onlyStale) items = items.filter(isStaleProspect);
  if (filters.onlyNoFollowUp) items = items.filter(hasNoFollowUp);
  if (filters.onlyOverdueFollowUp) items = items.filter(hasOverdueFollowUp);
  if (filters.onlyUnreachable) items = items.filter(hasNoContactMethod);
  if (filters.onlyNoWebsite) items = items.filter(hasNoWebsite);
  if (filters.onlyTopRated) items = items.filter(isTopRatedUncontacted);
  if (filters.onlyResearchFailed) items = items.filter(hasFailedResearch);
  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    items = items.filter((p) =>
      (p.business_name || "").toLowerCase().includes(q) ||
      (p.area || "").toLowerCase().includes(q) ||
      (p.city || "").toLowerCase().includes(q) ||
      (nicheById(p.niche_id)?.name || "").toLowerCase().includes(q)
    );
  }
  if (filters.sortHeat) items.sort((a, b) => b.heat_score - a.heat_score);
  else items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  return items;
}

function exportFilteredCSV() {
  const items = getFilteredProspects();
  if (!items.length) return toast("No prospects match the current filters", "error");

  const columns = [
    { label: "Business Name", get: (p) => p.business_name },
    { label: "Niche", get: (p) => nicheById(p.niche_id)?.name || "" },
    { label: "City", get: (p) => p.city },
    { label: "Area", get: (p) => p.area },
    { label: "WhatsApp Number", get: (p) => p.whatsapp_number },
    { label: "Email", get: (p) => p.email },
    { label: "Instagram", get: (p) => p.instagram },
    { label: "Website", get: (p) => p.website },
    { label: "Tier", get: (p) => p.tier },
    { label: "Status", get: (p) => statusLabel(p.status) },
    { label: "Heat Score", get: (p) => p.heat_score },
    { label: "MRR", get: (p) => p.mrr },
    { label: "Assigned To", get: (p) => profileById(p.assigned_to)?.full_name || "" },
    { label: "Days Since Update", get: (p) => daysSinceUpdate(p) },
    { label: "Follow-up Date", get: (p) => p.follow_up_date || "" },
    { label: "Created At", get: (p) => p.created_at ? p.created_at.slice(0, 10) : "" },
  ];

  const csv = toCSV(items, columns);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`pipeline-export-${stamp}.csv`, csv);
  toast(`Exported ${items.length} prospect${items.length === 1 ? "" : "s"}`, "success");
}

// findDuplicateProspect() already runs at creation time (new-prospect save
// and bulk-import preview), but that only catches overlaps at the moment
// something's added — two reps adding the same business weeks apart, with
// no shared import batch, never gets flagged. This retroactively sweeps the
// whole pipeline already loaded in `store.prospects` for name/phone matches,
// same matching rules as the at-creation check, just run pairwise across
// everything instead of "new row vs. everything before it."
function findAllDuplicatePairs() {
  const items = store.prospects;
  const seen = new Set();
  const pairs = [];
  for (let i = 1; i < items.length; i++) {
    const match = findDuplicateProspect(items[i].business_name, items[i].whatsapp_number, items.slice(0, i));
    if (!match) continue;
    const key = [items[i].id, match.prospect.id].sort().join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ a: items[i], b: match.prospect, reason: match.reason });
  }
  pairs.sort((x, y) => new Date(y.a.updated_at) - new Date(x.a.updated_at));
  return pairs;
}

function openDuplicateAuditSheet() {
  const pairs = findAllDuplicatePairs();
  const box = el(`<div></div>`);

  if (!pairs.length) {
    box.innerHTML = `<div class="text-faint" style="font-size:13px;text-align:center;padding:20px 0;">No duplicates found. The pipeline's clean.</div>`;
  } else {
    box.innerHTML = `<div class="text-faint" style="font-size:12.5px;margin-bottom:12px;">${pairs.length} possible duplicate pair${pairs.length === 1 ? "" : "s"} found, matched by business name or WhatsApp number. Open each and decide which to keep.</div>`;
    pairs.forEach((pair) => {
      const group = el(`
        <div class="card" style="margin-bottom:10px;">
          <div class="text-faint" style="font-size:10.5px;font-weight:700;text-transform:uppercase;margin-bottom:8px;">Matched by ${pair.reason === "name" ? "business name" : "WhatsApp number"}</div>
        </div>
      `);
      [pair.a, pair.b].forEach((p, idx) => {
        const assignee = profileById(p.assigned_to);
        const row = el(`
          <div style="padding:8px 0;${idx > 0 ? "border-top:1px solid var(--line);" : ""}display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:pointer;">
            <div>
              <div style="font-size:13.5px;font-weight:600;">${esc(p.business_name)}</div>
              <div class="text-faint" style="font-size:11px;">${statusLabel(p.status)}${assignee ? " · " + esc(assignee.full_name?.split(" ")[0] || "") : " · Unassigned"} · Updated ${fmtDate(p.updated_at)}</div>
            </div>
            <span class="small-link" style="flex:0 0 auto;">View</span>
          </div>
        `);
        row.addEventListener("click", () => {
          closeSheet();
          openProspectDetail(p);
        });
        group.appendChild(row);
      });
      box.appendChild(group);
    });
  }

  openSheet("Find Duplicates", box);
}

function renderList() {
  const listEl = document.getElementById("pl-list");
  if (!listEl) return;
  const items = getFilteredProspects();

  listEl.innerHTML = "";
  if (!items.length) {
    listEl.appendChild(el(`
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6" y="3" width="15" height="18" rx="3"/><path d="M3 8h3M3 12h3M3 16h3"/><circle cx="13.5" cy="10.3" r="2.4"/><path d="M9.8 17c0-1.9 1.7-3.2 3.7-3.2s3.7 1.3 3.7 3.2"/></svg>
        <p>No prospects match these filters yet.</p>
      </div>
    `));
    return;
  }
  items.forEach((p) => listEl.appendChild(prospectCard(p)));
  renderBulkBar();
}

function prospectCard(p) {
  const assignee = profileById(p.assigned_to);
  const niche = nicheById(p.niche_id);
  const checked = selectedIds.has(p.id);
  const card = el(`
    <div class="prospect-card tier-${p.tier} ${selectMode ? "select-mode" : ""} ${checked ? "selected" : ""}">
      ${selectMode ? `<label class="select-check"><input type="checkbox" ${checked ? "checked" : ""} /></label>` : ""}
      <div class="prospect-top">
        <div>
          <div class="prospect-name">${esc(p.business_name)}</div>
          <div class="prospect-meta">${nicheDotHTML(niche)}${esc(niche?.name || "No niche")}${p.area ? " · " + esc(p.area) : ""}${p.city ? " · " + esc(p.city) : ""}</div>
        </div>
        <span class="status-pill ${p.status}">${statusLabel(p.status)}</span>
      </div>
      <div class="heat-bar-wrap">
        <div class="heat-bar"><div class="heat-bar-fill" style="width:${p.heat_score}%"></div></div>
        <div class="heat-num">${p.heat_score}</div>
      </div>
      <div class="prospect-flags">
        <span class="tier-pill ${p.tier}">TIER ${p.tier}</span>
        ${hasOverdueFollowUp(p) ? `<span class="status-pill dead">Follow-up overdue</span>` : ""}
        ${isStaleProspect(p) ? `<span class="status-pill stale">Cold · ${daysSinceUpdate(p)}d</span>` : ""}
        ${hasNoContactMethod(p) ? `<span class="status-pill stale">No contact info</span>` : ""}
        ${hasNoWebsite(p) ? `<span class="status-pill stale">No Site</span>` : ""}
        ${isTopRatedUncontacted(p) ? `<span class="status-pill stale">★ Top Rated</span>` : ""}
        ${p._pending ? `<span class="conflict-flag pending-flag">SENDING…</span>` : ""}
        ${!p._pending && p.research_status === "researching" ? `<span class="conflict-flag" style="background:rgba(212,175,55,0.15);color:#d4af37;">RESEARCHING…</span>` : ""}
        ${p.research_status === "failed" ? `<span class="conflict-flag" style="background:rgba(220,53,69,0.15);color:#dc3545;">RESEARCH FAILED</span>` : ""}
        ${p.research_status !== "researching" && p.message_source === "auto_template" ? `<span class="conflict-flag" style="background:rgba(212,175,55,0.15);color:#d4af37;">REVIEW MESSAGE</span>` : ""}
        ${assignee ? `<span class="assigned-tag">${avatarHTML(assignee.full_name, assignee.avatar_url, 18, 9)}${esc(assignee.full_name?.split(" ")[0] || "")}</span>` : `<span class="assigned-tag text-faint">Unassigned</span>`}
      </div>
      ${selectMode ? "" : `
        <div class="btn-block-row" style="margin-top:11px;">
          <button class="btn btn-whatsapp btn-sm" data-action="wa">WhatsApp</button>
          <button class="btn btn-ghost btn-sm" data-action="open">Details</button>
        </div>
      `}
    </div>
  `);

  if (selectMode) {
    const cb = card.querySelector(".select-check input");
    const toggle = () => {
      if (cb.checked) selectedIds.add(p.id);
      else selectedIds.delete(p.id);
      card.classList.toggle("selected", cb.checked);
      renderBulkBar();
    };
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", toggle);
    card.addEventListener("click", (e) => {
      if (e.target.closest(".select-check")) return;
      cb.checked = !cb.checked;
      toggle();
    });
    return card;
  }

  card.querySelector('[data-action="open"]').addEventListener("click", () => openProspectDetail(p));
  card.addEventListener("click", (e) => {
    if (e.target.closest("[data-action]")) return;
    openProspectDetail(p);
  });
  card.querySelector('[data-action="wa"]').addEventListener("click", (e) => {
    e.stopPropagation();
    sendWhatsApp(p);
  });

  return card;
}

// Answers true only when the message actually reached WhatsApp, so a caller
// sending a batch (see views/outreach.js) can tell a real send from a refusal
// and avoid logging one that never happened.
export async function sendWhatsApp(p) {
  if (!p.whatsapp_number) {
    toast("No WhatsApp number saved for this prospect", "error");
    return false;
  }

  if (p.assigned_to && p.assigned_to !== store.profile.id) {
    const owner = profileById(p.assigned_to);
    toast(`${owner?.full_name || "A teammate"} is already working this prospect`, "error");
    return false;
  }

  // A prospect still sitting in the outbox has no row on the server to claim,
  // so asking to claim it can only fail. It also doesn't need claiming: this
  // phone created it moments ago and nobody else has ever seen it, and
  // claim_prospect grants an unassigned prospect to whoever added it anyway.
  // Claiming is for deciding who gets a lead two people can both see, which by
  // definition this isn't. So take it directly and carry on.
  if (p._pending) {
    if (!p.assigned_to) patchProspect(p.id, { assigned_to: store.profile.id });
  } else {
    const { data: claimed, error: claimErr } = await sb.rpc("claim_prospect", { p_id: p.id });
    if (claimErr) {
      toast(claimErr.message, "error");
      return false;
    }
    if (!claimed) {
      toast("Someone just claimed this prospect, pick another", "error");
      return false;
    }
  }

  // No message written yet? Auto-personalize one from this prospect's niche
  // template (business name, area, gap note filled in) so nobody has to
  // write 150+ openers by hand. Saved back so it's consistent if they open
  // this prospect again, and still fully editable before it's sent.
  let message = p.outreach_message;
  if (!message) {
    const template = bestTemplateFor(p, "opener");
    if (template) {
      message = personalizeMessage(template.body, p, store.profile?.full_name?.split(" ")[0]);
      // Through the outbox: for a prospect that hasn't been sent yet this folds
      // into the row on its way out, rather than trying to update a row the
      // server doesn't have.
      patchProspect(p.id, { outreach_message: message });
    }
  } else {
    // Already has a message (manually written, or AI-generated with an
    // {{agent_name}} token in it) — personalize it just for this send,
    // without overwriting the saved copy, so it still reads right for
    // whichever teammate opens this prospect next.
    message = personalizeMessage(message, p, store.profile?.full_name?.split(" ")[0]);
  }

  window.open(buildWhatsAppLink(p.whatsapp_number, message), "_blank");

  if (p.status === "not_contacted") {
    patchProspect(p.id, { status: "sent" });
  }

  return true;
}

export function openAddProspectSheet() {
  const form = buildProspectForm(null, () => {});
  openSheet("Add Prospect", form);
}

export function initPipelineView() {
  on("prospects", () => { if (isActive()) renderList(); });
  on("niches", () => { if (isActive()) renderPipeline(); });
  on("profiles", () => { if (isActive()) renderList(); });
}

function isActive() {
  return document.getElementById("view-pipeline")?.classList.contains("active");
}
