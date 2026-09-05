// ============================================================================
// STUDIO X COMMAND — View: Discovery
// ============================================================================
// Search Google Maps for real businesses in a niche + area, review the
// results, and add the ones worth pursuing straight into the pipeline.
// Results already in the org's pipeline (matched by Google listing id) are
// greyed out and can't be re-added — see migration_lead_discovery.sql.
// ============================================================================

import { sb } from "../supabaseClient.js";
import { store, on } from "../state.js";
import { el, esc, toast, titleCase } from "../utils.js";

let lastResults = [];
let lastQuery = "";

export function renderDiscovery() {
  const root = document.getElementById("view-discovery");
  root.innerHTML = "";

  const nicheOptions = store.niches.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join("");

  const wrap = el(`
    <div>
      <div class="page-title mt-0">Discovery<span class="accent">.</span></div>
      <p class="text-faint" style="font-size:12.5px;margin-top:-6px;margin-bottom:14px;">
        Search Google Maps for real businesses in a niche + area, and add the ones worth pursuing straight into your pipeline.
      </p>
      <div class="card" style="margin-bottom:14px;">
        <div class="field">
          <label>Niche</label>
          <select id="dc-niche" ${store.niches.length ? "" : "disabled"}>
            ${store.niches.length ? nicheOptions : `<option value="">Add a niche first</option>`}
          </select>
        </div>
        <div class="field">
          <label>Area (optional)</label>
          <input id="dc-area" type="text" placeholder="Borrowdale, leave blank to search all of Harare" />
        </div>
        <button class="btn btn-primary" id="dc-search" ${store.niches.length ? "" : "disabled"}>Search Google Maps</button>
      </div>
      <div id="dc-results"></div>
    </div>
  `);
  root.appendChild(wrap);

  wrap.querySelector("#dc-search").addEventListener("click", () => runSearch(wrap));

  if (lastResults.length) renderResults(wrap, lastResults, lastQuery);
}

async function runSearch(wrap) {
  const niche_id = wrap.querySelector("#dc-niche").value;
  if (!niche_id) return toast("Pick a niche first", "error");
  const area = wrap.querySelector("#dc-area").value.trim();

  const btn = wrap.querySelector("#dc-search");
  const resultsEl = wrap.querySelector("#dc-results");
  btn.disabled = true;
  btn.textContent = "Searching...";
  resultsEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;padding:10px 0;">Searching Google Maps...</div>`;

  const { data, error } = await sb.functions.invoke("discover-places", { body: { niche_id, area } });

  btn.disabled = false;
  btn.textContent = "Search Google Maps";

  if (error) {
    resultsEl.innerHTML = "";
    return toast(error.message || "Search failed", "error");
  }
  if (data?.error) {
    resultsEl.innerHTML = "";
    return toast(data.error, "error");
  }

  lastResults = (data?.results || []).map((r) => ({ ...r, niche_id }));
  lastQuery = data?.query || "";
  renderResults(wrap, lastResults, lastQuery);
}

function renderResults(wrap, results, query) {
  const resultsEl = wrap.querySelector("#dc-results");
  resultsEl.innerHTML = "";

  if (!results.length) {
    resultsEl.appendChild(el(`<div class="empty-state"><p>No results${query ? ` for "${esc(query)}"` : ""}. Try a broader area or a different niche.</p></div>`));
    return;
  }

  const addableCount = results.filter((r) => !r.already_added).length;
  const box = el(`
    <div>
      <div class="flex-between" style="margin-bottom:8px;">
        <div class="section-title" style="margin:0;">${results.length} found</div>
        ${addableCount ? `<button class="btn btn-gold btn-sm" id="dc-add-selected">Add Selected</button>` : ""}
      </div>
      <div id="dc-result-list"></div>
    </div>
  `);
  resultsEl.appendChild(box);

  const list = box.querySelector("#dc-result-list");
  results.forEach((r, i) => {
    const row = el(`
      <div class="card" style="margin-bottom:8px;${r.already_added ? "opacity:0.55;" : ""}">
        <div class="flex-between" style="align-items:flex-start;">
          <label style="display:flex;gap:10px;align-items:flex-start;flex:1;font-weight:400;">
            <input type="checkbox" class="dc-check" data-idx="${i}" style="width:auto;margin-top:3px;" ${r.already_added ? "disabled" : ""} />
            <span>
              <div style="font-weight:700;font-size:13.5px;">${esc(r.business_name)}</div>
              <div class="text-faint" style="font-size:12px;margin-top:2px;">${esc(r.formatted_address || "")}</div>
              <div class="text-faint" style="font-size:11.5px;margin-top:4px;">
                ${r.rating ? `★ ${r.rating}${r.user_rating_count ? ` (${r.user_rating_count})` : ""} · ` : ""}${r.whatsapp_number ? esc(r.whatsapp_number) : "No phone listed"} · ${r.website ? "has website" : "no website"}
              </div>
            </span>
          </label>
          ${r.already_added ? `<span class="status-pill" style="white-space:nowrap;">In pipeline</span>` : ""}
        </div>
      </div>
    `);
    list.appendChild(row);
  });

  const addBtn = box.querySelector("#dc-add-selected");
  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      const idxs = Array.from(box.querySelectorAll(".dc-check:checked")).map((cb) => Number(cb.dataset.idx));
      if (!idxs.length) return toast("Check at least one business to add", "error");

      addBtn.disabled = true;
      addBtn.textContent = "Adding...";

      const rows = idxs.map((i) => {
        const r = results[i];
        return {
          business_name: r.business_name,
          niche_id: r.niche_id || null,
          city: titleCase(r.city) || "Harare",
          area: r.area || "",
          whatsapp_number: r.whatsapp_number || "",
          website: r.website || "",
          rating: r.rating,
          google_place_id: r.google_place_id,
          tier: "B",
          heat_score: 50,
          created_by: store.profile.id,
        };
      });

      const { data, error } = await sb.from("prospects").insert(rows).select("id");
      addBtn.disabled = false;
      addBtn.textContent = "Add Selected";

      if (error) return toast(error.message, "error");

      toast(`Added ${rows.length} prospect${rows.length === 1 ? "" : "s"}, researching them online...`, "success");
      (data || []).forEach((p) => {
        sb.functions.invoke("research-prospect", { body: { prospect_id: p.id } }).catch((err) => {
          console.error("research-prospect invoke failed", err);
        });
      });

      idxs.forEach((i) => { results[i].already_added = true; });
      renderResults(wrap, results, query);
    });
  }
}

export function initDiscoveryView() {
  on("niches", () => { if (isActive()) renderDiscovery(); });
}
function isActive() {
  return document.getElementById("view-discovery")?.classList.contains("active");
}
