import { sb } from "../supabaseClient.js";
import { store, on } from "../state.js";
import { el, esc, money, toast, toCSV, downloadTextFile } from "../utils.js";
import { openSheet, closeSheet, confirmModal } from "../ui.js";

// The agency's own sellable catalog — fixed, named service offerings with a
// price and a turnaround estimate (e.g. "Starter Social Package — $500/mo,
// 5 business days"). Distinct from Deal Pricing (dealPricing.js), which is a
// market-band *calculator* keyed on a client's segment, not a list of what
// the agency actually sells. Permission model mirrors Niches, not
// Contracts/Invoices/Projects: everyone reads the catalog (to quote a client
// accurately) but only the owner curates it — a service catalog is a
// pricing/positioning decision, not day-to-day delivery work.

let filterCategory = "all";
let showInactive = false;

function categories() {
  const set = new Set();
  store.servicePackages.forEach((p) => { if (p.category) set.add(p.category); });
  return Array.from(set).sort();
}

function visiblePackages() {
  let items = store.servicePackages.slice();
  if (!showInactive) items = items.filter((p) => p.active !== false);
  if (filterCategory !== "all") items = items.filter((p) => (p.category || "") === filterCategory);
  return items;
}

function activePackages() {
  return store.servicePackages.filter((p) => p.active !== false);
}
function avgPriceByType(type) {
  const withType = activePackages().filter((p) => (p.price_type || "one_time") === type && Number(p.price) > 0);
  if (!withType.length) return null;
  return withType.reduce((sum, p) => sum + Number(p.price), 0) / withType.length;
}

function priceLabel(p) {
  return (p.price_type || "one_time") === "monthly" ? `${money(p.price)}/mo` : `${money(p.price)} one-time`;
}

export function renderServices() {
  const root = document.getElementById("view-services");
  root.innerHTML = "";
  const isOwner = store.profile?.role === "owner";

  const active = activePackages();
  const avgMonthly = avgPriceByType("monthly");
  const avgOneTime = avgPriceByType("one_time");
  const cats = categories();

  const wrap = el(`
    <div>
      <div class="flex-between">
        <div class="page-title mt-0">Services &amp; Packages<span class="accent">.</span></div>
        <div style="display:flex;gap:14px;">
          <span class="small-link" id="sv-export-csv">Export CSV</span>
          ${isOwner ? `<span class="small-link" id="sv-new">+ New Package</span>` : ""}
        </div>
      </div>
      <p class="text-faint" style="font-size:12.5px;margin-top:-6px;margin-bottom:10px;">
        ${isOwner ? "The fixed menu of what you sell — add or reprice a package here and everyone quotes off the same numbers." : "The agency's fixed menu — use these when quoting a client. Only the owner can add or reprice a package."}
      </p>
      <div class="stat-grid" style="margin-bottom:16px;">
        <div class="stat-card"><div class="num">${active.length}</div><div class="label">Active Packages</div></div>
        <div class="stat-card purple"><div class="num">${store.servicePackages.length}</div><div class="label">Total in Catalog</div></div>
      </div>
      ${avgMonthly !== null ? `
        <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
          <div class="stat-card"><div class="num">${money(avgMonthly)}</div><div class="label">Avg. Monthly Package Price</div></div>
        </div>
      ` : ""}
      ${avgOneTime !== null ? `
        <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
          <div class="stat-card"><div class="num">${money(avgOneTime)}</div><div class="label">Avg. One-Time Package Price</div></div>
        </div>
      ` : ""}
      <div class="chip-row" id="sv-cat-chips" style="margin-bottom:6px;"></div>
      <div class="chip-row" id="sv-inactive-chip"></div>
      <div id="sv-list"></div>
    </div>
  `);
  root.appendChild(wrap);

  wrap.querySelector("#sv-export-csv").addEventListener("click", exportServicesCSV);
  if (isOwner) wrap.querySelector("#sv-new").addEventListener("click", () => openServiceSheet(null));

  const catChips = wrap.querySelector("#sv-cat-chips");
  [["all", "All"], ...cats.map((c) => [c, c])].forEach(([val, label]) => {
    const chip = el(`<span class="chip ${filterCategory === val ? "active" : ""}">${esc(label)}</span>`);
    chip.addEventListener("click", () => { filterCategory = val; renderServices(); });
    catChips.appendChild(chip);
  });

  const inactiveChipRow = wrap.querySelector("#sv-inactive-chip");
  const inactiveChip = el(`<span class="chip ${showInactive ? "active" : ""}">${showInactive ? "Showing Inactive" : "Show Inactive"}</span>`);
  inactiveChip.addEventListener("click", () => { showInactive = !showInactive; renderServices(); });
  inactiveChipRow.appendChild(inactiveChip);

  renderList(wrap.querySelector("#sv-list"), isOwner);
}

function renderList(listEl, isOwner) {
  if (!listEl) listEl = document.getElementById("sv-list");
  if (!listEl) return;

  const items = visiblePackages().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.name || "").localeCompare(b.name || ""));

  listEl.innerHTML = "";
  if (!items.length) {
    listEl.appendChild(el(`
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Z"/><path d="M10 5h4v2h-4z"/></svg>
        <p>${store.servicePackages.length ? "No packages match this filter." : isOwner ? "No packages yet — add your first one to start building the catalog." : "No packages in the catalog yet."}</p>
      </div>
    `));
    return;
  }

  items.forEach((p) => {
    const inactive = p.active === false;
    const card = el(`
      <div class="card" style="margin-bottom:8px;${isOwner ? "cursor:pointer;" : ""}${inactive ? "opacity:0.6;" : ""}">
        <div class="flex-between" style="margin-bottom:4px;">
          <div style="font-weight:700;font-size:14px;">${esc(p.name)}</div>
          <span class="status-pill ${inactive ? "draft" : "signed"}">${inactive ? "Inactive" : "Active"}</span>
        </div>
        ${p.category ? `<div class="text-faint" style="font-size:12px;margin-bottom:6px;">${esc(p.category)}</div>` : ""}
        ${p.description ? `<div class="text-faint" style="font-size:12.5px;margin-bottom:8px;line-height:1.4;">${esc(p.description)}</div>` : ""}
        <div class="flex-between">
          <span style="font-weight:700;font-size:15px;">${priceLabel(p)}</span>
          ${p.turnaround_days ? `<span class="text-faint" style="font-size:11px;">${p.turnaround_days}-day turnaround</span>` : ""}
        </div>
      </div>
    `);
    if (isOwner) card.addEventListener("click", () => openServiceSheet(p));
    listEl.appendChild(card);
  });
}

function exportServicesCSV() {
  const items = visiblePackages().slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  if (!items.length) return toast("No packages to export", "error");

  const columns = [
    { label: "Name", get: (p) => p.name },
    { label: "Category", get: (p) => p.category || "" },
    { label: "Description", get: (p) => p.description || "" },
    { label: "Price", get: (p) => p.price },
    { label: "Price Type", get: (p) => (p.price_type || "one_time") === "monthly" ? "Monthly" : "One-Time" },
    { label: "Turnaround (days)", get: (p) => p.turnaround_days || "" },
    { label: "Status", get: (p) => p.active === false ? "Inactive" : "Active" },
  ];

  const csv = toCSV(items, columns);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`services-packages-export-${stamp}.csv`, csv);
}

export function openServiceSheet(existing) {
  const p = existing || {};
  const isEdit = !!p.id;

  const box = el(`
    <div>
      <div class="field">
        <label>Package name *</label>
        <input id="sv-name" type="text" value="${esc(p.name || "")}" placeholder="e.g. Starter Social Package" />
      </div>
      <div class="field">
        <label>Category</label>
        <input id="sv-category" type="text" value="${esc(p.category || "")}" placeholder="e.g. Social Media" list="sv-category-list" />
        <datalist id="sv-category-list">${categories().map((c) => `<option value="${esc(c)}"></option>`).join("")}</datalist>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Price (USD)</label>
          <input id="sv-price" type="number" min="0" step="1" value="${p.price ?? ""}" placeholder="e.g. 500" />
        </div>
        <div class="field">
          <label>Price type</label>
          <select id="sv-price-type">
            <option value="one_time" ${(p.price_type || "one_time") === "one_time" ? "selected" : ""}>One-Time</option>
            <option value="monthly" ${p.price_type === "monthly" ? "selected" : ""}>Monthly</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>Turnaround (days, optional)</label>
        <input id="sv-turnaround" type="number" min="0" step="1" value="${p.turnaround_days ?? ""}" placeholder="e.g. 5" />
      </div>
      <div class="field">
        <label>Description</label>
        <textarea id="sv-description" placeholder="What's included...">${esc(p.description || "")}</textarea>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin:4px 0 14px;font-size:13px;">
        <input id="sv-active" type="checkbox" ${p.active !== false ? "checked" : ""} style="width:auto;" />
        Active (shown to the team by default)
      </label>
      <button id="sv-save" class="btn btn-primary">${isEdit ? "Save Changes" : "Add Package"}</button>
      ${isEdit ? `<button id="sv-delete" class="btn btn-danger" style="margin-top:10px;">Delete Package</button>` : ""}
    </div>
  `);

  box.querySelector("#sv-save").addEventListener("click", async () => {
    const name = box.querySelector("#sv-name").value.trim();
    if (!name) return toast("Package name is required", "error");

    const payload = {
      name,
      category: box.querySelector("#sv-category").value.trim(),
      price: Number(box.querySelector("#sv-price").value) || 0,
      price_type: box.querySelector("#sv-price-type").value,
      turnaround_days: box.querySelector("#sv-turnaround").value ? Number(box.querySelector("#sv-turnaround").value) : null,
      description: box.querySelector("#sv-description").value.trim(),
      active: box.querySelector("#sv-active").checked,
    };

    const btn = box.querySelector("#sv-save");
    btn.disabled = true;

    if (isEdit) {
      const { error } = await sb.from("service_packages").update(payload).eq("id", p.id);
      btn.disabled = false;
      if (error) return toast(error.message, "error");
      toast("Saved", "success");
      closeSheet();
    } else {
      payload.created_by = store.profile.id;
      payload.sort_order = store.servicePackages.length;
      const { error } = await sb.from("service_packages").insert(payload);
      btn.disabled = false;
      if (error) return toast(error.message, "error");
      toast("Package added", "success");
      closeSheet();
    }
  });

  const delBtn = box.querySelector("#sv-delete");
  if (delBtn) {
    delBtn.addEventListener("click", () => {
      confirmModal({
        title: "Delete this package?",
        body: `This permanently removes <b>${esc(p.name)}</b> from the catalog. This can't be undone.`,
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
          const { error } = await sb.from("service_packages").delete().eq("id", p.id);
          if (error) return toast(error.message, "error");
          toast("Package deleted", "success");
          closeSheet();
        },
      });
    });
  }

  openSheet(isEdit ? "Edit Package" : "New Package", box);
}

export function initServicesView() {
  on("servicePackages", () => { if (isActive()) renderServices(); });
}
function isActive() {
  return document.getElementById("view-services")?.classList.contains("active");
}
