import { sb } from "../supabaseClient.js";
import { store, nicheById, loadNotesFor, prospectById, profileById } from "../state.js";
import { el, esc, money, toast, timeAgo } from "../utils.js";
import { openSheet, closeSheet, openModal, closeModal } from "../ui.js";
import { openProspectDetail } from "./prospectDetail.js";

// ============================================================================
// DEAL PRICING CALCULATOR
// ----------------------------------------------------------------------------
// A quick, opinionated pricing tool built on real Harare (Zimbabwe) 2026 USD
// market bands. An agent answers a handful of tap-to-select questions about
// a prospect and gets back a recommended monthly retainer, a "never go
// below" floor, a once-off launch package, and a one-line pitch sentence.
// Opens as a bottom sheet, from the More menu (general use, pick a
// prospect to save to) or as a quick action on a prospect's own Details
// screen (pre-filled and pre-targeted at that prospect).
// ============================================================================

const TIERS = [
  {
    key: "small",
    label: "Small Consumer",
    hint: "Café, salon, spa, boutique",
    min: 150,
    max: 350,
    floor: 150,
    launchRange: [150, 200],
  },
  {
    key: "sme",
    label: "SME",
    hint: "Car dealer, gym, mid restaurant, furniture",
    min: 300,
    max: 600,
    floor: 300,
    launchRange: [200, 275],
  },
  {
    key: "pro",
    label: "Professional / Corporate",
    hint: "Law, accounting, real estate, medical, solar",
    min: 500,
    max: 1000,
    floor: 500,
    launchRange: [275, 350],
  },
  {
    key: "large",
    label: "Developer / Large / Launch",
    hint: "Property developer, major brand, big launch",
    min: 1000,
    max: 2000,
    floor: 1000,
    launchRange: [350, 400],
    allowExceed: true,
  },
];

const PLATFORM_OPTIONS = [
  { key: "1", label: "1", val: 1 },
  { key: "2", label: "2", val: 2 },
  { key: "3", label: "3", val: 3 },
  { key: "4plus", label: "4+", val: 4 },
];
const VOLUME_OPTIONS = [
  { key: "light", label: "Light (4-8)", val: 0 },
  { key: "standard", label: "Standard (10-16)", val: 0.5 },
  { key: "heavy", label: "Heavy (20+ / daily)", val: 1 },
];
const VIDEO_OPTIONS = [
  { key: "no", label: "No", val: 0 },
  { key: "some", label: "Some", val: 0.5 },
  { key: "heavy", label: "Video-heavy", val: 1 },
];
const POST_OPTIONS = [
  { key: "client", label: "Client posts (we create only)", val: 0 },
  { key: "we", label: "We manage & post fully", val: 1 },
];
const ADS_OPTIONS = [
  { key: "no", label: "No", val: 0 },
  { key: "yes", label: "Yes (ad spend billed separately)", val: 1 },
];

// Freeform niche names get matched by keyword to guess a starting tier, // checked most-specific-first so e.g. "property developer" wins over "real
// estate". Falls back to SME (a safe middle default) if nothing matches;
// the agent can always tap a different tier chip to override.
const NICHE_KEYWORDS = {
  large: ["developer", "development", "construction", "property developer", "estate developer", "hotel", "resort", "bank", "franchise"],
  pro: ["law", "legal", "attorney", "advocate", "chambers", "account", "audit", "real estate", "realtor", "medical", "clinic", "dental", "doctor", "hospital", "pharmac", "solar", "energy", "engineer", "architect", "insurance", "financial", "consult"],
  sme: ["car deal", "dealership", "motors", "gym", "fitness", "restaurant", "furniture", "logistics", "manufactur", "wholesale", "school", "college", "academy", "hardware"],
  small: ["café", "cafe", "salon", "spa", "boutique", "bakery", "barber", "nail", "beauty", "personal brand", "influencer"],
};

function guessTierKey(prospect) {
  const name = (prospect ? nicheById(prospect.niche_id)?.name || "" : "").toLowerCase();
  for (const key of ["large", "pro", "sme", "small"]) {
    if (NICHE_KEYWORDS[key].some((kw) => name.includes(kw))) return key;
  }
  return "sme";
}

function roundTo25(n) {
  return Math.round(n / 25) * 25;
}

function computeQuote(tierKey, a) {
  const tier = TIERS.find((t) => t.key === tierKey) || TIERS[1];
  const platformScore = (a.platforms - 1) / 3;
  const pushScore = (platformScore + a.volume + a.video + a.posting + a.ads) / 5;

  // Start low-to-mid of the band, push toward the ceiling as more signals
  // (platforms, volume, video, full management, ads) stack up.
  let position = 0.2 + pushScore * 0.8;
  let price;
  if (tier.allowExceed && pushScore > 0.85) {
    price = tier.max + (pushScore - 0.85) * (tier.max - tier.min) * 1.5;
  } else {
    position = Math.min(position, 1);
    price = tier.min + position * (tier.max - tier.min);
  }
  price = roundTo25(price);

  const [lMin, lMax] = tier.launchRange;
  const launch = roundTo25(lMin + Math.min(position, 1) * (lMax - lMin));

  return { tier, price, floor: tier.floor, launch };
}

function buildJustification(tier, price, a) {
  const platformWord = a.platforms === 4 ? "4+" : String(a.platforms);
  const mgmt = a.posting === 1 ? "content creation and full posting" : "content creation";
  const videoBit = a.video === 0 ? "" : a.video === 0.5 ? " with video" : " with heavy video production";
  const adsBit = a.ads === 1 ? " plus paid ads management" : "";

  if (tier.key === "small") {
    return `A ${platformWord}-platform presence with ${mgmt}${videoBit} for a business like yours runs around ${money(price)}/month.`;
  }
  if (tier.key === "sme") {
    return `To compete properly across ${platformWord} platform${a.platforms > 1 ? "s" : ""} with ${mgmt}${videoBit}${adsBit}, budget around ${money(price)}/month.`;
  }
  if (tier.key === "pro") {
    return `For a firm of your standing, a managed ${platformWord}-platform presence with ${mgmt}${videoBit}${adsBit} sits around ${money(price)}/month.`;
  }
  return `At your scale, a full ${platformWord}-platform managed presence with ${mgmt}${videoBit}${adsBit} is around ${money(price)}/month.`;
}

function chipQuestion(label, hint, options, selectedKey, onSelect) {
  const wrap = el(`
    <div class="dpc-q">
      <div class="dpc-q-label">${esc(label)}</div>
      ${hint ? `<div class="dpc-q-hint">${esc(hint)}</div>` : ""}
      <div class="dpc-options"></div>
    </div>
  `);
  const row = wrap.querySelector(".dpc-options");
  const chips = {};
  options.forEach((opt) => {
    const chip = el(`<span class="chip ${opt.key === selectedKey ? "active" : ""}">${esc(opt.label)}</span>`);
    chip.addEventListener("click", () => {
      Object.values(chips).forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      onSelect(opt);
    });
    chips[opt.key] = chip;
    row.appendChild(chip);
  });
  wrap._chips = chips;
  return wrap;
}

// Every saved quote is a prospect_notes row with this distinctive marker
// prefix, until now that made it invisible except by opening one
// prospect's Notes tab at a time. This surfaces "what have we quoted
// recently across everyone" so an owner can sanity-check pricing
// consistency, or an agent can check they haven't already quoted someone.
// Fetched on demand (not on every app load) since it's a rarely-opened
// cross-prospect view, not something the main store needs to track live.
export const QUOTE_MARKER = "💰 Deal Pricing Calculator quote";
async function openRecentQuotesModal() {
  const box = el(`
    <div>
      <div class="section-title mt-0">Recent Quotes</div>
      <div id="dpc-recent-list"><div class="text-faint" style="font-size:12.5px;">Loading…</div></div>
    </div>
  `);
  openModal(box);

  const { data, error } = await sb
    .from("prospect_notes")
    .select("id, prospect_id, body, created_at, author_id")
    .ilike("body", `${QUOTE_MARKER}%`)
    .order("created_at", { ascending: false })
    .limit(20);

  const listEl = box.querySelector("#dpc-recent-list");
  if (error) { listEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;">${esc(error.message)}</div>`; return; }
  if (!data || !data.length) { listEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;">No quotes saved yet.</div>`; return; }

  listEl.innerHTML = "";
  data.forEach((n) => {
    const prospect = prospectById(n.prospect_id);
    const author = profileById(n.author_id);
    // The saved note body already reads as a full sentence, just strip the
    // marker emoji/prefix so the card shows the useful part (tier + price).
    const summary = n.body.replace(`${QUOTE_MARKER}: `, "");
    const row = el(`
      <div class="card" style="margin-bottom:8px;${prospect ? "cursor:pointer;" : ""}">
        <div class="flex-between" style="margin-bottom:4px;">
          <span style="font-weight:700;font-size:13.5px;">${esc(prospect ? prospect.business_name : "Prospect no longer available")}</span>
          <span class="text-faint" style="font-size:11px;">${timeAgo(n.created_at)}</span>
        </div>
        <div class="text-faint" style="font-size:12px;line-height:1.4;">${esc(summary)}</div>
        ${author ? `<div class="text-faint" style="font-size:11px;margin-top:4px;">by ${esc(author.full_name || author.email)}</div>` : ""}
      </div>
    `);
    if (prospect) {
      row.addEventListener("click", () => {
        closeModal();
        openDealPricingCalculator(prospect);
      });
    }
    listEl.appendChild(row);
  });
}

// "Recent Quotes" above shows what we *quoted*; nothing checked that against
// what a prospect actually *signed* for once the deal closed, so
// systematic under-pricing (agents caving on price) or over-quoting (losing
// deals over an unrealistic number) was invisible. The quoted price was
// never stored as its own column, it only ever lived inside the saved
// note's text, so this parses it back out of the same QUOTE_MARKER note
// body and compares it to the prospect's real signed mrr. Only the most
// recent quote per prospect counts (a prospect can be re-quoted more than
// once before closing; only the final number was ever actually pitched).
function parseQuotedPrice(body) {
  const m = /recommended \$([\d,]+)\/mo/.exec(body || "");
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

const QUOTE_ACCURACY_FLAG_PCT = -15;

async function openQuoteAccuracyModal() {
  const box = el(`
    <div>
      <div class="section-title mt-0">Quote Accuracy</div>
      <div id="dpc-accuracy-list"><div class="text-faint" style="font-size:12.5px;">Loading…</div></div>
    </div>
  `);
  openModal(box);
  const listEl = box.querySelector("#dpc-accuracy-list");

  const signedIds = store.prospects.filter((p) => p.status === "signed").map((p) => p.id);
  if (!signedIds.length) {
    listEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;">No signed clients yet.</div>`;
    return;
  }

  const { data, error } = await sb
    .from("prospect_notes")
    .select("prospect_id, body, created_at")
    .ilike("body", `${QUOTE_MARKER}%`)
    .in("prospect_id", signedIds)
    .order("created_at", { ascending: false });

  if (error) { listEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;">${esc(error.message)}</div>`; return; }

  // Newest-first, so the first note we see per prospect is their latest quote.
  const latestByProspect = new Map();
  (data || []).forEach((n) => { if (!latestByProspect.has(n.prospect_id)) latestByProspect.set(n.prospect_id, n); });

  const rows = [];
  latestByProspect.forEach((note, prospectId) => {
    const quoted = parseQuotedPrice(note.body);
    const prospect = prospectById(prospectId);
    if (!prospect || quoted == null) return;
    const actual = Number(prospect.mrr) || 0;
    const pct = quoted ? Math.round(((actual - quoted) / quoted) * 100) : null;
    rows.push({ prospect, quoted, actual, pct });
  });

  if (!rows.length) {
    listEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;">None of your signed clients have a saved quote to compare yet.</div>`;
    return;
  }

  // Worst (most-below-quote) first, that's the actionable "we're leaving
  // money on the table" case an owner needs to see first.
  rows.sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));

  listEl.innerHTML = "";
  rows.forEach((r) => {
    const notable = r.pct !== null && r.pct <= QUOTE_ACCURACY_FLAG_PCT;
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <span style="font-weight:700;font-size:13.5px;">${esc(r.prospect.business_name)}</span>
          ${notable
            ? `<span class="status-pill stale">${r.pct}%</span>`
            : `<span class="text-faint" style="font-size:11px;">${r.pct > 0 ? "+" : ""}${r.pct}%</span>`}
        </div>
        <div class="text-faint" style="font-size:11.5px;margin-top:2px;">Quoted ${money(r.quoted)}/mo → Signed ${money(r.actual)}/mo</div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openProspectDetail(r.prospect);
    });
    listEl.appendChild(row);
  });
}

export function openDealPricingCalculator(prospect = null) {
  const answers = {
    tierKey: guessTierKey(prospect),
    platforms: 2,
    volume: 0.5,
    video: 0,
    posting: 0,
    ads: 0,
  };
  let targetProspectId = prospect?.id || null;

  const box = el(`<div></div>`);
  box.innerHTML = `
    <div class="flex-between" style="margin:-4px 2px 4px;">
      <p class="text-faint" style="font-size:13px;line-height:1.5;margin:0;flex:1;">
        Answer a few quick questions to get a Harare-market-accurate quote: a recommended
        retainer, a floor you should never go below, and a launch package to open with.
      </p>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:16px;margin:0 2px 16px;">
      <span class="small-link" id="dpc-quote-accuracy">Quote Accuracy</span>
      <span class="small-link" id="dpc-recent-quotes">Recent Quotes</span>
    </div>
    <div id="dpc-prospect-slot"></div>
    <div id="dpc-questions"></div>
    <div class="card glow-card" style="margin-bottom:16px;">
      <div class="pv-big-num" id="dpc-price">$0</div>
      <div class="pv-big-label">Recommended monthly retainer</div>
      <div class="dpc-floor-box" id="dpc-floor"></div>
      <div class="pv-flow text-dim" id="dpc-launch"></div>
      <div class="pv-flow text-dim" style="margin-bottom:0;" id="dpc-deposit">50% deposit + signed agreement to begin.</div>
    </div>
    <div class="section-title mt-0">Pitch Line</div>
    <div class="card" style="margin-bottom:16px;"><div class="dpc-justify" id="dpc-justify"></div></div>
    <div id="dpc-save-slot"></div>
  `;

  const prospectSlot = box.querySelector("#dpc-prospect-slot");
  const questionsBox = box.querySelector("#dpc-questions");
  const saveSlot = box.querySelector("#dpc-save-slot");

  box.querySelector("#dpc-recent-quotes").addEventListener("click", openRecentQuotesModal);
  box.querySelector("#dpc-quote-accuracy").addEventListener("click", openQuoteAccuracyModal);

  // -- who is this quote for? --
  if (prospect) {
    prospectSlot.innerHTML = `
      <div class="section-title mt-0">Quoting For</div>
      <div class="card" style="margin-bottom:16px;font-size:13.5px;font-weight:700;">${esc(prospect.business_name)}</div>
    `;
  } else {
    const options = store.prospects
      .slice()
      .sort((a, b) => (a.business_name || "").localeCompare(b.business_name || ""))
      .map((p) => `<option value="${p.id}">${esc(p.business_name)}</option>`)
      .join("");
    prospectSlot.innerHTML = `
      <div class="section-title mt-0">Quoting For (optional)</div>
      <div class="field" style="margin-bottom:16px;">
        <select id="dpc-prospect-select">
          <option value="">Not tied to a prospect</option>
          ${options}
        </select>
        <div class="hint">Pick a prospect to enable saving this quote to their record.</div>
      </div>
    `;
    prospectSlot.querySelector("#dpc-prospect-select").addEventListener("change", (e) => {
      targetProspectId = e.target.value || null;
      const p = targetProspectId ? store.prospects.find((pr) => pr.id === targetProspectId) : null;
      if (p) {
        answers.tierKey = guessTierKey(p);
        rebuildQuestions();
      }
      renderSave();
      recompute();
    });
  }

  // -- tier + question chips --
  function rebuildQuestions() {
    questionsBox.innerHTML = "";
    questionsBox.appendChild(
      chipQuestion(
        "Business tier / type",
        TIERS.find((t) => t.key === answers.tierKey)?.hint,
        TIERS.map((t) => ({ key: t.key, label: t.label })),
        answers.tierKey,
        (opt) => { answers.tierKey = opt.key; recompute(); }
      )
    );
    questionsBox.appendChild(
      chipQuestion("Number of platforms", null, PLATFORM_OPTIONS, String(answers.platforms === 4 ? "4plus" : answers.platforms), (opt) => {
        answers.platforms = opt.val; recompute();
      })
    );
    questionsBox.appendChild(
      chipQuestion("Content volume per month", null, VOLUME_OPTIONS, volumeKey(answers.volume), (opt) => {
        answers.volume = opt.val; recompute();
      })
    );
    questionsBox.appendChild(
      chipQuestion("Video included?", null, VIDEO_OPTIONS, videoKey(answers.video), (opt) => {
        answers.video = opt.val; recompute();
      })
    );
    questionsBox.appendChild(
      chipQuestion("Who posts?", null, POST_OPTIONS, answers.posting === 1 ? "we" : "client", (opt) => {
        answers.posting = opt.val; recompute();
      })
    );
    questionsBox.appendChild(
      chipQuestion("Paid ads management?", null, ADS_OPTIONS, answers.ads === 1 ? "yes" : "no", (opt) => {
        answers.ads = opt.val; recompute();
      })
    );
  }

  function volumeKey(v) { return v === 0 ? "light" : v === 1 ? "heavy" : "standard"; }
  function videoKey(v) { return v === 0 ? "no" : v === 1 ? "heavy" : "some"; }

  const priceEl = box.querySelector("#dpc-price");
  const floorEl = box.querySelector("#dpc-floor");
  const launchEl = box.querySelector("#dpc-launch");
  const justifyEl = box.querySelector("#dpc-justify");

  let lastQuote = null;
  function recompute() {
    const q = computeQuote(answers.tierKey, answers);
    lastQuote = q;
    priceEl.textContent = money(q.price) + "/mo";
    floorEl.textContent = `Don't go below ${money(q.floor)}/mo`;
    launchEl.innerHTML = `Suggested launch package: <b>${money(q.launch)}</b> once-off (foundation setup)`;
    justifyEl.textContent = buildJustification(q.tier, q.price, answers);
    renderSave();
  }

  function renderSave() {
    if (!lastQuote) return;
    if (!targetProspectId) {
      saveSlot.innerHTML = `<div class="hint" style="margin-bottom:16px;">Pick a prospect above to save this quote to their record.</div>`;
      return;
    }
    saveSlot.innerHTML = `<button class="btn btn-primary" id="dpc-save-btn" style="margin-bottom:16px;">Save Quote to Prospect</button>`;
    saveSlot.querySelector("#dpc-save-btn").addEventListener("click", async () => {
      const p = store.prospects.find((pr) => pr.id === targetProspectId);
      if (!p || !lastQuote) return;
      const btn = saveSlot.querySelector("#dpc-save-btn");
      btn.textContent = "Saving…";
      btn.setAttribute("disabled", "true");
      const body =
        `💰 Deal Pricing Calculator quote: ${lastQuote.tier.label}, recommended ${money(lastQuote.price)}/mo ` +
        `(floor ${money(lastQuote.floor)}/mo). Launch package: ${money(lastQuote.launch)} once-off. ` +
        `Basis: ${answers.platforms === 4 ? "4+" : answers.platforms} platform(s), ` +
        `${volumeKey(answers.volume)} content, video: ${videoKey(answers.video)}, ` +
        `${answers.posting === 1 ? "we manage & post" : "client posts"}, ` +
        `ads: ${answers.ads === 1 ? "yes" : "no"}.`;
      const { error } = await sb.from("prospect_notes").insert({ prospect_id: p.id, author_id: store.profile.id, body });
      if (error) {
        toast(error.message, "error");
        btn.textContent = "Save Quote to Prospect";
        btn.removeAttribute("disabled");
        return;
      }
      loadNotesFor(p.id);
      toast(`Quote saved to ${p.business_name}`, "success");
      btn.textContent = "Saved ✓";
    });
  }

  rebuildQuestions();
  recompute();

  openSheet("Deal Pricing Calculator", box);
}
