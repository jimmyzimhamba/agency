// ============================================================================
// STUDIO X COMMAND, View: Copilot
// ============================================================================
// A chat assistant that can answer questions about the team's real pipeline,
// tasks, activity and finances, backed by the copilot-chat edge function,
// which gives Claude tools to look up that data server-side.
//
// Conversation history is kept in memory only (module-level `history`), // it resets on page reload. This is a deliberate v1 scope decision, not an
// oversight: see SETUP.md Step 145 for why, and how to add persistence later
// if the team wants it.
// ============================================================================

import { sb } from "../supabaseClient.js";
import { el, esc, toast } from "../utils.js";

let history = []; // [{ role: "user" | "assistant", content: string }]
let sending = false;

export function renderCopilot() {
  const root = document.getElementById("view-copilot");
  root.innerHTML = "";

  const wrap = el(`
    <div style="display:flex;flex-direction:column;height:calc(100vh - var(--topbar-h) - var(--nav-h) - 32px);max-height:780px;">
      <div class="flex-between" style="margin-bottom:10px;">
        <div class="page-title mt-0" style="margin-bottom:0;">Copilot<span class="accent">.</span></div>
        ${history.length ? `<button class="btn btn-sm" id="cp-clear">Clear chat</button>` : ""}
      </div>
      <div id="cp-messages" style="flex:1;overflow-y:auto;padding:2px 2px 10px;">
      </div>
      <div style="display:flex;gap:8px;align-items:flex-end;border-top:1px solid var(--line);padding-top:10px;">
        <textarea id="cp-input" rows="1" placeholder="Ask about your pipeline, tasks, activity, or finances..." style="flex:1;min-width:0;resize:none;min-height:42px;max-height:120px;"></textarea>
        <button class="btn btn-primary" id="cp-send" style="width:auto;flex:0 0 auto;">Send</button>
      </div>
    </div>
  `);
  root.appendChild(wrap);

  const msgBox = wrap.querySelector("#cp-messages");
  const input = wrap.querySelector("#cp-input");
  const sendBtn = wrap.querySelector("#cp-send");

  renderMessages(msgBox);

  const doSend = () => sendMessage(wrap);
  sendBtn.addEventListener("click", doSend);
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
      <div class="empty-state" style="padding:30px 20px;">
        <p>Ask me things like "who hasn't been followed up with this week?", "what's our signed MRR?", or "show me tier A prospects in Fitness".</p>
      </div>
    `));
    return;
  }

  history.forEach((m) => msgBox.appendChild(renderBubble(m.role, m.content)));
  msgBox.scrollTop = msgBox.scrollHeight;
}

function renderBubble(role, text, opts = {}) {
  const isUser = role === "user";
  const bubble = el(`
    <div style="display:flex;${isUser ? "justify-content:flex-end;" : "justify-content:flex-start;"}margin-bottom:10px;">
      <div style="max-width:80%;padding:10px 13px;border-radius:var(--radius-sm);font-size:13.5px;line-height:1.45;white-space:pre-wrap;
        ${isUser ? "background:var(--purple);color:#fff;" : "background:var(--black-card);border:1px solid var(--line);color:var(--text);"}">
        ${opts.pending ? `<span class="text-faint">Thinking...</span>` : esc(text)}
      </div>
    </div>
  `);
  return bubble;
}

async function sendMessage(wrap) {
  if (sending) return;
  const input = wrap.querySelector("#cp-input");
  const text = input.value.trim();
  if (!text) return;

  const msgBox = wrap.querySelector("#cp-messages");
  history.push({ role: "user", content: text });
  input.value = "";
  input.style.height = "auto";
  renderMessages(msgBox);

  sending = true;
  wrap.querySelector("#cp-send").disabled = true;
  const pending = renderBubble("assistant", "", { pending: true });
  msgBox.appendChild(pending);
  msgBox.scrollTop = msgBox.scrollHeight;

  const { data, error } = await sb.functions.invoke("copilot-chat", {
    body: { message: text, history: history.slice(0, -1) },
  });

  sending = false;
  wrap.querySelector("#cp-send").disabled = false;

  if (error || data?.error) {
    pending.remove();
    toast(error?.message || data?.error || "Copilot couldn't answer that", "error");
    history.pop();
    renderMessages(msgBox);
    return;
  }

  history.push({ role: "assistant", content: data.reply || "" });
  renderMessages(msgBox);
}
