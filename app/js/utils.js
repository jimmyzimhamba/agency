// Wraps a promise so it rejects after `ms` milliseconds instead of hanging
// forever. Used on the app's boot sequence, on a flaky/slow mobile
// connection, a stalled network request should surface as a clear "try
// again" screen rather than leaving the app stuck on the loading spinner
// indefinitely with no way out except force-quitting the app.
export function withTimeout(promise, ms, label = "Request") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out, check your connection`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Reads a File into an ArrayBuffer for Storage uploads. `File.arrayBuffer()`
// is usually reliable, but some Chrome builds (including this app's
// installed-PWA shell) intermittently throw a bare
// "NotReadableError: The requested file could not be read, typically due to
// permission problems that have occurred after a reference to a file was
// acquired." right after a file is picked, before any of our own error
// handling runs, as an unhandled promise rejection: no toast, no upload, the
// UI just silently does nothing (or, in the installed-PWA window, shows
// Chrome's own raw error banner instead of anything this app renders). It's
// most commonly seen picking a file straight out of a cloud-synced folder
// (iCloud Drive Desktop/Documents, OneDrive, Google Drive, Dropbox), where
// macOS can evict the file's local bytes right after the picker hands back a
// reference to it, so the very first read loses the race against the OS
// re-downloading them.
//
// A couple of retries clears most of these (it's a timing/race issue), and
// FileReader is a fallback last resort, since it goes through a different
// internal code path than File.arrayBuffer() and isn't affected by the same
// race, but it can hit the exact same transient error on its own first try,
// especially for a large file still being re-synced, so it gets its own
// short retry loop too rather than failing on one shot. Only once every
// attempt across both code paths has failed does this throw, with a message
// that actually tells the person what to do about it instead of surfacing
// Chrome's internal wording verbatim.
export async function readFileAsArrayBuffer(file, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await file.arrayBuffer();
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      });
    } catch {
      if (attempt === retries) {
        throw new Error("Couldn't read that file. This can happen right after picking one synced from iCloud/OneDrive/Google Drive, wait a moment for it to finish downloading and try selecting it again.");
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

// House rule: the em dash never appears in anything a human reads.
//
// This is not a style preference, it is a credibility one. The em dash is the
// single most recognisable fingerprint of AI-written text, and the messages
// this app produces go out under a real person's name to real businesses in
// Harare. A prospect who clocks the message as machine-written has already
// decided the answer before reading line 3.
//
// Instructing the AI not to use one (which the research-prospect prompt does)
// is necessary but not sufficient: a language model follows a negative
// instruction most of the time, not every time, and "most of the time" is not
// a standard worth shipping. So the character is also stripped mechanically at
// every point where text becomes visible, which is what this function is for.
//
// A comma is the replacement because that is what the dash is nearly always
// standing in for in the first place, and it reads as ordinary typing. A
// hyphen was the other candidate and was rejected: " - " is itself becoming a
// tell, and it looks like a typo mid-sentence.
//
// Both dash characters are covered. The en dash is rarer but shows up in
// number ranges pasted from elsewhere, and a range is the one case where a
// comma would be wrong, so that one becomes "to" instead.
export function noDash(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    // Ranges are handled first, before the generic rule below can eat them.
    // A dash between two numbers means "to", so turning it into a comma would
    // change what the sentence actually says.
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2")
    // Spaced dash used as punctuation: ", " keeps the sentence flowing.
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*–\s*/g, ", ")
    // A dash left standing completely alone was being used as a placeholder
    // for "nothing here yet", so it becomes nothing rather than a stray comma.
    .replace(/^,\s*/, "")
    .replace(/,\s*$/, "");
}

// Every rendered string in the app passes through here, so this is the one
// place that guarantees the rule holds for data that is ALREADY in the
// database. Messages the AI researched before this rule existed are sitting in
// Supabase with em dashes in them; rewriting those rows would mean editing
// prospect data we do not own the wording of, whereas cleaning them on the way
// to the screen fixes every one of them at once and cannot corrupt anything.
export function esc(str) {
  if (str === null || str === undefined) return "";
  return String(noDash(str))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || "").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
}

export function colorFor(str) {
  const palette = ["#7b2ff7", "#d4af37", "#5fb0ff", "#34d399", "#ff5c6c", "#f2b84b", "#c084fc"];
  let hash = 0;
  for (let i = 0; i < (str || "").length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

// Renders the little circular avatar used everywhere in the app, an
// uploaded photo if the person has one, otherwise the same colored-initials
// fallback as always. `size` is the diameter in px; font size auto-scales
// unless overridden. Returns an HTML string, so it drops straight into the
// existing template-literal call sites (`class="avatar"` + inline size
// styles) with no other markup changes needed.
export function avatarHTML(name, avatarUrl, size = 32, fontSize) {
  const fs = fontSize || Math.max(9, Math.round(size * 0.36));
  if (avatarUrl) {
    return `<span class="avatar" style="width:${size}px;height:${size}px;"><img src="${esc(avatarUrl)}" alt="" /></span>`;
  }
  return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${fs}px;background:${colorFor(name || "")}">${initials(name)}</span>`;
}

export function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + "d ago";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export function statusLabel(s) {
  return { not_contacted: "Not Contacted", sent: "Sent", replied: "Replied", meeting_booked: "Meeting Booked", signed: "Signed", dead: "Dead" }[s] || s;
}

export function money(n) {
  const v = Number(n) || 0;
  return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// Normalizes free-typed city names ("harare", "BULAWAYO ") into a
// consistent "Harare" / "Bulawayo" so the city filter doesn't end up with
// duplicate chips for the same place typed differently.
export function titleCase(str) {
  return (str || "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Normalizes a business name for duplicate comparison, lowercases, strips
// punctuation, and collapses whitespace, so "The Fig & Olive" and "the fig
// and olive " (a stray trailing space from a pasted spreadsheet cell) are
// recognized as the same lead instead of slipping through as a "new" one.
export function normalizeForMatch(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Zimbabwe numbers show up as "0771234567", "263771234567", "+263 77 123
// 4567", etc. Comparing the last 9 digits sidesteps all of that formatting
// noise without needing a full phone-parsing library.
function last9Digits(raw) {
  return (raw || "").replace(/\D/g, "").slice(-9);
}

// Looks for an existing prospect that's probably the same business as the
// one about to be added, matched on normalized business name OR WhatsApp
// number. Either one alone is a strong signal: same name with a different
// number is likely a re-entry/typo fix, same number under a different name
// is likely the same business re-listed. `prospects` can be any array of
// {business_name, whatsapp_number}-shaped objects, used both against the
// live pipeline (state.js store.prospects) and against earlier rows in the
// same bulk-import batch (see bulkImport.js).
// Returns { prospect, reason: "name" | "phone" } or null.
export function findDuplicateProspect(name, whatsapp, prospects) {
  const normName = normalizeForMatch(name);
  const normPhone = last9Digits(whatsapp);
  if (!normName && !normPhone) return null;
  for (const p of prospects || []) {
    if (normName && normalizeForMatch(p.business_name) === normName) {
      return { prospect: p, reason: "name" };
    }
    if (normPhone && normPhone.length >= 9 && last9Digits(p.whatsapp_number) === normPhone) {
      return { prospect: p, reason: "phone" };
    }
  }
  return null;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Every "Copy Link"/"Copy Code" button in the app used to call
// navigator.clipboard.writeText() directly. That API silently rejects (or
// straight up doesn't exist) in a handful of real situations users actually
// hit: installed-standalone PWA mode on older iOS/WKWebView builds, non-secure
// contexts, and a tab that doesn't currently have focus/permission. All of
// those just throw, which the old per-button try/catch already caught, but
// "caught" only meant falling back to showing the raw link as a toast, not
// an actual copy, so "the link isn't copying" was a real, reproducible
// complaint even though nothing was erroring loudly. This adds one real
// second attempt, the old-school hidden-textarea + document.execCommand
// ("copy") trick, before giving up and returning false so the caller can
// still show the text itself as a last resort.
export async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Keep it on-screen (0-size, but not display:none) so iOS Safari
    // actually lets it receive selection, off-screen instead of hidden.
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.padding = "0";
    ta.style.border = "none";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Turns any Zimbabwe-style number into the digits-only international
// format WhatsApp's click-to-chat link needs (e.g. 0771234567 -> 263771234567).
export function toWhatsAppDigits(raw) {
  let digits = (raw || "").replace(/[^\d+]/g, "");
  digits = digits.replace(/^\+/, "");
  if (digits.startsWith("0")) digits = "263" + digits.slice(1);
  if (!digits.startsWith("263") && digits.length === 9) digits = "263" + digits;
  return digits;
}

// The second place the no-em-dash rule has to be enforced, and the one that
// matters most. Text bound for WhatsApp never passes through esc(), because it
// is not being rendered as HTML, it is being handed to another app entirely.
// This is the last line of code that touches an outreach message before a
// stranger reads it, so the strip happens here rather than at any of the
// several call sites that could each forget.
export function buildWhatsAppLink(number, message) {
  const digits = toWhatsAppDigits(number);
  return `https://wa.me/${digits}?text=${encodeURIComponent(noDash(message || ""))}`;
}

// Fills a template's {{tokens}} in with a specific prospect's real details,
// so an agent gets a message that already reads like it was written for
// that exact business rather than a generic form-letter.
export function personalizeMessage(body, prospect, agentName) {
  const area = (prospect?.area || "").trim();
  const gap = (prospect?.gap_note || "").trim();
  const vars = {
    "{{business_name}}": prospect?.business_name || "there",
    "{{area_clause}}": area ? ` in ${area}` : "",
    "{{gap_clause}}": gap || "wanted to reach out about growing your online presence",
    "{{agent_name}}": agentName || "the Agency Command team",
  };
  let out = body || "";
  for (const [token, value] of Object.entries(vars)) out = out.split(token).join(value);
  return out;
}

let toastWrap;
export function toast(msg, type = "") {
  if (!toastWrap) {
    toastWrap = document.querySelector(".toast-wrap");
    if (!toastWrap) {
      toastWrap = el('<div class="toast-wrap"></div>');
      document.body.appendChild(toastWrap);
    }
  }
  const node = el(`<div class="toast ${type}">${esc(msg)}</div>`);
  toastWrap.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

// A bigger, richer cousin of toast() for genuinely celebratory moments (a
// badge unlocked, a big chunk of points earned), an icon-badge next to a
// bold title and a faint subtitle, instead of a single line of plain text.
// Stays up a little longer than a regular toast since there's more to read.
// `icon` is raw SVG path markup (from our own badges.js catalog, never
// user-supplied), so it's inserted as-is rather than escaped; title/subtitle
// go through esc() same as every other toast.
export function celebrateToast({ icon, title, subtitle, tier = "purple" } = {}) {
  if (!toastWrap) {
    toastWrap = document.querySelector(".toast-wrap");
    if (!toastWrap) {
      toastWrap = el('<div class="toast-wrap"></div>');
      document.body.appendChild(toastWrap);
    }
  }
  const node = el(`
    <div class="toast celebrate">
      <div class="icon-badge sm${tier === "gold" ? " gold" : ""}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${icon || ""}</svg>
      </div>
      <div class="tc-text">
        <div class="tc-title">${esc(title || "")}</div>
        ${subtitle ? `<div class="tc-sub">${esc(subtitle)}</div>` : ""}
      </div>
    </div>
  `);
  toastWrap.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

// Turns [{col: val, ...}, ...] into an RFC-4180-ish CSV string. Any value
// containing a comma, quote, or newline gets wrapped in quotes with inner
// quotes doubled, the one escaping rule spreadsheets actually agree on.
function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows, columns) {
  const header = columns.map((c) => csvCell(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvCell(c.get(row))).join(","));
  return [header, ...lines].join("\r\n");
}

// Triggers a browser download of `text` as a file, no server round-trip,
// just a Blob + a throwaway <a download> click. Works the same on desktop
// and mobile browsers that support the File API (all modern ones).
export function downloadTextFile(filename, text, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Escapes the handful of characters the .ics spec (RFC 5545) requires
// escaping inside text fields, commas, semicolons, and newlines.
function icsEscape(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/([,;])/g, "\\$1")
    .replace(/\n/g, "\\n");
}

// Builds a minimal single-event .ics calendar file (an all-day reminder on
// `dateISO`) and triggers a download via downloadTextFile above. No calendar
// API/library needed, a .ics is just plain text every calendar app (Google,
// Apple, Outlook) already knows how to import on double-click/tap.
export function downloadReminderICS(filename, { title, description, dateISO }) {
  if (!dateISO) return;
  const startDigits = dateISO.replace(/-/g, "");
  const endDate = new Date(dateISO + "T00:00:00");
  endDate.setDate(endDate.getDate() + 1);
  const endDigits = endDate.toISOString().slice(0, 10).replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@agencycommand`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Agency Command//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${startDigits}`,
    `DTEND;VALUE=DATE:${endDigits}`,
    `SUMMARY:${icsEscape(title)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  downloadTextFile(filename, lines.join("\r\n"), "text/calendar;charset=utf-8;");
}

// vCard 3.0 uses the same escaping rules as .ics text fields (backslash,
// comma, semicolon, newline), reusing the icsEscape logic under a separate
// name so a future change to one format's quirks doesn't silently affect
// the other.
function vcardEscape(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/([,;])/g, "\\$1")
    .replace(/\n/g, "\\n");
}

// Downloads a minimal vCard (.vcf) so a hot lead's contact details land
// straight in a sales rep's phone contacts with one tap, ready to call/text
// outside WhatsApp too, same "plain text, every OS already knows how to
// import this" approach as the .ics calendar export above, no library.
export function downloadVCard(filename, { name, phone, email, note }) {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:;${vcardEscape(name)};;;`, `FN:${vcardEscape(name)}`, `ORG:${vcardEscape(name)}`];
  if (phone) lines.push(`TEL;TYPE=CELL:${vcardEscape("+" + toWhatsAppDigits(phone))}`);
  if (email) lines.push(`EMAIL:${vcardEscape(email)}`);
  if (note) lines.push(`NOTE:${vcardEscape(note)}`);
  lines.push("END:VCARD");
  downloadTextFile(filename, lines.join("\r\n"), "text/vcard;charset=utf-8;");
}

// A long-press-then-drag reorder helper built on Pointer Events (not HTML5
// dragstart/drop) specifically because native HTML5 drag-and-drop doesn't
// fire on touch in mobile Safari, and this app is used on phones. Works
// identically for mouse and touch. Used by the Grid Plan Review builder
// (agency side) and, later, the public client review page, so both share
// one implementation instead of two subtly-different ones.
//
// container: the element whose direct children are the reorderable items.
// itemSelector: CSS selector matching each reorderable child.
// handleSelector: CSS selector (within each item) that starts the drag, //   keeps a plain tap on the tile free to open an edit modal instead.
// onReorder(orderedIds): called once, on release, with the item ids
//   (read from each item's data-id attribute) in their new order. Not
//   called if the order didn't actually change.
export function enablePointerReorder(container, itemSelector, handleSelector, onReorder) {
  let dragging = null;
  let startY = 0;
  let startX = 0;
  let orderAtStart = [];

  container.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(handleSelector);
    if (!handle) return;
    const item = handle.closest(itemSelector);
    if (!item || item.parentElement !== container) return;
    dragging = item;
    startX = e.clientX;
    startY = e.clientY;
    orderAtStart = Array.from(container.querySelectorAll(itemSelector)).map((n) => n.dataset.id);
    item.setPointerCapture(e.pointerId);
    item.classList.add("dragging");
  });

  container.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    // Ignore tiny jitters so a plain tap-and-release on the handle doesn't
    // briefly flag as a drag.
    if (Math.abs(e.clientX - startX) < 4 && Math.abs(e.clientY - startY) < 4) return;
    e.preventDefault();
    const overEl = document.elementFromPoint(e.clientX, e.clientY);
    const overItem = overEl?.closest(itemSelector);
    if (!overItem || overItem === dragging || overItem.parentElement !== container) return;
    const items = Array.from(container.querySelectorAll(itemSelector));
    const draggingIdx = items.indexOf(dragging);
    const overIdx = items.indexOf(overItem);
    if (draggingIdx < overIdx) overItem.after(dragging);
    else overItem.before(dragging);
  });

  const finish = () => {
    if (!dragging) return;
    dragging.classList.remove("dragging");
    const orderedIds = Array.from(container.querySelectorAll(itemSelector)).map((n) => n.dataset.id);
    dragging = null;
    const changed = orderedIds.length !== orderAtStart.length || orderedIds.some((id, i) => id !== orderAtStart[i]);
    if (changed) onReorder(orderedIds);
  };
  container.addEventListener("pointerup", finish);
  container.addEventListener("pointercancel", finish);
}
