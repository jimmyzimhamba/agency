import { store, on, profileById, prospectById } from "../state.js";
import { el, esc, timeAgo, debounce, toCSV, downloadTextFile, toast } from "../utils.js";
import { openProspectDetail } from "./prospectDetail.js";

// The feed only ever holds the most recent 60 rows (see state.js), so these
// filters operate on data already loaded client-side — no extra query, no
// pagination to build. Persisted at module scope (not per-render) so
// switching away and back to the tab keeps whatever filter was set.
let filterAgent = "all";
let searchQuery = "";

export function renderActivity() {
  const root = document.getElementById("view-activity");
  root.innerHTML = "";

  const wrap = el(`
    <div>
      <div class="flex-between">
        <div class="page-title mt-0">Team Activity<span class="accent">.</span></div>
        <span class="small-link" id="af-export-csv">Export CSV</span>
      </div>
      <div class="section-title mt-0">Today at a Glance</div>
      <div class="chip-row" id="af-today-glance" style="margin-bottom:10px;"></div>
      <div class="field" style="margin-bottom:10px;">
        <input id="af-search" type="text" placeholder="Search activity..." value="${esc(searchQuery)}" />
      </div>
      <div class="chip-row" id="af-agent-chips"></div>
      <div class="card" id="af-list"></div>
    </div>
  `);
  root.appendChild(wrap);
  wrap.querySelector("#af-export-csv").addEventListener("click", exportActivityCSV);
  renderTodayGlance(wrap.querySelector("#af-today-glance"));

  // Only offer agents who've actually logged something, so owners aren't
  // scrolling past a chip for someone with zero activity in the loaded feed.
  const activeAgentIds = [...new Set(store.activityLog.map((a) => a.actor_id).filter(Boolean))];
  const chipRow = wrap.querySelector("#af-agent-chips");
  [["all", "Everyone"], ...activeAgentIds.map((id) => [id, profileById(id)?.full_name || profileById(id)?.email || "Someone"])].forEach(([val, label]) => {
    const chip = el(`<span class="chip ${filterAgent === val ? "active" : ""}">${esc(label)}</span>`);
    chip.addEventListener("click", () => { filterAgent = val; renderActivity(); });
    chipRow.appendChild(chip);
  });

  const searchInput = wrap.querySelector("#af-search");
  const runSearch = debounce(() => { searchQuery = searchInput.value; renderList(wrap.querySelector("#af-list")); }, 150);
  searchInput.addEventListener("input", runSearch);

  const listEl = wrap.querySelector("#af-list");
  // Delegated instead of per-row: renderList() rebuilds #af-list's innerHTML
  // wholesale (search/filter re-render), so a listener attached to
  // individual rows would be lost on every keystroke. The list container
  // itself survives those re-renders, so one listener here covers every row
  // for the lifetime of this view instance.
  listEl.addEventListener("click", (e) => {
    const row = e.target.closest("[data-prospect-id]");
    if (!row) return;
    const prospect = prospectById(row.dataset.prospectId);
    if (prospect) openProspectDetail(prospect);
  });

  renderList(listEl);
}

// Quick per-teammate count of who's actually logged something today, so a
// glance at this tab answers "is anyone actually working the pipeline right
// now" without reading through the raw feed. Runs over the same
// store.activityLog the rest of this view uses — that's only ever the most
// recent 60 rows team-wide (see state.js), so on a very high-volume day this
// can undercount someone whose earlier entries got pushed out by everyone
// else's more recent ones. Acceptable: it's a "who's active" glance, not a
// billing-grade tally, and every other filter on this page already accepts
// the same 60-row ceiling.
function renderTodayGlance(container) {
  if (!container) return;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const counts = {};
  store.activityLog.forEach((a) => {
    if (!a.actor_id || !a.created_at || new Date(a.created_at) < todayStart) return;
    counts[a.actor_id] = (counts[a.actor_id] || 0) + 1;
  });
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) {
    container.innerHTML = `<div class="text-faint" style="font-size:11.5px;">No activity logged yet today.</div>`;
    return;
  }
  container.innerHTML = ranked
    .map(([id, count]) => {
      const name = profileById(id)?.full_name || profileById(id)?.email || "Someone";
      return `<span class="chip" style="cursor:default;">${esc(name)} · ${count}</span>`;
    })
    .join("");
}

// Shared by the on-screen list and the CSV export, so "what you're looking
// at" and "what you export" always match — exporting respects whatever
// agent chip/search text is currently active instead of always dumping the
// full unfiltered feed.
function filteredActivity() {
  let items = store.activityLog.slice();
  if (filterAgent !== "all") items = items.filter((a) => a.actor_id === filterAgent);
  const q = searchQuery.trim().toLowerCase();
  if (q) items = items.filter((a) => (a.message || "").toLowerCase().includes(q));
  return items;
}

// Same toCSV/downloadTextFile mechanism Pipeline/Contracts/Invoices/Projects
// already use for their own exports — Activity was the one list view left
// without one, useful for handing a slice of the feed to someone outside
// the app or keeping an offline audit trail.
function exportActivityCSV() {
  const items = filteredActivity();
  if (!items.length) return toast("No activity to export", "error");
  const columns = [
    { label: "Time", get: (a) => (a.created_at ? new Date(a.created_at).toLocaleString() : "") },
    { label: "Actor", get: (a) => profileById(a.actor_id)?.full_name || profileById(a.actor_id)?.email || "" },
    { label: "Message", get: (a) => a.message || "" },
  ];
  const csv = toCSV(items, columns);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`activity-export-${stamp}.csv`, csv);
}

function renderList(listEl) {
  if (!listEl) return;

  const items = filteredActivity();

  if (!store.activityLog.length) {
    listEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;padding:10px 0;">Nothing yet — activity will appear here live as the team works the pipeline.</div>`;
    return;
  }
  if (!items.length) {
    listEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;padding:10px 0;">No activity matches this filter.</div>`;
    return;
  }
  listEl.innerHTML = items
    .map((a) => {
      const prospect = a.prospect_id ? prospectById(a.prospect_id) : null;
      return `
      <div class="activity-feed-item"${prospect ? ` data-prospect-id="${esc(a.prospect_id)}" style="cursor:pointer;"` : ""}>
        <div>
          <div class="txt">${esc(a.message)}</div>
          <div class="time">${timeAgo(a.created_at)}</div>
        </div>
      </div>
    `;
    })
    .join("");
}

export function initActivityView() {
  on("activityLog", () => { if (isActive()) renderActivity(); });
}
function isActive() {
  return document.getElementById("view-activity")?.classList.contains("active");
}
