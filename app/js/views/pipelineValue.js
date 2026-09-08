import { sb } from "../supabaseClient.js";
import { store, on, nicheById, profileById } from "../state.js";
import { el, money, debounce } from "../utils.js";
import { LOST_REASON_MARKER } from "./prospectDetail.js";
import { QUOTE_MARKER } from "./dealPricing.js";

// ============================================================================
// PIPELINE VALUE, "what this pipeline is worth" calculator
// ----------------------------------------------------------------------------
// Sliders let an agent model a month of outreach. By default the sliders are
// set from REAL numbers pulled from the last 30 days of your team's own
// outreach (status_history table + signed prospects' actual retainer values)
//, so the calculator starts truthful, not guessed. Drag any slider to
// explore a "what if" scenario; a badge shows whether you're looking at the
// live number or a custom one, and "Reset to Live" snaps back. Whatever you
// leave it on is remembered on this device (localStorage) for next time.
// ============================================================================

const LS_KEY = "sxc_pipeline_value_v1";
const WINDOW_DAYS = 30;
const DAYS_PER_MONTH = 30;
// Stage-timing averages need more sample size than the 30-day live-rate
// counters above, so it gets its own, longer lookback window.
const TIMING_WINDOW_DAYS = 90;

// The four adjacent funnel steps we report a "time in stage" average for, // deliberately excludes "dead" and any non-adjacent jump (e.g. sent straight
// to signed) so one weird outlier can't masquerade as a clean stage duration.
const STAGE_TRANSITIONS = [
  { from: "not_contacted", to: "sent", label: "Lead → First Sent" },
  { from: "sent", to: "replied", label: "Sent → Replied" },
  { from: "replied", to: "meeting_booked", label: "Replied → Meeting" },
  { from: "meeting_booked", to: "signed", label: "Meeting → Signed" },
];

const FIELDS = [
  { key: "msgsPerWeek", label: "Messages sent per week", min: 0, max: 400, step: 5, fmt: (v) => String(v) },
  { key: "replyRate", label: "Reply rate", min: 0, max: 100, step: 1, fmt: (v) => v + "%" },
  { key: "replyToMeeting", label: "Reply → meeting", min: 0, max: 100, step: 1, fmt: (v) => v + "%" },
  { key: "meetingToSigned", label: "Meeting → signed", min: 0, max: 100, step: 1, fmt: (v) => v + "%" },
  { key: "retainer", label: "Avg monthly retainer", min: 150, max: 2000, step: 10, fmt: (v) => money(v) },
];

let liveStats = null; // { counts, msgsPerWeek, replyRate, replyToMeeting, meetingToSigned, retainer }
let inputs = null; // current slider state, same shape as liveStats fields + bills
let isCustom = false;
let statusHistoryCache = [];
let stageTimingCache = []; // { prospect_id, old_status, new_status, changed_at } over TIMING_WINDOW_DAYS
let lostReasonsCache = []; // prospect_notes rows whose body starts with LOST_REASON_MARKER
let quotedProspectsCache = []; // prospect_notes rows whose body starts with QUOTE_MARKER
let refs = null; // live DOM refs for in-place updates while dragging

function isActive() {
  return document.getElementById("view-pipelinevalue")?.classList.contains("active");
}

function clampPct(v) {
  return Math.round(Math.min(1, Math.max(0, v)) * 100);
}

function fallbackLiveStats() {
  return {
    counts: { sent: 0, replied: 0, meeting_booked: 0, signed: 0 },
    msgsPerWeek: 20,
    replyRate: 10,
    replyToMeeting: 50,
    meetingToSigned: 40,
    retainer: 400,
  };
}

function computeLiveStats() {
  const counts = { sent: 0, replied: 0, meeting_booked: 0, signed: 0 };
  statusHistoryCache.forEach((h) => {
    if (counts[h.new_status] !== undefined) counts[h.new_status]++;
  });

  const msgsPerWeek = Math.round((counts.sent / WINDOW_DAYS) * 7);
  const replyRate = counts.sent > 0 ? counts.replied / counts.sent : 0.10;
  const replyToMeeting = counts.replied > 0 ? counts.meeting_booked / counts.replied : 0.50;
  const meetingToSigned = counts.meeting_booked > 0 ? counts.signed / counts.meeting_booked : 0.40;

  const signedWithMrr = store.prospects.filter((p) => p.status === "signed" && Number(p.mrr) > 0);
  const retainer = signedWithMrr.length
    ? Math.round(signedWithMrr.reduce((s, p) => s + Number(p.mrr), 0) / signedWithMrr.length)
    : 400;

  return {
    counts,
    msgsPerWeek: msgsPerWeek || 20,
    replyRate: clampPct(replyRate),
    replyToMeeting: clampPct(replyToMeeting),
    meetingToSigned: clampPct(meetingToSigned),
    retainer: Math.max(0, retainer),
  };
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ inputs, isCustom }));
  } catch {
    /* storage unavailable, non-fatal, just won't remember across visits */
  }
}

function ensureInitialState() {
  if (inputs) return;
  liveStats = fallbackLiveStats();
  const saved = loadSaved();
  if (saved?.isCustom && saved?.inputs) {
    inputs = { ...liveStats, bills: 1000, ...saved.inputs };
    isCustom = true;
  } else {
    inputs = { ...liveStats, bills: saved?.inputs?.bills ?? 1000 };
    isCustom = false;
  }
}

function computeProjection(v) {
  const messagesPerMonth = v.msgsPerWeek * (DAYS_PER_MONTH / 7);
  const replies = messagesPerMonth * (v.replyRate / 100);
  const meetings = replies * (v.replyToMeeting / 100);
  const signedPerMonth = meetings * (v.meetingToSigned / 100);
  const monthlyRecurring = signedPerMonth * v.retainer;
  const threeMonth = monthlyRecurring * 3;
  const depositUnit = v.retainer * 0.5;
  const depositsNeeded = depositUnit > 0 ? Math.ceil((v.bills || 0) / depositUnit) : 0;
  const signedPerWeek = signedPerMonth / (DAYS_PER_MONTH / 7);
  const weeksToClear = depositsNeeded > 0 && signedPerWeek > 0 ? Math.max(1, Math.ceil(depositsNeeded / signedPerWeek)) : null;
  return { messagesPerMonth, replies, meetings, signedPerMonth, monthlyRecurring, threeMonth, depositsNeeded, weeksToClear };
}

const fmtNum = (n) => Math.round(n).toLocaleString();
const fmt1 = (n) => (Math.round(n * 10) / 10).toLocaleString();

function patchOutputs() {
  if (!refs) return;
  const proj = computeProjection(inputs);

  refs.bigNum.textContent = money(proj.monthlyRecurring);
  refs.flowLine.innerHTML =
    `<b>${fmtNum(proj.messagesPerMonth)}</b> messages/month → <b>${fmt1(proj.replies)}</b> replies → ` +
    `<b>${fmt1(proj.meetings)}</b> meetings → <b>${fmt1(proj.signedPerMonth)}</b> signed/month`;
  refs.retainerLine.innerHTML =
    `Each signed client adds <b>${money(inputs.retainer)}</b>/mo recurring. Three months of this compounds to ` +
    `<b>${money(proj.threeMonth)}</b>/mo if none churn.`;
  refs.billsLine.innerHTML = proj.depositsNeeded > 0
    ? `To clear <b>${money(inputs.bills)}</b> in bills, you need ~<b>${proj.depositsNeeded}</b> deposit${proj.depositsNeeded === 1 ? "" : "s"} (50% upfront)` +
      (proj.weeksToClear ? `, roughly <b>${proj.weeksToClear}</b> week${proj.weeksToClear === 1 ? "" : "s"} at this rate.` : `, at this rate that's not moving, send more messages or raise your close rate.`)
    : `Set a bills amount above to see how many deposits you'd need to clear it.`;

  refs.badge.className = "pv-badge " + (isCustom ? "custom" : "live");
  refs.badge.innerHTML = isCustom
    ? `<span class="dot"></span> Custom scenario`
    : `<span class="dot"></span> Live: last ${WINDOW_DAYS} days`;
  refs.resetBtn.style.display = isCustom ? "" : "none";
}

function setSliderFill(input) {
  const min = Number(input.min), max = Number(input.max), val = Number(input.value);
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  input.style.setProperty("--pv-fill", pct + "%");
}

function markCustomIfDifferent() {
  const wasCustom = isCustom;
  isCustom = FIELDS.some((f) => Number(inputs[f.key]) !== Number(liveStats[f.key]));
  if (isCustom !== wasCustom) persist();
}

const persistDebounced = debounce(() => persist(), 400);

export function renderPipelineValue() {
  ensureInitialState();
  const root = document.getElementById("view-pipelinevalue");
  root.innerHTML = "";

  const wrap = el(`
    <div>
      <div class="page-title">Pipeline Value<span class="accent">.</span></div>
      <p class="text-faint" style="font-size:13px;line-height:1.5;margin:-6px 2px 18px;">
        Model your month. Sliders start from your team's real outreach, drag any of them to test a scenario.
      </p>

      <div class="card glow-card" style="margin-bottom:18px;">
        <div class="pv-big-num" id="pv-bignum">$0</div>
        <div class="pv-big-label">Projected monthly recurring</div>
        <div class="pv-flow text-dim" id="pv-flow"></div>
        <div class="pv-flow text-dim" id="pv-retainer-line"></div>
        <div class="pv-flow text-dim" id="pv-bills-line" style="margin-bottom:0;"></div>
      </div>

      <div class="flex-between" style="margin:22px 2px 10px;">
        <div class="section-title" style="margin:0;">Your Inputs</div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="small-link" id="pv-reset" style="display:none;">Reset to Live</span>
          <span class="pv-badge live" id="pv-badge"></span>
        </div>
      </div>

      <div class="card" id="pv-sliders" style="margin-bottom:14px;"></div>

      <div class="field" style="margin-bottom:4px;">
        <label>Bills to clear this month (USD)</label>
        <input id="pv-bills" type="number" min="0" step="10" value="${inputs.bills}" />
      </div>

      <div class="section-title">What We're Seeing</div>
      <div class="stat-grid cols-3" id="pv-live-grid" style="margin-bottom:6px;"></div>
      <div class="hint" style="margin:8px 2px 20px;">Counted from status changes logged by your team over the last ${WINDOW_DAYS} days. Saves your slider scenario on this device only.</div>

      <div class="section-title">Revenue by Niche</div>
      <div class="stat-grid cols-2" id="pv-niche-grid" style="margin-bottom:18px;"></div>

      <div class="section-title">Revenue by Tier</div>
      <div class="stat-grid cols-3" id="pv-tier-grid" style="margin-bottom:6px;"></div>
      <div class="hint" style="margin:8px 2px 20px;">Monthly recurring value of signed clients only, grouped by niche and tier.</div>

      <div class="section-title">Revenue by City</div>
      <div class="stat-grid cols-2" id="pv-city-grid" style="margin-bottom:18px;"></div>

      <div class="section-title">Win Rate by Niche</div>
      <div class="stat-grid cols-2" id="pv-niche-win-grid" style="margin-bottom:18px;"></div>

      <div class="section-title">Win Rate by Agent</div>
      <div class="stat-grid cols-2" id="pv-agent-win-grid" style="margin-bottom:6px;"></div>
      <div class="hint" style="margin:8px 2px 20px;">Of everyone actually contacted (not left at Not Contacted), what share converted all the way to Signed. Shows where outreach is working, not just where revenue is.</div>

      <div class="section-title">Win Rate by Heat Score</div>
      <div class="stat-grid cols-3" id="pv-heat-win-grid" style="margin-bottom:6px;"></div>
      <div class="hint" style="margin:8px 2px 20px;">Every other breakdown here groups win rate by niche or agent. This groups it by the hand-assigned Heat Score itself, so you can see whether "hot" leads actually convert better or the scoring habit is just noise.</div>

      <div class="section-title">Win Rate by Tier</div>
      <div class="stat-grid cols-3" id="pv-tier-win-grid" style="margin-bottom:6px;"></div>
      <div class="hint" style="margin:8px 2px 20px;">Same lens as Heat Score, but for the other hand-assigned field: the A/B/C tier your team sets manually. Shows whether the highest-priority tier actually closes more often, or whether the tiering habit needs a rethink.</div>

      <div class="section-title">Average Time in Stage</div>
      <div class="stat-grid cols-2" id="pv-timing-grid" style="margin-bottom:6px;"></div>
      <div class="hint" style="margin:8px 2px 20px;">How long deals typically sit in each stage before moving to the next, based on status changes logged over the last ${TIMING_WINDOW_DAYS} days. Shows where time actually leaks out of the funnel, not just where it stalls in count.</div>

      <div class="section-title">Best Day to Send</div>
      <div class="stat-grid cols-3" id="pv-day-grid" style="margin-bottom:6px;"></div>
      <div class="hint" style="margin:8px 2px 20px;">Reply rate by the day of the week your first outreach went out, based on the same ${TIMING_WINDOW_DAYS}-day status history above. Days with no sends yet show "-".</div>

      <div class="section-title">Lost Reasons</div>
      <div class="stat-grid cols-2" id="pv-lost-grid" style="margin-bottom:6px;"></div>
      <div class="hint" style="margin:8px 2px 20px;">Why deals actually died, tallied from the reason picked when a prospect is moved to Dead. Only counts prospects you can see, and only ones where a reason was saved.</div>

      <div class="section-title">Quote Conversion Rate</div>
      <div class="stat-grid cols-2" id="pv-quote-grid" style="margin-bottom:6px;"></div>
      <div class="hint" style="margin:8px 2px 20px;">Win rate for prospects who've had a Deal Pricing Calculator quote saved to their record, vs. everyone else who's been contacted: a check on whether quoting actually correlates with closing.</div>
    </div>
  `);
  root.appendChild(wrap);

  const slidersBox = wrap.querySelector("#pv-sliders");
  const sliderInputs = {};
  FIELDS.forEach((f) => {
    const row = el(`
      <div class="pv-slider-row">
        <div class="flex-between" style="margin-bottom:6px;">
          <span style="font-size:13px;font-weight:600;">${f.label}</span>
          <span class="text-gold" style="font-weight:800;font-size:13.5px;" id="pv-out-${f.key}">${f.fmt(inputs[f.key])}</span>
        </div>
        <input type="range" class="pv-range" id="pv-in-${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${inputs[f.key]}" />
      </div>
    `);
    slidersBox.appendChild(row);
    sliderInputs[f.key] = row.querySelector("input");
    setSliderFill(sliderInputs[f.key]);
  });

  refs = {
    bigNum: wrap.querySelector("#pv-bignum"),
    flowLine: wrap.querySelector("#pv-flow"),
    retainerLine: wrap.querySelector("#pv-retainer-line"),
    billsLine: wrap.querySelector("#pv-bills-line"),
    badge: wrap.querySelector("#pv-badge"),
    resetBtn: wrap.querySelector("#pv-reset"),
    liveGrid: wrap.querySelector("#pv-live-grid"),
    nicheGrid: wrap.querySelector("#pv-niche-grid"),
    tierGrid: wrap.querySelector("#pv-tier-grid"),
    cityGrid: wrap.querySelector("#pv-city-grid"),
    nicheWinGrid: wrap.querySelector("#pv-niche-win-grid"),
    agentWinGrid: wrap.querySelector("#pv-agent-win-grid"),
    heatWinGrid: wrap.querySelector("#pv-heat-win-grid"),
    tierWinGrid: wrap.querySelector("#pv-tier-win-grid"),
    timingGrid: wrap.querySelector("#pv-timing-grid"),
    dayGrid: wrap.querySelector("#pv-day-grid"),
    lostGrid: wrap.querySelector("#pv-lost-grid"),
    quoteGrid: wrap.querySelector("#pv-quote-grid"),
    outs: Object.fromEntries(FIELDS.map((f) => [f.key, wrap.querySelector(`#pv-out-${f.key}`)])),
    billsInput: wrap.querySelector("#pv-bills"),
  };

  FIELDS.forEach((f) => {
    sliderInputs[f.key].addEventListener("input", () => {
      const v = Number(sliderInputs[f.key].value);
      inputs[f.key] = v;
      refs.outs[f.key].textContent = f.fmt(v);
      setSliderFill(sliderInputs[f.key]);
      markCustomIfDifferent();
      patchOutputs();
      persistDebounced();
    });
  });

  refs.billsInput.addEventListener("input", () => {
    inputs.bills = Math.max(0, Number(refs.billsInput.value) || 0);
    patchOutputs();
    persistDebounced();
  });

  refs.resetBtn.addEventListener("click", () => resetToLive(wrap, sliderInputs));

  renderLiveGrid();
  renderRevenueBreakdown();
  renderConversionBreakdown();
  renderStageTimingBreakdown();
  renderBestDayBreakdown();
  renderLostReasonsBreakdown();
  renderQuoteConversionBreakdown();
  patchOutputs();

  refreshLiveStats(wrap, sliderInputs);
}

function renderLiveGrid() {
  if (!refs?.liveGrid) return;
  const c = liveStats.counts;
  const cells = [
    { num: c.sent, label: "Sent" },
    { num: c.replied, label: "Replied" },
    { num: c.meeting_booked, label: "Meetings" },
    { num: c.signed, label: "Signed" },
    { num: liveStats.msgsPerWeek, label: "Msgs / week" },
    { num: money(liveStats.retainer), label: "Avg retainer" },
  ];
  refs.liveGrid.innerHTML = cells.map((cell) => `
    <div class="stat-card">
      <div class="num">${typeof cell.num === "number" ? cell.num.toLocaleString() : cell.num}</div>
      <div class="label">${cell.label}</div>
    </div>
  `).join("");
}

function statCard(label, num, sub) {
  return `
    <div class="stat-card">
      <div class="num">${num}</div>
      <div class="label">${label}</div>
      ${sub ? `<div class="text-faint" style="font-size:11px;margin-top:3px;">${sub}</div>` : ""}
    </div>
  `;
}

function renderRevenueBreakdown() {
  if (!refs?.nicheGrid && !refs?.tierGrid && !refs?.cityGrid) return;
  const signed = store.prospects.filter((p) => p.status === "signed");

  if (refs.nicheGrid) {
    const byNiche = new Map();
    signed.forEach((p) => {
      const key = p.niche_id || "none";
      const cur = byNiche.get(key) || { revenue: 0, count: 0 };
      cur.revenue += Number(p.mrr) || 0;
      cur.count += 1;
      byNiche.set(key, cur);
    });
    const nicheCells = Array.from(byNiche.entries())
      .map(([nicheId, v]) => ({
        label: nicheId === "none" ? "No niche set" : (nicheById(nicheId)?.name || "Unknown niche"),
        revenue: v.revenue,
        count: v.count,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    refs.nicheGrid.innerHTML = nicheCells.length
      ? nicheCells
          .map((c) => statCard(c.label, money(c.revenue), `${c.count} client${c.count === 1 ? "" : "s"}`))
          .join("")
      : `<div class="hint">No signed clients yet. This fills in as deals close.</div>`;
  }

  if (refs.tierGrid) {
    const byTier = { A: { revenue: 0, count: 0 }, B: { revenue: 0, count: 0 }, C: { revenue: 0, count: 0 } };
    signed.forEach((p) => {
      const t = byTier[p.tier] ? p.tier : "B";
      byTier[t].revenue += Number(p.mrr) || 0;
      byTier[t].count += 1;
    });
    refs.tierGrid.innerHTML = ["A", "B", "C"]
      .map((t) => statCard(`Tier ${t}`, money(byTier[t].revenue), `${byTier[t].count} client${byTier[t].count === 1 ? "" : "s"}`))
      .join("");
  }

  if (refs.cityGrid) {
    const byCity = new Map();
    signed.forEach((p) => {
      const key = p.city || "Unspecified";
      const cur = byCity.get(key) || { revenue: 0, count: 0 };
      cur.revenue += Number(p.mrr) || 0;
      cur.count += 1;
      byCity.set(key, cur);
    });
    const cityCells = Array.from(byCity.entries())
      .map(([city, v]) => ({ label: city, revenue: v.revenue, count: v.count }))
      .sort((a, b) => b.revenue - a.revenue);

    refs.cityGrid.innerHTML = cityCells.length
      ? cityCells
          .map((c) => statCard(c.label, money(c.revenue), `${c.count} client${c.count === 1 ? "" : "s"}`))
          .join("")
      : `<div class="hint">No signed clients yet. This fills in as deals close.</div>`;
  }
}

// Revenue by Niche/Tier above answer "where's the money", this answers
// "where does outreach actually convert". Win rate = signed ÷ everyone who
// was actually contacted (i.e. left Not Contacted at all), so a niche/agent
// with just 2 leads and 1 signed doesn't get buried under one with 40 leads
// and 3 signed. Minimum-sample-size cells are still shown (with their raw
// counts) rather than hidden, so a 1-for-1 doesn't quietly disappear, the
// count subtext makes the sample size obvious at a glance.
function winRateCells(groups) {
  return Array.from(groups.entries())
    .map(([label, v]) => ({ label, total: v.total, signed: v.signed, pct: v.total > 0 ? Math.round((v.signed / v.total) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct || b.total - a.total);
}

// Cold/Warm/Hot bucket boundaries for the Heat Score win-rate breakdown
// below, mirrors the 0-100 range prospectForm.js's #pf-heat input already
// enforces (schema check: heat_score between 0 and 100).
const HEAT_BANDS = [
  { label: "Cold (0-39)", min: 0, max: 39 },
  { label: "Warm (40-69)", min: 40, max: 69 },
  { label: "Hot (70-100)", min: 70, max: 100 },
];

const TIER_LABELS = { A: "Tier A", B: "Tier B", C: "Tier C" };

function renderConversionBreakdown() {
  if (!refs?.nicheWinGrid && !refs?.agentWinGrid && !refs?.heatWinGrid && !refs?.tierWinGrid) return;
  const engaged = store.prospects.filter((p) => p.status !== "not_contacted");

  if (refs.nicheWinGrid) {
    const byNiche = new Map();
    engaged.forEach((p) => {
      const key = p.niche_id || "none";
      const cur = byNiche.get(key) || { total: 0, signed: 0 };
      cur.total += 1;
      if (p.status === "signed") cur.signed += 1;
      byNiche.set(key, cur);
    });
    const labeled = new Map(
      Array.from(byNiche.entries()).map(([nicheId, v]) => [
        nicheId === "none" ? "No niche set" : (nicheById(nicheId)?.name || "Unknown niche"),
        v,
      ])
    );
    const cells = winRateCells(labeled);
    refs.nicheWinGrid.innerHTML = cells.length
      ? cells.map((c) => statCard(c.label, c.pct + "%", `${c.signed}/${c.total} signed`)).join("")
      : `<div class="hint">No outreach logged yet. This fills in once leads move past Not Contacted.</div>`;
  }

  if (refs.agentWinGrid) {
    const byAgent = new Map();
    engaged.forEach((p) => {
      const key = p.assigned_to || "none";
      const cur = byAgent.get(key) || { total: 0, signed: 0 };
      cur.total += 1;
      if (p.status === "signed") cur.signed += 1;
      byAgent.set(key, cur);
    });
    const labeled = new Map(
      Array.from(byAgent.entries()).map(([agentId, v]) => [
        agentId === "none" ? "Unassigned" : (profileById(agentId)?.full_name || profileById(agentId)?.email || "Unknown"),
        v,
      ])
    );
    const cells = winRateCells(labeled);
    refs.agentWinGrid.innerHTML = cells.length
      ? cells.map((c) => statCard(c.label, c.pct + "%", `${c.signed}/${c.total} signed`)).join("")
      : `<div class="hint">No outreach logged yet. This fills in once leads move past Not Contacted.</div>`;
  }

  if (refs.heatWinGrid) {
    const byBand = new Map(HEAT_BANDS.map((b) => [b.label, { total: 0, signed: 0 }]));
    engaged.forEach((p) => {
      const score = Number(p.heat_score) || 0;
      const band = HEAT_BANDS.find((b) => score >= b.min && score <= b.max) || HEAT_BANDS[0];
      const cur = byBand.get(band.label);
      cur.total += 1;
      if (p.status === "signed") cur.signed += 1;
    });
    const cells = winRateCells(byBand);
    refs.heatWinGrid.innerHTML = cells.length
      ? cells.map((c) => statCard(c.label, c.pct + "%", `${c.signed}/${c.total} signed`)).join("")
      : `<div class="hint">No outreach logged yet. This fills in once leads move past Not Contacted.</div>`;
  }

  if (refs.tierWinGrid) {
    const byTier = new Map(Object.values(TIER_LABELS).map((label) => [label, { total: 0, signed: 0 }]));
    engaged.forEach((p) => {
      const label = TIER_LABELS[p.tier] || TIER_LABELS.B;
      const cur = byTier.get(label);
      cur.total += 1;
      if (p.status === "signed") cur.signed += 1;
    });
    const cells = winRateCells(byTier);
    refs.tierWinGrid.innerHTML = cells.length
      ? cells.map((c) => statCard(c.label, c.pct + "%", `${c.signed}/${c.total} signed`)).join("")
      : `<div class="hint">No outreach logged yet. This fills in once leads move past Not Contacted.</div>`;
  }
}

// Every other metric on this page answers "how many" or "what %", this
// answers "how long", which nothing else here does. Walks each prospect's
// status_history in order, using the previous stage's timestamp (or the
// prospect's created_at for the very first step) as the baseline, so each
// bucket is a true "time spent in that stage before moving on", not just a
// gap between two arbitrary events.
function computeStageTimings() {
  const byProspect = new Map();
  stageTimingCache.forEach((h) => {
    if (!byProspect.has(h.prospect_id)) byProspect.set(h.prospect_id, []);
    byProspect.get(h.prospect_id).push(h);
  });

  const buckets = new Map(STAGE_TRANSITIONS.map((t) => [t.label, []]));

  byProspect.forEach((rows, prospectId) => {
    const prospect = store.prospects.find((p) => p.id === prospectId);
    if (!prospect?.created_at) return;
    rows.sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));

    let prevStatus = "not_contacted";
    let prevAt = prospect.created_at;
    rows.forEach((h) => {
      const match = STAGE_TRANSITIONS.find((t) => t.from === prevStatus && t.to === h.new_status);
      if (match) {
        const days = (new Date(h.changed_at) - new Date(prevAt)) / 86400000;
        if (days >= 0) buckets.get(match.label).push(days);
      }
      prevStatus = h.new_status;
      prevAt = h.changed_at;
    });
  });

  return STAGE_TRANSITIONS.map((t) => {
    const days = buckets.get(t.label);
    const avg = days.length ? days.reduce((s, d) => s + d, 0) / days.length : null;
    return { label: t.label, avg, count: days.length };
  });
}

function renderStageTimingBreakdown() {
  if (!refs?.timingGrid) return;
  const cells = computeStageTimings();
  const withData = cells.filter((c) => c.count > 0);
  refs.timingGrid.innerHTML = withData.length
    ? cells
        .map((c) =>
          c.count > 0
            ? statCard(c.label, `${fmt1(c.avg)}d`, `${c.count} deal${c.count === 1 ? "" : "s"}`)
            : statCard(c.label, "-", "No data yet")
        )
        .join("")
    : `<div class="hint">No stage transitions logged yet in the last ${TIMING_WINDOW_DAYS} days. This fills in as outreach moves through the pipeline.</div>`;
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Everything above groups outcomes by who/what (niche, agent, heat score) or
// by how-long (time in stage), nothing groups by *when* the first outreach
// actually went out. Reuses the same stageTimingCache already fetched for
// Average Time in Stage, so this costs zero extra Supabase queries. For each
// prospect, find its "sent" transitions and bucket by day-of-week, then
// check whether a later "replied" transition exists for that same prospect
// to compute a reply rate per weekday.
function computeBestDaySend() {
  const byProspect = new Map();
  stageTimingCache.forEach((h) => {
    if (!byProspect.has(h.prospect_id)) byProspect.set(h.prospect_id, []);
    byProspect.get(h.prospect_id).push(h);
  });

  const buckets = DOW_LABELS.map(() => ({ sent: 0, replied: 0 }));
  byProspect.forEach((rows) => {
    rows.sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));
    rows.forEach((h, i) => {
      if (h.new_status !== "sent") return;
      const day = new Date(h.changed_at).getDay();
      buckets[day].sent += 1;
      if (rows.slice(i + 1).some((r) => r.new_status === "replied")) buckets[day].replied += 1;
    });
  });

  return DOW_LABELS.map((label, i) => ({
    label,
    sent: buckets[i].sent,
    replied: buckets[i].replied,
    pct: buckets[i].sent > 0 ? Math.round((buckets[i].replied / buckets[i].sent) * 100) : null,
  }));
}

function renderBestDayBreakdown() {
  if (!refs?.dayGrid) return;
  const cells = computeBestDaySend();
  const withData = cells.filter((c) => c.sent > 0);
  refs.dayGrid.innerHTML = withData.length
    ? cells
        .map((c) =>
          c.sent > 0
            ? statCard(c.label, `${c.pct}%`, `${c.sent} sent`)
            : statCard(c.label, "-", "No sends yet")
        )
        .join("")
    : `<div class="hint">No outreach sent yet in the last ${TIMING_WINDOW_DAYS} days. This fills in as messages go out.</div>`;
}

// Every other breakdown on this page explains why deals win. This is the
// only one that looks at why they die, reading back the reason picked in
// prospectDetail.js's "Why did this one die?" prompt the moment a prospect
// is moved to Dead. Those are stored as plain prospect_notes rows tagged
// with LOST_REASON_MARKER (same trick the Deal Pricing Calculator's quote
// log already uses), fetched alongside the other cross-cutting queries in
// refreshLiveStats() so this costs one extra Supabase call, not a schema
// change.
function computeLostReasons() {
  const counts = new Map();
  lostReasonsCache.forEach((n) => {
    const reason = n.body.slice(LOST_REASON_MARKER.length).trim();
    const label = reason.startsWith("Other:") ? "Other" : reason;
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function renderLostReasonsBreakdown() {
  if (!refs?.lostGrid) return;
  const cells = computeLostReasons();
  refs.lostGrid.innerHTML = cells.length
    ? cells.map((c) => statCard(c.label, c.count, null)).join("")
    : `<div class="hint">No reasons logged yet. These fill in as prospects move to Dead and a reason is picked.</div>`;
}

// Every other win-rate lens here groups by a hand-assigned attribute
// (niche/agent/heat/tier), this is the first that groups by an actual
// sales *action*: did this prospect ever get a Deal Pricing Calculator
// quote saved to their record (dealPricing.js's "Save Quote to Prospect",
// tagged with QUOTE_MARKER, same trick Lost Reasons above already uses).
// Same "engaged" denominator (contacted, not left at Not Contacted) and
// winRateCells() helper as the Niche/Agent/Heat/Tier breakdowns.
function computeQuoteConversion() {
  const quotedIds = new Set(quotedProspectsCache.map((n) => n.prospect_id));
  const engaged = store.prospects.filter((p) => p.status !== "not_contacted");
  const byQuote = new Map([
    ["Got a Quote", { total: 0, signed: 0 }],
    ["No Quote Saved", { total: 0, signed: 0 }],
  ]);
  engaged.forEach((p) => {
    const label = quotedIds.has(p.id) ? "Got a Quote" : "No Quote Saved";
    const cur = byQuote.get(label);
    cur.total += 1;
    if (p.status === "signed") cur.signed += 1;
  });
  return winRateCells(byQuote);
}

function renderQuoteConversionBreakdown() {
  if (!refs?.quoteGrid) return;
  const cells = computeQuoteConversion();
  const gotQuote = cells.find((c) => c.label === "Got a Quote");
  refs.quoteGrid.innerHTML = gotQuote && gotQuote.total > 0
    ? cells.map((c) => statCard(c.label, c.pct + "%", `${c.signed}/${c.total} signed`)).join("")
    : `<div class="hint">No quotes saved yet. This fills in once a quote is saved from the Deal Pricing Calculator.</div>`;
}

function resetToLive(wrap, sliderInputs) {
  inputs = { ...liveStats, bills: inputs.bills };
  isCustom = false;
  FIELDS.forEach((f) => {
    sliderInputs[f.key].value = inputs[f.key];
    refs.outs[f.key].textContent = f.fmt(inputs[f.key]);
    setSliderFill(sliderInputs[f.key]);
  });
  patchOutputs();
  persist();
}

async function refreshLiveStats(wrap, sliderInputs) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400 * 1000).toISOString();
  const timingSince = new Date(Date.now() - TIMING_WINDOW_DAYS * 86400 * 1000).toISOString();
  const [liveRes, timingRes, lostRes, quoteRes] = await Promise.all([
    sb.from("status_history").select("new_status, changed_at").gte("changed_at", since),
    sb.from("status_history").select("prospect_id, old_status, new_status, changed_at").gte("changed_at", timingSince),
    sb.from("prospect_notes").select("body").ilike("body", `${LOST_REASON_MARKER}%`),
    sb.from("prospect_notes").select("prospect_id, body").ilike("body", `${QUOTE_MARKER}%`),
  ]);
  if (!liveRes.error) {
    statusHistoryCache = liveRes.data || [];
    liveStats = computeLiveStats();
  }
  if (!timingRes.error) stageTimingCache = timingRes.data || [];
  if (!lostRes.error) lostReasonsCache = lostRes.data || [];
  if (!quoteRes.error) quotedProspectsCache = quoteRes.data || [];

  // A view we're not currently looking at may have re-rendered since this
  // fetch started (or the user navigated away), bail rather than touch
  // detached DOM nodes.
  if (!document.body.contains(wrap)) return;

  renderLiveGrid();
  renderRevenueBreakdown();
  renderStageTimingBreakdown();
  renderBestDayBreakdown();
  renderLostReasonsBreakdown();
  renderQuoteConversionBreakdown();
  if (!isCustom) {
    inputs = { ...liveStats, bills: inputs.bills };
    FIELDS.forEach((f) => {
      sliderInputs[f.key].value = inputs[f.key];
      refs.outs[f.key].textContent = f.fmt(inputs[f.key]);
      setSliderFill(sliderInputs[f.key]);
    });
  }
  patchOutputs();
}

const refreshDebounced = debounce(() => {
  if (!isActive()) return;
  renderPipelineValue();
}, 600);

export function initPipelineValueView() {
  // Real-time: any status change a teammate logs updates the prospects
  // table (and, via the DB trigger, status_history) which already fires
  // this "prospects" event through the app's existing realtime channel,   // so the live numbers here refresh themselves without anyone hitting
  // reload, the moment new outreach activity happens.
  on("prospects", () => refreshDebounced());
}
