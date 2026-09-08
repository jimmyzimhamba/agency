import { sb } from "../supabaseClient.js";
import { store, on, emit, prospectById, profileById, firstOfMonth } from "../state.js";
import { el, esc, money, fmtDate, todayISO, toast, downloadReminderICS, buildWhatsAppLink, toCSV, downloadTextFile } from "../utils.js";
import { openSheet, closeSheet, confirmModal, openModal, closeModal } from "../ui.js";
import { printInvoice } from "../printDoc.js";
import { openProspectDetail } from "./prospectDetail.js";

const STATUS_LABELS = { draft: "Draft", sent: "Sent", paid: "Paid", void: "Void" };
const STATUSES = ["draft", "sent", "paid", "void"];

let filterStatus = "all";

// Overdue (sent, past due_date) was already covered, but nothing flagged the
// opposite failure mode: an invoice drafted and then never actually sent.
// It never counts toward "Outstanding" (sent-only) and Dashboard's Revenue
// at Risk only catches a signed client with *zero* invoices after 30 days, // a client who already has a half-finished draft sitting untouched is
// invisible everywhere. Mirrors contracts.js's STALE_DAYS/isStale pattern
// for its own "Awaiting Signature" case, just anchored on created_at since
// drafts don't have a sent_date yet.
const STALE_DRAFT_DAYS = 3;
function daysSinceCreated(i) {
  if (!i.created_at) return 0;
  return Math.floor((new Date(todayISO() + "T00:00:00") - new Date(i.created_at.slice(0, 10) + "T00:00:00")) / 86400000);
}
function isStaleDraft(i) {
  return i.status === "draft" && i.created_at && daysSinceCreated(i) >= STALE_DRAFT_DAYS;
}

// Overdue only fires once due_date has already passed, the team only ever
// chases money once it's late. Nothing nudges a client *before* the
// deadline, when a friendly heads-up reads as courteous instead of a
// collections message. Same "catch it before it's a problem" pattern
// Contracts' stale-sent flag and this file's own Stale Draft flag already
// use, applied to the one obvious remaining case: a due date coming up soon.
const DUE_SOON_DAYS = 3;
function daysUntilDue(i) {
  if (!i.due_date) return null;
  return Math.round((new Date(i.due_date + "T00:00:00") - new Date(todayISO() + "T00:00:00")) / 86400000);
}
function isDueSoon(i) {
  if (i.status !== "sent" || !i.due_date) return false;
  const days = daysUntilDue(i);
  return days >= 0 && days <= DUE_SOON_DAYS;
}

// ---- retainers not yet invoiced this month ---------------------------------
//
// A signed client with a monthly retainer who has no invoice covering this
// month is revenue quietly going missing. It's the one money problem nothing
// else in the app could ever surface, because every other warning here is
// about an invoice that exists, overdue, stale draft, due soon. An invoice
// nobody created has no row to flag, so it never appears anywhere and the
// month just closes short.
//
// Matches public.draft_retainer_invoices() in
// supabase/migration_money_and_portal.sql exactly, and it has to: this list is
// what the button hands to that function, so if the two disagreed the banner
// would offer to draft invoices the database then decides already exist, and
// nothing would happen when it was tapped. Keyed on due_date inside this month
// (an invoice raised on the 28th of last month for this month's work is the
// same money) and ignoring voided ones (voiding is how somebody says "that was
// wrong, do it again").
function monthBounds() {
  const d = new Date();
  const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const end = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  return { start, end };
}

function retainersNotInvoicedThisMonth() {
  const { start, end } = monthBounds();
  return store.prospects.filter((p) => {
    if (p.status !== "signed") return false;
    if (!(Number(p.mrr) > 0)) return false;
    return !store.invoices.some(
      (i) => i.prospect_id === p.id && i.status !== "void" && i.due_date && i.due_date >= start && i.due_date <= end
    );
  });
}

// Lets Dashboard deep-link into a pre-filtered Invoices list (mirrors
// pipeline.js's setStatusFilter) instead of always dumping onto the
// unfiltered "All" view, which is all the Outstanding/Overdue stat cards
// did before.
export function setInvoiceStatusFilter(status) {
  filterStatus = status;
}

export function renderInvoices() {
  const root = document.getElementById("view-invoices");
  root.innerHTML = "";

  const outstanding = store.invoices
    .filter((i) => i.status === "sent")
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const overdueCount = store.invoices.filter((i) => i.status === "sent" && i.due_date && i.due_date < todayISO()).length;
  // Distinct from "Projected MRR" on the Dashboard (forward-looking, based on
  // signed clients' recurring value), this is what's actually landed:
  // invoices marked Paid with a paid_date inside the current calendar month.
  // The one number an owner asks about most and, until now, had nowhere on
  // Invoices to see at a glance.
  const collectedThisMonth = store.invoices
    .filter((i) => i.status === "paid" && i.paid_date && i.paid_date >= firstOfMonth())
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const staleDraftCount = store.invoices.filter(isStaleDraft).length;
  const dueSoonCount = store.invoices.filter(isDueSoon).length;
  const topClients = topClientsByRevenue();
  // Distinct from every other stat here, those are all snapshots of money's
  // current state (landed, owed, late, unsent). This is the one number that
  // answers a cash-flow question owners actually ask: once a client's
  // billed, how long does it typically take them to actually pay? Neither
  // Dashboard's forward-looking Projected MRR nor Pipeline Value's
  // Average Time in Stage (funnel movement, not billing) covers this.
  const paidWithDates = store.invoices.filter((i) => i.status === "paid" && i.paid_date && i.created_at);
  const avgDaysToPay = paidWithDates.length
    ? Math.round(paidWithDates.reduce((sum, i) => sum + (new Date(i.paid_date) - new Date(i.created_at.slice(0, 10))) / 86400000, 0) / paidWithDates.length)
    : null;
  // Money actually billed or collected with no signed contract on file is a
  // real compliance/audit gap, if the client disputes it, there's nothing
  // to point to. Distinct from every other flag here: those all inspect
  // status/dates, this is the only one that inspects contract_id. Only
  // counts sent/paid invoices, a draft with no contract yet isn't a
  // problem, since nothing's actually been billed yet.
  const noContractInvoices = store.invoices.filter((i) => !i.contract_id && (i.status === "sent" || i.status === "paid"));
  // Outstanding (one total) and Outstanding by Client (grouped by who owes
  // it) both already exist, but neither tells an owner whether that total is
  // healthy, mostly not-yet-due, or a real collections problem, mostly
  // weeks late. Standard AR-aging buckets, grouped by *when* instead of *who*.
  const agingGroups = agingBuckets();
  const uninvoicedRetainers = retainersNotInvoicedThisMonth();
  const uninvoicedTotal = uninvoicedRetainers.reduce((sum, p) => sum + (Number(p.mrr) || 0), 0);
  // Only the owner sees the drafting banner, because only the owner can run
  // it, the database function refuses anybody else (see
  // draft_my_retainer_invoices). Showing an agent a button that always errors
  // would be worse than showing nothing.
  const canDraft = store.profile?.role === "owner";

  const wrap = el(`
    <div>
      <div class="flex-between">
        <div class="page-title mt-0">Invoices<span class="accent">.</span></div>
        <div style="display:flex;gap:14px;">
          <span class="small-link" id="iv-export-csv">Export CSV</span>
          <span class="small-link" id="iv-new">+ New Invoice</span>
        </div>
      </div>

      <div class="stat-grid cols-3" style="margin-bottom:16px;">
        <div class="stat-card"><div class="num">${money(collectedThisMonth)}</div><div class="label">Collected This Month</div></div>
        <div class="stat-card purple" id="iv-outstanding-card" style="${outstanding ? "cursor:pointer;" : ""}"><div class="num">${money(outstanding)}</div><div class="label">Outstanding</div></div>
        <div class="stat-card ${overdueCount ? "accent" : ""}"><div class="num">${overdueCount}</div><div class="label">Overdue</div></div>
      </div>
      ${uninvoicedRetainers.length ? `
        <div class="card" id="iv-retainer-banner" style="margin-bottom:16px;border-color:var(--accent, #7c3aed);">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">
            ${uninvoicedRetainers.length} retainer${uninvoicedRetainers.length === 1 ? "" : "s"} not invoiced this month
          </div>
          <div class="text-faint" style="font-size:12.5px;line-height:1.5;margin-bottom:10px;">
            ${money(uninvoicedTotal)} of monthly retainer has no invoice covering this month:
            ${esc(uninvoicedRetainers.slice(0, 3).map((p) => p.business_name).join(", "))}${uninvoicedRetainers.length > 3 ? ` and ${uninvoicedRetainers.length - 3} more` : ""}.
          </div>
          ${canDraft
            ? `<button class="btn btn-primary btn-sm" id="iv-draft-retainers" style="width:auto;">Draft Them Now</button>`
            : `<div class="text-faint" style="font-size:11.5px;">Ask the owner to draft these.</div>`}
        </div>
      ` : ""}
      ${staleDraftCount ? `
        <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
          <div class="stat-card accent"><div class="num">${staleDraftCount}</div><div class="label">Draft invoice${staleDraftCount === 1 ? "" : "s"} not sent ${STALE_DRAFT_DAYS}+ days</div></div>
        </div>
      ` : ""}
      ${dueSoonCount ? `
        <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
          <div class="stat-card accent"><div class="num">${dueSoonCount}</div><div class="label">Invoice${dueSoonCount === 1 ? "" : "s"} due in the next ${DUE_SOON_DAYS} days</div></div>
        </div>
      ` : ""}
      <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
        <div class="stat-card" id="iv-avg-pay-card" style="${paidWithDates.length ? "cursor:pointer;" : ""}">
          <div class="num">${avgDaysToPay === null ? "-" : avgDaysToPay + "d"}</div>
          <div class="label">Avg. Days to Get Paid${paidWithDates.length ? ", tap to see slowest payers" : ", no paid invoices yet"}</div>
        </div>
      </div>
      ${topClients.length ? `
        <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
          <div class="stat-card purple" id="iv-topclients-card" style="cursor:pointer;">
            <div class="num">${money(topClients[0].total)}</div>
            <div class="label">Top client by revenue: ${esc(topClients[0].prospect.business_name)}, tap for full ranking</div>
          </div>
        </div>
      ` : ""}
      ${noContractInvoices.length ? `
        <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
          <div class="stat-card accent" id="iv-no-contract-card" style="cursor:pointer;">
            <div class="num">${noContractInvoices.length}</div>
            <div class="label">Invoice${noContractInvoices.length === 1 ? "" : "s"} billed with no contract on file</div>
          </div>
        </div>
      ` : ""}
      ${agingGroups.length ? `
        <div class="section-title">Outstanding by Age</div>
        <div class="stat-grid" id="iv-aging-grid" style="margin-bottom:16px;"></div>
      ` : ""}

      <div class="chip-row" id="iv-status-chips"></div>
      <div id="iv-list"></div>
    </div>
  `);
  root.appendChild(wrap);

  wrap.querySelector("#iv-new").addEventListener("click", () => openInvoiceSheet(null));
  wrap.querySelector("#iv-export-csv").addEventListener("click", exportInvoicesCSV);
  const draftBtn = wrap.querySelector("#iv-draft-retainers");
  if (draftBtn) {
    draftBtn.addEventListener("click", () => {
      confirmModal({
        title: "Draft this month's retainer invoices?",
        body:
          `This creates <b>${uninvoicedRetainers.length}</b> draft invoice${uninvoicedRetainers.length === 1 ? "" : "s"} ` +
          `totalling <b>${money(uninvoicedTotal)}</b>, one per signed client with a monthly retainer and no invoice yet ` +
          `this month. Nothing is sent to anyone. They land as drafts for you to check first.`,
        confirmLabel: "Draft Them",
        onConfirm: async () => {
          // Calls the same database function the monthly schedule calls, so
          // the button and the timer can never drift apart or double up: the
          // function's own "does an invoice already cover this month" check is
          // what stops a second run creating duplicates, whichever of the two
          // got there first.
          const { data, error } = await sb.rpc("draft_my_retainer_invoices");
          if (error) return toast(error.message, "error");
          const made = Number(data) || 0;
          toast(made ? `${made} invoice${made === 1 ? "" : "s"} drafted` : "Already up to date", "success");
          await refreshInvoices();
        },
      });
    });
  }
  if (paidWithDates.length) {
    wrap.querySelector("#iv-avg-pay-card").addEventListener("click", () => openSlowestPayersModal(paidWithDates));
  }
  if (outstanding) {
    wrap.querySelector("#iv-outstanding-card").addEventListener("click", () => openOutstandingByClientModal());
  }
  if (topClients.length) {
    wrap.querySelector("#iv-topclients-card").addEventListener("click", () => openTopClientsModal(topClients));
  }
  if (noContractInvoices.length) {
    wrap.querySelector("#iv-no-contract-card").addEventListener("click", () => openNoContractModal(noContractInvoices));
  }
  if (agingGroups.length) {
    const agingGrid = wrap.querySelector("#iv-aging-grid");
    agingGroups.forEach((g) => {
      const card = el(`
        <div class="stat-card ${g.key === "overdue31" ? "accent" : ""}" style="cursor:pointer;">
          <div class="num">${money(g.total)}</div>
          <div class="label">${g.count} · ${esc(g.label)}</div>
        </div>
      `);
      card.addEventListener("click", () => openAgingBucketModal(g.label, g.invoices));
      agingGrid.appendChild(card);
    });
  }

  const chipRow = wrap.querySelector("#iv-status-chips");
  [["all", "All"], ...STATUSES.map((s) => [s, STATUS_LABELS[s]])].forEach(([val, label]) => {
    const chip = el(`<span class="chip ${filterStatus === val ? "active" : ""}">${label}</span>`);
    chip.addEventListener("click", () => { filterStatus = val; renderInvoices(); });
    chipRow.appendChild(chip);
  });

  renderList(wrap.querySelector("#iv-list"));
}

function renderList(listEl) {
  if (!listEl) listEl = document.getElementById("iv-list");
  if (!listEl) return;

  let items = store.invoices.slice();
  if (filterStatus !== "all") items = items.filter((i) => i.status === filterStatus);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  listEl.innerHTML = "";
  if (!items.length) {
    listEl.appendChild(el(`
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 9.5 12 4l9 5.5"/><path d="M5.5 11v7M10 11v7M14 11v7M18.5 11v7"/><path d="M3.5 21h17"/></svg>
        <p>No invoices yet. Create one once a client's ready to be billed.</p>
      </div>
    `));
    return;
  }

  const today = todayISO();
  items.forEach((i) => {
    const prospect = prospectById(i.prospect_id);
    const creator = profileById(i.created_by);
    const isOverdue = i.status === "sent" && i.due_date && i.due_date < today;
    const staleDraft = isStaleDraft(i);
    const dueSoon = !isOverdue && isDueSoon(i);
    const card = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between" style="margin-bottom:4px;">
          <div style="font-weight:700;font-size:14px;">${esc(i.invoice_number || "Untitled invoice")}</div>
          ${isOverdue ? `<span class="status-pill dead">Overdue</span>` : staleDraft ? `<span class="status-pill stale">Draft (${daysSinceCreated(i)}d)</span>` : dueSoon ? `<span class="status-pill stale">Due in ${daysUntilDue(i)}d</span>` : `<span class="status-pill ${i.status}">${STATUS_LABELS[i.status] || i.status}</span>`}
        </div>
        <div class="text-faint" style="font-size:12px;margin-bottom:6px;">
          ${prospect ? esc(prospect.business_name) : "No prospect linked"}${creator ? " · " + esc(creator.full_name || creator.email) : ""}
        </div>
        <div class="flex-between">
          <span style="font-weight:700;font-size:15px;">${money(i.amount)}</span>
          <span class="text-faint" style="font-size:11px;">${i.status === "paid" && i.paid_date ? "Paid " + fmtDate(i.paid_date) : i.due_date ? "Due " + fmtDate(i.due_date) : "No due date"}</span>
        </div>
        ${(isOverdue || dueSoon) && prospect?.whatsapp_number ? `<button class="btn btn-ghost btn-sm" data-action="remind" style="margin-top:8px;width:100%;">Send Payment Reminder</button>` : ""}
        ${staleDraft ? `<button class="btn btn-ghost btn-sm" data-action="mark-sent" style="margin-top:8px;width:100%;">Mark as Sent</button>` : ""}
      </div>
    `);
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-action='remind']") || e.target.closest("[data-action='mark-sent']")) return;
      openInvoiceSheet(i);
    });
    const remindBtn = card.querySelector("[data-action='remind']");
    if (remindBtn) {
      remindBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        sendPaymentReminder(i, prospect);
      });
    }
    const markSentBtn = card.querySelector("[data-action='mark-sent']");
    if (markSentBtn) {
      markSentBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const { error } = await sb.from("invoices").update({ status: "sent" }).eq("id", i.id);
        if (error) return toast(error.message, "error");
        toast("Marked as sent", "success");
      });
    }
    listEl.appendChild(card);
  });
}

// Drill-down for the "Avg. Days to Get Paid" stat card, the bare average
// alone can't tell an owner *which* clients are the slow payers worth
// following up with on payment terms; this ranks the paid invoices slowest
// (longest created_at → paid_date gap) first, same modal-list pattern
// dashboard.js already uses for its own click-through stat cards.
function openSlowestPayersModal(paidWithDates) {
  const rows = paidWithDates
    .map((i) => ({ invoice: i, days: Math.round((new Date(i.paid_date) - new Date(i.created_at.slice(0, 10))) / 86400000) }))
    .sort((a, b) => b.days - a.days);
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Slowest to Pay</div>
      <div id="iv-slow-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#iv-slow-list");
  rows.forEach(({ invoice, days }) => {
    const prospect = prospectById(invoice.prospect_id);
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(prospect?.business_name || "No prospect linked")}</div>
            <div class="text-faint" style="font-size:11px;">${esc(invoice.invoice_number || "Untitled invoice")} · ${money(invoice.amount)}</div>
          </div>
          <span class="status-pill ${days >= 14 ? "dead" : "paid"}">${days}d</span>
        </div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openInvoiceSheet(invoice);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

// Standard AR-aging breakdown. "Outstanding" (one total) and "Outstanding by
// Client" (grouped by who owes it) already exist, but neither says whether
// that total is healthy, mostly not-yet-due, or a real collections
// problem, mostly weeks late. Buckets every sent (unpaid) invoice by how
// overdue it is, using the same daysUntilDue() the Due Soon flag already
// relies on, so "we're owed $4,200" becomes "$3,000 of that is 30+ days
// overdue" at a glance.
function agingBuckets() {
  const sent = store.invoices.filter((i) => i.status === "sent");
  const defs = [
    { key: "notDue", label: "Not Yet Due", test: (d) => d !== null && d >= 0 },
    { key: "overdue15", label: "1-15 Days Overdue", test: (d) => d !== null && d < 0 && d >= -15 },
    { key: "overdue30", label: "16-30 Days Overdue", test: (d) => d !== null && d < -15 && d >= -30 },
    { key: "overdue31", label: "31+ Days Overdue", test: (d) => d !== null && d < -30 },
    { key: "noDate", label: "No Due Date", test: (d) => d === null },
  ];
  return defs
    .map((def) => {
      const invoices = sent.filter((i) => def.test(daysUntilDue(i)));
      return {
        key: def.key,
        label: def.label,
        count: invoices.length,
        total: invoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
        invoices,
      };
    })
    .filter((g) => g.count > 0);
}

// Drill-down for the "Outstanding" stat card, the aggregate total alone
// doesn't say *who* owes it, so chasing collections meant manually scanning
// the invoice list and mentally tallying per-client totals. Groups every
// sent (unpaid) invoice by client, sums what each one owes, and sorts
// worst-first so the biggest collections targets are immediately obvious.
// Distinct from "Slowest to Pay" (which measures speed of already-paid
// invoices) and Dashboard's Revenue at Risk (which flags a signed client
// with no invoice at all), this is "who currently owes the most, right now."
// Distinct from "Outstanding by Client" below (that's a collections tool, // who owes us money right now) and "Revenue by Niche/Tier" on the Dashboard
// (aggregated by category, not by individual client). This is the first
// place that ranks actual clients by lifetime paid revenue, useful for
// prioritizing account-management attention, upsell/renewal conversations,
// and referral asks toward the accounts actually generating the most money.
function topClientsByRevenue() {
  const paid = store.invoices.filter((i) => i.status === "paid");
  const groups = new Map();
  paid.forEach((i) => {
    if (!i.prospect_id) return;
    if (!groups.has(i.prospect_id)) groups.set(i.prospect_id, { prospect: prospectById(i.prospect_id), total: 0, count: 0 });
    const g = groups.get(i.prospect_id);
    g.total += Number(i.amount) || 0;
    g.count += 1;
  });
  return Array.from(groups.values())
    .filter((g) => g.prospect)
    .sort((a, b) => b.total - a.total);
}

function openTopClientsModal(rows) {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Top Clients by Revenue</div>
      <div id="iv-topclients-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#iv-topclients-list");
  rows.forEach(({ prospect, total, count }, idx) => {
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;display:flex;align-items:center;gap:8px;">
            <span class="text-faint" style="font-size:11.5px;flex:0 0 auto;">#${idx + 1}</span>
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(prospect.business_name)}</div>
              <div class="text-faint" style="font-size:11px;">${count} paid invoice${count === 1 ? "" : "s"}</div>
            </div>
          </div>
          <span style="font-weight:700;font-size:14px;">${money(total)}</span>
        </div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openProspectDetail(prospect);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

function openOutstandingByClientModal() {
  const sent = store.invoices.filter((i) => i.status === "sent");
  const groups = new Map();
  sent.forEach((i) => {
    const key = i.prospect_id || "__unlinked";
    if (!groups.has(key)) groups.set(key, { prospect: prospectById(i.prospect_id), total: 0, invoices: [] });
    const g = groups.get(key);
    g.total += Number(i.amount) || 0;
    g.invoices.push(i);
  });
  const rows = Array.from(groups.values()).sort((a, b) => b.total - a.total);

  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Outstanding by Client</div>
      <div id="iv-outstanding-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#iv-outstanding-list");
  rows.forEach(({ prospect, total, invoices }) => {
    const mostRecent = invoices.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(prospect?.business_name || "Unlinked invoices")}</div>
            <div class="text-faint" style="font-size:11px;">${invoices.length} invoice${invoices.length === 1 ? "" : "s"} outstanding</div>
          </div>
          <span style="font-weight:700;font-size:14px;">${money(total)}</span>
        </div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openInvoiceSheet(mostRecent);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

// Drill-down for an "Outstanding by Age" bucket, same click-through pattern
// as Outstanding by Client, just scoped to one age band, sorted most
// overdue first so the most urgent chases surface at the top.
function openAgingBucketModal(label, invoices) {
  const rows = invoices.slice().sort((a, b) => (daysUntilDue(a) ?? 999) - (daysUntilDue(b) ?? 999));
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Outstanding: ${esc(label)}</div>
      <div id="iv-aging-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#iv-aging-list");
  rows.forEach((i) => {
    const prospect = prospectById(i.prospect_id);
    const days = daysUntilDue(i);
    const sub = days === null ? "No due date" : days < 0 ? `${Math.abs(days)}d overdue` : `Due in ${days}d`;
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${prospect ? esc(prospect.business_name) : "Unlinked invoice"}</div>
            <div class="text-faint" style="font-size:11px;">${esc(sub)}</div>
          </div>
          <span style="font-weight:700;font-size:14px;">${money(i.amount)}</span>
        </div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openInvoiceSheet(i);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

// Drill-down for the "billed with no contract on file" stat card, lists
// the offending invoices individually (not grouped by client, since the fix
// is per-invoice), tapping one closes the modal and opens that invoice's
// edit sheet, where the existing "Linked contract" dropdown lets a rep
// attach one in a single tap.
function openNoContractModal(invoices) {
  const rows = invoices.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Billed With No Contract</div>
      <div id="iv-no-contract-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#iv-no-contract-list");
  rows.forEach((i) => {
    const prospect = prospectById(i.prospect_id);
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(i.invoice_number || "Untitled invoice")}</div>
            <div class="text-faint" style="font-size:11px;">${prospect ? esc(prospect.business_name) : "No prospect linked"} · <span class="status-pill ${i.status}">${STATUS_LABELS[i.status] || i.status}</span></div>
          </div>
          <span style="font-weight:700;font-size:14px;">${money(i.amount)}</span>
        </div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openInvoiceSheet(i);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

// Builds a friendly WhatsApp payment-reminder message and opens it in a new
// tab, reuses buildWhatsAppLink the same way pipeline.js's outreach send
// does, just with billing copy instead of an outreach opener. Wording shifts
// depending on whether the due date has actually passed yet, so a
// not-yet-due nudge doesn't read as an accusation.
function sendPaymentReminder(invoice, prospect) {
  if (!prospect?.whatsapp_number) return toast("No WhatsApp number saved for this client", "error");
  const isOverdue = invoice.due_date && invoice.due_date < todayISO();
  const label = invoice.invoice_number ? `invoice ${invoice.invoice_number}` : "your invoice";
  const message = isOverdue
    ? `Hi ${prospect.business_name}, just a friendly reminder that ${label} for ${money(invoice.amount)} was due ${fmtDate(invoice.due_date)} and is still outstanding. Could you let us know when we can expect payment? Thanks!`
    : `Hi ${prospect.business_name}, quick reminder that ${label} for ${money(invoice.amount)}${invoice.due_date ? " is due " + fmtDate(invoice.due_date) : " is awaiting payment"}. Let us know if you have any questions, thanks!`;
  window.open(buildWhatsAppLink(prospect.whatsapp_number, message), "_blank");
}

// Exports whatever's currently in view (respects the active status chip), // useful for handing a batch of invoices off to an accountant/bookkeeper
// without them needing app access. Same toCSV/downloadTextFile mechanism as
// the Pipeline's existing CSV export and Contracts' new one.
function exportInvoicesCSV() {
  let items = store.invoices.slice();
  if (filterStatus !== "all") items = items.filter((i) => i.status === filterStatus);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!items.length) return toast("No invoices to export", "error");

  const today = todayISO();
  const columns = [
    { label: "Invoice Number", get: (i) => i.invoice_number },
    { label: "Client", get: (i) => prospectById(i.prospect_id)?.business_name || "" },
    { label: "Amount", get: (i) => i.amount },
    { label: "Status", get: (i) => (i.status === "sent" && i.due_date && i.due_date < today ? "Overdue" : isStaleDraft(i) ? `Draft (not sent ${daysSinceCreated(i)}d)` : STATUS_LABELS[i.status] || i.status) },
    { label: "Due Date", get: (i) => i.due_date || "" },
    { label: "Paid Date", get: (i) => i.paid_date || "" },
    { label: "Created By", get: (i) => profileById(i.created_by)?.full_name || "" },
    { label: "Created At", get: (i) => i.created_at ? i.created_at.slice(0, 10) : "" },
    { label: "Notes", get: (i) => i.notes || "" },
  ];

  const csv = toCSV(items, columns);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`invoices-export-${stamp}.csv`, csv);
}

// Exported so contracts.js can reuse the same numbering convention when it
// offers to draft a client's first invoice straight off a newly-signed
// contract, instead of inventing a second incrementing scheme.
export function nextInvoiceNumber() {
  const n = store.invoices.length + 1;
  return "INV-" + String(n).padStart(4, "0");
}

// Adds one calendar month to a YYYY-MM-DD string, clamping to the last real
// day of the target month (so Jan 31 + 1 month lands on Feb 28/29, not
// rolling over into March like naive date math would).
function addOneMonth(dateStr) {
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

function offerRecurringInvoice(paidInvoice) {
  if (!paidInvoice.prospect_id) return; // nothing to recur without a client attached
  // Skip if a next-period invoice for this client already exists (drafted,
  // sent, or otherwise) so re-opening/re-saving this one doesn't nag twice.
  const already = store.invoices.some(
    (other) =>
      other.id !== paidInvoice.id &&
      other.prospect_id === paidInvoice.prospect_id &&
      other.due_date &&
      paidInvoice.due_date &&
      other.due_date > paidInvoice.due_date
  );
  if (already) return;

  const prospect = prospectById(paidInvoice.prospect_id);
  const nextDue = addOneMonth(paidInvoice.due_date);
  confirmModal({
    title: "Draft next month's invoice?",
    body: `<b>${esc(prospect?.business_name || "This client")}</b> just got marked Paid. Want to draft next month's invoice (${money(paidInvoice.amount)}, due ${fmtDate(nextDue)}) now?`,
    confirmLabel: "Draft Invoice",
    onConfirm: async () => {
      const payload = {
        invoice_number: nextInvoiceNumber(),
        amount: paidInvoice.amount,
        prospect_id: paidInvoice.prospect_id,
        contract_id: paidInvoice.contract_id || null,
        status: "draft",
        due_date: nextDue,
        paid_date: null,
        notes: paidInvoice.notes || "",
        created_by: store.profile.id,
      };
      const { error } = await sb.from("invoices").insert(payload);
      if (error) return toast(error.message, "error");
      toast("Next invoice drafted", "success");
    },
  });
}

// Invoices are covered by Realtime, so rows the database creates on its own
// normally arrive by themselves. This refetch exists for the case where they
// don't, a dropped socket, a phone that just woke up, because the banner
// that triggered this is the kind of thing somebody taps twice if it doesn't
// visibly go away. Drafting twice is harmless (the function refuses to
// duplicate) but it looks broken, which is its own problem.
async function refreshInvoices() {
  const { data } = await sb.from("invoices").select("*").order("created_at", { ascending: false });
  store.invoices = data || [];
  emit("invoices");
}

export function openInvoiceSheet(existing) {
  const i = existing || {};
  const isEdit = !!i.id;
  const isOwner = store.profile?.role === "owner";
  const canDelete = isEdit && isOwner;
  const linkedProspect = i.prospect_id ? prospectById(i.prospect_id) : null;
  const canRemind = isEdit && i.status === "sent" && !!linkedProspect?.whatsapp_number;

  const prospectOptions = store.prospects
    .slice()
    .sort((a, b) => a.business_name.localeCompare(b.business_name))
    .map((p) => `<option value="${p.id}" ${i.prospect_id === p.id ? "selected" : ""}>${esc(p.business_name)}</option>`)
    .join("");

  const contractOptions = store.contracts
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((c) => `<option value="${c.id}" ${i.contract_id === c.id ? "selected" : ""}>${esc(c.title)}</option>`)
    .join("");

  const box = el(`
    <div>
      <div class="field-row">
        <div class="field">
          <label>Invoice number</label>
          <input id="iv-number" type="text" value="${esc(i.invoice_number || (isEdit ? "" : nextInvoiceNumber()))}" placeholder="INV-0001" />
        </div>
        <div class="field">
          <label>Amount (USD) *</label>
          <input id="iv-amount" type="number" min="0" step="1" value="${i.amount ?? ""}" placeholder="e.g. 500" />
        </div>
      </div>
      <div class="field">
        <label>Linked prospect</label>
        <select id="iv-prospect"><option value="">No prospect linked</option>${prospectOptions}</select>
      </div>
      <div class="field">
        <label>Linked contract</label>
        <select id="iv-contract"><option value="">No contract linked</option>${contractOptions}</select>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Status</label>
          <select id="iv-status">
            ${STATUSES.map((s) => `<option value="${s}" ${(i.status || "draft") === s ? "selected" : ""}>${STATUS_LABELS[s]}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Due date</label>
          <input id="iv-due" type="date" value="${i.due_date || ""}" />
        </div>
      </div>
      <div class="field">
        <label>Paid date</label>
        <input id="iv-paid" type="date" value="${i.paid_date || ""}" />
      </div>
      <div class="field">
        <label>Notes</label>
        <textarea id="iv-notes" placeholder="What's this invoice for...">${esc(i.notes || "")}</textarea>
      </div>
      <button id="iv-save" class="btn btn-primary" style="margin-top:6px;">${isEdit ? "Save Changes" : "Create Invoice"}</button>
      ${isEdit ? `<button id="iv-print" class="btn btn-ghost" style="margin-top:10px;">Print / Save as PDF</button>` : ""}
      ${isEdit ? `<button id="iv-ics" class="btn btn-ghost" style="margin-top:10px;">Add Due Date to Calendar</button>` : ""}
      ${canRemind ? `<button id="iv-remind" class="btn btn-ghost" style="margin-top:10px;">Send Payment Reminder</button>` : ""}
      ${canDelete ? `<button id="iv-delete" class="btn btn-danger" style="margin-top:10px;">Delete Invoice</button>` : ""}
    </div>
  `);

  box.querySelector("#iv-save").addEventListener("click", async () => {
    const amount = Number(box.querySelector("#iv-amount").value) || 0;
    if (amount <= 0) return toast("Enter an invoice amount", "error");

    const status = box.querySelector("#iv-status").value;
    const paidInput = box.querySelector("#iv-paid").value || null;
    const wasPaid = isEdit && i.status === "paid";

    const payload = {
      invoice_number: box.querySelector("#iv-number").value.trim(),
      amount,
      prospect_id: box.querySelector("#iv-prospect").value || null,
      contract_id: box.querySelector("#iv-contract").value || null,
      status,
      due_date: box.querySelector("#iv-due").value || null,
      // Marking paid without picking a date defaults to today, so the
      // record still makes sense at a glance later.
      paid_date: status === "paid" ? (paidInput || todayISO()) : paidInput,
      notes: box.querySelector("#iv-notes").value.trim(),
    };

    const btn = box.querySelector("#iv-save");
    btn.disabled = true;

    if (isEdit) {
      const { error } = await sb.from("invoices").update(payload).eq("id", i.id);
      btn.disabled = false;
      if (error) return toast(error.message, "error");
      toast("Saved", "success");
      closeSheet();
      if (status === "paid" && !wasPaid) offerRecurringInvoice({ ...i, ...payload });
    } else {
      payload.created_by = store.profile.id;
      const { error } = await sb.from("invoices").insert(payload);
      btn.disabled = false;
      if (error) return toast(error.message, "error");
      toast("Invoice created", "success");
      closeSheet();
    }
  });

  const printBtn = box.querySelector("#iv-print");
  if (printBtn) printBtn.addEventListener("click", () => printInvoice(i));

  const icsBtn = box.querySelector("#iv-ics");
  if (icsBtn) {
    icsBtn.addEventListener("click", () => {
      const dateISO = box.querySelector("#iv-due").value;
      if (!dateISO) return toast("Set a due date first", "error");
      const prospect = prospectById(i.prospect_id);
      downloadReminderICS(`invoice-due-${(i.invoice_number || "invoice").toLowerCase()}.ics`, {
        title: `Invoice due: ${i.invoice_number || "Invoice"}${prospect ? " (" + prospect.business_name + ")" : ""}`,
        description: `${money(box.querySelector("#iv-amount").value ? Number(box.querySelector("#iv-amount").value) : i.amount)} due${prospect ? " from " + prospect.business_name : ""}.`,
        dateISO,
      });
      toast("Calendar file downloaded", "success");
    });
  }

  const remindBtn = box.querySelector("#iv-remind");
  if (remindBtn) {
    remindBtn.addEventListener("click", () => sendPaymentReminder(i, linkedProspect));
  }

  const delBtn = box.querySelector("#iv-delete");
  if (delBtn) {
    delBtn.addEventListener("click", () => {
      confirmModal({
        title: "Delete this invoice?",
        body: `This permanently removes <b>${esc(i.invoice_number || "this invoice")}</b>. This can't be undone.`,
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
          const { error } = await sb.from("invoices").delete().eq("id", i.id);
          if (error) return toast(error.message, "error");
          toast("Invoice deleted", "success");
          closeSheet();
        },
      });
    });
  }

  openSheet(isEdit ? "Edit Invoice" : "New Invoice", box);
}

export function openNewInvoiceSheet(prospect) {
  openInvoiceSheet(prospect ? { prospect_id: prospect.id } : null);
}

export function initInvoicesView() {
  on("invoices", () => { if (isActive()) renderInvoices(); });
  on("contracts", () => { if (isActive()) renderInvoices(); });
  on("prospects", () => { if (isActive()) renderInvoices(); });
}
function isActive() {
  return document.getElementById("view-invoices")?.classList.contains("active");
}
