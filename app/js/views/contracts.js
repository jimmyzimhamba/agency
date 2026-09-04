import { sb } from "../supabaseClient.js";
import { store, on, prospectById, profileById, firstOfMonth } from "../state.js";
import { el, esc, money, fmtDate, todayISO, toast, toCSV, downloadTextFile, buildWhatsAppLink } from "../utils.js";
import { openSheet, closeSheet, confirmModal, openModal, closeModal } from "../ui.js";
import { printContract } from "../printDoc.js";
import { nextInvoiceNumber } from "./invoices.js";

const STATUS_LABELS = { draft: "Draft", sent: "Sent", signed: "Signed", void: "Void" };
const STATUSES = ["draft", "sent", "signed", "void"];

let filterStatus = "all";

// A contract sitting in "sent" status for a while with no nudge is easy to
// lose track of — invoices already flag overdue payments the same way, but
// contracts had nothing equivalent. 5 days mirrors a reasonable "should have
// heard back by now" window without being noisy about brand-new sends.
const STALE_DAYS = 5;
function daysSinceSent(c) {
  if (!c.sent_date) return 0;
  return Math.floor((new Date(todayISO() + "T00:00:00") - new Date(c.sent_date + "T00:00:00")) / 86400000);
}
function isStale(c) {
  return c.status === "sent" && c.sent_date && daysSinceSent(c) >= STALE_DAYS;
}

// Mirrors Invoices' "Avg. Days to Get Paid" and Projects' "Avg. Delivery
// Time" — Contracts had a per-contract staleness flag but no aggregate on
// the team's typical sales-cycle speed (send-to-signature). Only counts
// contracts with both dates set, same "skip incomplete data" convention as
// those other two averages.
function daysToSign(c) {
  return Math.round((new Date(c.signed_date + "T00:00:00") - new Date(c.sent_date + "T00:00:00")) / 86400000);
}
function contractsWithSignTime() {
  return store.contracts.filter((c) => c.status === "signed" && c.sent_date && c.signed_date);
}
function avgDaysToSign() {
  const withDates = contractsWithSignTime();
  if (!withDates.length) return null;
  return Math.round(withDates.reduce((sum, c) => sum + daysToSign(c), 0) / withDates.length);
}

// Avg. Days to Sign covers speed; "Value Signed This Month" covers a single
// month's total — neither tells a rep what a typical closed deal is actually
// worth, so there's no benchmark for "is this new contract big or small for
// us." Only counts signed contracts with a real value, same "skip incomplete
// data" convention as avgDaysToSign above.
function signedContractsWithValue() {
  return store.contracts.filter((c) => c.status === "signed" && Number(c.value) > 0);
}
function avgDealSize() {
  const withValue = signedContractsWithValue();
  if (!withValue.length) return null;
  return withValue.reduce((sum, c) => sum + Number(c.value), 0) / withValue.length;
}

// Contracts carry a 'void' status but nothing anywhere aggregates it — a
// deal that gets drafted/sent and then falls through is a materially
// different signal than one that never got sent, and today it's invisible
// unless someone manually clicks the "Void" filter chip and counts by eye.
// Only contracts that reached a *final* outcome (signed or void) count —
// a still-open draft/sent contract hasn't failed or succeeded yet.
function voidedContracts() {
  return store.contracts.filter((c) => c.status === "void");
}
function contractOutcomeTotals() {
  const signed = store.contracts.filter((c) => c.status === "signed").length;
  const voided = voidedContracts().length;
  return { signed, voided, total: signed + voided };
}

// openNewContractSheet pre-fills a new contract's value from prospect.mrr
// only once, at creation time — after that the two fields drift independently.
// Every revenue number elsewhere in the app (Dashboard's Monthly Goal /
// Projected MRR, Pipeline Value's revenue-by-niche/tier) is computed from
// prospects.mrr, not from contracts — so a renegotiated contract whose value
// no longer matches the prospect's mrr silently throws off every one of
// those numbers, with nothing surfacing it. Dashboard's existing "Zero-MRR
// Signed Prospects" check only catches mrr === 0, not "mrr disagrees with
// what was actually signed."
function mrrMismatch(c) {
  if (c.status !== "signed" || !c.prospect_id || !(c.value > 0)) return null;
  const prospect = prospectById(c.prospect_id);
  if (!prospect || Number(prospect.mrr || 0) === Number(c.value)) return null;
  return prospect;
}

// Lets Dashboard deep-link into a pre-filtered Contracts list (mirrors
// pipeline.js's setStatusFilter), instead of always landing on the
// unfiltered "All" view like the Awaiting Sig. stat card did before.
export function setContractStatusFilter(status) {
  filterStatus = status;
}

export function renderContracts() {
  const root = document.getElementById("view-contracts");
  root.innerHTML = "";

  const staleCount = store.contracts.filter(isStale).length;
  // Invoices already has "Collected This Month" (cash received); Contracts
  // had zero aggregate stats of its own. Dashboard's Projected MRR is a
  // cumulative recurring-revenue snapshot (not tied to *when* a client
  // signed), and the Leaderboard counts deals per rep with no dollar figure
  // — neither answers "how much new business did we actually close this
  // month," the natural sales-ops companion to Invoices' own monthly card.
  const signedThisMonth = store.contracts.filter((c) => c.status === "signed" && c.signed_date && c.signed_date >= firstOfMonth());
  const signedThisMonthValue = signedThisMonth.reduce((sum, c) => sum + (Number(c.value) || 0), 0);
  const withSignTime = contractsWithSignTime();
  const avgSignDays = avgDaysToSign();
  // "Awaiting Signature 5+ days" (below) is a staleness count — it tells you
  // *how many* pending contracts are stale, not what they're worth. This is
  // the value companion, covering every sent-not-signed contract regardless
  // of age, so the team can prioritize chasing the biggest deal first rather
  // than just the oldest one.
  const pendingSignature = store.contracts.filter((c) => c.status === "sent");
  const pendingSignatureValue = pendingSignature.reduce((sum, c) => sum + (Number(c.value) || 0), 0);
  const withValue = signedContractsWithValue();
  const dealSize = avgDealSize();
  const voided = voidedContracts();
  const outcomes = contractOutcomeTotals();
  const voidRatePct = outcomes.total ? Math.round((outcomes.voided / outcomes.total) * 100) : null;
  const voidCardLabel = "Void Rate — " + outcomes.voided + " of " + outcomes.total + " contracts drafted fell through";

  const wrap = el(`
    <div>
      <div class="flex-between">
        <div class="page-title mt-0">Contracts<span class="accent">.</span></div>
        <div style="display:flex;gap:14px;">
          <span class="small-link" id="ct-export-csv">Export CSV</span>
          <span class="small-link" id="ct-new">+ New Contract</span>
        </div>
      </div>
      <div class="stat-grid" style="margin-bottom:16px;">
        <div class="stat-card"><div class="num">${signedThisMonth.length}</div><div class="label">Signed This Month</div></div>
        <div class="stat-card purple" id="ct-signed-value-card" style="${signedThisMonth.length ? "cursor:pointer;" : ""}"><div class="num">${money(signedThisMonthValue)}</div><div class="label">Value Signed This Month</div></div>
      </div>
      <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
        <div class="stat-card" id="ct-avg-sign-card" style="${withSignTime.length ? "cursor:pointer;" : ""}"><div class="num">${avgSignDays === null ? "—" : avgSignDays + "d"}</div><div class="label">Avg. Days to Sign${withSignTime.length ? " — tap to see slowest" : " — no signed contracts with both dates yet"}</div></div>
      </div>
      <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
        <div class="stat-card" id="ct-avg-deal-card" style="${withValue.length ? "cursor:pointer;" : ""}"><div class="num">${dealSize === null ? "—" : money(dealSize)}</div><div class="label">Avg. Deal Size${withValue.length ? " — tap to see biggest deals" : " — no signed contracts with a value yet"}</div></div>
      </div>
      ${pendingSignature.length ? `
        <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
          <div class="stat-card purple" id="ct-pending-value-card" style="cursor:pointer;"><div class="num">${money(pendingSignatureValue)}</div><div class="label">Value Awaiting Signature — ${pendingSignature.length} contract${pendingSignature.length === 1 ? "" : "s"} sent, not yet signed</div></div>
        </div>
      ` : ""}
      ${staleCount ? `
        <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
          <div class="stat-card accent"><div class="num">${staleCount}</div><div class="label">Awaiting Signature 5+ days</div></div>
        </div>
      ` : ""}
      ${outcomes.total ? `
        <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
          <div class="stat-card ${voidRatePct >= 25 ? "accent" : ""}" id="ct-void-card" style="cursor:pointer;"><div class="num">${voidRatePct}%</div><div class="label">${esc(voidCardLabel)}</div></div>
        </div>
      ` : ""}
      <div class="chip-row" id="ct-status-chips"></div>
      <div id="ct-list"></div>
    </div>
  `);
  root.appendChild(wrap);

  wrap.querySelector("#ct-new").addEventListener("click", () => openContractSheet(null));
  wrap.querySelector("#ct-export-csv").addEventListener("click", exportContractsCSV);
  if (signedThisMonth.length) {
    wrap.querySelector("#ct-signed-value-card").addEventListener("click", () => openSignedThisMonthModal(signedThisMonth));
  }
  if (withSignTime.length) {
    wrap.querySelector("#ct-avg-sign-card").addEventListener("click", () => openSlowestToSignModal(withSignTime));
  }
  if (withValue.length) {
    wrap.querySelector("#ct-avg-deal-card").addEventListener("click", () => openDealSizeModal(withValue));
  }
  if (pendingSignature.length) {
    wrap.querySelector("#ct-pending-value-card").addEventListener("click", () => openPendingSignatureModal(pendingSignature));
  }
  if (outcomes.total) {
    wrap.querySelector("#ct-void-card").addEventListener("click", () => openVoidedModal(voided));
  }

  const chipRow = wrap.querySelector("#ct-status-chips");
  [["all", "All"], ...STATUSES.map((s) => [s, STATUS_LABELS[s]])].forEach(([val, label]) => {
    const chip = el(`<span class="chip ${filterStatus === val ? "active" : ""}">${label}</span>`);
    chip.addEventListener("click", () => { filterStatus = val; renderContracts(); });
    chipRow.appendChild(chip);
  });

  renderList(wrap.querySelector("#ct-list"));
}

function renderList(listEl) {
  if (!listEl) listEl = document.getElementById("ct-list");
  if (!listEl) return;

  let items = store.contracts.slice();
  if (filterStatus !== "all") items = items.filter((c) => c.status === filterStatus);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  listEl.innerHTML = "";
  if (!items.length) {
    listEl.appendChild(el(`
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M9 12h6M9 16h6M9 8h2"/></svg>
        <p>No contracts yet — draft one once a deal's ready to close.</p>
      </div>
    `));
    return;
  }

  items.forEach((c) => {
    const prospect = prospectById(c.prospect_id);
    const creator = profileById(c.created_by);
    const stale = isStale(c);
    const mismatchedProspect = mrrMismatch(c);
    const card = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between" style="margin-bottom:4px;">
          <div style="font-weight:700;font-size:14px;">${esc(c.title)}</div>
          ${stale ? `<span class="status-pill dead">Awaiting Signature (${daysSinceSent(c)}d)</span>` : `<span class="status-pill ${c.status}">${STATUS_LABELS[c.status] || c.status}</span>`}
        </div>
        <div class="text-faint" style="font-size:12px;margin-bottom:6px;">
          ${prospect ? esc(prospect.business_name) : "No prospect linked"}${creator ? " · " + esc(creator.full_name || creator.email) : ""}
        </div>
        <div class="flex-between">
          <span style="font-weight:700;font-size:15px;">${money(c.value)}</span>
          <span class="text-faint" style="font-size:11px;">${c.signed_date ? "Signed " + fmtDate(c.signed_date) : c.sent_date ? "Sent " + fmtDate(c.sent_date) : "Drafted " + fmtDate(c.created_at)}</span>
        </div>
        ${mismatchedProspect ? `<div class="status-pill stale" style="margin-top:8px;width:100%;text-align:center;">MRR mismatch: contract ${money(c.value)} vs profile ${money(mismatchedProspect.mrr || 0)}</div>` : ""}
        ${stale && prospect?.whatsapp_number ? `<button class="btn btn-ghost btn-sm" data-action="nudge" style="margin-top:8px;width:100%;">Send Signature Reminder</button>` : ""}
      </div>
    `);
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-action='nudge']")) return;
      openContractSheet(c);
    });
    const nudgeBtn = card.querySelector("[data-action='nudge']");
    if (nudgeBtn) {
      nudgeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        sendContractWhatsApp(c, prospect, { nudge: true });
      });
    }
    listEl.appendChild(card);
  });
}

// Drill-down for "Value Awaiting Signature" — same click-through pattern as
// openSignedThisMonthModal below, sorted highest-value-first so the biggest
// deal still waiting on a signature stands out.
function openPendingSignatureModal(contracts) {
  const rows = contracts.slice().sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Value Awaiting Signature</div>
      <div id="ct-pending-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#ct-pending-list");
  rows.forEach((c) => {
    const prospect = prospectById(c.prospect_id);
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(prospect?.business_name || c.title)}</div>
            <div class="text-faint" style="font-size:11px;">${esc(c.title)}${c.sent_date ? " · Sent " + fmtDate(c.sent_date) : ""}</div>
          </div>
          <span style="font-weight:700;font-size:14px;">${money(c.value)}</span>
        </div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openContractSheet(c);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

// Drill-down for the "Value Signed This Month" stat card — same
// click-through modal-list pattern invoices.js already established for its
// own stat cards (openOutstandingByClientModal / openSlowestPayersModal).
// Sorted highest-value-first so the biggest deal of the month stands out.
function openSignedThisMonthModal(contracts) {
  const rows = contracts.slice().sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Signed This Month</div>
      <div id="ct-signed-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#ct-signed-list");
  rows.forEach((c) => {
    const prospect = prospectById(c.prospect_id);
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(prospect?.business_name || c.title)}</div>
            <div class="text-faint" style="font-size:11px;">${esc(c.title)} · Signed ${fmtDate(c.signed_date)}</div>
          </div>
          <span style="font-weight:700;font-size:14px;">${money(c.value)}</span>
        </div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openContractSheet(c);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

function openSlowestToSignModal(contracts) {
  const rows = contracts.slice().sort((a, b) => daysToSign(b) - daysToSign(a));
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Slowest to Sign</div>
      <div id="ct-slowsign-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#ct-slowsign-list");
  rows.forEach((c) => {
    const prospect = prospectById(c.prospect_id);
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(prospect?.business_name || c.title)}</div>
            <div class="text-faint" style="font-size:11px;">${esc(c.title)}</div>
          </div>
          <span style="font-weight:700;font-size:14px;">${daysToSign(c)}d</span>
        </div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openContractSheet(c);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

// Drill-down for "Avg. Deal Size" — same click-through pattern as Signed
// This Month / Slowest to Sign, sorted biggest-value-first so the standout
// deals surface immediately.
function openDealSizeModal(contracts) {
  const rows = contracts.slice().sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Biggest Signed Deals</div>
      <div id="ct-dealsize-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#ct-dealsize-list");
  rows.forEach((c) => {
    const prospect = prospectById(c.prospect_id);
    const signedSuffix = c.signed_date ? " · Signed " + fmtDate(c.signed_date) : "";
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(prospect?.business_name || c.title)}</div>
            <div class="text-faint" style="font-size:11px;">${esc(c.title)}${esc(signedSuffix)}</div>
          </div>
          <span style="font-weight:700;font-size:14px;">${money(c.value)}</span>
        </div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openContractSheet(c);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

// Drill-down for "Void Rate" — same click-through pattern as the other
// stat-card modals on this page, most-recently-voided first (using
// updated_at, which the status-change save already refreshes) so the
// newest fallen-through deal surfaces first.
function openVoidedModal(contracts) {
  const rows = contracts.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Voided Contracts</div>
      <div id="ct-voided-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#ct-voided-list");
  rows.forEach((c) => {
    const prospect = prospectById(c.prospect_id);
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(prospect?.business_name || c.title)}</div>
            <div class="text-faint" style="font-size:11px;">${esc(c.title)}</div>
          </div>
          <span style="font-weight:700;font-size:14px;">${money(c.value)}</span>
        </div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openContractSheet(c);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

// Exports whatever's currently in view (respects the active status chip, same
// as the row order on screen) — useful for handing a batch of contracts off
// to an accountant/bookkeeper without them needing app access. Same
// toCSV/downloadTextFile mechanism as the Pipeline's existing CSV export.
function exportContractsCSV() {
  let items = store.contracts.slice();
  if (filterStatus !== "all") items = items.filter((c) => c.status === filterStatus);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!items.length) return toast("No contracts to export", "error");

  const columns = [
    { label: "Title", get: (c) => c.title },
    { label: "Client", get: (c) => prospectById(c.prospect_id)?.business_name || "" },
    { label: "Value", get: (c) => c.value },
    { label: "Status", get: (c) => (isStale(c) ? "Awaiting Signature (stale)" : STATUS_LABELS[c.status] || c.status) },
    { label: "Sent Date", get: (c) => c.sent_date || "" },
    { label: "Days Since Sent", get: (c) => c.sent_date && c.status === "sent" ? daysSinceSent(c) : "" },
    { label: "Signed Date", get: (c) => c.signed_date || "" },
    { label: "Days to Sign", get: (c) => (c.status === "signed" && c.sent_date && c.signed_date ? daysToSign(c) : "") },
    { label: "Created By", get: (c) => profileById(c.created_by)?.full_name || "" },
    { label: "Created At", get: (c) => c.created_at ? c.created_at.slice(0, 10) : "" },
    { label: "Notes", get: (c) => c.notes || "" },
  ];

  const csv = toCSV(items, columns);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`contracts-export-${stamp}.csv`, csv);
}

// Builds a short WhatsApp message summarizing the contract (title, value,
// status) and opens it addressed to the linked prospect — mirrors
// sendPaymentReminder() in invoices.js, which already proved this pattern
// out for billing; contracts got Print/PDF earlier this session but never
// got the equivalent quick-send-to-client action.
function sendContractWhatsApp(contract, prospect, { nudge = false } = {}) {
  if (!prospect?.whatsapp_number) return toast("No WhatsApp number saved for this client", "error");
  const statusPhrase = contract.status === "signed"
    ? "which we now both have signed — thank you!"
    : contract.status === "sent"
    ? "which is ready for your signature whenever you get a chance"
    : "for your review";
  // Awaiting-signature nudge uses a lighter "just checking in" tone instead
  // of re-sending the same "here it is" copy — this is a follow-up, not the
  // first ask, so it shouldn't read like one.
  const message = nudge
    ? `Hi ${prospect.business_name}, just checking in on "${contract.title || "our agreement"}" (${money(contract.value)}) — no rush, just want to make sure it didn't get buried. Let me know if you have any questions or need anything else to sign it!`
    : `Hi ${prospect.business_name}, sending over "${contract.title || "our agreement"}" (${money(contract.value)}) ${statusPhrase}. Let me know if you have any questions!`;
  window.open(buildWhatsAppLink(prospect.whatsapp_number, message), "_blank");
}

// Contracts and Invoices are otherwise fully decoupled — marking a contract
// Signed has zero effect on billing. Without this, the only safety net is
// Dashboard's Revenue at Risk card, which only flags "No invoice raised yet"
// after a signed client has sat untouched for 30 days. This catches it right
// when it's created instead of a month later — mirrors offerRecurringInvoice
// in invoices.js almost exactly, just triggered by "contract signed" instead
// of "invoice paid".
function offerFirstInvoice(contract) {
  if (!contract.prospect_id) return; // nothing to bill without a client attached
  if (store.invoices.some((i) => i.contract_id === contract.id)) return; // already invoiced
  const prospect = prospectById(contract.prospect_id);
  confirmModal({
    title: "Draft the first invoice?",
    body: `<b>${esc(contract.title)}</b> just got marked Signed. Want to draft an invoice for ${money(contract.value)} now?`,
    confirmLabel: "Draft Invoice",
    onConfirm: async () => {
      const payload = {
        invoice_number: nextInvoiceNumber(),
        amount: contract.value,
        prospect_id: contract.prospect_id,
        contract_id: contract.id,
        status: "draft",
        due_date: null,
        paid_date: null,
        notes: contract.title ? `For: ${contract.title}` : "",
        created_by: store.profile.id,
      };
      const { error } = await sb.from("invoices").insert(payload);
      if (error) return toast(error.message, "error");
      toast("Invoice drafted", "success");
    },
  });
}

export function openContractSheet(existing) {
  const c = existing || {};
  const isEdit = !!c.id;
  const isOwner = store.profile?.role === "owner";
  const canDelete = isEdit && isOwner;
  const linkedProspect = c.prospect_id ? prospectById(c.prospect_id) : null;
  const canSendWA = isEdit && !!linkedProspect?.whatsapp_number;
  const mismatchedProspect = isEdit ? mrrMismatch(c) : null;

  const prospectOptions = store.prospects
    .slice()
    .sort((a, b) => a.business_name.localeCompare(b.business_name))
    .map((p) => `<option value="${p.id}" ${c.prospect_id === p.id ? "selected" : ""}>${esc(p.business_name)}</option>`)
    .join("");

  const box = el(`
    <div>
      <div class="field">
        <label>Contract title *</label>
        <input id="ct-title" type="text" value="${esc(c.title || "")}" placeholder="e.g. Monthly Social Retainer — WestProp" />
      </div>
      <div class="field">
        <label>Linked prospect</label>
        <select id="ct-prospect"><option value="">No prospect linked</option>${prospectOptions}</select>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Value (USD)</label>
          <input id="ct-value" type="number" min="0" step="1" value="${c.value ?? ""}" placeholder="e.g. 3000" />
        </div>
        <div class="field">
          <label>Status</label>
          <select id="ct-status">
            ${STATUSES.map((s) => `<option value="${s}" ${(c.status || "draft") === s ? "selected" : ""}>${STATUS_LABELS[s]}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Sent date</label>
          <input id="ct-sent" type="date" value="${c.sent_date || ""}" />
        </div>
        <div class="field">
          <label>Signed date</label>
          <input id="ct-signed" type="date" value="${c.signed_date || ""}" />
        </div>
      </div>
      <div class="field">
        <label>Notes</label>
        <textarea id="ct-notes" placeholder="Terms, scope, anything worth remembering...">${esc(c.notes || "")}</textarea>
      </div>
      ${mismatchedProspect ? `
        <div class="card" style="margin-bottom:14px;border:1px solid var(--warn);">
          <div style="font-size:12.5px;margin-bottom:8px;">This contract is signed at <b>${money(c.value)}</b> but ${esc(mismatchedProspect.business_name)}'s profile MRR still says <b>${money(mismatchedProspect.mrr || 0)}</b> — every revenue number elsewhere in the app reads from the profile, not the contract.</div>
          <button id="ct-sync-mrr" class="btn btn-ghost btn-sm" style="width:100%;">Sync MRR to ${money(c.value)}</button>
        </div>
      ` : ""}
      <button id="ct-save" class="btn btn-primary" style="margin-top:6px;">${isEdit ? "Save Changes" : "Create Contract"}</button>
      ${isEdit ? `<button id="ct-print" class="btn btn-ghost" style="margin-top:10px;">Print / Save as PDF</button>` : ""}
      ${canSendWA ? `<button id="ct-send-wa" class="btn btn-ghost" style="margin-top:10px;">Send via WhatsApp</button>` : ""}
      ${canDelete ? `<button id="ct-delete" class="btn btn-danger" style="margin-top:10px;">Delete Contract</button>` : ""}
    </div>
  `);

  box.querySelector("#ct-save").addEventListener("click", async () => {
    const title = box.querySelector("#ct-title").value.trim();
    if (!title) return toast("Contract title is required", "error");

    const payload = {
      title,
      prospect_id: box.querySelector("#ct-prospect").value || null,
      value: Number(box.querySelector("#ct-value").value) || 0,
      status: box.querySelector("#ct-status").value,
      sent_date: box.querySelector("#ct-sent").value || null,
      signed_date: box.querySelector("#ct-signed").value || null,
      notes: box.querySelector("#ct-notes").value.trim(),
    };

    const btn = box.querySelector("#ct-save");
    btn.disabled = true;
    const wasSigned = isEdit && c.status === "signed";

    if (isEdit) {
      const { error } = await sb.from("contracts").update(payload).eq("id", c.id);
      btn.disabled = false;
      if (error) return toast(error.message, "error");
      toast("Saved", "success");
      closeSheet();
      if (payload.status === "signed" && !wasSigned) offerFirstInvoice({ ...c, ...payload });
    } else {
      payload.created_by = store.profile.id;
      const { error } = await sb.from("contracts").insert(payload);
      btn.disabled = false;
      if (error) return toast(error.message, "error");
      toast("Contract created", "success");
      closeSheet();
    }
  });

  const syncMrrBtn = box.querySelector("#ct-sync-mrr");
  if (syncMrrBtn) {
    syncMrrBtn.addEventListener("click", async () => {
      syncMrrBtn.disabled = true;
      const { error } = await sb.from("prospects").update({ mrr: c.value }).eq("id", c.prospect_id);
      syncMrrBtn.disabled = false;
      if (error) return toast(error.message, "error");
      toast("MRR synced", "success");
      closeSheet();
    });
  }

  const printBtn = box.querySelector("#ct-print");
  if (printBtn) printBtn.addEventListener("click", () => printContract(c));

  const sendWABtn = box.querySelector("#ct-send-wa");
  if (sendWABtn) {
    sendWABtn.addEventListener("click", () => {
      sendContractWhatsApp(
        {
          title: box.querySelector("#ct-title").value.trim() || c.title,
          value: Number(box.querySelector("#ct-value").value) || c.value,
          status: box.querySelector("#ct-status").value,
        },
        linkedProspect
      );
    });
  }

  const delBtn = box.querySelector("#ct-delete");
  if (delBtn) {
    delBtn.addEventListener("click", () => {
      confirmModal({
        title: "Delete this contract?",
        body: `This permanently removes <b>${esc(c.title)}</b>. This can't be undone.`,
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
          const { error } = await sb.from("contracts").delete().eq("id", c.id);
          if (error) return toast(error.message, "error");
          toast("Contract deleted", "success");
          closeSheet();
        },
      });
    });
  }

  openSheet(isEdit ? "Edit Contract" : "New Contract", box);
}

export function openNewContractSheet(prospect) {
  openContractSheet(
    prospect
      ? {
          prospect_id: prospect.id,
          title: prospect.business_name ? `Agreement — ${prospect.business_name}` : "",
          value: prospect.mrr > 0 ? prospect.mrr : undefined,
        }
      : null
  );
}

export function initContractsView() {
  on("contracts", () => { if (isActive()) renderContracts(); });
  on("prospects", () => { if (isActive()) renderContracts(); });
}
function isActive() {
  return document.getElementById("view-contracts")?.classList.contains("active");
}
