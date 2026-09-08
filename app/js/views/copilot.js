// ============================================================================
// STUDIO X COMMAND, View: Phoenix (the AI assistant)
// ============================================================================
// A chat assistant that can answer questions about the team's real pipeline,
// tasks, activity and finances, backed by the copilot-chat edge function,
// which gives Claude tools to look up that data server-side.
//
// The assistant is shown to the team as "Phoenix". The edge function is
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

const PHOENIX_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1.6 2.4 2.4 4.4 2.4 6.2 0 1.3-.5 2.3-1.4 3.1.9-.2 1.8-.8 2.6-1.8.6 1 .9 2 .9 3.1 0 3.4-2.9 6.2-6.5 6.2S3.5 16 3.5 12.6c0-2.9 1.6-5.1 3.6-6.9-.2 1-.1 1.9.3 2.7.6-2.6 2-4.8 4.6-6.4Z"/></svg>`;

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
          <div class="phx-header-name">Phoenix</div>
          <div class="phx-header-status"><span class="dot"></span>Knows your live pipeline, tasks and finances</div>
        </div>
        ${history.length ? `<button class="btn btn-sm" id="cp-clear">Clear chat</button>` : ""}
      </div>
      <div id="cp-messages" class="phx-messages"></div>
      <div class="phx-inputbar">
        <textarea id="cp-input" class="phx-input" rows="1" placeholder="Ask Phoenix anything about the business..."></textarea>
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
        <p>Ask Phoenix things like "who hasn't been followed up with this week?", "what's our signed MRR?", or "show me tier A prospects in Fitness".</p>
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
    toast(error?.message || data?.error || "Phoenix couldn't answer that", "error");
    history.pop();
    renderMessages(msgBox);
    return;
  }

  history.push({ role: "assistant", content: data.reply || "" });
  renderMessages(msgBox);
}
