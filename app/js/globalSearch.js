// ============================================================================
// GLOBAL SEARCH, one box, everything in the org
// ----------------------------------------------------------------------------
// Searches prospects (by business name/area/city), contracts and invoices
// (by title/number, or by the client they're linked to), projects (by
// name, or by their linked client), niches (by name/notes), message
// templates (by title/body/category), and grid plans (by client name), // all against data already loaded into
// `store` (no extra network round-trip). Prospect notes are the one
// exception: `prospect_notes` isn't preloaded org-wide (only lazy-loaded per
// prospect when someone opens Prospect Detail), so a note's content is
// otherwise invisible unless you already know which prospect to open and
// scroll through their notes tab. Every keystroke also fires a small
// `ilike` query against `prospect_notes` and appends a "Notes" group once
// it resolves, so an objection, quote or call outcome someone typed weeks
// ago on any prospect is instantly findable from the same search box. Two
// entry points share the same matching + row-building logic:
//   - Desktop: a real search bar pinned in the sidebar with an inline
//     dropdown of results underneath it.
//   - Phone: a search icon in the topbar that opens the same results list
//     inside the app's existing bottom sheet (there's no persistent sidebar
//     to anchor a dropdown to at that width).
// Clicking any result opens that item exactly the way it opens everywhere
// else in the app (prospect detail sheet, contract/invoice/project sheet), // those sheets already float above whatever view is currently showing, so
// there's no need to switch tabs first.
// ============================================================================

import { sb } from "./supabaseClient.js";
import { store, prospectById } from "./state.js";
import { esc, money, debounce } from "./utils.js";
import { openSheet, closeSheet } from "./ui.js";
import { openProspectDetail } from "./views/prospectDetail.js";
import { openContractSheet } from "./views/contracts.js";
import { openInvoiceSheet } from "./views/invoices.js";
import { openProjectDetail } from "./views/projects.js";
import { openNicheForm, overallScore } from "./views/niches.js";
import { openTemplateForm } from "./views/messages.js";

const MAX_PER_GROUP = 5;
const MIN_QUERY_LEN = 2;

function computeMatches(query) {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY_LEN) return null;

  const clientName = (prospectId) => (prospectById(prospectId)?.business_name || "").toLowerCase();

  // Agents often have a raw WhatsApp number, email, or Instagram handle in
  // hand (from a reply, a referral, or before adding a new lead) and need a
  // quick "is this prospect already in the pipeline?" check, so contact
  // fields count as a match here too, not just name/area/city.
  const prospects = store.prospects
    .filter(
      (p) =>
        (p.business_name || "").toLowerCase().includes(q) ||
        (p.area || "").toLowerCase().includes(q) ||
        (p.city || "").toLowerCase().includes(q) ||
        (p.whatsapp_number || "").toLowerCase().includes(q) ||
        (p.email || "").toLowerCase().includes(q) ||
        (p.instagram || "").toLowerCase().includes(q)
    )
    .slice(0, MAX_PER_GROUP);

  const contracts = store.contracts
    .filter((c) => (c.title || "").toLowerCase().includes(q) || clientName(c.prospect_id).includes(q))
    .slice(0, MAX_PER_GROUP);

  const invoices = store.invoices
    .filter((i) => (i.invoice_number || "").toLowerCase().includes(q) || clientName(i.prospect_id).includes(q))
    .slice(0, MAX_PER_GROUP);

  const projects = store.projects
    .filter((p) => (p.name || "").toLowerCase().includes(q) || clientName(p.prospect_id).includes(q))
    .slice(0, MAX_PER_GROUP);

  const niches = store.niches
    .filter((n) => (n.name || "").toLowerCase().includes(q) || (n.notes || "").toLowerCase().includes(q))
    .slice(0, MAX_PER_GROUP);

  const templates = store.templates
    .filter(
      (t) =>
        (t.title || "").toLowerCase().includes(q) ||
        (t.body || "").toLowerCase().includes(q) ||
        (t.category || "").toLowerCase().includes(q)
    )
    .slice(0, MAX_PER_GROUP);

  // Grid plans were the one client-facing record type left out of search,   // contracts, invoices and projects all match on their client's name, so
  // grid plans do too, keyed on the same client_name field they're already
  // listed by everywhere else (gridPlans.js).
  const gridPlans = store.gridPlans
    .filter((g) => (g.client_name || "").toLowerCase().includes(q))
    .slice(0, MAX_PER_GROUP);

  return { prospects, contracts, invoices, projects, niches, templates, gridPlans, q };
}

// Notes matches come back from an async Supabase query rather than the
// synchronous in-memory `store`, so they're tracked separately from
// computeMatches()/buildResultsHTML() above and appended into the results
// container once the query resolves (see runNoteSearch below). A token
// guard discards a response if a newer keystroke has already superseded it.
let noteSearchToken = 0;
let currentNoteResults = [];

async function fetchNoteMatches(q) {
  const { data, error } = await sb
    .from("prospect_notes")
    .select("id, prospect_id, body, created_at")
    .ilike("body", `%${q}%`)
    .order("created_at", { ascending: false })
    .limit(MAX_PER_GROUP);
  if (error || !data) return [];
  return data;
}

function noteRows(notes) {
  return notes
    .map((n) => {
      const client = prospectById(n.prospect_id)?.business_name || "Unknown business";
      const snippet = (n.body || "").replace(/\s+/g, " ").trim();
      const short = snippet.length > 70 ? snippet.slice(0, 70) + "…" : snippet;
      return resultRow("note", n.id, esc(client), esc(short));
    })
    .join("");
}

async function runNoteSearch(query, resultsEl) {
  const q = query.trim().toLowerCase();
  const token = ++noteSearchToken;
  if (q.length < MIN_QUERY_LEN) { currentNoteResults = []; return; }
  const notes = await fetchNoteMatches(q);
  if (token !== noteSearchToken) return; // a newer keystroke already superseded this search
  currentNoteResults = notes;
  if (!notes.length) return; // nothing to add, leave the synchronous groups as rendered
  const notesHTML = group("Notes", noteRows(notes));
  if (resultsEl.querySelector(".hint")) {
    // The synchronous groups found nothing, so the notes group is the whole result set.
    resultsEl.innerHTML = notesHTML;
  } else {
    resultsEl.insertAdjacentHTML("beforeend", notesHTML);
  }
}

function resultRow(type, id, title, subtitle) {
  return `
    <div class="gsearch-row" data-type="${type}" data-id="${esc(id)}">
      <div class="gsearch-row-title">${title}</div>
      <div class="gsearch-row-sub">${subtitle}</div>
    </div>
  `;
}

function group(label, rowsHTML) {
  return rowsHTML ? `<div class="gsearch-group-label">${label}</div>${rowsHTML}` : "";
}

function buildResultsHTML(matches) {
  if (!matches) {
    return `<div class="hint" style="padding:10px 8px;">Type at least ${MIN_QUERY_LEN} characters to search prospects, contracts, invoices, projects, niches, templates, grid plans and notes.</div>`;
  }
  const total =
    matches.prospects.length + matches.contracts.length + matches.invoices.length + matches.projects.length +
    matches.niches.length + matches.templates.length + matches.gridPlans.length;
  if (!total) return `<div class="hint" style="padding:10px 8px;">No matches.</div>`;

  const prospectRows = matches.prospects
    .map((p) => {
      // If the match came from a contact field rather than name/area/city,
      // surface which one so it's clear why this row showed up.
      const nameAreaCityMatched =
        (p.business_name || "").toLowerCase().includes(matches.q) ||
        (p.area || "").toLowerCase().includes(matches.q) ||
        (p.city || "").toLowerCase().includes(matches.q);
      const contactMatch = !nameAreaCityMatched
        ? [p.whatsapp_number, p.email, p.instagram].find((v) => (v || "").toLowerCase().includes(matches.q))
        : null;
      const subtitle = contactMatch
        ? `${(p.status || "").replace(/_/g, " ")} · ${esc(contactMatch)}`
        : `${(p.status || "").replace(/_/g, " ")}${p.area ? " · " + esc(p.area) : ""}`;
      return resultRow("prospect", p.id, esc(p.business_name), subtitle);
    })
    .join("");

  const contractRows = matches.contracts
    .map((c) => {
      const client = prospectById(c.prospect_id)?.business_name;
      return resultRow("contract", c.id, esc(c.title), `${client ? esc(client) + " · " : ""}${money(c.value)}`);
    })
    .join("");

  const invoiceRows = matches.invoices
    .map((i) => {
      const client = prospectById(i.prospect_id)?.business_name;
      return resultRow("invoice", i.id, esc(i.invoice_number || "Untitled invoice"), `${client ? esc(client) + " · " : ""}${money(i.amount)}`);
    })
    .join("");

  const projectRows = matches.projects
    .map((p) => {
      const client = prospectById(p.prospect_id)?.business_name;
      return resultRow("project", p.id, esc(p.name), `${client ? esc(client) + " · " : ""}${(p.status || "").replace(/_/g, " ")}`);
    })
    .join("");

  const nicheRows = matches.niches
    .map((n) => resultRow("niche", n.id, esc(n.name), `Score ${overallScore(n)}`))
    .join("");

  const templateRows = matches.templates
    .map((t) => {
      const niche = t.niche_id ? store.niches.find((n) => n.id === t.niche_id) : null;
      return resultRow("template", t.id, esc(t.title), `${(t.category || "").replace(/_/g, " ")}${niche ? " · " + esc(niche.name) : ""}`);
    })
    .join("");

  const gridPlanRows = matches.gridPlans
    .map((g) => resultRow("gridplan", g.id, esc(g.client_name), `Grid plan · ${(g.status || "").replace(/_/g, " ")}`))
    .join("");

  return [
    group("Prospects", prospectRows),
    group("Contracts", contractRows),
    group("Invoices", invoiceRows),
    group("Projects", projectRows),
    group("Niches", nicheRows),
    group("Message Templates", templateRows),
    group("Grid Plans", gridPlanRows),
  ].join("");
}

function openResult(type, id) {
  if (type === "prospect") {
    const p = store.prospects.find((x) => x.id === id);
    if (p) openProspectDetail(p);
  } else if (type === "contract") {
    const c = store.contracts.find((x) => x.id === id);
    if (c) openContractSheet(c);
  } else if (type === "invoice") {
    const i = store.invoices.find((x) => x.id === id);
    if (i) openInvoiceSheet(i);
  } else if (type === "project") {
    const p = store.projects.find((x) => x.id === id);
    if (p) openProjectDetail(p);
  } else if (type === "niche") {
    // Niche editing is owner-only everywhere else in the app (the "Edit"
    // link on a niche card is hidden from non-owners), match that here
    // instead of letting search punch a hole in that restriction.
    if (store.profile?.role !== "owner") return;
    const n = store.niches.find((x) => x.id === id);
    if (n) openNicheForm(n);
  } else if (type === "template") {
    const t = store.templates.find((x) => x.id === id);
    if (t) openTemplateForm(t);
  } else if (type === "note") {
    const n = currentNoteResults.find((x) => x.id === id);
    const p = n ? prospectById(n.prospect_id) : null;
    if (p) openProspectDetail(p);
  } else if (type === "gridplan") {
    goToGridPlanResult(id);
  }
}

// Grid plans live on their own tab rather than floating in a sheet above
// whatever's currently open (unlike contracts/invoices/projects), so
// opening one from search means switching views first, same deep-link
// pattern dashboard.js's goToGridPlan already uses. Dynamic import keeps
// globalSearch.js from needing a static dependency on main.js.
async function goToGridPlanResult(id) {
  const [{ switchView }, { openGridPlanId }] = await Promise.all([import("./main.js"), import("./views/gridPlans.js")]);
  openGridPlanId(id);
  switchView("gridplans");
}

function wireResultClicks(container, onOpen) {
  container.addEventListener("click", (e) => {
    const row = e.target.closest(".gsearch-row");
    if (!row) return;
    openResult(row.dataset.type, row.dataset.id);
    if (onOpen) onOpen();
  });
}

// ---- desktop sidebar dropdown ---------------------------------------------

function initSidebarSearch() {
  const input = document.getElementById("global-search-input");
  const results = document.getElementById("global-search-results");
  if (!input || !results) return;

  const runSearch = debounce(() => {
    results.innerHTML = buildResultsHTML(computeMatches(input.value));
    runNoteSearch(input.value, results);
  }, 150);

  input.addEventListener("input", () => {
    results.classList.add("open");
    runSearch();
  });
  input.addEventListener("focus", () => {
    results.classList.add("open");
    results.innerHTML = buildResultsHTML(computeMatches(input.value));
    runNoteSearch(input.value, results);
  });

  wireResultClicks(results, () => {
    results.classList.remove("open");
    input.value = "";
    input.blur();
  });

  // Click-away closes the dropdown without clearing what was typed, in case
  // they just want to glance elsewhere and come back to it.
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".sidebar-search")) results.classList.remove("open");
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { results.classList.remove("open"); input.blur(); }
  });
}

// ---- mobile: topbar icon -> bottom sheet -----------------------------------

function openSearchSheet() {
  const box = document.createElement("div");
  box.innerHTML = `
    <div class="search-bar" style="margin-bottom:14px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="gs-sheet-input" type="text" placeholder="Search everything..." autocomplete="off" />
    </div>
    <div id="gs-sheet-results"></div>
  `;

  const input = box.querySelector("#gs-sheet-input");
  const results = box.querySelector("#gs-sheet-results");
  results.innerHTML = buildResultsHTML(null);

  const runSearch = debounce(() => {
    results.innerHTML = buildResultsHTML(computeMatches(input.value));
    runNoteSearch(input.value, results);
  }, 150);
  input.addEventListener("input", runSearch);

  wireResultClicks(results, () => closeSheet());

  openSheet("Search", box);
  setTimeout(() => input.focus(), 50);
}

function initMobileSearch() {
  const btn = document.getElementById("btn-search");
  if (btn) btn.addEventListener("click", openSearchSheet);
}

export function initGlobalSearch() {
  initSidebarSearch();
  initMobileSearch();
}
