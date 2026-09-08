// ============================================================================
// STUDIO X COMMAND, View: Expenses & Profit
// ----------------------------------------------------------------------------
// The other half of the money picture. Invoices answer "what came in";
// this answers "what went out", and together they answer the question that
// actually decides who the agency should keep working with, which clients
// are worth it.
//
// The single most important thing on this screen is Profit by Client, and the
// reason it needed building is that revenue alone actively misleads. A client
// paying $150 a month whose ad budget the agency fronts, and whose work needs
// a freelance editor, can cost more than they bring; a $200 client with no
// direct costs is pure margin. On a revenue-only ranking those two sit in the
// same place, and the wrong one looks like the better client.
//
// Deliberately NOT here: any attempt to spread office overhead across clients.
// See the long note in supabase/migration_money_and_portal.sql, the short
// version is that every formula for it invents a number, and an invented
// number that looks precise is worse than an honest gap. So "profit" on this
// screen means revenue minus costs actually booked against that client, and
// the screen says exactly that in words, on screen, where nobody can miss it.
// ============================================================================

import { sb } from "../supabaseClient.js";
import { store, on, emit, prospectById, profileById, firstOfMonth } from "../state.js";
import { el, esc, money, fmtDate, todayISO, toast, toCSV, downloadTextFile } from "../utils.js";
import { openSheet, closeSheet, openModal, closeModal, confirmModal } from "../ui.js";
import { openProspectDetail } from "./prospectDetail.js";

const CATEGORIES = [
  ["ad_spend", "Ad Spend"],
  ["subcontractor", "Subcontractor"],
  ["software", "Software"],
  ["data_airtime", "Data & Airtime"],
  ["transport", "Transport"],
  ["equipment", "Equipment"],
  ["other", "Other"],
];
const CATEGORY_LABELS = Object.fromEntries(CATEGORIES);

let filterCategory = "all";

function amountOf(e) {
  return Number(e.amount) || 0;
}

// money() in utils.js puts the dollar sign in front of whatever it's given, so
// a negative comes out as "$-190". Nothing in the app had ever handed it a
// negative before, every other money figure in here is a total that can only
// go up. Profit can go down, so it needs the minus in front of the sign rather
// than after it, which is how every bank statement and accounting package
// writes it and therefore what people actually read at a glance.
//
// Deliberately local rather than a fix inside money() itself: that function is
// called from a dozen views and changing what it returns would quietly alter
// every one of them, to fix a case only this screen can produce.
function signedMoney(n) {
  const v = Number(n) || 0;
  return v < 0 ? "-" + money(Math.abs(v)) : money(v);
}

// "This month" is keyed on spent_on, never created_at. Someone typing in a
// receipt from three weeks ago is recording money that left in that month, and
// filing it under the day they got round to the paperwork would move real
// spending into the wrong month and make both months wrong.
function spentThisMonth() {
  const start = firstOfMonth();
  return store.expenses.filter((e) => e.spent_on && e.spent_on >= start);
}

function collectedThisMonth() {
  const start = firstOfMonth();
  return store.invoices
    .filter((i) => i.status === "paid" && i.paid_date && i.paid_date >= start)
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
}

// ---- profit by client ------------------------------------------------------
//
// Revenue counts paid invoices only, not sent, not drafted. Money that has
// been billed but not received cannot be counted against money that has
// definitely left the account, or a client who never pays would show up as the
// most profitable one on the list right up until they're written off.
function profitByClient() {
  const rows = new Map();

  const bump = (prospectId, key, value) => {
    if (!prospectId) return;
    const prospect = prospectById(prospectId);
    if (!prospect) return; // deleted client; its money falls out of the ranking
    if (!rows.has(prospectId)) {
      rows.set(prospectId, { prospect, revenue: 0, cost: 0, invoiceCount: 0, expenseCount: 0 });
    }
    const row = rows.get(prospectId);
    row[key] += value;
    if (key === "revenue") row.invoiceCount++;
    else row.expenseCount++;
  };

  store.invoices
    .filter((i) => i.status === "paid")
    .forEach((i) => bump(i.prospect_id, "revenue", Number(i.amount) || 0));
  store.expenses.forEach((e) => bump(e.prospect_id, "cost", amountOf(e)));

  return Array.from(rows.values())
    .map((r) => ({
      ...r,
      profit: r.revenue - r.cost,
      // Margin is only meaningful against revenue that exists. A client with
      // costs and no payments yet has an undefined margin, not a -100% one,       // showing -100% would rank a brand-new client alongside a genuine
      // loss-maker, which are completely different problems.
      margin: r.revenue > 0 ? Math.round(((r.revenue - r.cost) / r.revenue) * 100) : null,
    }))
    .sort((a, b) => a.profit - b.profit); // worst first: the ones needing a decision
}

function categoryTotals(list) {
  const totals = new Map();
  list.forEach((e) => totals.set(e.category, (totals.get(e.category) || 0) + amountOf(e)));
  return Array.from(totals.entries())
    .map(([key, total]) => ({ key, label: CATEGORY_LABELS[key] || key, total }))
    .sort((a, b) => b.total - a.total);
}

export function renderExpenses() {
  const root = document.getElementById("view-expenses");
  root.innerHTML = "";

  const monthList = spentThisMonth();
  const spent = monthList.reduce((sum, e) => sum + amountOf(e), 0);
  const collected = collectedThisMonth();
  const profit = collected - spent;
  // The standing monthly burn, subscriptions and retainers the agency itself
  // pays, separated from one-off spending because it's the number that says
  // what a quiet month still costs. It reads every recurring expense ever
  // logged, not just this month's, since the whole point is that these repeat
  // whether or not anyone remembered to enter one this month.
  const recurringBurn = store.expenses.filter((e) => e.recurring).reduce((sum, e) => sum + amountOf(e), 0);
  const clientRows = profitByClient();
  const losing = clientRows.filter((r) => r.profit < 0);
  const cats = categoryTotals(monthList);
  // Ad spend fronted on a client's behalf that hasn't been attached to any
  // client is money the agency has quietly absorbed. It's the single easiest
  // way to lose money without noticing, because nothing else in the app has
  // any reason to mention it.
  const unattributedAdSpend = store.expenses.filter((e) => e.category === "ad_spend" && !e.prospect_id);
  const unattributedTotal = unattributedAdSpend.reduce((sum, e) => sum + amountOf(e), 0);

  const wrap = el(`
    <div>
      <div class="flex-between">
        <div class="page-title mt-0">Expenses<span class="accent">.</span></div>
        <div style="display:flex;gap:14px;">
          <span class="small-link" id="ex-export-csv">Export CSV</span>
          <span class="small-link" id="ex-new">+ New Expense</span>
        </div>
      </div>

      <div class="stat-grid cols-3" style="margin-bottom:16px;">
        <div class="stat-card"><div class="num">${money(spent)}</div><div class="label">Spent This Month</div></div>
        <div class="stat-card ${profit < 0 ? "accent" : "purple"}"><div class="num">${signedMoney(profit)}</div><div class="label">Profit This Month</div></div>
        <div class="stat-card"><div class="num">${money(recurringBurn)}</div><div class="label">Monthly Recurring Burn</div></div>
      </div>

      <div class="hint" style="margin:-6px 2px 16px;">
        Profit This Month is money collected this month minus money spent this month. It doesn't
        guess at tax or anything the app hasn't been told about.
      </div>

      ${clientRows.length ? `
        <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
          <div class="stat-card ${losing.length ? "accent" : "purple"}" id="ex-profit-card" style="cursor:pointer;">
            <div class="num">${losing.length ? losing.length : clientRows.length}</div>
            <div class="label">${losing.length
              ? `Client${losing.length === 1 ? " is" : "s are"} costing more than they pay, tap to see who`
              : `Client${clientRows.length === 1 ? "" : "s"} with money tracked, tap for profit ranking`}</div>
          </div>
        </div>
      ` : ""}

      ${unattributedAdSpend.length ? `
        <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;">
          <div class="stat-card accent" id="ex-unattributed-card" style="cursor:pointer;">
            <div class="num">${money(unattributedTotal)}</div>
            <div class="label">Ad spend not linked to any client, tap to fix</div>
          </div>
        </div>
      ` : ""}

      ${cats.length ? `
        <div class="section-title">This Month by Category</div>
        <div class="stat-grid" id="ex-cat-grid" style="margin-bottom:16px;"></div>
      ` : ""}

      <div class="chip-row" id="ex-cat-chips"></div>
      <div id="ex-list"></div>
    </div>
  `);
  root.appendChild(wrap);

  wrap.querySelector("#ex-new").addEventListener("click", () => openExpenseSheet(null));
  wrap.querySelector("#ex-export-csv").addEventListener("click", exportExpensesCSV);
  if (clientRows.length) {
    wrap.querySelector("#ex-profit-card").addEventListener("click", () => openProfitByClientModal(clientRows));
  }
  if (unattributedAdSpend.length) {
    wrap.querySelector("#ex-unattributed-card").addEventListener("click", () => openUnattributedModal(unattributedAdSpend));
  }
  if (cats.length) {
    const grid = wrap.querySelector("#ex-cat-grid");
    cats.forEach((c) => {
      const card = el(`
        <div class="stat-card" style="cursor:pointer;">
          <div class="num">${money(c.total)}</div>
          <div class="label">${esc(c.label)}</div>
        </div>
      `);
      card.addEventListener("click", () => { filterCategory = c.key; renderExpenses(); });
      grid.appendChild(card);
    });
  }

  const chipRow = wrap.querySelector("#ex-cat-chips");
  [["all", "All"], ...CATEGORIES].forEach(([val, label]) => {
    const chip = el(`<span class="chip ${filterCategory === val ? "active" : ""}">${label}</span>`);
    chip.addEventListener("click", () => { filterCategory = val; renderExpenses(); });
    chipRow.appendChild(chip);
  });

  renderList(wrap.querySelector("#ex-list"));
}

function renderList(listEl) {
  if (!listEl) listEl = document.getElementById("ex-list");
  if (!listEl) return;

  let items = store.expenses.slice();
  if (filterCategory !== "all") items = items.filter((e) => e.category === filterCategory);
  items.sort((a, b) => (b.spent_on || "").localeCompare(a.spent_on || ""));

  listEl.innerHTML = "";
  if (!items.length) {
    listEl.appendChild(el(`
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="6" width="19" height="13" rx="3"/><path d="M2.5 10.5h19"/><path d="M6.5 15h4"/></svg>
        <p>${filterCategory === "all"
          ? "Nothing recorded yet. Add what the agency spends and every screen can start showing profit instead of just revenue."
          : "No expenses in this category."}</p>
      </div>
    `));
    return;
  }

  items.forEach((e) => {
    const prospect = e.prospect_id ? prospectById(e.prospect_id) : null;
    const creator = profileById(e.created_by);
    const card = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between" style="margin-bottom:4px;">
          <div style="font-weight:700;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(e.description || "Untitled expense")}</div>
          <span class="status-pill" style="flex:0 0 auto;">${esc(CATEGORY_LABELS[e.category] || e.category)}</span>
        </div>
        <div class="text-faint" style="font-size:12px;margin-bottom:6px;">
          ${prospect ? esc(prospect.business_name) : "General overhead"}${creator ? " · " + esc(creator.full_name || creator.email) : ""}${e.recurring ? " · repeats monthly" : ""}
        </div>
        <div class="flex-between">
          <span style="font-weight:700;font-size:15px;">${money(e.amount)}</span>
          <span class="text-faint" style="font-size:11px;">${e.spent_on ? fmtDate(e.spent_on) : "No date"}</span>
        </div>
      </div>
    `);
    card.addEventListener("click", () => openExpenseSheet(e));
    listEl.appendChild(card);
  });
}

function openProfitByClientModal(rows) {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:6px;">Profit by Client</div>
      <div class="hint" style="margin:0 0 12px;">
        Money each client has actually paid, minus costs booked against them. Shared running
        costs like software and office data aren't split across clients. They're not any one
        client's fault, so guessing a share would only invent a number.
      </div>
      <div id="ex-profit-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#ex-profit-list");
  rows.forEach((r) => {
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between" style="margin-bottom:4px;">
          <div style="font-weight:700;font-size:13.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.prospect.business_name)}</div>
          <span style="font-weight:800;font-size:14px;flex:0 0 auto;" class="${r.profit < 0 ? "accent" : ""}">${signedMoney(r.profit)}</span>
        </div>
        <div class="text-faint" style="font-size:11.5px;">
          ${money(r.revenue)} in${r.cost ? ` · ${money(r.cost)} out` : " · no costs booked"}${r.margin === null ? "" : ` · ${r.margin}% margin`}
        </div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openProspectDetail(r.prospect);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

function openUnattributedModal(rows) {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:6px;">Ad Spend With No Client</div>
      <div class="hint" style="margin:0 0 12px;">
        Ad budget is nearly always spent for a particular client. Anything left unlinked here is
        being carried by the agency, and won't show against that client's profit. Tap one to
        attach it.
      </div>
      <div id="ex-unattr-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#ex-unattr-list");
  rows.forEach((e) => {
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;font-size:13.5px;">${esc(e.description || "Untitled expense")}</div>
          <span style="font-weight:700;font-size:14px;flex:0 0 auto;">${money(e.amount)}</span>
        </div>
        <div class="text-faint" style="font-size:11px;margin-top:4px;">${e.spent_on ? fmtDate(e.spent_on) : "No date"}</div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openExpenseSheet(e);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

function exportExpensesCSV() {
  let items = store.expenses.slice();
  if (filterCategory !== "all") items = items.filter((e) => e.category === filterCategory);
  if (!items.length) return toast("Nothing to export", "error");
  const columns = [
    { label: "Date", get: (e) => e.spent_on || "" },
    { label: "Description", get: (e) => e.description || "" },
    { label: "Category", get: (e) => CATEGORY_LABELS[e.category] || e.category },
    { label: "Amount", get: (e) => e.amount ?? 0 },
    { label: "Client", get: (e) => prospectById(e.prospect_id)?.business_name || "" },
    { label: "Repeats Monthly", get: (e) => (e.recurring ? "Yes" : "No") },
    { label: "Added By", get: (e) => { const p = profileById(e.created_by); return p ? p.full_name || p.email : ""; } },
    { label: "Notes", get: (e) => e.notes || "" },
  ];
  downloadTextFile(`expenses-${todayISO()}.csv`, toCSV(items, columns));
}

export function openExpenseSheet(existing) {
  const e = existing || {};
  const isEdit = !!e.id;
  const isOwner = store.profile?.role === "owner";
  // Matches the RLS policy in the migration exactly. Showing a Save button
  // that the database will refuse is worse than not showing it, the person
  // fills the whole form in first and only then finds out.
  const canEdit = !isEdit || isOwner || e.created_by === store.profile?.id;
  const canDelete = isEdit && isOwner;

  const prospectOptions = store.prospects
    .slice()
    .sort((a, b) => a.business_name.localeCompare(b.business_name))
    .map((p) => `<option value="${p.id}" ${e.prospect_id === p.id ? "selected" : ""}>${esc(p.business_name)}</option>`)
    .join("");

  const box = el(`
    <div>
      <div class="field">
        <label>What was it for? *</label>
        <input id="ex-desc" type="text" value="${esc(e.description || "")}" placeholder="e.g. Facebook ads for Kombi Wash" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Amount (USD) *</label>
          <input id="ex-amount" type="number" min="0" step="1" value="${e.amount ?? ""}" placeholder="e.g. 60" />
        </div>
        <div class="field">
          <label>Date spent</label>
          <input id="ex-date" type="date" value="${e.spent_on || todayISO()}" />
        </div>
      </div>
      <div class="field">
        <label>Category</label>
        <select id="ex-category">
          ${CATEGORIES.map(([val, label]) => `<option value="${val}" ${(e.category || "other") === val ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Spent for which client?</label>
        <select id="ex-prospect"><option value="">General overhead (not one client)</option>${prospectOptions}</select>
        <div class="hint" style="margin-top:6px;">
          Link it to a client when the money was spent specifically for them, like ad budget or a
          freelancer on their job. Leave it on overhead for costs of just being open, like
          software or office data.
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin:4px 0 14px;font-size:13px;">
        <input id="ex-recurring" type="checkbox" ${e.recurring ? "checked" : ""} style="width:auto;" />
        This repeats every month
      </label>
      <div class="field">
        <label>Notes</label>
        <textarea id="ex-notes" placeholder="Anything worth remembering...">${esc(e.notes || "")}</textarea>
      </div>
      ${canEdit ? `<button id="ex-save" class="btn btn-primary">${isEdit ? "Save Changes" : "Add Expense"}</button>` : `
        <div class="hint" style="margin:0 0 4px;">Only the person who added this expense, or the owner, can change it.</div>
      `}
      ${canDelete ? `<button id="ex-delete" class="btn btn-danger" style="margin-top:10px;">Delete Expense</button>` : ""}
    </div>
  `);

  const saveBtn = box.querySelector("#ex-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const description = box.querySelector("#ex-desc").value.trim();
      if (!description) return toast("Say what the money was for", "error");
      const amount = Number(box.querySelector("#ex-amount").value);
      if (!amount || amount <= 0) return toast("Enter an amount above zero", "error");

      const payload = {
        description,
        amount,
        category: box.querySelector("#ex-category").value,
        prospect_id: box.querySelector("#ex-prospect").value || null,
        spent_on: box.querySelector("#ex-date").value || todayISO(),
        recurring: box.querySelector("#ex-recurring").checked,
        notes: box.querySelector("#ex-notes").value.trim(),
      };

      saveBtn.disabled = true;
      if (isEdit) {
        const { error } = await sb.from("expenses").update(payload).eq("id", e.id);
        saveBtn.disabled = false;
        if (error) return toast(error.message, "error");
        toast("Saved", "success");
      } else {
        payload.created_by = store.profile.id;
        const { error } = await sb.from("expenses").insert(payload);
        saveBtn.disabled = false;
        if (error) return toast(error.message, "error");
        toast("Expense added", "success");
      }
      await refreshExpenses();
      closeSheet();
    });
  }

  const delBtn = box.querySelector("#ex-delete");
  if (delBtn) {
    delBtn.addEventListener("click", () => {
      confirmModal({
        title: "Delete this expense?",
        body: `This removes <b>${esc(e.description)}</b> (${money(e.amount)}) for good, and the agency will look more profitable than it was. Only do this if it was entered by mistake.`,
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
          const { error } = await sb.from("expenses").delete().eq("id", e.id);
          if (error) return toast(error.message, "error");
          toast("Expense deleted", "success");
          await refreshExpenses();
          closeSheet();
        },
      });
    });
  }

  openSheet(isEdit ? "Edit Expense" : "New Expense", box);
}

// Expenses aren't part of the Realtime subscription set (they change rarely
// and nobody needs to watch a teammate type one in), so the list is pulled
// again after this device changes something. Without this the screen behind
// the sheet would keep showing the old totals until a full reload.
export async function refreshExpenses() {
  const { data } = await sb.from("expenses").select("*").order("spent_on", { ascending: false });
  store.expenses = data || [];
  emit("expenses");
}

export function initExpensesView() {
  on("expenses", () => { if (isActive()) renderExpenses(); });
  // Profit depends on invoices as much as on expenses, so a payment marked
  // Paid on another screen has to redraw this one too.
  on("invoices", () => { if (isActive()) renderExpenses(); });
}

function isActive() {
  return document.getElementById("view-expenses")?.classList.contains("active");
}
