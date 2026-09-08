import { sb } from "../supabaseClient.js";
import { store, on, nicheDotHTML } from "../state.js";
import { el, esc, toast } from "../utils.js";
import { openSheet, closeSheet, confirmModal, openModal, closeModal } from "../ui.js";

const DIMENSIONS = [
  ["lead_value", "Lead Value"],
  ["close_speed", "Close Speed"],
  ["stickiness", "Stickiness"],
  ["marketing_gap", "Mkt Gap"],
  ["fit", "Fit"],
];

export function overallScore(n) {
  const sum = DIMENSIONS.reduce((s, [key]) => s + (n[key] || 0), 0);
  return Math.round((sum / (DIMENSIONS.length * 5)) * 100);
}

// A niche with live outreach but no niche-tagged Opener means agents are
// either improvising a first message from scratch or reaching for a
// General template that doesn't mention this niche's specific pitch, flag
// it so whoever owns the niche notices before it costs replies.
function hasActiveProspects(n) {
  return store.prospects.some((p) => p.niche_id === n.id && !["signed", "dead"].includes(p.status));
}
function hasOpenerTemplate(n) {
  return store.templates.some((t) => t.category === "opener" && t.niche_id === n.id);
}

// The opportunity score is a hand-typed gut-feel guess made before any
// outreach happens. This is the reality check: how the niche's prospects
// have actually converted so far. A niche ranked #1 by score but converting
// worst in practice is exactly the mismatch an owner needs surfaced, not
// buried behind manually cross-referencing Pipeline filters per niche.
function nicheConversionStats(n) {
  const prospects = store.prospects.filter((p) => p.niche_id === n.id);
  const total = prospects.length;
  if (!total) return null;
  const signed = prospects.filter((p) => p.status === "signed").length;
  return { total, signed, rate: signed / total };
}

// The opener-template flag and conversion stats above only ever fire once a
// niche has active prospects, a niche the team rated a strong opportunity
// but never actually worked can sit invisibly idle forever. This flags that
// gap directly: high score, zero prospects logged against it at all.
const UNTAPPED_SCORE_THRESHOLD = 60;
function isUntapped(n) {
  return overallScore(n) >= UNTAPPED_SCORE_THRESHOLD && !store.prospects.some((p) => p.niche_id === n.id);
}

// Niche conversion (above) and Revenue by City (Pipeline Value) both slice
// the pipeline by dimensions the team explicitly chose (a niche tag, the
// broad city field). Area is finer-grained, the actual neighborhood an
// agent typed while scouting, and nothing anywhere aggregates it. A
// minimum sample size keeps one 1-for-1 lead from looking like a 100%
// hotspot.
const MIN_AREA_SAMPLE = 3;
function areaStats() {
  const byArea = new Map();
  store.prospects.forEach((p) => {
    const key = (p.area || "").trim();
    if (!key) return;
    const cur = byArea.get(key) || { total: 0, signed: 0 };
    cur.total += 1;
    if (p.status === "signed") cur.signed += 1;
    byArea.set(key, cur);
  });
  return Array.from(byArea.entries()).map(([area, v]) => ({
    area,
    total: v.total,
    signed: v.signed,
    rate: v.total ? v.signed / v.total : 0,
  }));
}
function hotAreas() {
  return areaStats()
    .filter((r) => r.total >= MIN_AREA_SAMPLE)
    .sort((a, b) => b.rate - a.rate || b.total - a.total)
    .slice(0, 5);
}

// Pipeline already has a "No Website" filter chip (hasNoWebsite() there), // but it's a flat, agency-wide list, never sliced by niche, even though this
// is exactly the view that already answers "where should the team focus
// outreach" (opportunity score, conversion rate, hot areas). A niche where
// most active prospects don't even have a website yet is a strong opener
// pitch worth knowing niche-by-niche ("I noticed you don't have a website
// yet..."), not just buried in one flat cross-niche list. Recomputed here
// directly from store.prospects (same fields Pipeline's own hasNoWebsite()
// reads) rather than importing from pipeline.js, to keep this a one-file
// change. Minimum sample size guards against one prospect reading as a false
// 100%, same guardrail areaStats() above already uses.
const NO_WEBSITE_MIN_SAMPLE = 3;
function nicheNoWebsiteStats(n) {
  const active = store.prospects.filter((p) => p.niche_id === n.id && !["signed", "dead"].includes(p.status));
  if (active.length < NO_WEBSITE_MIN_SAMPLE) return null;
  const noSite = active.filter((p) => !p.website).length;
  return { total: active.length, noSite, rate: noSite / active.length };
}

let sortMode = "score"; // "score" | "conversion"

export function renderNiches() {
  const root = document.getElementById("view-niches");
  root.innerHTML = "";
  const isOwner = store.profile?.role === "owner";

  const untapped = store.niches.filter(isUntapped);
  const hot = hotAreas();
  const allAreas = areaStats();

  const wrap = el(`
    <div>
      <div class="flex-between">
        <div class="page-title mt-0">Niche Strategy<span class="accent">.</span></div>
        ${isOwner ? `<span class="small-link" id="nc-add">+ Add Niche</span>` : ""}
      </div>
      <p class="text-faint" style="font-size:12.5px;margin-top:-6px;margin-bottom:10px;">
        ${sortMode === "score" ? "Ranked by overall opportunity: where the team should focus outreach first." : "Ranked by actual signed-conversion rate: how niches are really performing."}
      </p>
      ${untapped.length ? `
        <div class="stat-grid" style="margin-bottom:14px;grid-template-columns:1fr;">
          <div class="stat-card accent" id="nc-untapped-card" style="cursor:pointer;"><div class="num">${untapped.length}</div><div class="label">High-opportunity niche${untapped.length === 1 ? "" : "s"} with zero prospects, tap to review</div></div>
        </div>
      ` : ""}
      <div class="chip-row" style="margin-bottom:14px;">
        <span class="chip ${sortMode === "score" ? "active" : ""}" id="nc-sort-score">Sort: Opportunity Score</span>
        <span class="chip ${sortMode === "conversion" ? "active" : ""}" id="nc-sort-conversion">Sort: Conversion Rate</span>
      </div>
      ${hot.length ? `
        <div class="card" style="margin-bottom:14px;">
          <div class="flex-between" style="margin-bottom:8px;">
            <div class="section-title" style="margin:0;">Hot Areas</div>
            <span class="small-link" id="nc-view-all-areas">View All Areas</span>
          </div>
          ${hot.map((r) => `
            <div class="flex-between" style="padding:6px 0;font-size:12.5px;">
              <span>${esc(r.area)}</span>
              <span class="text-faint">${r.signed}/${r.total} signed · ${Math.round(r.rate * 100)}%</span>
            </div>
          `).join("")}
        </div>
      ` : ""}
      <div id="nc-list"></div>
    </div>
  `);
  root.appendChild(wrap);

  if (isOwner) wrap.querySelector("#nc-add").addEventListener("click", () => openNicheForm(null));
  if (untapped.length) wrap.querySelector("#nc-untapped-card").addEventListener("click", () => openUntappedModal(untapped));
  const viewAllAreasLink = wrap.querySelector("#nc-view-all-areas");
  if (viewAllAreasLink) viewAllAreasLink.addEventListener("click", () => openAreaStatsModal(allAreas));
  wrap.querySelector("#nc-sort-score").addEventListener("click", () => { sortMode = "score"; renderNiches(); });
  wrap.querySelector("#nc-sort-conversion").addEventListener("click", () => { sortMode = "conversion"; renderNiches(); });

  const list = wrap.querySelector("#nc-list");
  const sorted = store.niches.slice().sort((a, b) => {
    if (sortMode === "conversion") {
      const ra = nicheConversionStats(a)?.rate ?? -1;
      const rb = nicheConversionStats(b)?.rate ?? -1;
      return rb - ra;
    }
    return overallScore(b) - overallScore(a);
  });
  if (!sorted.length) {
    list.appendChild(el(`<div class="empty-state"><p>No niches yet.</p></div>`));
    return;
  }
  sorted.forEach((n) => list.appendChild(nicheCard(n, isOwner)));
}

function nicheCard(n, isOwner) {
  const score = overallScore(n);
  const needsOpener = hasActiveProspects(n) && !hasOpenerTemplate(n);
  const conv = nicheConversionStats(n);
  const lowConversion = conv && conv.total >= 5 && conv.rate < 0.1;
  const noWebsite = nicheNoWebsiteStats(n);
  const card = el(`
    <div class="card niche-card">
      <div class="niche-head">
        <div class="n-name">${nicheDotHTML(n)}${esc(n.name)}</div>
        <div class="niche-score">${score}</div>
      </div>
      <div class="niche-bars">
        ${DIMENSIONS.map(([key, label]) => `
          <div class="niche-bar-cell">
            <div class="niche-bar-track"><div class="niche-bar-fill" style="height:${(n[key] || 0) * 20}%"></div></div>
            <div class="niche-bar-label">${label}</div>
          </div>`).join("")}
      </div>
      ${n.notes ? `<div class="text-faint" style="font-size:12px;margin-top:10px;line-height:1.4;">${esc(n.notes)}</div>` : ""}
      <div class="${lowConversion ? "status-pill stale" : "text-faint"}" style="margin-top:10px;${lowConversion ? "display:inline-block;" : ""}font-size:12px;">
        ${conv ? `Converting ${Math.round(conv.rate * 100)}% (${conv.signed}/${conv.total} signed)` : "No prospects yet"}
      </div>
      ${noWebsite ? `<div class="text-faint" style="margin-top:4px;font-size:11.5px;">${Math.round(noWebsite.rate * 100)}% have no website (${noWebsite.noSite}/${noWebsite.total}), strong opener angle</div>` : ""}
      ${needsOpener ? `<span class="status-pill stale" style="margin-top:10px;display:inline-block;cursor:pointer;" data-add-opener>No opener template</span>` : ""}
      ${isUntapped(n) ? `<span class="status-pill stale" style="margin-top:10px;display:inline-block;">Untapped, no prospects yet</span>` : ""}
      ${isOwner ? `<div class="small-link" style="margin-top:10px;" data-edit>Edit</div>` : ""}
    </div>
  `);
  const openerPill = card.querySelector("[data-add-opener]");
  if (openerPill) openerPill.addEventListener("click", async (e) => {
    e.stopPropagation();
    const { openNewTemplateForm } = await import("./messages.js");
    openNewTemplateForm({ category: "opener", niche_id: n.id });
  });
  if (isOwner) card.querySelector("[data-edit]").addEventListener("click", () => openNicheForm(n));
  return card;
}

function openUntappedModal(untapped) {
  const box = el(`
    <div>
      <div class="page-title mt-0" style="font-size:17px;">Untapped Niches</div>
      <p class="text-faint" style="font-size:12.5px;margin-top:-4px;margin-bottom:12px;">High opportunity score, zero prospects logged. Tap one to open it.</p>
      <div id="nc-untapped-list"></div>
    </div>
  `);
  const list = box.querySelector("#nc-untapped-list");
  untapped
    .slice()
    .sort((a, b) => overallScore(b) - overallScore(a))
    .forEach((n) => {
      const row = el(`
        <div class="card" style="margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
          <div class="n-name">${nicheDotHTML(n)}${esc(n.name)}</div>
          <div class="niche-score">${overallScore(n)}</div>
        </div>
      `);
      row.addEventListener("click", () => {
        closeModal();
        openNicheForm(n);
      });
      list.appendChild(row);
    });
  openModal(box);
}

function openAreaStatsModal(rows) {
  const box = el(`
    <div>
      <div class="page-title mt-0" style="font-size:17px;">Areas by Win Rate</div>
      <p class="text-faint" style="font-size:12.5px;margin-top:-4px;margin-bottom:12px;">Every area with at least one prospect logged, sorted by signed-conversion rate.</p>
      <div id="nc-all-areas-list"></div>
    </div>
  `);
  const list = box.querySelector("#nc-all-areas-list");
  const sorted = rows.slice().sort((a, b) => b.rate - a.rate || b.total - a.total);
  if (!sorted.length) {
    list.appendChild(el(`<div class="text-faint" style="font-size:12.5px;padding:10px 0;">No prospects with an area set yet.</div>`));
  } else {
    sorted.forEach((r) => {
      list.appendChild(el(`
        <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--line);font-size:12.5px;">
          <span>${esc(r.area)}</span>
          <span class="text-faint">${r.signed}/${r.total} signed · ${Math.round(r.rate * 100)}%</span>
        </div>
      `));
    });
  }
  openModal(box);
}

// Exported so Global Search can jump straight into a matched niche's detail
//, owner-only editing is enforced by the caller (globalSearch.js only
// invokes this for owners, matching the fact that niche cards elsewhere in
// the app only expose an "Edit" entry point to owners too).
export function openNicheForm(existing) {
  const n = existing || {};
  const box = el(`
    <div>
      <div class="field">
        <label>Niche name</label>
        <input id="nf-name" type="text" value="${esc(n.name || "")}" />
      </div>
      ${DIMENSIONS.map(([key, label]) => `
        <div class="field">
          <label>${label} (1-5)</label>
          <input id="nf-${key}" type="number" min="1" max="5" value="${n[key] || 3}" />
        </div>`).join("")}
      <div class="field">
        <label>Notes</label>
        <textarea id="nf-notes">${esc(n.notes || "")}</textarea>
      </div>
      <div class="field">
        <label>Discovery search phrase (optional)</label>
        <input id="nf-search-query" type="text" value="${esc(n.search_query || "")}" placeholder="Leave blank to search for &quot;${esc(n.name || "this niche's name")}&quot;" />
        <div class="hint">What the Discovery tab types into Google Maps for this niche, e.g. "gym" instead of "Fitness &amp; Gyms".</div>
      </div>
      <button class="btn btn-primary" id="nf-save">${existing ? "Save Changes" : "Add Niche"}</button>
      ${existing ? `<button class="btn btn-danger" id="nf-delete" style="margin-top:10px;">Delete Niche</button>` : ""}
    </div>
  `);

  box.querySelector("#nf-save").addEventListener("click", async () => {
    const name = box.querySelector("#nf-name").value.trim();
    if (!name) return toast("Niche name is required", "error");
    const payload = { name, notes: box.querySelector("#nf-notes").value.trim(), search_query: box.querySelector("#nf-search-query").value.trim() };
    DIMENSIONS.forEach(([key]) => { payload[key] = Number(box.querySelector(`#nf-${key}`).value) || 3; });

    if (existing) {
      const { error } = await sb.from("niches").update(payload).eq("id", existing.id);
      if (error) return toast(error.message, "error");
    } else {
      payload.sort_order = store.niches.length + 1;
      const { error } = await sb.from("niches").insert(payload);
      if (error) return toast(error.message, "error");
    }
    toast("Saved", "success");
    closeSheet();
    await refreshNiches();
  });

  const delBtn = box.querySelector("#nf-delete");
  if (delBtn) delBtn.addEventListener("click", () => {
    confirmModal({
      title: "Delete this niche?",
      body: `Prospects in <b>${esc(n.name)}</b> will keep their data but lose their niche tag.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        const { error } = await sb.from("niches").delete().eq("id", n.id);
        if (error) toast(error.message, "error");
        else { toast("Niche deleted", "success"); closeSheet(); await refreshNiches(); }
      },
    });
  });

  openSheet(existing ? "Edit Niche" : "Add Niche", box);
}

async function refreshNiches() {
  const { data } = await sb.from("niches").select("*").order("sort_order");
  store.niches = data || [];
  renderNiches();
}

export function initNichesView() {
  on("niches", () => { if (isActive()) renderNiches(); });
}
function isActive() {
  return document.getElementById("view-niches")?.classList.contains("active");
}
