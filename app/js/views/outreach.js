// ============================================================================
// STUDIO X COMMAND — Outreach (batch approve, then one-tap send)
// ============================================================================
// The problem this solves:
//   Sending 20 cold openers used to mean 20 separate trips into a prospect,
//   reading what the AI wrote, deciding if it's any good, and tapping send —
//   with the pipeline redrawing between each one. The research and the writing
//   were already automated (the research-prospect Edge Function looks the
//   business up online with Claude and writes the 3-line opener). The part
//   that still ate the morning was the reviewing and the tapping.
//
//   So this screen does the whole run in one sitting: read them all, fix the
//   ones that read badly, approve in a batch, then tap through the sends.
//
// Why it does not send automatically, which is what was originally asked for:
//   The first message to a stranger always leaves from a human's own WhatsApp
//   app via a wa.me hand-off. Automating that step means driving a WhatsApp
//   session from a script, which is against WhatsApp's terms and gets numbers
//   banned — detection is automatic, it does not wait for anyone to complain,
//   and unanswered messages are themselves a flag, which is precisely the
//   pattern cold outreach produces. The agency's WhatsApp number is also the
//   number existing clients use, so a ban costs far more than the outreach is
//   worth. Every alternative was considered and this is the honest one.
//
//   What is automated is everything either side of the tap, which is where the
//   two hours actually went. Twenty sends is now a few minutes of tapping.
// ============================================================================

import { store, on, emit, nicheById, profileById, bestTemplateFor } from "../state.js";
import { sb } from "../supabaseClient.js";
import { el, esc, toast, timeAgo, personalizeMessage } from "../utils.js";
import { confirmModal } from "../ui.js";
import { patchProspect } from "../outbox.js";
import { sendWhatsApp } from "./pipeline.js";

// A target, not a cap. The ask was "at least 20 a day", so the number is drawn
// as something to reach rather than a limit to bump into — nothing here stops
// anyone at 20.
const DAILY_TARGET = 20;

// Past this many in one day from one number, the screen says so. Not a block:
// a big push before a campaign is a real thing people do. But volume from a
// single number is the main thing that looks like spam from the outside, and
// this is a lot cheaper than finding out afterwards.
const HEAVY_DAY = 40;

function isActive() {
  return document.getElementById("view-outreach")?.classList.contains("active");
}

// Local midnight, built from local date parts rather than toISOString(), which
// converts to UTC and — in a UTC+2 country — reports anything sent before 2am
// as belonging to the previous day.
function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function sentToday() {
  const start = startOfToday();
  return (store.outreachLog || []).filter((r) => new Date(r.sent_at).getTime() >= start);
}

// Every prospect this screen will ever touch: never contacted, reachable on
// WhatsApp, and not on the do-not-contact list. Assignment is checked at send
// time by sendWhatsApp() rather than filtered out here, so a teammate's
// prospects are still visible for review — seeing that somebody else is
// already on it is useful; silently hiding it looks like the lead vanished.
function contactable() {
  return store.prospects.filter(
    (p) => p.status === "not_contacted" && p.whatsapp_number && !p.do_not_contact
  );
}

function awaitingApproval() {
  return contactable().filter((p) => !p.outreach_approved_at);
}

function readyToSend() {
  return contactable().filter((p) => p.outreach_approved_at);
}

// The message as it will actually go out — tokens filled in for whoever is
// looking at it. Mirrors what sendWhatsApp() does at send time, so the text
// reviewed on this screen is the text that leaves.
function previewMessage(p) {
  const agent = store.profile?.full_name?.split(" ")[0];
  if (p.outreach_message) return personalizeMessage(p.outreach_message, p, agent);
  const template = bestTemplateFor(p, "opener");
  return template ? personalizeMessage(template.body, p, agent) : "";
}

export async function refreshOutreachLog() {
  // Thirty days is plenty: this screen only ever asks about today, and the
  // recent history is for "have we spoken to these people already".
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data } = await sb
    .from("outreach_log")
    .select("*")
    .gte("sent_at", since)
    .order("sent_at", { ascending: false });
  store.outreachLog = data || [];
  emit("outreachLog");
}

// ---- sending ---------------------------------------------------------------

async function doSend(p) {
  const message = previewMessage(p);
  if (!message.trim()) return toast("No message written for this prospect yet", "error");

  // sendWhatsApp handles claiming the prospect, opening WhatsApp, and moving
  // the status to 'sent'. It answers false when it refused — no number, or a
  // teammate got there first — and nothing should be logged in that case.
  const ok = await sendWhatsApp(p);
  if (!ok) return false;

  const { error } = await sb.from("outreach_log").insert({
    prospect_id: p.id,
    channel: "whatsapp",
    message,
    sent_by: store.profile?.id || null,
  });
  // A failed log entry is worth knowing about but must not look like a failed
  // send — WhatsApp is already open with the message in it at this point.
  if (error) console.error("outreach_log insert failed", error);
  else await refreshOutreachLog();

  return true;
}

// ---- rendering -------------------------------------------------------------

export function renderOutreach() {
  const view = document.getElementById("view-outreach");
  if (!view) return;

  const today = sentToday();
  const pending = awaitingApproval();
  const ready = readyToSend();
  const dnc = store.prospects.filter((p) => p.do_not_contact);
  const pct = Math.min(100, Math.round((today.length / DAILY_TARGET) * 100));

  view.innerHTML = `
    <div class="section-title mt-0">Today</div>
    <div class="card" style="margin-bottom:14px;">
      <div class="flex-between" style="margin-bottom:10px;">
        <span style="font-weight:800;font-size:15px;">${today.length} of ${DAILY_TARGET} sent</span>
        <span class="text-faint" style="font-size:12px;">${ready.length} ready · ${pending.length} to review</span>
      </div>
      <div style="height:8px;border-radius:99px;background:var(--surface-2, rgba(127,127,127,.18));overflow:hidden;">
        <div style="height:100%;width:${pct}%;border-radius:99px;background:var(--accent, #7c3aed);transition:width .4s ease;"></div>
      </div>
      ${today.length >= HEAVY_DAY ? `
        <div class="text-faint" style="font-size:11.5px;margin-top:8px;line-height:1.5;">
          That's a lot from one number in a day. Nothing's wrong, but heavy volume
          from a single number is what looks like spam from the outside — worth
          spreading the rest over tomorrow.
        </div>` : ""}
    </div>

    ${ready.length ? `
      <div class="section-title">Ready to send</div>
      <button class="btn btn-primary" id="or-send-next" style="margin-bottom:10px;">
        Send Next (${ready.length} waiting)
      </button>
      <div class="text-faint" style="font-size:11.5px;line-height:1.5;margin-bottom:12px;">
        Each one opens WhatsApp with the message already written. Press send in
        WhatsApp, come back, and tap again for the next.
      </div>
      <div id="or-ready"></div>
    ` : ""}

    <div class="section-title">${pending.length ? "Review and approve" : "Nothing to review"}</div>
    <div id="or-pending"></div>

    ${dnc.length ? `
      <div class="section-title" style="margin-top:20px;">Do not contact (${dnc.length})</div>
      <div id="or-dnc"></div>
    ` : ""}
  `;

  renderReady(view, ready);
  renderPending(view, pending);
  renderDnc(view, dnc);

  const nextBtn = view.querySelector("#or-send-next");
  if (nextBtn) {
    nextBtn.addEventListener("click", async () => {
      const list = readyToSend();
      if (!list.length) return;
      nextBtn.disabled = true;
      await doSend(list[0]);
      nextBtn.disabled = false;
      renderOutreach();
    });
  }
}

function renderReady(view, list) {
  const wrap = view.querySelector("#or-ready");
  if (!wrap) return;
  list.forEach((p) => {
    const niche = nicheById(p.niche_id);
    const row = el(`
      <div class="card" style="margin-bottom:8px;">
        <div class="flex-between" style="margin-bottom:6px;">
          <span style="font-weight:700;font-size:14px;">${esc(p.business_name)}</span>
          <span class="small-link" data-send>Send</span>
        </div>
        <div class="text-faint" style="font-size:11.5px;">
          ${niche ? esc(niche.name) + " · " : ""}${esc(p.area || p.city || "")}
        </div>
      </div>
    `);
    row.querySelector("[data-send]").addEventListener("click", async () => {
      await doSend(p);
      renderOutreach();
    });
    wrap.appendChild(row);
  });
}

function renderPending(view, list) {
  const wrap = view.querySelector("#or-pending");
  if (!wrap) return;

  if (!list.length) {
    wrap.innerHTML = `
      <div class="card">
        <div class="text-faint" style="font-size:13px;line-height:1.5;">
          Everyone reachable on WhatsApp has either been approved or already
          contacted. Add more through <b>Discovery</b>, and the AI will research
          them and write the opener before they land here.
        </div>
      </div>`;
    return;
  }

  wrap.innerHTML = "";

  const approveAll = el(`<button class="btn btn-ghost btn-sm" style="width:auto;margin-bottom:12px;">Approve all ${list.length} as written</button>`);
  approveAll.addEventListener("click", () => {
    confirmModal({
      title: `Approve all ${list.length}?`,
      body:
        "This approves every message below exactly as the AI wrote it, without you reading them one by one. " +
        "Fine when you've spot-checked a few and they're good — but these go to real businesses under your name.",
      confirmLabel: "Approve all",
      onConfirm: async () => {
        const stamp = { outreach_approved_at: new Date().toISOString(), outreach_approved_by: store.profile?.id || null };
        for (const p of list) {
          if (!previewMessage(p).trim()) continue;
          await patchProspect(p.id, stamp);
        }
        toast(`${list.length} approved`, "success");
        renderOutreach();
      },
    });
  });
  wrap.appendChild(approveAll);

  list.forEach((p) => {
    const niche = nicheById(p.niche_id);
    const owner = p.assigned_to ? profileById(p.assigned_to) : null;
    const msg = previewMessage(p);
    const researching = p.research_status === "pending" || p.research_status === "researching";

    const card = el(`
      <div class="card" style="margin-bottom:10px;">
        <div style="font-weight:700;font-size:14.5px;">${esc(p.business_name)}</div>
        <div class="text-faint" style="font-size:11.5px;margin-bottom:8px;">
          ${niche ? esc(niche.name) + " · " : ""}${esc(p.area || p.city || "")}
          ${owner && owner.id !== store.profile?.id ? " · " + esc(owner.full_name || "a teammate") + "'s prospect" : ""}
          ${p.researched_at ? " · researched " + esc(timeAgo(p.researched_at)) : ""}
        </div>

        ${msg ? `
          <textarea data-msg rows="5" style="font-size:13px;line-height:1.5;">${esc(msg)}</textarea>
        ` : researching ? `
          <div class="text-faint" style="font-size:12.5px;line-height:1.5;">
            The AI is still looking this business up online. Give it a moment and pull
            down to refresh.
          </div>
        ` : `
          <div class="text-faint" style="font-size:12.5px;line-height:1.5;margin-bottom:8px;">
            No opener written yet, and no niche template matched this one.
          </div>
          <button class="btn btn-ghost btn-sm" data-research style="width:auto;">Research &amp; Write It</button>
        `}

        ${msg ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            <button class="btn btn-primary btn-sm" data-approve style="width:auto;">Approve</button>
            <button class="btn btn-ghost btn-sm" data-rewrite style="width:auto;">Rewrite with AI</button>
            <span class="small-link" data-never style="align-self:center;margin-left:auto;">Never contact</span>
          </div>
        ` : ""}
      </div>
    `);

    const ta = card.querySelector("[data-msg]");

    const approveBtn = card.querySelector("[data-approve]");
    if (approveBtn) {
      approveBtn.addEventListener("click", async () => {
        const edited = ta.value.trim();
        if (!edited) return toast("The message is empty", "error");
        approveBtn.disabled = true;
        // Message and approval go in one patch on purpose. The database trigger
        // clears an approval whenever the text changes, so approving and then
        // saving an edit as two steps would wipe the approval it just made.
        await patchProspect(p.id, {
          outreach_message: edited,
          outreach_approved_at: new Date().toISOString(),
          outreach_approved_by: store.profile?.id || null,
        });
        toast("Approved", "success");
        renderOutreach();
      });
    }

    const rewriteBtn = card.querySelector("[data-rewrite]") || card.querySelector("[data-research]");
    if (rewriteBtn) {
      rewriteBtn.addEventListener("click", async () => {
        rewriteBtn.disabled = true;
        rewriteBtn.textContent = "Researching...";
        const { error } = await sb.functions.invoke("research-prospect", { body: { prospect_id: p.id } });
        rewriteBtn.disabled = false;
        if (error) {
          rewriteBtn.textContent = "Try Again";
          return toast(error.message || "Research failed", "error");
        }
        toast("Researched — pull down to refresh", "success");
      });
    }

    const never = card.querySelector("[data-never]");
    if (never) {
      never.addEventListener("click", () => {
        confirmModal({
          title: `Never contact ${p.business_name}?`,
          body:
            "Use this when a business has asked not to be messaged. They stay in your list but " +
            "drop out of every outreach screen, and nobody can approve a message for them — " +
            "including if they get added again from Discovery later.",
          confirmLabel: "Never contact",
          danger: true,
          onConfirm: async () => {
            await patchProspect(p.id, {
              do_not_contact: true,
              do_not_contact_at: new Date().toISOString(),
              do_not_contact_reason: "Marked from Outreach",
            });
            toast("Added to do-not-contact", "success");
            renderOutreach();
          },
        });
      });
    }

    wrap.appendChild(card);
  });
}

function renderDnc(view, list) {
  const wrap = view.querySelector("#or-dnc");
  if (!wrap) return;
  list.forEach((p) => {
    const row = el(`
      <div class="card" style="margin-bottom:8px;display:flex;align-items:center;gap:10px;">
        <span style="flex:1;font-size:13.5px;">${esc(p.business_name)}</span>
        <span class="small-link" data-undo>Allow again</span>
      </div>
    `);
    row.querySelector("[data-undo]").addEventListener("click", async () => {
      await patchProspect(p.id, { do_not_contact: false, do_not_contact_reason: null, do_not_contact_at: null });
      toast("Removed from do-not-contact", "success");
      renderOutreach();
    });
    wrap.appendChild(row);
  });
}

export function initOutreachView() {
  on("prospects", () => { if (isActive()) renderOutreach(); });
  on("outreachLog", () => { if (isActive()) renderOutreach(); });
}
