import { sb } from "../supabaseClient.js";
import { store, on, profileById, nicheById, nicheDotHTML, loadNotesFor, loadMessagesFor } from "../state.js";
import { el, esc, avatarHTML, statusLabel, fmtDateTime, money, todayISO, buildWhatsAppLink, personalizeMessage, toast, downloadReminderICS, downloadVCard } from "../utils.js";
import { openSheet, closeSheet, confirmModal, openModal, closeModal } from "../ui.js";
import { buildProspectForm } from "./prospectForm.js";
import { openDealPricingCalculator } from "./dealPricing.js";
import { notify } from "../push.js";
import { canSendFreeform, sendWhatsAppMessage } from "../whatsapp.js";

const STATUSES = ["not_contacted", "sent", "replied", "meeting_booked", "signed", "dead"];

// Every "why did this die" reason is stored as a plain prospect_notes row
// with this marker prefix — same trick the Deal Pricing Calculator's quote
// log (dealPricing.js's QUOTE_MARKER) and the "Assign to me" flow already
// use to smuggle structured data through an existing table instead of a
// schema migration. Pipeline Value's "Lost Reasons" breakdown reads these
// back out by prefix match.
export const LOST_REASON_MARKER = "🪦 Lost reason:";
const LOST_REASONS = ["Price too high", "Went quiet / no reply", "Chose a competitor", "Not a good fit", "Bad timing"];

export function openProspectDetail(prospectIn) {
  render(prospectIn);
}

function currentProspect(id) {
  return store.prospects.find((p) => p.id === id);
}

// prospectForm.js's placeholder ("www.business.co.zw") makes clear the
// website field is saved without a protocol most of the time — an <a href>
// without one resolves relative to the app itself instead of opening the
// site, so this adds https:// only when a protocol isn't already there.
function websiteHref(website) {
  const w = (website || "").trim();
  const lower = w.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://") ? w : "https://" + w;
}

function render(p0) {
  const p = currentProspect(p0.id) || p0;
  const niche = nicheById(p.niche_id);
  const assignee = profileById(p.assigned_to);
  const isMine = p.assigned_to === store.profile?.id;
  const isOwner = store.profile?.role === "owner";

  // "Business Ops" used to only offer *create* buttons once a prospect was
  // signed — there was no way to see contracts/invoices/projects that
  // already exist for them without leaving the sheet and searching three
  // separate list views. Now it also lists whatever's already linked, so a
  // rep can check billing/delivery status without ever leaving this card.
  const linkedContracts = (store.contracts || []).filter((c) => c.prospect_id === p.id);
  const linkedInvoices = (store.invoices || []).filter((i) => i.prospect_id === p.id);
  const linkedProjects = (store.projects || []).filter((pr) => pr.prospect_id === p.id);
  const hasBizOpsRecords = linkedContracts.length || linkedInvoices.length || linkedProjects.length;
  // Invoices' "Top Clients by Revenue" already totals this org-wide, but the
  // one screen where someone's actually looking at a single client never
  // added it up locally — you'd have to eyeball each invoice row in the list
  // below and do the math yourself. Paid only (not sent/overdue) since this
  // is meant to answer "what have they actually paid us," not what's billed.
  const lifetimeValue = linkedInvoices.filter((i) => i.status === "paid").reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const showBizOps = p.status === "signed" || hasBizOpsRecords;
  const today = todayISO();

  const box = el(`<div></div>`);

  // Only offer active team members for a *new* assignment, but if this
  // prospect is already assigned to someone whose access has since been
  // removed, still show that option (labeled) so it doesn't silently
  // disappear from the dropdown — the owner can see it and reassign away.
  const teamOptions = store.profiles
    .filter((pr) => pr.active !== false || p.assigned_to === pr.id)
    .map((pr) => `<option value="${pr.id}" ${p.assigned_to === pr.id ? "selected" : ""}>${esc(pr.full_name || pr.email)}${pr.active === false ? " (removed)" : ""}</option>`)
    .join("");

  box.innerHTML = `
    <div class="flex-between" style="margin-bottom:6px;">
      <span class="tier-pill ${p.tier}">TIER ${p.tier}</span>
      <span class="status-pill ${p.status}">${statusLabel(p.status)}</span>
    </div>
    <div style="font-size:19px;font-weight:800;margin-bottom:2px;">${esc(p.business_name)}</div>
    <div class="text-faint" style="font-size:12.5px;margin-bottom:14px;">${nicheDotHTML(niche)}${esc(niche?.name || "No niche")}${p.area ? " · " + esc(p.area) : ""}${p.rating ? " · ★" + p.rating : ""}</div>

    <div id="pd-ai-section"></div>

    <div class="card" style="margin-bottom:14px;">
      <div class="flex-between mt-0" style="margin-bottom:2px;">
        <div class="section-title mt-0" style="margin-bottom:0;">Contact</div>
        ${p.whatsapp_number || p.email ? `<span class="small-link" id="pd-save-contact">Save Contact</span>` : ""}
      </div>
      <div style="font-size:13.5px;line-height:2;">
        ${p.whatsapp_number ? `<div>📱 ${esc(p.whatsapp_number)}</div>` : ""}
        ${p.email ? `<div>✉️ ${esc(p.email)}</div>` : ""}
        ${p.instagram ? `<div>📸 ${esc(p.instagram)}</div>` : ""}
        ${p.website ? `<div>🌐 <a href="${esc(websiteHref(p.website))}" target="_blank" rel="noopener">${esc(p.website)}</a></div>` : ""}
        ${!p.whatsapp_number && !p.email && !p.instagram && !p.website ? `<div class="text-faint">No contact details saved</div>` : ""}
      </div>
    </div>

    <div id="pd-wa-section"></div>

    ${p.gap_note ? `<div class="section-title mt-0">Gap / Observation</div><div class="card" style="margin-bottom:14px;font-size:13.5px;line-height:1.5;">${esc(p.gap_note)}</div>` : ""}

    <div class="btn-block-row" style="margin-bottom:10px;">
      <button class="btn btn-whatsapp" id="pd-wa">Send WhatsApp</button>
      <button class="btn btn-ghost" id="pd-edit" style="width:auto;flex:0 0 auto;padding-left:16px;padding-right:16px;">Edit</button>
    </div>
    <button class="btn btn-gold" id="pd-price" style="margin-bottom:14px;">💰 Price This Deal</button>

    ${showBizOps ? `
      <div class="flex-between" style="align-items:baseline;">
        <div class="section-title mt-0">Business Ops</div>
        ${hasBizOpsRecords ? `<span class="small-link" id="pd-print-statement">Print Statement</span>` : ""}
      </div>
      ${lifetimeValue > 0 ? `<div class="text-gold" style="font-size:12px;font-weight:700;margin:-2px 0 8px;">${money(lifetimeValue)} collected to date</div>` : ""}
      ${hasBizOpsRecords ? `
        <div class="card" style="margin-bottom:10px;" id="pd-bizops-list">
          ${linkedContracts.map((c, idx) => `
            <div class="flex-between pd-bizop-row" data-kind="contract" data-id="${c.id}" style="padding:6px 0;cursor:pointer;${idx > 0 ? "border-top:1px solid var(--line);" : ""}">
              <span style="font-size:13px;">📄 ${esc(c.title || "Contract")}${c.value ? " · " + money(c.value) : ""}</span>
              <span class="status-pill ${c.status}" style="font-size:9.5px;">${(c.status || "").replace("_", " ")}</span>
            </div>`).join("")}
          ${linkedInvoices.map((i, idx) => {
            const isOverdue = i.status === "sent" && i.due_date && i.due_date < today;
            return `
            <div class="flex-between pd-bizop-row" data-kind="invoice" data-id="${i.id}" style="padding:6px 0;cursor:pointer;${idx > 0 || linkedContracts.length ? "border-top:1px solid var(--line);" : ""}">
              <span style="font-size:13px;">🧾 ${esc(i.invoice_number || "Invoice")} · ${money(i.amount)}</span>
              ${isOverdue ? `<span class="status-pill dead" style="font-size:9.5px;">Overdue</span>` : `<span class="status-pill ${i.status}" style="font-size:9.5px;">${(i.status || "").replace("_", " ")}</span>`}
            </div>`;
          }).join("")}
          ${linkedProjects.map((pr, idx) => `
            <div class="flex-between pd-bizop-row" data-kind="project" data-id="${pr.id}" style="padding:6px 0;cursor:pointer;${idx > 0 || linkedContracts.length || linkedInvoices.length ? "border-top:1px solid var(--line);" : ""}">
              <span style="font-size:13px;">📁 ${esc(pr.name || "Project")}</span>
              <span class="status-pill ${pr.status}" style="font-size:9.5px;">${(pr.status || "").replace("_", " ")}</span>
            </div>`).join("")}
        </div>
      ` : ""}
      ${p.status === "signed" ? `
        <div class="btn-block-row" style="margin-bottom:14px;">
          <button class="btn btn-ghost btn-sm" id="pd-new-contract">Contract</button>
          <button class="btn btn-ghost btn-sm" id="pd-new-invoice">Invoice</button>
          <button class="btn btn-ghost btn-sm" id="pd-new-project">Project</button>
        </div>
      ` : ""}
    ` : ""}

    <div class="section-title mt-0">Status</div>
    <div class="field" style="margin-bottom:14px;">
      <select id="pd-status">
        ${STATUSES.map((s) => `<option value="${s}" ${p.status === s ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}
      </select>
    </div>

    <div class="section-title mt-0">Assigned To</div>
    <div class="card" style="margin-bottom:14px;">
      ${assignee ? `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          ${avatarHTML(assignee.full_name || assignee.email, assignee.avatar_url, 26, 11)}
          <span style="font-size:13.5px;font-weight:600;">${esc(assignee.full_name || assignee.email)}</span>
        </div>` : `<div class="text-faint" style="font-size:13px;margin-bottom:10px;">Unassigned, up for grabs</div>`}
      ${isOwner ? `
        <select id="pd-assign">
          <option value="">Unassigned</option>
          ${teamOptions}
        </select>
      ` : (!p.assigned_to ? `<button class="btn btn-ghost btn-sm" id="pd-claim">Take This Prospect</button>` :
           (isMine ? `<button class="btn btn-ghost btn-sm" id="pd-release">Release Prospect</button>` : ""))}
    </div>

    <div class="section-title mt-0">Follow-up</div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
      <div class="field" style="margin-bottom:0;flex:1;">
        <input id="pd-followup" type="date" value="${p.follow_up_date || ""}" />
      </div>
      <button class="btn btn-ghost btn-sm" id="pd-followup-ics" style="flex:0 0 auto;width:auto;${p.follow_up_date ? "" : "display:none;"}">+ Calendar</button>
    </div>

    <div class="section-title">Status Timeline</div>
    <div id="pd-timeline" class="timeline" style="margin-bottom:10px;"><div class="text-faint" style="font-size:12.5px;">Loading...</div></div>

    <div class="section-title">Notes</div>
    <div id="pd-notes" style="margin-bottom:10px;"><div class="text-faint" style="font-size:12.5px;">Loading...</div></div>
    <div class="field">
      <textarea id="pd-note-input" placeholder="Leave an update for the team..." style="min-height:56px;"></textarea>
    </div>
    <button class="btn btn-ghost" id="pd-note-send" style="margin-bottom:16px;">Post Note</button>

    ${isOwner ? `<button class="btn btn-danger" id="pd-delete">Delete Prospect</button>` : ""}
  `;

  // -- wire actions --
  box.querySelector("#pd-wa").addEventListener("click", async () => {
    const { sendWhatsApp } = await import("./pipeline.js");
    sendWhatsApp(currentProspect(p.id) || p);
  });

  const saveContactBtn = box.querySelector("#pd-save-contact");
  if (saveContactBtn) {
    saveContactBtn.addEventListener("click", () => {
      const cur = currentProspect(p.id) || p;
      downloadVCard(`${(cur.business_name || "contact").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.vcf`, {
        name: cur.business_name,
        phone: cur.whatsapp_number,
        email: cur.email,
        note: [niche?.name, cur.area].filter(Boolean).join(" · "),
      });
      toast("Contact file downloaded", "success");
    });
  }

  box.querySelector("#pd-edit").addEventListener("click", () => {
    const form = buildProspectForm(currentProspect(p.id) || p, () => {});
    openSheet("Edit Prospect", form, { onClose: () => render(currentProspect(p.id) || p) });
  });

  box.querySelector("#pd-price").addEventListener("click", () => {
    openDealPricingCalculator(currentProspect(p.id) || p);
  });

  const newContractBtn = box.querySelector("#pd-new-contract");
  if (newContractBtn) newContractBtn.addEventListener("click", async () => {
    const { openNewContractSheet } = await import("./contracts.js");
    openNewContractSheet(currentProspect(p.id) || p);
  });
  const newInvoiceBtn = box.querySelector("#pd-new-invoice");
  if (newInvoiceBtn) newInvoiceBtn.addEventListener("click", async () => {
    const { openNewInvoiceSheet } = await import("./invoices.js");
    openNewInvoiceSheet(currentProspect(p.id) || p);
  });
  const newProjectBtn = box.querySelector("#pd-new-project");
  if (newProjectBtn) newProjectBtn.addEventListener("click", async () => {
    const { openNewProjectSheet } = await import("./projects.js");
    openNewProjectSheet(currentProspect(p.id) || p);
  });

  const printStatementBtn = box.querySelector("#pd-print-statement");
  if (printStatementBtn) printStatementBtn.addEventListener("click", async () => {
    const { printClientStatement } = await import("../printDoc.js");
    printClientStatement(currentProspect(p.id) || p);
  });

  box.querySelectorAll(".pd-bizop-row").forEach((row) => {
    row.addEventListener("click", async () => {
      const { kind, id } = row.dataset;
      if (kind === "contract") {
        const c = store.contracts.find((x) => x.id === id);
        if (!c) return;
        const { openContractSheet } = await import("./contracts.js");
        openContractSheet(c);
      } else if (kind === "invoice") {
        const i = store.invoices.find((x) => x.id === id);
        if (!i) return;
        const { openInvoiceSheet } = await import("./invoices.js");
        openInvoiceSheet(i);
      } else if (kind === "project") {
        const pr = store.projects.find((x) => x.id === id);
        if (!pr) return;
        const { openProjectDetail: openProjDetail } = await import("./projects.js");
        openProjDetail(pr);
      }
    });
  });

  box.querySelector("#pd-status").addEventListener("change", async (e) => {
    const newStatus = e.target.value;
    const wasSigned = p.status === "signed";
    const { error } = await sb.from("prospects").update({ status: newStatus }).eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast("Status updated", "success");

    if (newStatus === "signed" && !wasSigned) {
      const already = store.contracts?.some((c) => c.prospect_id === p.id);
      if (!already) {
        const fresh = currentProspect(p.id) || p;
        confirmModal({
          title: "Draft a contract?",
          body: `<b>${esc(fresh.business_name)}</b> just moved to Signed. Want to auto-draft a contract for them now?`,
          confirmLabel: "Draft Contract",
          onConfirm: async () => {
            const { openNewContractSheet } = await import("./contracts.js");
            openNewContractSheet(fresh);
          },
        });
      }
    }

    if (newStatus === "dead" && p.status !== "dead") {
      promptLostReason(currentProspect(p.id) || p);
    }
  });

  box.querySelector("#pd-followup").addEventListener("change", async (e) => {
    const { error } = await sb.from("prospects").update({ follow_up_date: e.target.value || null }).eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast("Follow-up date set", "success");
    const icsBtn = box.querySelector("#pd-followup-ics");
    if (icsBtn) icsBtn.style.display = e.target.value ? "" : "none";
  });

  const followupIcsBtn = box.querySelector("#pd-followup-ics");
  if (followupIcsBtn) {
    followupIcsBtn.addEventListener("click", () => {
      const dateISO = box.querySelector("#pd-followup").value;
      if (!dateISO) return;
      downloadReminderICS(`follow-up-${p.business_name.replace(/[^\w]+/g, "-").toLowerCase()}.ics`, {
        title: `Follow up: ${p.business_name}`,
        description: `Agency Command follow-up reminder for ${p.business_name}${p.area ? ` (${p.area})` : ""}.`,
        dateISO,
      });
      toast("Calendar file downloaded", "success");
    });
  }

  const assignSel = box.querySelector("#pd-assign");
  if (assignSel) {
    assignSel.addEventListener("change", async () => {
      const newAgentId = assignSel.value || null;
      const { error } = await sb.from("prospects").update({ assigned_to: newAgentId }).eq("id", p.id);
      if (error) return toast(error.message, "error");
      if (newAgentId) notify("assigned", p.id, newAgentId);
    });
  }
  const claimBtn = box.querySelector("#pd-claim");
  if (claimBtn) claimBtn.addEventListener("click", async () => {
    const { data: ok, error } = await sb.rpc("claim_prospect", { p_id: p.id });
    if (error) return toast(error.message, "error");
    if (!ok) return toast("Someone already claimed this prospect", "error");
    toast("Prospect assigned to you", "success");
  });
  const releaseBtn = box.querySelector("#pd-release");
  if (releaseBtn) releaseBtn.addEventListener("click", async () => {
    const { error } = await sb.from("prospects").update({ assigned_to: null }).eq("id", p.id);
    if (error) toast(error.message, "error");
  });

  box.querySelector("#pd-note-send").addEventListener("click", async () => {
    const input = box.querySelector("#pd-note-input");
    const body = input.value.trim();
    if (!body) return;
    const { error } = await sb.from("prospect_notes").insert({ prospect_id: p.id, author_id: store.profile.id, body });
    if (error) return toast(error.message, "error");
    input.value = "";
    loadNotesFor(p.id);
  });

  const delBtn = box.querySelector("#pd-delete");
  if (delBtn) delBtn.addEventListener("click", () => {
    confirmModal({
      title: "Delete this prospect?",
      body: `This permanently removes <b>${esc(p.business_name)}</b> and its notes. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        const { error } = await sb.from("prospects").delete().eq("id", p.id);
        if (error) toast(error.message, "error");
        else { toast("Prospect deleted", "success"); closeSheet(); }
      },
    });
  });

  renderAISection(box, p);
  renderWhatsAppSection(box, p);

  openSheet(p.business_name, box);
  loadTimeline(p.id);
  renderNotes(p.id);
  loadNotesFor(p.id).then(() => renderNotes(p.id));
  if (p.whatsapp_last_inbound_at) loadMessagesFor(p.id).then(() => renderWhatsAppThread(p.id));

  const offNotes = on("notes:" + p.id, () => renderNotes(p.id));
  const offWhatsApp = on("whatsapp:" + p.id, () => renderWhatsAppThread(p.id));
  const offProspects = on("prospects", () => {
    const fresh = currentProspect(p.id);
    if (fresh) {
      const statusSel = document.getElementById("pd-status");
      if (statusSel && statusSel.value !== fresh.status) statusSel.value = fresh.status;
      renderAISection(box, fresh);
      renderWhatsAppSection(box, fresh);
    }
  });
  document.getElementById("sheet")._onClose = () => { offNotes(); offWhatsApp(); offProspects(); };
}

// The "AI Research" + "Message" cards live in their own container so they
// can be refreshed in place (via Realtime, or after tapping Regenerate)
// without re-rendering — and losing focus on — the rest of the sheet.
function renderAISection(box, p) {
  const wrap = box.querySelector("#pd-ai-section");
  if (!wrap) return;

  const agentFirst = store.profile?.full_name?.split(" ")[0];
  const preview = p.outreach_message ? personalizeMessage(p.outreach_message, p, agentFirst) : "";
  const researching = p.research_status === "researching";
  const isAutoTemplate = p.message_source === "auto_template";
  const hasResearched = p.research_status === "done" || p.research_status === "failed";

  wrap.innerHTML = `
    ${preview ? `
      <div class="card" style="margin-bottom:14px;">
        <div class="flex-between" style="margin-bottom:6px;">
          <div class="section-title mt-0" style="margin-bottom:0;">Message</div>
          ${p.message_source === "ai_generated" ? `<span class="text-faint" style="font-size:11px;">AI-GENERATED</span>` : ""}
        </div>
        ${isAutoTemplate ? `<div class="conflict-flag" style="display:inline-block;margin-bottom:8px;background:rgba(212,175,55,0.15);color:#d4af37;">AUTO-TEMPLATE: REVIEW BEFORE SENDING</div>` : ""}
        <div style="font-size:13.5px;line-height:1.5;white-space:pre-wrap;">${esc(preview)}</div>
      </div>
    ` : ""}

    ${researching ? `
      <div class="card" style="margin-bottom:14px;">
        <div class="section-title mt-0">AI Research</div>
        <div class="text-faint" style="font-size:12.5px;">Researching this business online. This usually takes under a minute. Reopen this card shortly.</div>
      </div>
    ` : hasResearched ? `
      <div class="card" style="margin-bottom:14px;">
        <div class="flex-between" style="margin-bottom:6px;">
          <div class="section-title mt-0" style="margin-bottom:0;">AI Research</div>
          <span class="small-link" id="pd-regenerate">Regenerate</span>
        </div>
        <div class="text-faint" style="font-size:13px;line-height:1.5;">${esc(p.research_summary || (p.research_status === "failed" ? "AI research couldn't complete for this business, try again." : "No summary saved."))}</div>
      </div>
    ` : `
      <div class="card" style="margin-bottom:14px;">
        <div class="flex-between" style="margin-bottom:6px;">
          <div class="section-title mt-0" style="margin-bottom:0;">AI Research</div>
          <span class="small-link" id="pd-regenerate">Research this business</span>
        </div>
        <div class="text-faint" style="font-size:12.5px;">No research run yet for this prospect.</div>
      </div>
    `}
  `;

  const regenBtn = wrap.querySelector("#pd-regenerate");
  if (regenBtn) {
    regenBtn.addEventListener("click", async () => {
      regenBtn.textContent = "Researching…";
      regenBtn.style.pointerEvents = "none";
      const { error } = await sb.functions.invoke("research-prospect", { body: { prospect_id: p.id } });
      if (error) {
        toast(error.message || "Couldn't start research", "error");
        regenBtn.textContent = "Regenerate";
        regenBtn.style.pointerEvents = "";
      } else {
        toast("Researching this business online...", "success");
      }
    });
  }
}

// Sits right below the Contact card, alongside the cold-open "Send
// WhatsApp" button above. Renders nothing at all until a prospect has
// actually replied on WhatsApp at least once (whatsapp_last_inbound_at is
// null) — before that, the cold-open button is the only way to reach them,
// exactly as it always has been. Once they've replied, this shows the real
// two-way thread, with a reply box only while still inside WhatsApp's
// 24-hour customer-service window (canSendFreeform) — outside it, the
// thread is still shown (so history isn't lost), just read-only, pointing
// back at the cold-open button to re-open the conversation.
function renderWhatsAppSection(box, p) {
  const wrap = box.querySelector("#pd-wa-section");
  if (!wrap) return;

  if (!p.whatsapp_last_inbound_at) {
    wrap.innerHTML = "";
    return;
  }

  const canReply = canSendFreeform(p);
  wrap.innerHTML = `
    <div class="card" style="margin-bottom:14px;">
      <div class="section-title mt-0">WhatsApp Conversation</div>
      <div id="pd-wa-thread" style="max-height:280px;overflow-y:auto;margin-bottom:10px;"><div class="text-faint" style="font-size:12.5px;">Loading...</div></div>
      ${canReply ? `
        <div class="field" style="margin-bottom:8px;">
          <textarea id="pd-wa-input" placeholder="Type a reply..." style="min-height:44px;"></textarea>
        </div>
        <button class="btn btn-whatsapp" id="pd-wa-send">Send</button>
      ` : `
        <div class="text-faint" style="font-size:12px;">It's been more than 24 hours since they last messaged. WhatsApp requires them to message first before you can reply here again. Use the Send WhatsApp button above to reach out.</div>
      `}
    </div>
  `;

  const sendBtn = wrap.querySelector("#pd-wa-send");
  if (sendBtn) {
    sendBtn.addEventListener("click", async () => {
      const input = wrap.querySelector("#pd-wa-input");
      const body = input.value.trim();
      if (!body) return;
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending...";
      const { data, error } = await sendWhatsAppMessage(p.id, body);
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
      if (error || data?.error) {
        toast(error?.message || data?.error || "Couldn't send that message", "error");
        return;
      }
      input.value = "";
    });
  }

  renderWhatsAppThread(p.id);
}

// Bubble-style thread, same visual language as Copilot's chat bubbles
// (inbound left/neutral, outbound right/purple) — kept as a plain HTML
// string like renderNotes below rather than DOM nodes since it only ever
// needs a full re-render, never per-message patching.
function renderWhatsAppThread(prospectId) {
  const threadEl = document.getElementById("pd-wa-thread");
  if (!threadEl) return;
  const messages = store.messagesByProspect[prospectId] || [];
  if (!messages.length) {
    threadEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;">No messages yet.</div>`;
    return;
  }
  threadEl.innerHTML = messages
    .map((m) => {
      const isOut = m.direction === "outbound";
      const statusNote = isOut && m.status ? ` · ${m.status}` : "";
      return `<div style="display:flex;${isOut ? "justify-content:flex-end;" : "justify-content:flex-start;"}margin-bottom:8px;">
        <div style="max-width:82%;padding:8px 11px;border-radius:var(--radius-sm);font-size:13px;line-height:1.4;white-space:pre-wrap;
          ${isOut ? "background:var(--purple);color:#fff;" : "background:var(--black-card);border:1px solid var(--line);color:var(--text);"}">
          ${esc(m.body)}
          <div style="font-size:10px;opacity:0.7;margin-top:4px;">${fmtDateTime(m.created_at)}${statusNote}</div>
        </div>
      </div>`;
    })
    .join("");
  threadEl.scrollTop = threadEl.scrollHeight;
}

async function loadTimeline(prospectId) {
  const { data } = await sb
    .from("status_history")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("changed_at", { ascending: false });
  const timelineEl = document.getElementById("pd-timeline");
  if (!timelineEl) return;
  if (!data || !data.length) {
    timelineEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;">No status changes yet.</div>`;
    return;
  }
  timelineEl.innerHTML = data
    .map((h) => {
      const who = profileById(h.changed_by);
      return `<div class="timeline-item">
        <div class="t-msg">${esc(who?.full_name || "Someone")} moved to <b>${statusLabel(h.new_status)}</b></div>
        <div class="t-time">${fmtDateTime(h.changed_at)}</div>
      </div>`;
    })
    .join("");
}

function renderNotes(prospectId) {
  const notesEl = document.getElementById("pd-notes");
  if (!notesEl) return;
  const notes = store.notesByProspect[prospectId] || [];
  if (!notes.length) {
    notesEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;">No notes yet. Be the first to leave an update.</div>`;
    return;
  }
  notesEl.innerHTML = notes
    .map((n) => {
      const author = profileById(n.author_id);
      return `<div class="note-item">
        <div class="n-head"><b>${esc(author?.full_name || "Someone")}</b><span>${fmtDateTime(n.created_at)}</span></div>
        <div class="n-body">${esc(n.body)}</div>
      </div>`;
    })
    .join("");
}

// Fires right after a prospect is moved to Dead — a one-tap reason picker
// so the "why" isn't lost the moment the deal is. Saved as a plain
// prospect_notes row (see LOST_REASON_MARKER above) so it shows up in this
// prospect's own Notes tab too, not just the Pipeline Value rollup.
async function saveLostReason(prospectId, reasonText) {
  const { error } = await sb
    .from("prospect_notes")
    .insert({ prospect_id: prospectId, author_id: store.profile.id, body: `${LOST_REASON_MARKER} ${reasonText}` });
  if (error) return toast(error.message, "error");
  toast("Reason saved", "success");
  loadNotesFor(prospectId);
  closeModal();
}

function promptLostReason(prospect) {
  const box = el(`
    <div>
      <div class="section-title mt-0">Why did this one die?</div>
      <div class="hint" style="margin:0 2px 12px;">Optional, but it's the only way "Lost Reasons" on Pipeline Value ever gets useful. Tap the backdrop to skip.</div>
      <div class="chip-row" id="pd-lost-chips" style="flex-wrap:wrap;overflow:visible;"></div>
      <div class="field" style="margin-top:4px;">
        <label>Other reason</label>
        <textarea id="pd-lost-other" rows="2" placeholder="Type a reason and save…"></textarea>
      </div>
      <button class="btn btn-ghost" id="pd-lost-other-save">Save Other Reason</button>
    </div>
  `);
  const chipRow = box.querySelector("#pd-lost-chips");
  LOST_REASONS.forEach((reason) => {
    const chip = el(`<span class="chip">${esc(reason)}</span>`);
    chip.addEventListener("click", () => saveLostReason(prospect.id, reason));
    chipRow.appendChild(chip);
  });
  box.querySelector("#pd-lost-other-save").addEventListener("click", () => {
    const text = box.querySelector("#pd-lost-other").value.trim();
    if (!text) return;
    saveLostReason(prospect.id, `Other: ${text}`);
  });
  openModal(box);
}
