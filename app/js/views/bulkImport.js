import { sb } from "../supabaseClient.js";
import { store } from "../state.js";
import { el, esc, toast, titleCase, findDuplicateProspect, toCSV, downloadTextFile } from "../utils.js";
import { openSheet, closeSheet, confirmModal } from "../ui.js";
import { hasNoContactMethod } from "./pipeline.js";

const COLUMNS = ["Business Name", "Niche", "Area", "WhatsApp", "Email", "Instagram", "Rating", "Gap / Observation", "Tier (A/B/C)", "Heat Score", "City (optional, defaults to Harare)"];

export function openBulkImportSheet() {
  const box = el(`
    <div>
      <p style="font-size:13px;color:var(--text-dim);line-height:1.5;margin-top:0;">
        Paste rows copied straight from a spreadsheet (or type your own, one prospect per line).
        Separate the fields on each line with <b>commas</b> or <b>tabs</b>, whichever your list already uses.
      </p>
      <div class="card" style="margin-bottom:12px;font-size:11.5px;color:var(--text-faint);">
        Column order: ${COLUMNS.map((c, i) => `${i + 1}. ${c}`).join(" &nbsp;·&nbsp; ")}
        <br/><br/>Only <b>Business Name</b> is required, leave the rest blank if you don't have it.
        <br/><br/><span class="small-link" id="bi-download-template">Download Sample CSV</span>
      </div>
      <div class="field">
        <textarea id="bi-text" style="min-height:160px;font-family:monospace;font-size:12px;" placeholder="The Fig & Olive, Restaurants, Borrowdale, 0771234567, hello@fig.co.zw, @figandolive, 4.6, No posts in 3 months, A, 78"></textarea>
      </div>
      <button class="btn btn-primary" id="bi-preview">Preview Import</button>
      <div id="bi-results" style="margin-top:14px;"></div>
    </div>
  `);

  box.querySelector("#bi-preview").addEventListener("click", () => runPreview(box));
  box.querySelector("#bi-download-template").addEventListener("click", downloadSampleCSV);
  openSheet("Bulk Import Prospects", box);
}

// Agents copying from ad-hoc spreadsheets had only the inline "Column
// order: ..." hint to go on — easy to misalign columns (e.g. Rating landing
// in the Tier slot) when re-typing/re-ordering their own sheet by hand. A
// ready-made template with the exact header + one filled example row can be
// opened in Excel/Sheets, filled in, and pasted straight back in. Reuses the
// same COLUMNS list the preview hint and parser already agree on, so the
// template can never drift out of sync with what runPreview() expects.
function downloadSampleCSV() {
  const exampleRow = {
    "Business Name": "The Fig & Olive",
    "Niche": "Restaurants",
    "Area": "Borrowdale",
    "WhatsApp": "0771234567",
    "Email": "hello@fig.co.zw",
    "Instagram": "@figandolive",
    "Rating": "4.6",
    "Gap / Observation": "No posts in 3 months",
    "Tier (A/B/C)": "A",
    "Heat Score": "78",
    "City (optional, defaults to Harare)": "Harare",
  };
  const csv = toCSV([exampleRow], COLUMNS.map((c) => ({ label: c, get: (r) => r[c] || "" })));
  downloadTextFile("prospect-import-template.csv", csv);
}

function splitLine(line) {
  const delim = line.includes("\t") ? "\t" : ",";
  return line.split(delim).map((s) => s.trim());
}

function findNicheId(name) {
  if (!name) return null;
  const match = store.niches.find((n) => n.name.toLowerCase() === name.toLowerCase());
  return match ? match.id : null;
}

// Flags rows that look like duplicates — either of a prospect already in
// the pipeline, or of an earlier row in this same pasted batch (easy to do
// by accident when copying from a big spreadsheet). Returns one entry per
// row: null if clean, or { with, reason, inBatch } describing the match.
function computeDuplicateFlags(rows) {
  return rows.map((r, i) => {
    const existing = findDuplicateProspect(r.business_name, r.whatsapp_number, store.prospects);
    if (existing) return { with: existing.prospect.business_name, reason: existing.reason, inBatch: false };
    const inBatch = findDuplicateProspect(r.business_name, r.whatsapp_number, rows.slice(0, i));
    if (inBatch) return { with: inBatch.prospect.business_name, reason: inBatch.reason, inBatch: true };
    return null;
  });
}

function runPreview(box) {
  const raw = box.querySelector("#bi-text").value;
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  // Rows whose pasted niche text didn't match any known niche by name —
  // silently landing with niche_id: null used to be invisible until later,
  // when auto-personalization or Niche Strategy stats quietly skipped the
  // prospect. Tracked as { idx, raw } pairs (idx = the row's eventual
  // position in `rows`) so the confirm step can apply whatever the agent
  // picks from a dropdown right before insert.
  const nicheUnmatched = [];

  lines.forEach((line, i) => {
    const cols = splitLine(line);
    const business_name = cols[0];
    if (!business_name) { errors.push(`Line ${i + 1}: missing business name`); return; }
    const nicheRaw = (cols[1] || "").trim();
    const niche_id = findNicheId(nicheRaw);
    if (nicheRaw && !niche_id) nicheUnmatched.push({ idx: rows.length, raw: nicheRaw });
    const tierRaw = (cols[8] || "B").toUpperCase().trim();
    const tier = ["A", "B", "C"].includes(tierRaw) ? tierRaw : "B";
    const heat = Number(cols[9]);
    rows.push({
      business_name,
      niche_id,
      city: titleCase(cols[10]) || "Harare",
      area: cols[2] || "",
      whatsapp_number: cols[3] || "",
      email: cols[4] || "",
      instagram: cols[5] || "",
      rating: cols[6] ? Number(cols[6]) || null : null,
      gap_note: cols[7] || "",
      tier,
      heat_score: Number.isFinite(heat) ? Math.max(0, Math.min(100, heat)) : 50,
      created_by: store.profile.id,
    });
  });

  const dupFlags = computeDuplicateFlags(rows);
  const dupeCount = dupFlags.filter(Boolean).length;

  // Pipeline's "Unreachable" flag (hasNoContactMethod, pipeline.js) only ever
  // catches this after a lead's already imported and sitting in the pipeline
  // looking like normal backlog. Reusing that exact same check here surfaces
  // it at preview time instead — purely a heads-up, not a block, since a
  // business with no contact info today might still be worth having on file
  // for later enrichment.
  const noContactRows = rows.filter(hasNoContactMethod);
  const noContactListHtml = noContactRows
    .map((r) => "<div style=\"font-size:12px;line-height:1.6;\">" + esc(r.business_name) + "</div>")
    .join("");
  const noContactCard = noContactRows.length
    ? "<div class=\"card\" style=\"margin-bottom:10px;border-color:var(--warn);\">"
      + "<div style=\"font-weight:700;font-size:13px;color:var(--warn);margin-bottom:6px;\">⚠ " + noContactRows.length
      + (noContactRows.length === 1 ? " row has" : " rows have")
      + " no WhatsApp, email, or Instagram. They'll import fine, but land as \"Unreachable\" in Pipeline until enriched</div>"
      + noContactListHtml
      + "</div>"
    : "";

  const resultsEl = box.querySelector("#bi-results");
  resultsEl.innerHTML = `
    <div class="card" style="margin-bottom:10px;">
      <div style="font-weight:700;font-size:13.5px;margin-bottom:4px;">${rows.length} prospect${rows.length === 1 ? "" : "s"} ready to import</div>
      ${errors.length ? `<div style="color:var(--danger);font-size:12px;">${errors.length} line(s) skipped: ${esc(errors.join("; "))}</div>` : ""}
    </div>
    ${dupeCount ? `
      <div class="card" style="margin-bottom:10px;border-color:var(--warn);">
        <div style="font-weight:700;font-size:13px;color:var(--warn);margin-bottom:6px;">⚠ ${dupeCount} possible duplicate${dupeCount === 1 ? "" : "s"} found, unchecked rows below will be skipped</div>
        ${rows.map((r, i) => dupFlags[i] ? `
          <div class="field checkbox-row" style="margin-bottom:6px;">
            <input type="checkbox" class="bi-dupe-check" data-idx="${i}" id="bi-dupe-${i}" />
            <label style="margin:0;font-size:12px;line-height:1.4;" for="bi-dupe-${i}">
              Import <b>${esc(r.business_name)}</b> anyway: ${dupFlags[i].inBatch ? "duplicate within this pasted list, matches" : "already in the pipeline as"} <b>${esc(dupFlags[i].with)}</b> (${dupFlags[i].reason === "phone" ? "same WhatsApp number" : "same name"})
            </label>
          </div>
        ` : "").join("")}
      </div>
    ` : ""}
    ${noContactCard}
    ${nicheUnmatched.length ? `
      <div class="card" style="margin-bottom:10px;border-color:var(--warn);">
        <div style="font-weight:700;font-size:13px;color:var(--warn);margin-bottom:6px;">⚠ ${nicheUnmatched.length} niche name${nicheUnmatched.length === 1 ? "" : "s"} didn't match, pick the right one</div>
        ${nicheUnmatched.map(({ idx, raw }) => `
          <div class="field" style="margin-bottom:8px;">
            <label style="font-size:12px;line-height:1.4;display:block;margin-bottom:4px;">
              <b>${esc(rows[idx].business_name)}</b>: typed "${esc(raw)}"
            </label>
            <select id="bi-niche-fix-${idx}">
              <option value="">No niche</option>
              ${store.niches.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join("")}
            </select>
          </div>
        `).join("")}
      </div>
    ` : ""}
    ${rows.length ? `<button class="btn btn-primary" id="bi-confirm">Import Prospect${rows.length === 1 ? "" : "s"}</button>` : ""}
  `;

  const confirmBtn = resultsEl.querySelector("#bi-confirm");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", async () => {
      nicheUnmatched.forEach(({ idx }) => {
        const picked = resultsEl.querySelector(`#bi-niche-fix-${idx}`)?.value || null;
        rows[idx].niche_id = picked;
      });
      const skipIdx = new Set();
      resultsEl.querySelectorAll(".bi-dupe-check").forEach((cb) => {
        if (!cb.checked) skipIdx.add(Number(cb.dataset.idx));
      });
      const toInsert = rows.filter((_, i) => !skipIdx.has(i));
      if (!toInsert.length) return toast("Nothing left to import, check a duplicate row to import it anyway", "error");

      confirmBtn.disabled = true;
      confirmBtn.textContent = "Importing...";
      const { data, error } = await sb.from("prospects").insert(toInsert).select("id");
      if (error) {
        toast(error.message, "error");
        confirmBtn.disabled = false;
        confirmBtn.textContent = `Import Prospect${rows.length === 1 ? "" : "s"}`;
        return;
      }
      const skipped = rows.length - toInsert.length;
      toast(`Imported ${toInsert.length} prospect${toInsert.length === 1 ? "" : "s"}${skipped ? ` (${skipped} duplicate${skipped === 1 ? "" : "s"} skipped)` : ""}`, "success");
      showImportDone(resultsEl, data || [], toInsert.length);
    });
  }
}

// A bulk paste is exactly the kind of thing that goes wrong in a way you
// only notice after confirming — columns off by one, wrong niche mapped,
// pasted the wrong sheet range. The only recovery used to be manually
// hunting down and deleting each new prospect one at a time in Pipeline.
// Capturing the IDs Supabase just handed back from the insert (via
// .select("id") above) lets us offer a one-tap bulk-delete of exactly those
// rows and nothing else. Sheet stays open so the option has a natural
// window; it goes away once the agent taps Done or dismisses the sheet.
function showImportDone(resultsEl, insertedRows, count) {
  resultsEl.innerHTML = `
    <div class="card" style="margin-bottom:10px;">
      <div style="font-weight:700;font-size:13.5px;margin-bottom:10px;">Imported ${count} prospect${count === 1 ? "" : "s"}.</div>
      <div class="btn-block-row">
        ${insertedRows.length ? `<button class="btn btn-ghost btn-sm" id="bi-undo">Undo Import</button>` : ""}
        <button class="btn btn-primary btn-sm" id="bi-done">Done</button>
      </div>
    </div>
  `;
  resultsEl.querySelector("#bi-done").addEventListener("click", () => closeSheet());
  const undoBtn = resultsEl.querySelector("#bi-undo");
  if (undoBtn) {
    undoBtn.addEventListener("click", () => {
      confirmModal({
        title: "Undo this import?",
        body: `This removes the ${insertedRows.length} prospect${insertedRows.length === 1 ? "" : "s"} you just added.`,
        confirmLabel: "Undo Import",
        danger: true,
        onConfirm: async () => {
          const { error } = await sb.from("prospects").delete().in("id", insertedRows.map((r) => r.id));
          if (error) return toast(error.message, "error");
          toast("Import undone", "success");
          closeSheet();
        },
      });
    });
  }
}
