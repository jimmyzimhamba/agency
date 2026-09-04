// Shared bottom-sheet + modal controller used by every view.

const sheetBackdrop = () => document.getElementById("sheet-backdrop");
const sheet = () => document.getElementById("sheet");
const sheetTitle = () => document.getElementById("sheet-title");
const sheetBody = () => document.getElementById("sheet-body");

export function openSheet(title, contentEl, { onClose } = {}) {
  sheetTitle().textContent = title;
  sheetBody().innerHTML = "";
  sheetBody().appendChild(contentEl);
  sheetBackdrop().classList.add("open");
  sheet().classList.add("open");
  sheet()._onClose = onClose;
}

export function closeSheet() {
  sheet().classList.remove("open");
  sheetBackdrop().classList.remove("open");
  if (sheet()._onClose) sheet()._onClose();
  sheet()._onClose = null;
}

const modalBackdrop = () => document.getElementById("modal-backdrop");
const modalBox = () => document.getElementById("modal-box");

export function openModal(contentEl) {
  modalBox().innerHTML = "";
  modalBox().appendChild(contentEl);
  modalBackdrop().classList.add("open");
}

export function closeModal() {
  modalBackdrop().classList.remove("open");
  modalBox().innerHTML = "";
}

export function confirmModal({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, onConfirm, onCancel }) {
  const box = document.createElement("div");
  box.innerHTML = `
    <div style="font-weight:800;font-size:16px;margin-bottom:8px;">${title}</div>
    <div style="font-size:13.5px;color:var(--text-dim);margin-bottom:16px;line-height:1.4;">${body}</div>
    <div class="btn-block-row">
      <button class="btn btn-ghost" id="confirm-cancel">${cancelLabel}</button>
      <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="confirm-ok">${confirmLabel}</button>
    </div>`;
  openModal(box);
  box.querySelector("#confirm-cancel").addEventListener("click", () => {
    closeModal();
    if (onCancel) onCancel();
  });
  box.querySelector("#confirm-ok").addEventListener("click", () => {
    closeModal();
    onConfirm();
  });
}

export function initGlobalUI() {
  document.getElementById("sheet-backdrop").addEventListener("click", closeSheet);
  document.getElementById("sheet-close").addEventListener("click", closeSheet);
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });
}
