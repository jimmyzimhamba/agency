import { sb } from "../supabaseClient.js";
import { store, on } from "../state.js";
import { el, esc, toast, readFileAsArrayBuffer, withTimeout } from "../utils.js";
import { openSheet, closeSheet, confirmModal } from "../ui.js";

// The agency's public "our best work" showcase, case studies of past
// client projects that can be shared as a plain link (portfolio.html), no
// login required on the other end. Different from every other tab: this is
// the one place in the app with content that's meant to leave the building.
// Permission model mirrors Niches/Services & Packages: everyone on the team
// browses the full internal catalog (published or not), only the owner
// curates it, see migration_portfolio.sql for the RLS/security reasoning.

let filterStatus = "all"; // "all" | "published" | "draft"

function isActive() {
  return document.getElementById("view-portfolio")?.classList.contains("active");
}

function publicUrl() {
  return `${location.origin}/portfolio.html?org=${store.profile?.org_id || ""}`;
}

function visibleItems() {
  let items = store.portfolioItems.slice();
  if (filterStatus === "published") items = items.filter((p) => p.is_published);
  else if (filterStatus === "draft") items = items.filter((p) => !p.is_published);
  return items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.title || "").localeCompare(b.title || ""));
}

export function renderPortfolio() {
  const root = document.getElementById("view-portfolio");
  root.innerHTML = "";
  const isOwner = store.profile?.role === "owner";

  const settings = store.portfolioSettings;
  const isPublic = !!settings?.is_public;
  const published = store.portfolioItems.filter((p) => p.is_published).length;

  const wrap = el(`
    <div>
      <div class="flex-between">
        <div class="page-title mt-0">Portfolio Studio<span class="accent">.</span></div>
        ${isOwner ? `<span class="small-link" id="pf-new">+ New Case Study</span>` : ""}
      </div>
      <p class="text-faint" style="font-size:12.5px;margin-top:-6px;margin-bottom:10px;">
        ${isOwner ? "Build a public showcase of past work to send prospects. Nothing here goes live until you publish it." : "The agency's public case-study catalog. Only the owner can add or publish new work."}
      </p>
      <div class="card" style="margin-bottom:16px;">
        <div class="flex-between" style="margin-bottom:${isPublic ? "10px" : "0"};">
          <div>
            <div style="font-weight:700;font-size:13.5px;">${isPublic ? "Showcase is public" : "Showcase is private"}</div>
            <div class="text-faint" style="font-size:11.5px;margin-top:2px;">${isPublic ? `${published} published case stud${published === 1 ? "y" : "ies"} visible to anyone with the link` : "Turn this on once you have at least one published case study"}</div>
          </div>
          <span class="status-pill ${isPublic ? "signed" : "draft"}">${isPublic ? "Public" : "Private"}</span>
        </div>
        ${isPublic ? `
          <div style="display:flex;gap:8px;align-items:center;background:rgba(255,255,255,0.04);border-radius:8px;padding:8px 10px;">
            <span style="font-size:11.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" class="text-faint">${esc(publicUrl())}</span>
            <span class="small-link" id="pf-copy-link" style="flex:0 0 auto;">Copy</span>
          </div>
        ` : ""}
        ${isOwner ? `<div class="small-link" id="pf-settings" style="margin-top:10px;">${isPublic ? "Edit Showcase Settings" : "Set Up Showcase"}</div>` : ""}
      </div>
      <div class="chip-row" id="pf-status-chips"></div>
      <div id="pf-list"></div>
    </div>
  `);
  root.appendChild(wrap);

  if (isOwner) wrap.querySelector("#pf-new").addEventListener("click", () => openPortfolioItemSheet(null));
  if (isOwner) wrap.querySelector("#pf-settings").addEventListener("click", () => openPortfolioSettingsSheet(settings));
  const copyBtn = wrap.querySelector("#pf-copy-link");
  if (copyBtn) copyBtn.addEventListener("click", () => copyPublicLink());

  const chipRow = wrap.querySelector("#pf-status-chips");
  [["all", "All"], ["published", "Published"], ["draft", "Draft"]].forEach(([val, label]) => {
    const chip = el(`<span class="chip ${filterStatus === val ? "active" : ""}">${label}</span>`);
    chip.addEventListener("click", () => { filterStatus = val; renderPortfolio(); });
    chipRow.appendChild(chip);
  });

  renderList(wrap.querySelector("#pf-list"), isOwner);
}

function renderList(listEl, isOwner) {
  if (!listEl) listEl = document.getElementById("pf-list");
  if (!listEl) return;

  const items = visibleItems();
  listEl.innerHTML = "";
  if (!items.length) {
    listEl.appendChild(el(`
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="6.5" width="19" height="13.5" rx="4"/><path d="M8.9 6.5 10.3 4h3.4l1.4 2.5"/><circle cx="12" cy="13.2" r="3.5"/></svg>
        <p>${store.portfolioItems.length ? "No case studies match this filter." : isOwner ? "No case studies yet. Add your first project to start building the showcase." : "No case studies in the catalog yet."}</p>
      </div>
    `));
    return;
  }

  items.forEach((p) => {
    const card = el(`
      <div class="card" style="margin-bottom:8px;${isOwner ? "cursor:pointer;" : ""}display:flex;gap:12px;">
        ${p.image_url ? `<img src="${esc(p.image_url)}" alt="" style="width:64px;height:64px;border-radius:8px;object-fit:cover;flex:0 0 auto;" />` : `<div style="width:64px;height:64px;border-radius:8px;flex:0 0 auto;background:rgba(255,255,255,0.06);"></div>`}
        <div style="min-width:0;flex:1;">
          <div class="flex-between" style="margin-bottom:4px;">
            <div style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.title)}</div>
            <span class="status-pill ${p.is_published ? "signed" : "draft"}">${p.is_published ? "Published" : "Draft"}</span>
          </div>
          ${p.category ? `<div class="text-faint" style="font-size:12px;margin-bottom:4px;">${esc(p.category)}${p.client_name ? " · " + esc(p.client_name) : ""}</div>` : p.client_name ? `<div class="text-faint" style="font-size:12px;margin-bottom:4px;">${esc(p.client_name)}</div>` : ""}
          ${p.summary ? `<div class="text-faint" style="font-size:12px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${esc(p.summary)}</div>` : ""}
        </div>
      </div>
    `);
    if (isOwner) card.addEventListener("click", () => openPortfolioItemSheet(p));
    listEl.appendChild(card);
  });
}

async function copyPublicLink() {
  try {
    await navigator.clipboard.writeText(publicUrl());
    toast("Link copied", "success");
  } catch {
    toast(publicUrl(), "");
  }
}

function openPortfolioSettingsSheet(existing) {
  const s = existing || {};
  const box = el(`
    <div>
      <div class="field">
        <label>Headline</label>
        <input id="pfs-headline" type="text" value="${esc(s.headline || "Our Work")}" placeholder="e.g. Our Work" />
      </div>
      <div class="field">
        <label>Tagline</label>
        <textarea id="pfs-tagline" placeholder="A short line under the headline...">${esc(s.tagline || "")}</textarea>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin:4px 0 14px;font-size:13px;">
        <input id="pfs-public" type="checkbox" ${s.is_public ? "checked" : ""} style="width:auto;" />
        Make showcase public
      </label>
      <p class="text-faint" style="font-size:11.5px;margin-top:-8px;margin-bottom:14px;">Only <b>published</b> case studies ever show up on the public page, even once this is on.</p>
      <button id="pfs-save" class="btn btn-primary">Save Settings</button>
    </div>
  `);

  box.querySelector("#pfs-save").addEventListener("click", async () => {
    const payload = {
      headline: box.querySelector("#pfs-headline").value.trim() || "Our Work",
      tagline: box.querySelector("#pfs-tagline").value.trim(),
      is_public: box.querySelector("#pfs-public").checked,
    };
    const btn = box.querySelector("#pfs-save");
    btn.disabled = true;

    let error;
    if (existing?.id) {
      ({ error } = await sb.from("portfolio_settings").update(payload).eq("id", existing.id));
    } else {
      payload.created_by = store.profile.id;
      ({ error } = await sb.from("portfolio_settings").insert(payload));
    }
    btn.disabled = false;
    if (error) return toast(error.message, "error");
    toast("Saved", "success");
    closeSheet();
  });

  openSheet("Showcase Settings", box);
}

export function openPortfolioItemSheet(existing) {
  const p = existing || {};
  const isEdit = !!p.id;

  const box = el(`
    <div>
      <div style="display:flex;justify-content:center;margin-bottom:14px;">
        <div id="pf-image-wrap" style="cursor:pointer;position:relative;">
          <div id="pf-image-slot" style="width:96px;height:96px;border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;">
            ${p.image_url ? `<img src="${esc(p.image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;" />` : `<span class="text-faint" style="font-size:11px;">No image</span>`}
          </div>
          <div class="small-link" id="pf-change-photo" style="text-align:center;margin-top:6px;font-size:11.5px;">${p.image_url ? "Change" : "Add"} Image</div>
        </div>
        <input id="pf-file-input" type="file" accept="image/*" style="display:none;" />
      </div>
      <div class="field">
        <label>Project title *</label>
        <input id="pf-title" type="text" value="${esc(p.title || "")}" placeholder="e.g. WestProp Rebrand & Launch" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Category</label>
          <input id="pf-category" type="text" value="${esc(p.category || "")}" placeholder="e.g. Branding" />
        </div>
        <div class="field">
          <label>Client name (optional)</label>
          <input id="pf-client" type="text" value="${esc(p.client_name || "")}" placeholder="Leave blank to anonymize" />
        </div>
      </div>
      <div class="field">
        <label>Summary</label>
        <textarea id="pf-summary" placeholder="What was the project...">${esc(p.summary || "")}</textarea>
      </div>
      <div class="field">
        <label>Results</label>
        <textarea id="pf-results" placeholder="What did it achieve: metrics, outcomes...">${esc(p.results || "")}</textarea>
      </div>
      <div class="field">
        <label>External link (optional)</label>
        <input id="pf-link" type="text" value="${esc(p.external_link || "")}" placeholder="Live site, case study, etc." />
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin:4px 0 14px;font-size:13px;">
        <input id="pf-published" type="checkbox" ${p.is_published ? "checked" : ""} style="width:auto;" />
        Published (visible on the public showcase, if it's turned on)
      </label>
      <button id="pf-save" class="btn btn-primary">${isEdit ? "Save Changes" : "Add Case Study"}</button>
      ${isEdit ? `<button id="pf-delete" class="btn btn-danger" style="margin-top:10px;">Delete Case Study</button>` : ""}
    </div>
  `);

  let pendingImageUrl = p.image_url || null;
  const fileInput = box.querySelector("#pf-file-input");
  const slot = box.querySelector("#pf-image-slot");
  const openPicker = () => fileInput.click();
  box.querySelector("#pf-image-wrap").addEventListener("click", openPicker);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Please choose an image file", "error");
    if (file.size > 5 * 1024 * 1024) return toast("Image must be under 5MB", "error");

    const localPreview = URL.createObjectURL(file);
    slot.innerHTML = `<img src="${localPreview}" alt="" style="width:100%;height:100%;object-fit:cover;" />`;

    const extMatch = /\.([a-z0-9]+)$/i.exec(file.name || "");
    const ext = (extMatch ? extMatch[1] : "jpg").toLowerCase();
    const path = `${store.profile.org_id}/${Date.now()}.${ext}`;

    // See gridPlans.js's upload handler for why: raw File/Blob bodies can
    // trigger a streamed fetch() that throws a bare "Failed to fetch" in
    // some Chrome builds. Reading into an ArrayBuffer first avoids that.
    try {
      const fileBuffer = await readFileAsArrayBuffer(file);
      const { error: upErr } = await withTimeout(
        sb.storage.from("portfolio-media").upload(path, fileBuffer, { upsert: true, cacheControl: "3600", contentType: file.type }),
        20000,
        "Upload"
      );
      if (upErr) {
        toast(upErr.message || "Upload failed", "error");
        slot.innerHTML = p.image_url ? `<img src="${esc(p.image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;" />` : `<span class="text-faint" style="font-size:11px;">No image</span>`;
        return;
      }
      const { data: pub } = sb.storage.from("portfolio-media").getPublicUrl(path);
      pendingImageUrl = pub.publicUrl;
      toast("Image uploaded", "success");
    } catch (err) {
      toast(err?.message || "Upload failed, please try again", "error");
    }
  });

  box.querySelector("#pf-save").addEventListener("click", async () => {
    const title = box.querySelector("#pf-title").value.trim();
    if (!title) return toast("Project title is required", "error");

    const payload = {
      title,
      category: box.querySelector("#pf-category").value.trim(),
      client_name: box.querySelector("#pf-client").value.trim(),
      summary: box.querySelector("#pf-summary").value.trim(),
      results: box.querySelector("#pf-results").value.trim(),
      external_link: box.querySelector("#pf-link").value.trim(),
      image_url: pendingImageUrl,
      is_published: box.querySelector("#pf-published").checked,
    };

    const btn = box.querySelector("#pf-save");
    btn.disabled = true;

    if (isEdit) {
      const { error } = await sb.from("portfolio_items").update(payload).eq("id", p.id);
      btn.disabled = false;
      if (error) return toast(error.message, "error");
      toast("Saved", "success");
      closeSheet();
    } else {
      payload.created_by = store.profile.id;
      payload.sort_order = store.portfolioItems.length;
      const { error } = await sb.from("portfolio_items").insert(payload);
      btn.disabled = false;
      if (error) return toast(error.message, "error");
      toast("Case study added", "success");
      closeSheet();
    }
  });

  const delBtn = box.querySelector("#pf-delete");
  if (delBtn) {
    delBtn.addEventListener("click", () => {
      confirmModal({
        title: "Delete this case study?",
        body: `This permanently removes <b>${esc(p.title)}</b> from the catalog and the public showcase. This can't be undone.`,
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
          const { error } = await sb.from("portfolio_items").delete().eq("id", p.id);
          if (error) return toast(error.message, "error");
          toast("Case study deleted", "success");
          closeSheet();
        },
      });
    });
  }

  openSheet(isEdit ? "Edit Case Study" : "New Case Study", box);
}

export function initPortfolioView() {
  on("portfolioItems", () => { if (isActive()) renderPortfolio(); });
  on("portfolioSettings", () => { if (isActive()) renderPortfolio(); });
}
