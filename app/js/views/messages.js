import { sb } from "../supabaseClient.js";
import { store, on, nicheById, profileById } from "../state.js";
import { el, esc, toast, personalizeMessage, avatarHTML } from "../utils.js";
import { openSheet, closeSheet, confirmModal, openModal, closeModal } from "../ui.js";
import { openProspectDetail } from "./prospectDetail.js";

const CATEGORIES = [["opener", "Opener"], ["follow_up", "Follow-up"], ["objection", "Objection Handler"], ["close", "Close"]];

// A template that never uses any personalization token sends out reading as
// obviously copy-pasted — but nothing today tells the team which templates
// are still generic. Same token list personalizeMessage() (utils.js)
// actually recognizes, so "generic" here means "would render byte-for-byte
// identical to every prospect."
const PERSONALIZATION_TOKENS = ["{{business_name}}", "{{area_clause}}", "{{gap_clause}}", "{{agent_name}}"];
function isGeneric(t) {
  return !PERSONALIZATION_TOKENS.some((tok) => (t.body || "").includes(tok));
}

// "No personalization" above audits the *templates*. This audits what
// actually went out: every contacted prospect carries a message_source
// ('manual' | 'ai_generated' | 'auto_template') set when their first
// outreach message was sent. Nothing today rolls that up across the whole
// pipeline, so an owner has no quick answer to "how much of our live
// outreach is AI-personalized vs. still raw auto-template vs. hand-written?"
// Scoped to prospects that have actually been contacted — not_contacted
// prospects haven't had a message_source assigned in any meaningful sense.
function outreachOriginStats() {
  const contacted = store.prospects.filter((p) => p.status !== "not_contacted");
  const byOrigin = (src) => contacted.filter((p) => p.message_source === src);
  return {
    total: contacted.length,
    ai: byOrigin("ai_generated"),
    auto: byOrigin("auto_template"),
    manual: byOrigin("manual"),
  };
}

// outreachOriginStats above already answers "how much of our outreach is
// AI/auto/manual" agency-wide — but never broken down by WHO sent it. Team
// Leaderboard (team.js) already ranks agents by MRR/win-rate; this is a
// distinct axis — outreach hygiene, not revenue — that's never been sliced
// per-person anywhere. Ranked worst-first (highest raw-auto-template %) so
// whoever needs the most coaching on personalizing their outreach surfaces
// first, same "worst-first" convention Dashboard's stale-lead/at-risk lists
// already use. Owner-only, matching Team Leaderboard's own gating — this is
// a coaching view into individual reps' work, not something every agent
// needs to see about each other. Minimum sample size guards against one
// contacted lead reading as a false 100%.
const PERSONALIZATION_MIN_SAMPLE = 3;
function personalizationByAgent() {
  const byAgent = {};
  store.prospects
    .filter((p) => p.status !== "not_contacted" && p.assigned_to)
    .forEach((p) => {
      const cur = byAgent[p.assigned_to] || { total: 0, autoTemplate: 0 };
      cur.total += 1;
      if (p.message_source === "auto_template") cur.autoTemplate += 1;
      byAgent[p.assigned_to] = cur;
    });
  return Object.entries(byAgent)
    .map(([agentId, v]) => ({ agentId, total: v.total, autoTemplate: v.autoTemplate, rate: v.autoTemplate / v.total }))
    .filter((r) => r.total >= PERSONALIZATION_MIN_SAMPLE)
    .sort((a, b) => b.rate - a.rate);
}

function renderPersonalizationByAgent(container) {
  if (!container) return;
  const ranked = personalizationByAgent();
  if (!ranked.length) {
    container.innerHTML = `<div class="text-faint" style="font-size:12.5px;">Not enough contacted leads per agent yet to compare.</div>`;
    return;
  }
  container.innerHTML = "";
  ranked.forEach((r) => {
    const p = profileById(r.agentId);
    const pct = Math.round(r.rate * 100);
    const row = el(`
      <div class="card" style="margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          ${avatarHTML(p?.full_name || p?.email, p?.avatar_url, 30, 11)}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p?.full_name || p?.email || "Unknown")}</div>
            <div class="text-faint" style="font-size:11px;">${r.autoTemplate}/${r.total} contacted still on raw auto-template</div>
          </div>
          <div class="${pct >= 50 ? "status-pill stale" : "text-faint"}" style="flex:0 0 auto;font-size:12px;${pct >= 50 ? "" : "font-weight:700;"}">${pct}%</div>
        </div>
      </div>
    `);
    container.appendChild(row);
  });
}

export function renderMessages() {
  const root = document.getElementById("view-messages");
  root.innerHTML = "";

  const genericTemplates = store.templates.filter(isGeneric);
  const origin = outreachOriginStats();
  const isOwner = store.profile?.role === "owner";

  const wrap = el(`
    <div>
      <div class="flex-between">
        <div class="page-title mt-0">Message Kit<span class="accent">.</span></div>
        <span class="small-link" id="mk-add">+ New</span>
      </div>
      <p class="text-faint" style="font-size:12.5px;margin-top:-6px;margin-bottom:14px;">Openers tagged to a niche auto-fill with each prospect's details when an agent sends their first message. Everything else: tap "Copy", then personalise before sending.</p>
      ${origin.total ? `
        <div class="stat-grid cols-3" style="margin-bottom:16px;">
          <div class="stat-card accent" id="mk-origin-ai" style="cursor:pointer;">
            <div class="num">${origin.ai.length}</div>
            <div class="label">AI-Generated</div>
          </div>
          <div class="stat-card" id="mk-origin-auto" style="cursor:pointer;">
            <div class="num">${origin.auto.length}</div>
            <div class="label">Auto-Template</div>
          </div>
          <div class="stat-card" id="mk-origin-manual" style="cursor:pointer;">
            <div class="num">${origin.manual.length}</div>
            <div class="label">Manual</div>
          </div>
        </div>
      ` : ""}
      ${genericTemplates.length ? `
        <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
          <div class="stat-card accent" id="mk-generic-card" style="cursor:pointer;">
            <div class="num">${genericTemplates.length}</div>
            <div class="label">Template${genericTemplates.length === 1 ? "" : "s"} with no personalization, tap to review</div>
          </div>
        </div>
      ` : ""}
      ${isOwner ? `
      <div class="section-title" style="margin-top:6px;">Personalization by Agent</div>
      <div id="mk-personalization" style="margin-bottom:6px;"></div>
      ` : ""}
      <div id="mk-list"></div>
    </div>
  `);
  root.appendChild(wrap);
  wrap.querySelector("#mk-add").addEventListener("click", () => openTemplateForm(null));
  if (isOwner) renderPersonalizationByAgent(wrap.querySelector("#mk-personalization"));
  if (genericTemplates.length) {
    wrap.querySelector("#mk-generic-card").addEventListener("click", () => openGenericTemplatesModal(genericTemplates));
  }
  if (origin.total) {
    wrap.querySelector("#mk-origin-ai").addEventListener("click", () => openOutreachOriginModal("AI-Generated Outreach", origin.ai));
    wrap.querySelector("#mk-origin-auto").addEventListener("click", () => openOutreachOriginModal("Auto-Template Outreach", origin.auto));
    wrap.querySelector("#mk-origin-manual").addEventListener("click", () => openOutreachOriginModal("Manual Outreach", origin.manual));
  }

  const list = wrap.querySelector("#mk-list");
  if (!store.templates.length) {
    list.appendChild(el(`<div class="empty-state"><p>No templates yet. Add your first one.</p></div>`));
    return;
  }

  CATEGORIES.forEach(([key, label]) => {
    const items = store.templates.filter((t) => t.category === key);
    if (!items.length) return;
    list.appendChild(el(`<div class="section-title" style="margin-top:18px;">${label}</div>`));
    items.forEach((t) => list.appendChild(templateCard(t)));
  });
}

// Click-through drill-down modal — same pattern as Invoices' "Slowest
// Payers"/"Outstanding by Client" and Contracts' "Signed This Month": list
// the flagged rows, tapping one closes the modal and jumps straight into
// fixing it.
function openGenericTemplatesModal(items) {
  const box = el(`
    <div>
      <div class="section-title mt-0">No Personalization</div>
      <div id="mk-generic-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#mk-generic-list");
  items.forEach((t) => {
    const niche = t.niche_id ? nicheById(t.niche_id) : null;
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <span style="font-weight:700;font-size:13.5px;">${esc(t.title)}</span>
          <span class="template-cat">${t.category.replace("_", " ")}</span>
        </div>
        <div class="text-faint" style="font-size:11px;margin-top:2px;">${niche ? "For: " + esc(niche.name) : "General, all niches"}</div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openTemplateForm(t);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

// Drill-down for the outreach-origin stat cards above — lists the contacted
// prospects in that bucket, tapping one closes the modal and jumps straight
// into their Prospect Detail (same click-through pattern as
// openGenericTemplatesModal above, but into prospects instead of templates).
function openOutreachOriginModal(title, prospects) {
  const box = el(`
    <div>
      <div class="section-title mt-0">${esc(title)}</div>
      <div id="mk-origin-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#mk-origin-list");
  if (!prospects.length) {
    listEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;padding:10px 0;">Nothing here.</div>`;
  } else {
    prospects.forEach((p) => {
      const row = el(`
        <div class="card" style="margin-bottom:8px;cursor:pointer;">
          <div class="flex-between">
            <span style="font-weight:700;font-size:13.5px;">${esc(p.business_name)}</span>
          </div>
          <div class="text-faint" style="font-size:11px;margin-top:2px;">${esc((p.status || "").replace("_", " "))}</div>
        </div>
      `);
      row.addEventListener("click", () => {
        closeModal();
        openProspectDetail(p);
      });
      listEl.appendChild(row);
    });
  }
  openModal(box);
}

function templateCard(t) {
  const niche = t.niche_id ? nicheById(t.niche_id) : null;
  const card = el(`
    <div class="card template-card">
      <div class="template-head">
        <div class="template-title">${esc(t.title)}</div>
        <span class="template-cat">${t.category.replace("_", " ")}</span>
      </div>
      <div class="text-faint" style="font-size:11px;margin-bottom:6px;">${niche ? "For: " + esc(niche.name) : "General, all niches"}</div>
      ${isGeneric(t) ? `<span class="status-pill stale" style="margin-bottom:6px;display:inline-block;">No personalization</span>` : ""}
      <div class="template-body">${esc(t.body)}</div>
      <div class="btn-block-row">
        <button class="btn btn-gold btn-sm" data-action="copy">Copy</button>
        <button class="btn btn-ghost btn-sm" data-action="edit" style="width:auto;flex:0 0 auto;">Edit</button>
      </div>
    </div>
  `);
  card.querySelector('[data-action="copy"]').addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(t.body);
      toast("Copied to clipboard", "success");
    } catch {
      toast("Couldn't copy, long-press the text instead", "error");
    }
  });
  card.querySelector('[data-action="edit"]').addEventListener("click", () => openTemplateForm(t));
  return card;
}

// Exported so Global Search can jump straight into a matched template —
// unlike niches, template editing was never owner-gated in the UI, so no
// extra permission check is needed at the call site.
export function openTemplateForm(existing) {
  const t = existing || {};
  // A caller can pass a partial template (e.g. { category: "opener",
  // niche_id }) to pre-fill a *new* template without it counting as editing
  // an existing one — only a real `id` means "edit mode."
  const isEdit = !!t.id;
  const nicheOptions = store.niches
    .map((n) => `<option value="${n.id}" ${t.niche_id === n.id ? "selected" : ""}>${esc(n.name)}</option>`)
    .join("");
  const box = el(`
    <div>
      <div class="field">
        <label>Title</label>
        <input id="tf-title" type="text" value="${esc(t.title || "")}" placeholder="Cold Opener" />
      </div>
      <div class="field">
        <label>Category</label>
        <select id="tf-cat">${CATEGORIES.map(([k, l]) => `<option value="${k}" ${t.category === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      <div class="field">
        <label>Niche</label>
        <select id="tf-niche">
          <option value="">General, all niches</option>
          ${nicheOptions}
        </select>
        <div class="hint">If this is an Opener tagged to a niche, the app auto-personalizes and inserts it the first time an agent messages a prospect in that niche.</div>
      </div>
      <div class="field">
        <label>Message</label>
        <textarea id="tf-body" style="min-height:120px;">${esc(t.body || "")}</textarea>
        <div class="hint">Use {{business_name}}, {{area_clause}}, {{gap_clause}}, {{agent_name}} to auto-fill per prospect, or [Name]/[Business] as manual placeholders if you'd rather personalise by hand.</div>
      </div>
      <div class="field">
        <label>Live Preview</label>
        <div class="card" id="tf-preview" style="font-size:13px;line-height:1.5;white-space:pre-wrap;"></div>
        <div class="hint" id="tf-preview-source"></div>
      </div>
      <button class="btn btn-primary" id="tf-save">${isEdit ? "Save Changes" : "Add Template"}</button>
      ${isEdit ? `<button class="btn btn-danger" id="tf-delete" style="margin-top:10px;">Delete Template</button>` : ""}
    </div>
  `);

  // Renders the body against a real prospect wherever possible, so a broken
  // or mistyped {{token}} shows up as literal text right away instead of
  // only being caught the first time an agent actually sends it. Prefers a
  // prospect matching the currently-selected niche (since that's who the
  // template will actually go to), falls back to any loaded prospect, and
  // finally to a made-up sample so the preview still means something for a
  // brand-new org with no prospects yet.
  function updatePreview() {
    const body = box.querySelector("#tf-body").value;
    const nicheId = box.querySelector("#tf-niche").value;
    const sample =
      (nicheId && store.prospects.find((p) => p.niche_id === nicheId)) ||
      store.prospects[0] ||
      { business_name: "Ace Cafe", area: "Borrowdale", gap_note: "" };
    const agentFirst = (store.profile?.full_name || "").trim().split(/\s+/)[0] || "";
    const previewEl = box.querySelector("#tf-preview");
    const sourceEl = box.querySelector("#tf-preview-source");
    if (!body.trim()) {
      previewEl.textContent = "Type a message above to see it personalised.";
      sourceEl.textContent = "";
      return;
    }
    previewEl.textContent = personalizeMessage(body, sample, agentFirst);
    sourceEl.textContent = `Previewed using "${sample.business_name}"${store.prospects.length ? "" : " (sample, no real prospects loaded yet)"}.`;
  }
  box.querySelector("#tf-body").addEventListener("input", updatePreview);
  box.querySelector("#tf-niche").addEventListener("change", updatePreview);
  updatePreview();

  box.querySelector("#tf-save").addEventListener("click", async () => {
    const title = box.querySelector("#tf-title").value.trim();
    const body = box.querySelector("#tf-body").value.trim();
    if (!title || !body) return toast("Title and message are required", "error");
    const payload = {
      title,
      body,
      category: box.querySelector("#tf-cat").value,
      niche_id: box.querySelector("#tf-niche").value || null,
      updated_by: store.profile.id,
    };

    if (isEdit) {
      const { error } = await sb.from("message_templates").update(payload).eq("id", t.id);
      if (error) return toast(error.message, "error");
    } else {
      payload.sort_order = store.templates.length + 1;
      const { error } = await sb.from("message_templates").insert(payload);
      if (error) return toast(error.message, "error");
    }
    toast("Saved", "success");
    closeSheet();
    await refreshTemplates();
  });

  const delBtn = box.querySelector("#tf-delete");
  if (delBtn) delBtn.addEventListener("click", () => {
    confirmModal({
      title: "Delete this template?",
      body: `<b>${esc(t.title)}</b> will be removed for the whole team.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        const { error } = await sb.from("message_templates").delete().eq("id", t.id);
        if (error) toast(error.message, "error");
        else { toast("Template deleted", "success"); closeSheet(); await refreshTemplates(); }
      },
    });
  });

  openSheet(isEdit ? "Edit Template" : "New Template", box);
}

// Lets another view (e.g. the niche template-coverage flag) open a *new*
// template pre-filled with a category/niche, without it being mistaken for
// editing an existing one — openTemplateForm only treats an object with a
// real `id` as edit mode.
export function openNewTemplateForm(prefill) {
  openTemplateForm(prefill || null);
}

async function refreshTemplates() {
  const { data } = await sb.from("message_templates").select("*").order("sort_order");
  store.templates = data || [];
  renderMessages();
}

export function initMessagesView() {
  on("templates", () => { if (isActive()) renderMessages(); });
}
function isActive() {
  return document.getElementById("view-messages")?.classList.contains("active");
}
