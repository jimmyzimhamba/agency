// ============================================================================
// STUDIO X COMMAND, View: Phoenix AI (the AI assistant)
// ============================================================================
// A chat assistant that can answer questions about the team's real pipeline,
// tasks, activity and finances, backed by the copilot-chat edge function,
// which gives Claude tools to look up that data server-side.
//
// The assistant is shown to the team as "Phoenix AI". The edge function is
// still named copilot-chat and the view/data-view id is still "copilot"
// everywhere in the code, that's deliberate: renaming a deployed Supabase
// function means Jimmy has to delete and re-create it under the new name
// rather than just re-uploading, and the internal id was never something a
// person reads. Only the words a person actually sees changed.
//
// Conversation history is kept in memory only (module-level `history`), it
// resets on page reload. This is a deliberate v1 scope decision, not an
// oversight: see SETUP.md Step 145 for why, and how to add persistence later
// if the team wants it.
// ============================================================================

import { sb } from "../supabaseClient.js";
import { el, esc, toast } from "../utils.js";

let history = []; // [{ role: "user" | "assistant", content: string }]
let sending = false;

// A phoenix in flight, wings spread, redrawn from scratch as a feathered fan
// on each side of a center body/tail (not traced from any stock asset).
const PHOENIX_ICON = `<svg viewBox="0 0 32 27" fill="currentColor"><path d="M16 14 L28.6 10.6 L22.4 11.2 L27 7.1 L21.3 9.5 L24.5 4.2 L19.8 8.1 L21.3 2.1 L17.9 7.3 L17.6 1.1 Z"/><path d="M16 14 L3.4 10.6 L9.6 11.2 L5 7.1 L10.7 9.5 L7.5 4.2 L12.2 8.1 L10.7 2.1 L14.1 7.3 L14.4 1.1 Z"/><path d="M14.5 15 L16 26 L17.5 15 Z"/><circle cx="16" cy="13" r="1.3"/><path d="M16 11.2 L14.9 13 L17.1 13 Z"/></svg>`;

const SUGGESTIONS = [
  "Who hasn't been followed up with this week?",
  "What's our signed MRR right now?",
  "Show me tier A prospects in Fitness",
];

export function renderCopilot() {
  const root = document.getElementById("view-copilot");
  root.innerHTML = "";

  const wrap = el(`
    <div style="display:flex;flex-direction:column;height:calc(100vh - var(--topbar-h) - var(--nav-h) - 32px);max-height:780px;">
      <div class="phx-header">
        <div class="phx-avatar">${PHOENIX_ICON}</div>
        <div class="phx-header-text" style="flex:1;min-width:0;">
          <div class="phx-header-name">Phoenix AI</div>
          <div class="phx-header-status"><span class="dot"></span>Knows your live pipeline, tasks and finances</div>
        </div>
        ${history.length ? `<button class="btn btn-sm" id="cp-clear">Clear chat</button>` : ""}
      </div>
      <div id="cp-messages" class="phx-messages"></div>
      <div class="phx-inputbar">
        <textarea id="cp-input" class="phx-input" rows="1" placeholder="Ask Phoenix AI anything about the business..."></textarea>
        <button class="phx-send" id="cp-send" title="Send" aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>
        </button>
      </div>
    </div>
  `);
  root.appendChild(wrap);

  const msgBox = wrap.querySelector("#cp-messages");
  const input = wrap.querySelector("#cp-input");
  const sendBtn = wrap.querySelector("#cp-send");

  renderMessages(msgBox);

  const doSend = (text) => sendMessage(wrap, text);
  sendBtn.addEventListener("click", () => doSend());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  msgBox.querySelectorAll("[data-suggestion]").forEach((btn) => {
    btn.addEventListener("click", () => doSend(btn.dataset.suggestion));
  });

  wrap.querySelector("#cp-clear")?.addEventListener("click", () => {
    history = [];
    renderCopilot();
  });

  if (!history.length) input.focus();
}

function renderMessages(msgBox) {
  msgBox.innerHTML = "";

  if (!history.length) {
    msgBox.appendChild(el(`
      <div class="empty-state" style="padding:26px 20px 10px;">
        <p>Ask Phoenix AI things like "who hasn't been followed up with this week?", "what's our signed MRR?", or "show me tier A prospects in Fitness".</p>
        <div class="phx-suggestions">
          ${SUGGESTIONS.map((s) => `<button type="button" class="phx-suggestion" data-suggestion="${esc(s)}">${esc(s)}</button>`).join("")}
        </div>
      </div>
    `));
    return;
  }

  history.forEach((m) => msgBox.appendChild(renderRow(m.role, m.content)));
  msgBox.scrollTop = msgBox.scrollHeight;
}

function renderRow(role, text, opts = {}) {
  const isUser = role === "user";
  const row = el(`
    <div class="phx-row ${isUser ? "user" : "assistant"}">
      ${isUser ? "" : `<div class="phx-avatar sm">${PHOENIX_ICON}</div>`}
      <div class="phx-bubble">
        ${opts.pending ? `<span class="phx-typing"><span></span><span></span><span></span></span>` : esc(text)}
      </div>
    </div>
  `);
  return row;
}

async function sendMessage(wrap, presetText) {
  if (sending) return;
  const input = wrap.querySelector("#cp-input");
  const text = (presetText ?? input.value).trim();
  if (!text) return;

  const msgBox = wrap.querySelector("#cp-messages");
  history.push({ role: "user", content: text });
  input.value = "";
  input.style.height = "auto";
  renderMessages(msgBox);

  sending = true;
  wrap.querySelector("#cp-send").disabled = true;
  const pending = renderRow("assistant", "", { pending: true });
  msgBox.appendChild(pending);
  msgBox.scrollTop = msgBox.scrollHeight;

  const { data, error } = await sb.functions.invoke("copilot-chat", {
    body: { message: text, history: history.slice(0, -1) },
  });

  sending = false;
  wrap.querySelector("#cp-send").disabled = false;

  if (error || data?.error) {
    pending.remove();
    toast(error?.message || data?.error || "Phoenix AI couldn't answer that", "error");
    history.pop();
    renderMessages(msgBox);
    return;
  }

  history.push({ role: "assistant", content: data.reply || "" });
  renderMessages(msgBox);
}
