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
// deliberately a starting point and not a library: objections that come up
// constantly when selling marketing to small businesses in Zimbabwe, and
// nothing more. They're written the blunt way a real prospect says them, not
// the tidied-up way a training manual would. Every one can be edited or
// deleted like any other card.
//
// The niche field is only ever a label printed on the card, so it's safe for
// it to say "Salons" even if this agency never set up a niche by that name.

// Objections you'll hear from almost any small business. These are always
// included, and stay untagged on purpose: a general objection tagged to one
// niche reads as if it only applies there.
const STARTER_GENERAL = [
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

// Niche-specific decks. Each niche pushes back in its own way, and the answer
// that lands on a hardware store falls flat in a salon, so these are kept
// apart rather than lumped into the general pile.
//
// `match` is a list of keywords checked against the niches this agency has
// actually set up (Niches tab). Only matching decks get loaded, so a team that
// never sells to hotels doesn't practise hotel objections. When a deck does
// match, the card is tagged with the agency's OWN wording for that niche
// ("Fitness & Gyms" rather than "Fitness") so the label matches the rest of
// the app. `label` is only the fallback for an agency with no niches set up.
const STARTER_BY_NICHE = [
  {
    label: "Salons",
    match: ["salon", "hair", "beauty", "barber", "spa", "nail"],
    cards: [
      "My clients just walk in from the road. I don't need Instagram.",
      "I already post my own pictures. My phone takes good photos.",
      "The salon next door is cheaper. My clients will just go there.",
      "I don't have time to be taking pictures while I'm doing someone's hair.",
      "My WhatsApp status already gets plenty of views.",
      "Weekends are already full. Can you actually bring me people on a Tuesday?",
    ],
  },
  {
    label: "Real Estate",
    match: ["real estate", "property", "propert"],
    cards: [
      "Property sells itself. If the price is right, people will call.",
      "We already list everything on the property websites.",
      "Each of my agents posts on their own page already.",
      "The market is dead right now. Nobody is buying.",
    ],
  },
  {
    label: "Car Dealerships",
    match: ["car", "vehicle", "dealership", "motor", "auto"],
    cards: [
      "People come to the yard to see the car, not to look at pictures.",
      "We boost our own posts on Facebook already.",
      "Everyone selling cars is on Marketplace for free. Why would I pay you?",
      "Buyers only care about the price and the mileage, nothing else.",
    ],
  },
  {
    label: "Solar Installers",
    match: ["solar"],
    cards: [
      "Load shedding sells solar for us. We don't need marketing.",
      "We're already booked solid for the next two months.",
      "Our work comes from referrals from people we've already installed for.",
      "Customers just want the cheapest price per kilowatt. Pictures won't change that.",
    ],
  },
  {
    label: "Restaurants & Cafes",
    match: ["restaurant", "cafe", "café", "food", "takeaway", "catering"],
    cards: [
      "We're already full every weekend.",
      "People find us on Google Maps. That's enough.",
      "I take the food pictures myself with my phone.",
      "Margins on food are too thin to pay someone every month.",
    ],
  },
  {
    label: "Fitness & Gyms",
    match: ["gym", "fitness", "sport"],
    cards: [
      "January is when people join. There's no point marketing now.",
      "My members bring their friends. That's how we grow.",
      "The trainers already post the workout videos.",
      "Everyone in this area knows where the gym is.",
    ],
  },
  {
    label: "Hotels & Lodges",
    match: ["hotel", "lodge", "guest", "tourism", "safari"],
    cards: [
      "All our bookings come through the booking sites and travel agents.",
      "It's low season. There's nothing to advertise right now.",
      "Head office handles marketing. I can't decide that here.",
      "Our guests are corporate. They don't book a lodge off Instagram.",
    ],
  },
  {
    label: "Private Healthcare",
    match: ["health", "clinic", "medical", "dental", "doctor", "pharmac"],
    cards: [
      "Patients come by referral from other doctors, not from adverts.",
      "There are rules about how a practice is allowed to advertise.",
      "It doesn't look professional for a clinic to be posting on Instagram.",
      "I'm with patients all day. I can't be dealing with content.",
    ],
  },
  {
    label: "Professional Services",
    match: ["professional", "law", "legal", "account", "consult", "financ", "insur"],
    cards: [
      "Our clients come through referrals and relationships, not social media.",
      "We're a serious firm. We don't need to be dancing on TikTok.",
      "The partners would never approve spending on this.",
      "What would we even post? Our work is confidential.",
    ],
  },
  {
    label: "Fashion & Boutiques",
    match: ["fashion", "boutique", "cloth", "retail"],
    cards: [
      "I post every new stock arrival on my WhatsApp status already.",
      "My customers just come to the shop and see what's new.",
      "People will screenshot the outfit and go find it cheaper somewhere else.",
      "My stock changes all the time. What would you even advertise?",
    ],
  },
  {
    label: "Events & Weddings",
    match: ["event", "wedding", "decor", "photograph"],
    cards: [
      "It's all word of mouth. One wedding brings the next.",
      "Wedding season is only a few months. The rest of the year is quiet.",
      "I already have thousands of photos on my page.",
      "Brides find me through the venues I work with.",
    ],
  },
];

// Builds the starter deck for THIS agency: the general cards, plus the niche
// decks that match niches they actually work. An agent's practice time is
// better spent on objections they'll really hear than on a hotel deck at an
// agency that has never pitched a hotel.
// Keywords match at the START of a word, never mid-word. A plain "contains"
// check quietly does the wrong thing here: "car" is inside "healthCARE", and
// "shop" is inside "barberSHOP", so a clinic would have been handed car-yard
// objections and a salon would have been handed clothing-boutique ones.
// Matching from a word boundary still allows deliberate prefixes, so
// "propert" catches both "Property" and "Properties".
function nicheMatches(nicheName, keywords) {
  const n = nicheName.toLowerCase();
  return keywords.some((k) => new RegExp("\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(n));
}

function starterCardsForOrg() {
  const orgNiches = (store.niches || []).map((n) => n.name).filter(Boolean);
  const rows = STARTER_GENERAL.map((text) => ({ prompt_text: text, niche: null }));
  // One niche gets one deck. A name like "Boutique Lodges" legitimately
  // matches both the hotel and the fashion keywords, and stacking both would
  // hand a lodge objections about stock arrivals. First match in the list
  // above wins, so the more specific decks are listed first.
  const claimed = new Set();

  STARTER_BY_NICHE.forEach((group) => {
    const own = orgNiches.find((n) => !claimed.has(n) && nicheMatches(n, group.match));
    // Skip decks this agency has no matching niche for. The exception is an
    // agency that hasn't set up niches at all, where filtering to nothing
    // would be worse than giving them everything.
    if (!own && orgNiches.length) return;
    if (own) claimed.add(own);
    group.cards.forEach((text) => rows.push({ prompt_text: text, niche: own || group.label }));
  });

  return rows;
}

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
          <span class="small-link" id="pp-seed">Or load ${starterCardsForOrg().length} common ones to start</span>
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

  const rows = starterCardsForOrg().map((c) => ({ ...c, created_by: null, is_starter: true }));
  const { data, error } = await sb.from("pitch_scenarios").insert(rows).select();

  if (error) {
    console.error("pitchPractice: could not load starter cards", error);
    // Re-running the migration is still the fix, but say WHY it failed rather
    // than only guessing at the cause. The two real causes look identical from
    // here — a missing is_starter column and a missing stamp_org_id trigger
    // (which leaves org_id null and trips the not-null constraint) — and
    // without the database's own words there is no way to tell them apart, so
    // a wrong guess sends someone re-running SQL that was never the problem.
    const why = (error.message || "").trim();
    toast(
      `Couldn't load the starter cards. Re-run the SQL in SETUP.md Step 158.${why ? " Database said: " + why : ""}`,
      "error"
    );
    link.textContent = `Or load ${starterCardsForOrg().length} common ones to start`;
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

// supabase-js reports a function that isn't deployed and a function that is
// deployed but unreachable with the same opaque sentence: "Failed to send a
// request to the Edge Function". On its own that tells the reader nothing they
// can act on — it looks like the app is broken rather than like a setup step
// was skipped. By far the likeliest cause on a fresh install is simply that
// pitch-coach was never deployed, so name that and point at the step. The
// original wording is kept on the end so a genuinely different fault (a
// function that IS deployed but is crashing, say) is still legible.
function coachErrorMessage(error, data) {
  const raw = (error?.message || data?.error || "").trim();
  if (/failed to send a request/i.test(raw)) {
    return "The pitch-coach function isn't deployed yet — see SETUP.md Step 158.2. Cards still work without it; only the coaching notes need it.";
  }
  return raw || "Couldn't get a coaching note";
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
    console.error("pitchPractice: coaching request failed", error || data?.error);
    toast(coachErrorMessage(error, data), "error");
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
