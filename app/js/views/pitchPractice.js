// ============================================================================
// STUDIO X COMMAND — View: Pitch Practice
// ============================================================================
// A practice game for the sales team, built on one idea: the objections your
// own team actually hears are better training material than anything bought
// off a shelf. So the team builds the deck themselves.
//
// The loop:
//   1. Someone hits a real objection on a call ("we already have a guy") and
//      writes it onto a card.
//   2. Anyone on the team can draw that card, see the objection, and type how
//      they'd answer it.
//   3. Claude sends back one short coaching note (via the pitch-coach edge
//      function) naming what worked and one thing to sharpen.
//
// What this deliberately does NOT do, and why:
//   - No score, no points, no XP. A number turns practice into a scoreboard,
//     and a scoreboard makes people farm the easy cards to protect the number.
//   - No leaderboard. Ranking teammates on how well they *practise* punishes
//     exactly the people who most need the reps: the new ones.
//   - No streak. This is a work tool. A streak that breaks because someone
//     took leave or got sick is a guilt mechanic pointed at an employee.
//   - Your attempts are private to you (enforced in the database, not just
//     hidden here). Nobody practises honestly if the boss can read every
//     fumbled answer.
//   The one motivator kept is a plain, closable loop: "you've practised 3
//   cards this week", which you can see finishing, and which costs you nothing
//   if you skip a week.
// ============================================================================

import { sb } from "../supabaseClient.js";
import { store } from "../state.js";
import { el, esc, toast, timeAgo } from "../utils.js";
import { closeSheet, openSheet } from "../ui.js";

// How many cards a week counts as "a good week of practice". Not a target
// anyone is measured against, just a sensible end point so the ring has
// somewhere to fill up to.
const WEEKLY_AIM = 5;

// A day-one deck, loaded in one tap when the team has nothing yet.
//
// The point of this feature is that the team writes its own cards, so this is
// deliberately a starting point and not a library: twelve objections that come
// up constantly when selling marketing to small businesses in Zimbabwe, and
// nothing more. They're written the blunt way a real prospect says them, not
// the tidied-up way a training manual would. No niche is set on any of them,
// because niches are per-agency and a starter card shouldn't reference one
// that doesn't exist. Every one can be edited or deleted like any other card.
const STARTER_CARDS = [
  "We already have someone doing our social media.",
  "Send me an email with your prices and I'll get back to you.",
  "How much? Ah no, that's way too expensive for us.",
  "Business is slow right now. Maybe come back next year.",
  "I need to discuss it with my partner first.",
  "We tried a marketing company before and nothing came of it.",
  "Can you guarantee me how many customers I'll get?",
  "My nephew does it for me for free.",
  "All our business comes from word of mouth. We don't need this.",
  "Just do one post first and let me see, then we can talk.",
  "Are you charging in USD? Most of our sales are in local currency.",
  "I'm busy right now, call me next week.",
];

let scenarios = [];
let myAttempts = [];
let loaded = false;
let loadError = "";
let currentCard = null; // the scenario currently drawn
let coaching = false;

export function renderPitchPractice() {
  const root = document.getElementById("view-pitch");
  root.innerHTML = "";

  const wrap = el(`
    <div>
      <div class="flex-between">
        <div class="page-title mt-0">Pitch Practice<span class="accent">.</span></div>
        <span class="small-link" id="pp-add">Add a card</span>
      </div>
      <div class="text-faint" style="font-size:13px;margin:-8px 2px 16px;">Real objections your team has heard. Draw one, answer it, get a coaching note back.</div>

      <div id="pp-progress"></div>
      <div id="pp-stage"></div>

      <div class="section-title">Your Recent Practice</div>
      <div id="pp-history"></div>
    </div>
  `);
  root.appendChild(wrap);

  wrap.querySelector("#pp-add").addEventListener("click", openAddCardSheet);

  renderProgress(wrap.querySelector("#pp-progress"));
  renderStage(wrap.querySelector("#pp-stage"));
  renderHistory(wrap.querySelector("#pp-history"));

  if (!loaded) loadData();
}

// ----------------------------------------------------------------------------
// Data
// ----------------------------------------------------------------------------

async function loadData() {
  loadError = "";
  const myId = store.profile?.id;

  const [scenRes, attemptRes] = await Promise.all([
    sb.from("pitch_scenarios").select("*").eq("active", true).order("created_at", { ascending: false }),
    sb.from("pitch_attempts").select("*").eq("agent_id", myId).order("created_at", { ascending: false }).limit(20),
  ]);

  if (scenRes.error || attemptRes.error) {
    // Almost always means the migration hasn't been run yet. Say that plainly
    // instead of showing a raw Postgres error to a non-technical user.
    loadError = "Pitch Practice isn't set up on your database yet. See SETUP.md Step 158.";
    console.error("pitchPractice: load failed", scenRes.error || attemptRes.error);
  } else {
    scenarios = scenRes.data || [];
    myAttempts = attemptRes.data || [];
  }
  loaded = true;
  if (document.getElementById("view-pitch")?.classList.contains("active")) renderPitchPractice();
}

export function refreshPitchPractice() {
  loaded = false;
  scenarios = [];
  myAttempts = [];
  currentCard = null;
}

function attemptsThisWeek() {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return myAttempts.filter((a) => new Date(a.created_at).getTime() >= weekAgo).length;
}

// ----------------------------------------------------------------------------
// Progress (the one motivator: a closable loop, private to you)
// ----------------------------------------------------------------------------

function renderProgress(box) {
  box.innerHTML = "";
  const done = attemptsThisWeek();
  const pct = Math.min(100, Math.round((done / WEEKLY_AIM) * 100));
  const complete = done >= WEEKLY_AIM;

  box.appendChild(el(`
    <div class="card ${complete ? "glow-card" : ""}" style="margin-bottom:16px;">
      <div class="flex-between" style="margin-bottom:8px;">
        <div>
          <div style="font-size:22px;font-weight:800;">${done}<span class="text-faint" style="font-size:13px;font-weight:600;"> / ${WEEKLY_AIM}</span></div>
          <div class="text-faint" style="font-size:11.5px;">${
            complete
              ? "That's a full week of practice done. Anything past this is a bonus."
              : `Cards practised this week. Only you can see this.`
          }</div>
        </div>
        ${complete ? `<span class="status-pill paid">Week done</span>` : ""}
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>
  `));
}

// ----------------------------------------------------------------------------
// The card stage: draw -> reveal -> answer -> coaching
// ----------------------------------------------------------------------------

function renderStage(stage) {
  stage.innerHTML = "";

  if (loadError) {
    stage.appendChild(el(`<div class="empty-state" style="padding:26px 20px;"><p>${esc(loadError)}</p></div>`));
    return;
  }
  if (!loaded) {
    stage.appendChild(el(`<div class="empty-state" style="padding:26px 20px;"><p>Loading the deck...</p></div>`));
    return;
  }
  if (!scenarios.length) {
    stage.appendChild(el(`
      <div class="empty-state" style="padding:26px 20px;">
        <p>The deck is empty. The best first card is the last objection a prospect actually gave you, word for word.</p>
        <button class="btn btn-primary" id="pp-empty-add" style="width:auto;margin-top:12px;">Add the first card</button>
        <div style="margin-top:14px;">
          <span class="small-link" id="pp-seed">Or load ${STARTER_CARDS.length} common ones to start</span>
        </div>
      </div>
    `));
    stage.querySelector("#pp-empty-add").addEventListener("click", openAddCardSheet);
    stage.querySelector("#pp-seed").addEventListener("click", (e) => seedStarterCards(e.target, stage));
    return;
  }

  if (!currentCard) {
    // If the whole deck is still the ready-made starter cards, say so once,
    // here, where it's useful. The feature only really works once the team
    // has written down objections they've actually heard, and this is the
    // gentlest possible reminder of that.
    const allStarter = scenarios.every((s) => s.is_starter);
    stage.appendChild(el(`
      <div>
        <div class="card pp-card-back" id="pp-draw">
          <div class="pp-card-back-inner">
            <div class="pp-card-mark">?</div>
            <div style="font-weight:800;font-size:15px;margin-top:10px;">Draw a card</div>
            <div class="text-faint" style="font-size:12px;margin-top:4px;">${scenarios.length} objection${scenarios.length === 1 ? "" : "s"} in the deck</div>
          </div>
        </div>
        ${allStarter ? `<div class="text-faint" style="font-size:12px;text-align:center;margin-top:10px;padding:0 12px;">These are all starter cards. The deck gets a lot sharper once you add the objections your own team keeps hearing.</div>` : ""}
      </div>
    `));
    stage.querySelector("#pp-draw").addEventListener("click", () => {
      currentCard = pickCard();
      renderStage(stage);
    });
    return;
  }

  const author = store.profiles?.find((p) => p.id === currentCard.created_by);
  const card = el(`
    <div>
      <div class="card pp-card-face">
        <div class="flex-between" style="margin-bottom:8px;">
          <span class="status-pill replied">Prospect says</span>
          ${currentCard.niche ? `<span class="text-faint" style="font-size:11px;">${esc(currentCard.niche)}</span>` : ""}
        </div>
        <div class="pp-card-quote">${esc(currentCard.prompt_text)}</div>
        <div class="text-faint" style="font-size:11px;margin-top:10px;">${
          currentCard.is_starter ? "Starter card" : `Card by ${esc(author?.full_name || "a teammate")}`
        }</div>
      </div>

      <div class="field" style="margin-top:12px;">
        <label for="pp-answer">How do you answer that?</label>
        <textarea id="pp-answer" rows="4" placeholder="Say it the way you'd actually say it on WhatsApp or on the phone..."></textarea>
      </div>

      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn btn-primary" id="pp-coach" style="flex:1;">Get Coaching</button>
        <button class="btn btn-ghost" id="pp-skip" style="width:auto;flex:0 0 auto;">Another card</button>
      </div>

      <div id="pp-coach-out" style="margin-top:12px;"></div>
    </div>
  `);
  stage.appendChild(card);

  card.querySelector("#pp-skip").addEventListener("click", () => {
    currentCard = pickCard();
    renderStage(stage);
  });
  card.querySelector("#pp-coach").addEventListener("click", () => submitAnswer(stage, card));
}

// One-tap day-one deck. These go in as ordinary cards owned by the agency —
// editable and deletable like any other — just flagged as starter cards so
// they aren't falsely credited to whoever pressed the button.
async function seedStarterCards(link, stage) {
  link.textContent = "Loading the deck...";
  link.style.pointerEvents = "none";

  // Check the database, not the copy held in this tab. If a teammate seeded
  // the deck from their own phone a minute ago, this tab wouldn't know, and
  // we'd cheerfully insert the same twelve cards a second time.
  const { data: existing } = await sb.from("pitch_scenarios").select("id").eq("is_starter", true).limit(1);
  if (existing?.length) {
    toast("A teammate already loaded these");
    loaded = false;
    await loadData();
    return;
  }

  const rows = STARTER_CARDS.map((text) => ({ prompt_text: text, niche: null, created_by: null, is_starter: true }));
  const { data, error } = await sb.from("pitch_scenarios").insert(rows).select();

  if (error) {
    console.error("pitchPractice: could not load starter cards", error);
    // The likeliest cause by far is an older copy of the migration without the
    // is_starter column, so point at the fix instead of showing a raw error.
    toast("Couldn't load the starter cards. Re-run the SQL in SETUP.md Step 158.", "error");
    link.textContent = `Or load ${STARTER_CARDS.length} common ones to start`;
    link.style.pointerEvents = "";
    return;
  }

  scenarios = (data || []).concat(scenarios);
  toast(`${data.length} starter cards added`);
  renderStage(stage);
}

// Prefer cards you haven't practised yet, so the deck doesn't keep handing
// back the same two objections while ten others sit untouched.
function pickCard() {
  const triedIds = new Set(myAttempts.map((a) => a.scenario_id));
  const fresh = scenarios.filter((s) => !triedIds.has(s.id) && s.id !== currentCard?.id);
  const pool = fresh.length ? fresh : scenarios.filter((s) => s.id !== currentCard?.id);
  const from = pool.length ? pool : scenarios;
  return from[Math.floor(Math.random() * from.length)];
}

async function submitAnswer(stage, card) {
  if (coaching) return;
  const input = card.querySelector("#pp-answer");
  const answer = input.value.trim();
  if (!answer) {
    toast("Type your answer first", "error");
    input.focus();
    return;
  }

  const out = card.querySelector("#pp-coach-out");
  const btn = card.querySelector("#pp-coach");
  coaching = true;
  btn.disabled = true;
  btn.textContent = "Coaching...";
  out.innerHTML = `<div class="card"><div class="text-faint" style="font-size:13px;">Reading your answer...</div></div>`;

  const { data, error } = await sb.functions.invoke("pitch-coach", {
    body: { scenario: currentCard.prompt_text, response: answer },
  });

  coaching = false;
  btn.disabled = false;
  btn.textContent = "Get Coaching";

  if (error || data?.error) {
    out.innerHTML = "";
    toast(error?.message || data?.error || "Couldn't get a coaching note", "error");
    return;
  }

  const note = data.note || "";
  out.innerHTML = "";
  out.appendChild(el(`
    <div class="card glow-card">
      <div class="status-pill paid" style="margin-bottom:8px;">Coach</div>
      <div style="font-size:13.5px;line-height:1.5;white-space:pre-wrap;">${esc(note)}</div>
    </div>
  `));

  // Save it so they can look back over their own reps later. Failing to save
  // shouldn't lose them the note they just got, so this is fire-and-forget
  // with a quiet console log rather than a blocking error.
  const { data: saved, error: saveErr } = await sb
    .from("pitch_attempts")
    .insert({ scenario_id: currentCard.id, agent_id: store.profile?.id, response_text: answer, coach_note: note })
    .select()
    .single();
  if (saveErr) console.error("pitchPractice: could not save attempt", saveErr);
  else myAttempts.unshift(saved);

  const root = document.getElementById("view-pitch");
  renderProgress(root.querySelector("#pp-progress"));
  renderHistory(root.querySelector("#pp-history"));

  const next = el(`<button class="btn btn-ghost" id="pp-next" style="margin-top:10px;">Draw another card</button>`);
  next.addEventListener("click", () => {
    currentCard = pickCard();
    renderStage(stage);
  });
  out.appendChild(next);
}

// ----------------------------------------------------------------------------
// Your own past reps
// ----------------------------------------------------------------------------

function renderHistory(box) {
  box.innerHTML = "";
  if (!myAttempts.length) {
    box.appendChild(el(`<div class="empty-state" style="padding:20px;"><p>Nothing yet. Your practice attempts show up here, visible only to you.</p></div>`));
    return;
  }

  myAttempts.slice(0, 8).forEach((a) => {
    const scen = scenarios.find((s) => s.id === a.scenario_id);
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(scen?.prompt_text || "A card that's since been removed")}</div>
            <div class="text-faint" style="font-size:11px;margin-top:2px;">${timeAgo(a.created_at)}</div>
          </div>
          <span class="text-faint" style="font-size:13px;flex:0 0 auto;margin-left:8px;">→</span>
        </div>
      </div>
    `);
    row.addEventListener("click", () => openAttemptSheet(a, scen));
    box.appendChild(row);
  });
}

function openAttemptSheet(attempt, scen) {
  const body = el(`
    <div>
      <div class="card" style="margin-bottom:10px;">
        <div class="status-pill replied" style="margin-bottom:8px;">Prospect said</div>
        <div style="font-size:13.5px;line-height:1.5;">${esc(scen?.prompt_text || "This card has since been removed.")}</div>
      </div>
      <div class="card" style="margin-bottom:10px;">
        <div class="status-pill" style="margin-bottom:8px;">You said</div>
        <div style="font-size:13.5px;line-height:1.5;white-space:pre-wrap;">${esc(attempt.response_text)}</div>
      </div>
      ${attempt.coach_note ? `
      <div class="card glow-card">
        <div class="status-pill paid" style="margin-bottom:8px;">Coach</div>
        <div style="font-size:13.5px;line-height:1.5;white-space:pre-wrap;">${esc(attempt.coach_note)}</div>
      </div>
      ` : ""}
    </div>
  `);
  openSheet(timeAgo(attempt.created_at), body);
}

// ----------------------------------------------------------------------------
// Building a card (this is the part that makes the deck yours)
// ----------------------------------------------------------------------------

function openAddCardSheet() {
  const niches = (store.niches || []).map((n) => n.name).filter(Boolean);
  const body = el(`
    <div>
      <div class="text-faint" style="font-size:12.5px;margin-bottom:12px;">Write the objection the way the prospect actually said it, not a tidied-up version. The awkward wording is the useful bit.</div>

      <div class="field">
        <label for="pp-new-text">What did they say?</label>
        <textarea id="pp-new-text" rows="3" placeholder="e.g. We already have someone doing our social media"></textarea>
      </div>

      <div class="field">
        <label for="pp-new-niche">Which niche? (optional)</label>
        <select id="pp-new-niche">
          <option value="">Any niche</option>
          ${niches.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("")}
        </select>
      </div>

      <button class="btn btn-primary" id="pp-new-save" style="margin-top:16px;">Add to the deck</button>
    </div>
  `);
  openSheet("Add a Card", body);

  body.querySelector("#pp-new-save").addEventListener("click", async () => {
    const text = body.querySelector("#pp-new-text").value.trim();
    if (!text) { toast("Write what the prospect said", "error"); return; }
    const niche = body.querySelector("#pp-new-niche").value || null;

    const btn = body.querySelector("#pp-new-save");
    btn.disabled = true;
    btn.textContent = "Adding...";

    const { data, error } = await sb
      .from("pitch_scenarios")
      .insert({ prompt_text: text, niche, created_by: store.profile?.id })
      .select()
      .single();

    btn.disabled = false;
    btn.textContent = "Add to the deck";

    if (error) {
      console.error("pitchPractice: could not add card", error);
      toast("Couldn't add that card", "error");
      return;
    }
    scenarios.unshift(data);
    closeSheet();
    toast("Card added to the deck");
    renderPitchPractice();
  });
}
