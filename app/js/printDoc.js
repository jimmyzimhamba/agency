// Print / "Save as PDF" for invoices and contracts. Deliberately no PDF
// library, every desktop and mobile browser's print dialog already offers
// "Save as PDF" as a destination, so filling a hidden #print-area with a
// clean letterhead-style document and calling window.print() gets a real,
// shareable PDF with zero new dependencies. The @media print rule in
// styles.css hides everything else on the page while printing, so the
// output is just the document, not the app chrome around it.
import { store, prospectById } from "./state.js";
import { esc, money, fmtDate } from "./utils.js";

function renderPrintArea(html) {
  const area = document.getElementById("print-area");
  if (!area) return;
  area.innerHTML = html;
  // One frame so the browser lays out the freshly-injected content before
  // the print dialog opens, printing on the same tick can occasionally
  // grab a blank first paint on slower devices.
  requestAnimationFrame(() => window.print());
}

function letterhead(docType, docNumber) {
  const orgName = store.organization?.name || "Agency Command";
  return `
    <div class="print-head">
      <div class="print-org">${esc(orgName)}</div>
      <div class="print-doc-type">${esc(docType)}${docNumber ? " · " + esc(docNumber) : ""}</div>
    </div>
  `;
}

function partyBlock(label, prospect) {
  return `
    <div>
      <div class="print-label">${esc(label)}</div>
      <div class="print-value">${esc(prospect?.business_name || "-")}</div>
      ${prospect?.area || prospect?.city ? `<div class="print-value">${esc([prospect.area, prospect.city].filter(Boolean).join(", "))}</div>` : ""}
      ${prospect?.email ? `<div class="print-value">${esc(prospect.email)}</div>` : ""}
    </div>
  `;
}

export function printInvoice(invoice) {
  const prospect = prospectById(invoice.prospect_id);
  const statusLabels = { draft: "Draft", sent: "Sent", paid: "Paid", void: "Void" };
  const html = `
    ${letterhead("Invoice", invoice.invoice_number)}
    <div class="print-parties">
      ${partyBlock("Billed To", prospect)}
      <div>
        <div class="print-label">Status</div>
        <div class="print-value">${esc(statusLabels[invoice.status] || invoice.status)}</div>
        ${invoice.due_date ? `<div class="print-label" style="margin-top:8px;">Due Date</div><div class="print-value">${esc(fmtDate(invoice.due_date))}</div>` : ""}
        ${invoice.paid_date ? `<div class="print-label" style="margin-top:8px;">Paid Date</div><div class="print-value">${esc(fmtDate(invoice.paid_date))}</div>` : ""}
      </div>
    </div>
    <table class="print-table">
      <thead><tr><th>Description</th><th style="text-align:right;">Amount</th></tr></thead>
      <tbody>
        <tr><td>${esc(invoice.notes || "Services rendered")}</td><td style="text-align:right;">${money(invoice.amount)}</td></tr>
      </tbody>
      <tfoot><tr><td style="text-align:right;font-weight:800;">Total</td><td style="text-align:right;font-weight:800;">${money(invoice.amount)}</td></tr></tfoot>
    </table>
    <div class="print-footer">Generated ${new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div>
  `;
  renderPrintArea(html);
}

export function printContract(contract) {
  const prospect = prospectById(contract.prospect_id);
  const statusLabels = { draft: "Draft", sent: "Sent", signed: "Signed", void: "Void" };
  const html = `
    ${letterhead("Contract", null)}
    <div class="print-parties">
      ${partyBlock("Client", prospect)}
      <div>
        <div class="print-label">Status</div>
        <div class="print-value">${esc(statusLabels[contract.status] || contract.status)}</div>
        ${contract.sent_date ? `<div class="print-label" style="margin-top:8px;">Sent</div><div class="print-value">${esc(fmtDate(contract.sent_date))}</div>` : ""}
        ${contract.signed_date ? `<div class="print-label" style="margin-top:8px;">Signed</div><div class="print-value">${esc(fmtDate(contract.signed_date))}</div>` : ""}
      </div>
    </div>
    <div class="print-label" style="margin-top:18px;">${esc(contract.title)}</div>
    <table class="print-table">
      <tbody>
        <tr><td>Contract Value</td><td style="text-align:right;font-weight:800;">${money(contract.value)}</td></tr>
      </tbody>
    </table>
    ${contract.notes ? `<div class="print-label" style="margin-top:18px;">Terms &amp; Notes</div><div class="print-value" style="white-space:pre-wrap;">${esc(contract.notes)}</div>` : ""}
    <div class="print-sign-row">
      <div class="print-sign-block"><div class="print-sign-line"></div><div class="print-label">Client Signature</div></div>
      <div class="print-sign-block"><div class="print-sign-line"></div><div class="print-label">Date</div></div>
    </div>
    <div class="print-footer">Generated ${new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div>
  `;
  renderPrintArea(html);
}

// One combined "account statement" for a client, every contract's value
// plus every invoice's status/amount, with a running Paid / Outstanding
// summary. Built entirely from records already in the store (contracts +
// invoices filtered by prospect_id), same letterhead/table markup as the
// single-document prints above, so it needs no new data and no PDF library.
export function printClientStatement(prospect) {
  const contracts = (store.contracts || []).filter((c) => c.prospect_id === prospect.id);
  const invoices = (store.invoices || []).filter((i) => i.prospect_id === prospect.id);
  const contractLabels = { draft: "Draft", sent: "Sent", signed: "Signed", void: "Void" };
  const invoiceLabels = { draft: "Draft", sent: "Sent", paid: "Paid", void: "Void" };

  const totalContractValue = contracts.reduce((sum, c) => sum + (Number(c.value) || 0), 0);
  const totalPaid = invoices.filter((i) => i.status === "paid").reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const totalOutstanding = invoices.filter((i) => i.status === "sent").reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  const html = `
    ${letterhead("Client Statement", null)}
    <div class="print-parties">
      ${partyBlock("Client", prospect)}
      <div>
        <div class="print-label">Total Contract Value</div>
        <div class="print-value">${money(totalContractValue)}</div>
        <div class="print-label" style="margin-top:8px;">Paid to Date</div>
        <div class="print-value">${money(totalPaid)}</div>
        <div class="print-label" style="margin-top:8px;">Outstanding</div>
        <div class="print-value">${money(totalOutstanding)}</div>
      </div>
    </div>

    <div class="print-label" style="margin-top:8px;">Contracts</div>
    ${contracts.length ? `
      <table class="print-table">
        <thead><tr><th>Title</th><th>Status</th><th>Signed</th><th style="text-align:right;">Value</th></tr></thead>
        <tbody>
          ${contracts.map((c) => `
            <tr>
              <td>${esc(c.title || "-")}</td>
              <td>${esc(contractLabels[c.status] || c.status)}</td>
              <td>${c.signed_date ? esc(fmtDate(c.signed_date)) : "-"}</td>
              <td style="text-align:right;">${money(c.value)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : `<div class="print-value" style="font-weight:400;color:#888;">No contracts on file.</div>`}

    <div class="print-label" style="margin-top:24px;">Invoices</div>
    ${invoices.length ? `
      <table class="print-table">
        <thead><tr><th>Invoice #</th><th>Status</th><th>Due</th><th style="text-align:right;">Amount</th></tr></thead>
        <tbody>
          ${invoices.map((i) => `
            <tr>
              <td>${esc(i.invoice_number || "-")}</td>
              <td>${esc(invoiceLabels[i.status] || i.status)}</td>
              <td>${i.due_date ? esc(fmtDate(i.due_date)) : "-"}</td>
              <td style="text-align:right;">${money(i.amount)}</td>
            </tr>
          `).join("")}
        </tbody>
        <tfoot>
          <tr><td colspan="3" style="text-align:right;font-weight:800;">Outstanding Balance</td><td style="text-align:right;font-weight:800;">${money(totalOutstanding)}</td></tr>
        </tfoot>
      </table>
    ` : `<div class="print-value" style="font-weight:400;color:#888;">No invoices on file.</div>`}

    <div class="print-footer">Generated ${new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div>
  `;
  renderPrintArea(html);
}
