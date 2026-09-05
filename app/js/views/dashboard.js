import { sb } from "../supabaseClient.js";
import { store, on, profileById, prospectById, firstOfMonth } from "../state.js";
import { el, esc, money, avatarHTML, statusLabel, toast, todayISO, timeAgo } from "../utils.js";
import { openModal, closeModal } from "../ui.js";
import { openProspectDetail } from "./prospectDetail.js";
import { openProjectDetail } from "./projects.js";

const METRIC_LABELS = { sent: "Sends", replied: "Replies", meeting_booked: "Meetings", signed: "Signed" };

// A static "% of target" bar looks identical whether it's day 5 or day 28
// of the month — 40% on day 5 is great, 40% on day 28 is a crisis already
// baked in. This compares actual progress against straight-line "expected
// by today" pacing (days elapsed / days in month) so the team gets an
// early, actionable signal instead of discovering the miss on the last day.
function goalPaceInfo(actualMRR, target) {
  if (!(target > 0)) return null;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const expectedPct = dayOfMonth / daysInMonth;
  const actualPct = actualMRR / target;
  const onPace = actualPct >= expectedPct;
  const remaining = Math.max(0, target - actualMRR);
  const daysLeft = Math.max(1, daysInMonth - dayOfMonth);
  const perDayNeeded = remaining / daysLeft;
  return { onPace, perDayNeeded };
}

const STATUS_ORDER = ["not_contacted", "sent", "replied", "meeting_booked", "signed", "dead"];
let weeklyHistory = [];

// A prospect is "stale" once it's sat in an active (not signed/dead) status
// with no update at all — no status change, no assignment, no edit — for
// this many days. `updated_at` is touched automatically by a DB trigger on
// every write to the row, so it's a reliable proxy for "last touched" even
// though we don't keep a full per-prospect activity history client-side
// (the loaded activity_log is capped at 60 rows org-wide). This is
// deliberately independent of `follow_up_date`/"Due Today" — that only
// catches leads someone remembered to set a reminder on; this catches the
// ones nobody thought to.
const STALE_DAYS = 5;
function staleProspects() {
  const cutoff = Date.now() - STALE_DAYS * 86400 * 1000;
  return store.prospects.filter(
    (p) => !["signed", "dead"].includes(p.status) && new Date(p.updated_at).getTime() < cutoff
  );
}

// Dead leads that have sat untouched for a while are worth a second look —
// businesses change hands, get new management, or just have better timing
// six months later. Same `updated_at` staleness signal as above, just
// scoped to the opposite end: leads that are dead AND have been dead a
// long time (a lead marked dead yesterday isn't a win-back candidate yet).
const WINBACK_DAYS = 60;
function winBackCandidates() {
  const cutoff = Date.now() - WINBACK_DAYS * 86400 * 1000;
  return store.prospects.filter((p) => p.status === "dead" && new Date(p.updated_at).getTime() < cutoff);
}

// Revenue that's already been won can still quietly slip away — a client
// stops paying, a project stalls, or nobody ever got around to billing them
// in the first place. This flags signed clients showing any of those signs
// so they get a second look before the relationship goes cold, instead of
// only noticing at renewal time. Same "flag it, don't guess why" spirit as
// Needs Follow-up / Win-Back, just aimed at protecting revenue already won
// rather than reactivating or reviving leads.
const NO_INVOICE_DAYS = 30;
function revenueAtRiskClients() {
  const today = todayISO();
  const noInvoiceCutoff = Date.now() - NO_INVOICE_DAYS * 86400 * 1000;
  return store.prospects
    .filter((p) => p.status === "signed")
    .map((p) => {
      const reasons = [];
      const invoices = store.invoices.filter((i) => i.prospect_id === p.id);
      if (invoices.some((i) => i.status === "sent" && i.due_date && i.due_date < today)) reasons.push("Overdue invoice");
      if (store.projects.some((pr) => pr.prospect_id === p.id && pr.status === "blocked")) reasons.push("Project blocked");
      if (!invoices.length && new Date(p.updated_at).getTime() < noInvoiceCutoff) reasons.push("No invoice raised yet");
      return reasons.length ? { prospect: p, reasons } : null;
    })
    .filter(Boolean);
}

// A "signed" prospect left at $0 MRR almost always just means someone
// forgot to fill in the retainer amount, not an intentional free deal — and
// it silently understates every revenue number derived from it: the Monthly
// Revenue Goal progress bar, Revenue by Niche/Tier, and the win-rate grids
// on Pipeline Value all quietly treat it as if it isn't there. Flagging it
// here catches the data-entry gap instead of leaving the numbers wrong.
function zeroMrrSignedProspects() {
  return store.prospects.filter((p) => p.status === "signed" && !(Number(p.mrr) > 0));
}

// The whole follow-up system — "Due Today" on the home screen, "Week Ahead"
// on Team, the ICS calendar export — only works for a lead someone remembered
// to set a follow_up_date on. A rep replies to a lead, moves it to Replied,
// gets pulled onto something else, and never sets a reminder — that lead
// goes invisible to every follow-up surface in the app, and (unlike the
// "Needs Follow-up" staleness card above) won't even get flagged there for
// STALE_DAYS more days, and only once it's genuinely gone untouched. This
// catches the missing-reminder gap itself, right when it happens.
function noFollowUpProspects() {
  return store.prospects.filter((p) => ["sent", "replied", "meeting_booked"].includes(p.status) && !p.follow_up_date);
}

// Distinct from the "Project blocked" signal inside Revenue at Risk: a
// project can be humming along as "in_progress" and still be late — blocked
// only tells you something stalled it, not whether the calendar already
// slipped. Client-delivery accountability, so a missed deadline gets caught
// before the client notices it first.
function overdueProjects() {
  const today = todayISO();
  return store.projects.filter((pr) => pr.status !== "complete" && pr.due_date && pr.due_date < today);
}

// store.gridPlans/store.gridPosts (Client Grid Plan Review) are loaded into
// the store like everything else but, until now, never referenced anywhere
// outside gridPlans.js itself — a plan the client sent back with
// "changes_requested" only ever surfaced if someone happened to open Grid
// Plans and notice the status pill. Same "flag it here too" logic as every
// other Dashboard card: the data already exists, it just needed a
// cross-cutting home. Deliberately just the plan's own status (not scanning
// individual posts within it) — a plan only carries "changes_requested"
// once the client has actually submitted that verdict on the whole review.
function gridPlansNeedingChanges() {
  return store.gridPlans.filter((p) => p.status === "changes_requested");
}

// Revenue at Risk already watches billing (overdue invoice / no invoice
// after 30 days) and a blocked project — but it never checks the simpler,
// earlier failure: a client signed, and nobody ever created a project row
// for them at all, so delivery work isn't tracked anywhere. That's a
// distinct real-world gap for a small agency — the deal closed, maybe even
// got invoiced, but nobody spun up the actual work, and nothing surfaces it
// until the client asks "so when do we start?" 3-day grace period avoids
// flagging a deal signed minutes ago before anyone's had a chance to react.
const PROJECT_GRACE_DAYS = 3;
function signedNoProjectClients() {
  const cutoff = Date.now() - PROJECT_GRACE_DAYS * 86400 * 1000;
  return store.prospects.filter(
    (p) =>
      p.status === "signed" &&
      p.updated_at &&
      new Date(p.updated_at).getTime() < cutoff &&
      !store.projects.some((pr) => pr.prospect_id === p.id)
  );
}

// A lead that's active but nobody's actually assigned to it is easy to lose
// track of — it doesn't show up on any one agent's plate, so it can just sit
// there until someone happens to notice. Owner-only: under RLS a non-owner
// only ever sees prospects assigned to (or created by) them, so this count
// would be silently incomplete for anyone else — same reasoning as the
// Monthly Leaderboard's org-wide-vs-per-user data source choice.
function unassignedActiveProspects() {
  return store.prospects.filter((p) => !["signed", "dead"].includes(p.status) && !p.assigned_to);
}

// Distinct from "Unassigned" above: this lead DOES have someone assigned,
// but that person's profile has since been marked inactive (access
// removed) — prospectDetail.js's reassignment dropdown already labels this
// case "(removed)" one lead at a time, but there was no aggregate view of
// how many active leads are currently orphaned this way, so they can go
// unnoticed until someone happens to open that specific prospect. Owner-only
// for the same RLS-visibility reason as unassignedActiveProspects above.
function orphanedActiveProspects() {
  const removedIds = new Set(store.profiles.filter((pr) => pr.active === false).map((pr) => pr.id));
  if (!removedIds.size) return [];
  return store.prospects.filter((p) => !["signed", "dead"].includes(p.status) && p.assigned_to && removedIds.has(p.assigned_to));
}

// Churned (already gone) and Win-Back (dead a while) both react to leads
// already lost. Revenue at Risk watches for warning signs on clients
// already showing trouble. This is the one forward-looking retention
// signal: a still-happy signed client quietly approaching (or just past)
// the 12-month mark on their earliest signed contract — the natural
// moment for a renewal check-in before a competitor gets there first or
// inattention lets the relationship go cold. Uses the earliest signed
// contract per prospect (not the latest) since that's the date the client
// actually remembers as "when we signed up".
const ANNIVERSARY_WINDOW_DAYS = 30;
const DAY_MS = 86400000;
function clientAnniversaries() {
  const now = Date.now();
  return store.prospects
    .filter((p) => p.status === "signed")
    .map((p) => {
      const signedContracts = store.contracts.filter(
        (c) => c.prospect_id === p.id && c.status === "signed" && c.signed_date
      );
      if (!signedContracts.length) return null;
      const earliest = signedContracts.reduce((a, b) => (a.signed_date < b.signed_date ? a : b));
      const signedAt = new Date(earliest.signed_date + "T00:00:00").getTime();
      const years = Math.round((now - signedAt) / DAY_MS / 365);
      if (years < 1) return null;
      const anniversaryMs = signedAt + years * 365 * DAY_MS;
      const daysAway = Math.round((anniversaryMs - now) / DAY_MS);
      if (Math.abs(daysAway) > ANNIVERSARY_WINDOW_DAYS) return null;
      return { prospect: p, years, daysAway, signedDate: earliest.signed_date };
    })
    .filter(Boolean)
    .sort((a, b) => a.daysAway - b.daysAway);
}

// Every number here already exists somewhere in the app (Contracts,
// Invoices, Team, the Goal card) but getting them into one shareable
// message today means visiting four screens and typing it out by hand.
// WhatsApp-share is already an established pattern for individual records
// (payment reminders, contracts) — this applies the same idea to an
// aggregate weekly rollup. Uses exact signed/paid dates rather than the
// fuzzier `updated_at` staleness signal other widgets rely on, since a
// recap needs to land in the right week, not just "recently".
const RECAP_WINDOW_DAYS = 7;
function weeklyRecapStats() {
  const since = Date.now() - RECAP_WINDOW_DAYS * DAY_MS;
  const newLeads = store.prospects.filter((p) => p.created_at && new Date(p.created_at).getTime() >= since);
  const signedContracts = store.contracts.filter(
    (c) => c.status === "signed" && c.signed_date && new Date(c.signed_date + "T00:00:00").getTime() >= since
  );
  const paidInvoices = store.invoices.filter(
    (i) => i.status === "paid" && i.paid_date && new Date(i.paid_date + "T00:00:00").getTime() >= since
  );
  const signedValue = signedContracts.reduce((s, c) => s + (Number(c.value) || 0), 0);
  const collectedValue = paidInvoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const activeMRR = store.prospects
    .filter((p) => p.status === "signed")
    .reduce((s, p) => s + (Number(p.mrr) || 0), 0);

  const byAgent = new Map();
  signedContracts.forEach((c) => {
    const prospect = prospectById(c.prospect_id);
    const agentId = prospect?.assigned_to;
    if (!agentId) return;
    byAgent.set(agentId, (byAgent.get(agentId) || 0) + 1);
  });
  let topPerformer = null;
  let topCount = 0;
  byAgent.forEach((count, agentId) => {
    if (count > topCount) { topCount = count; topPerformer = agentId; }
  });
  const topPerformerName = topPerformer ? (profileById(topPerformer)?.full_name || profileById(topPerformer)?.email || null) : null;

  return { newLeads: newLeads.length, signedCount: signedContracts.length, signedValue, collectedValue, activeMRR, topPerformerName, topCount };
}

function buildRecapText(s) {
  const lines = [
    `📊 Weekly Recap — ${new Date().toLocaleDateString()}`,
    ``,
    `New leads added: ${s.newLeads}`,
    `Contracts signed: ${s.signedCount}${s.signedValue ? ` (${money(s.signedValue)})` : ""}`,
    `Collected: ${money(s.collectedValue)}`,
    `Active pipeline MRR: ${money(s.activeMRR)}`,
  ];
  if (s.topPerformerName) lines.push(`Top performer: ${s.topPerformerName} (${s.topCount} signed)`);
  return lines.join("\n");
}

// "Getting Started" checklist — nudges a brand-new team toward the handful
// of actions that make every other Dashboard card meaningful (an empty
// pipeline can't show stale leads, an org with no contracts can't show
// Revenue at Risk, etc.). Every item is derived from data that already
// exists in the store — nothing new to track in the database — and the
// card disappears on its own once every relevant item is done, or
// immediately if someone hides it. Two items (setting a revenue goal,
// inviting a teammate) are owner-only actions elsewhere in the app, so
// they're excluded entirely for a non-owner rather than shown as
// permanently un-actionable.
function getChecklistItems(isOwner) {
  const items = [
    { id: "profile", label: "Add a profile photo or avatar", done: !!store.profile?.avatar_url, view: "team" },
    { id: "prospect", label: "Add your first prospect", done: store.prospects.length > 0, view: "pipeline" },
    { id: "outreach", label: "Reach out to a lead", done: store.prospects.some((p) => p.status !== "not_contacted"), view: "pipeline" },
    { id: "contract", label: "Create your first contract", done: store.contracts.length > 0, view: "contracts" },
    { id: "invoice", label: "Create your first invoice", done: store.invoices.length > 0, view: "invoices" },
  ];
  if (isOwner) {
    items.push(
      { id: "goal", label: "Set your monthly revenue goal", done: !!store.monthlyGoal?.target_mrr, action: "goal" },
      { id: "invite", label: "Invite a teammate", done: store.profiles.length > 1, view: "team" }
    );
  }
  return items;
}

// Dismissal is a personal, cosmetic UI preference ("stop nudging me about
// this"), not team data — so it's kept in localStorage rather than a new
// database column. Keyed by org+user so switching accounts or organizations
// doesn't inherit someone else's dismissal.
function checklistDismissKey() {
  return `sxc_checklist_dismissed_${store.organization?.id || "x"}_${store.profile?.id || "x"}`;
}

export function renderDashboard() {
  const root = document.getElementById("view-dashboard");
  root.innerHTML = "";
  const isOwner = store.profile?.role === "owner";

  const prospects = store.prospects;
  const byStatus = {};
  STATUS_ORDER.forEach((s) => (byStatus[s] = 0));
  prospects.forEach((p) => { byStatus[p.status] = (byStatus[p.status] || 0) + 1; });

  const signed = prospects.filter((p) => p.status === "signed");
  const stale = staleProspects();
  const winback = winBackCandidates();
  const projectedMRR = signed.reduce((sum, p) => sum + (Number(p.mrr) || 0), 0);
  const goal = store.monthlyGoal;
  const goalTarget = goal?.target_mrr || 0;
  const goalPct = goalTarget > 0 ? Math.min(100, Math.round((projectedMRR / goalTarget) * 100)) : 0;
  const goalPace = goalPaceInfo(projectedMRR, goalTarget);

  const firstName = (store.profile?.full_name || "").trim().split(/\s+/)[0] || "";

  const outstandingInvoices = store.invoices
    .filter((i) => i.status === "sent")
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const overdueInvoices = store.invoices.filter((i) => i.status === "sent" && i.due_date && i.due_date < todayISO()).length;
  const contractsAwaitingSignature = store.contracts.filter((c) => c.status === "draft" || c.status === "sent").length;
  const activeProjects = store.projects.filter((p) => p.status !== "complete").length;
  const hasBizData = store.contracts.length || store.invoices.length || store.projects.length;
  const atRisk = hasBizData ? revenueAtRiskClients() : [];
  const zeroMrr = zeroMrrSignedProspects();
  const noFollowUp = noFollowUpProspects();
  const unassigned = isOwner ? unassignedActiveProspects() : [];
  const orphaned = isOwner ? orphanedActiveProspects() : [];
  const overdueProj = hasBizData ? overdueProjects() : [];
  const signedNoProject = hasBizData ? signedNoProjectClients() : [];
  const anniversaries = hasBizData ? clientAnniversaries() : [];
  const gridAttention = store.gridPlans.length ? gridPlansNeedingChanges() : [];

  const checklistItems = getChecklistItems(isOwner);
  const checklistDone = checklistItems.filter((i) => i.done).length;
  const checklistDismissed = localStorage.getItem(checklistDismissKey()) === "1";
  const showChecklist = !checklistDismissed && checklistDone < checklistItems.length;
  const checklistPct = Math.round((checklistDone / checklistItems.length) * 100);

  const wrap = el(`
    <div>
      <div class="flex-between">
        <div class="page-title mt-0">Dashboard<span class="accent">.</span></div>
        <span class="small-link" id="db-share-recap">Share Update</span>
      </div>
      <div class="text-faint" style="font-size:13px;margin:-8px 2px 18px;">${firstName ? `Welcome back, ${esc(firstName)} — ` : ""}here's how the pipeline is doing.</div>

      ${showChecklist ? `
      <div id="db-checklist-wrap">
        <div class="section-title mt-0">Getting Started</div>
        <div class="card glow-card" id="db-checklist-card" style="margin-bottom:18px;">
          <div class="flex-between" style="margin-bottom:10px;">
            <div style="font-weight:800;font-size:14px;">${checklistDone} of ${checklistItems.length} done</div>
            <span class="small-link" id="db-checklist-dismiss">Hide</span>
          </div>
          <div class="progress-track" style="margin-bottom:10px;"><div class="progress-fill" style="width:${checklistPct}%"></div></div>
          <div id="db-checklist-items"></div>
        </div>
      </div>
      ` : ""}

      <div class="section-title ${showChecklist ? "" : "mt-0"}">Pipeline Overview</div>
      <div class="stat-grid cols-3" id="db-status-grid"></div>

      <div class="section-title">Monthly Revenue Goal</div>
      <div class="card glow-card" id="db-goal-card" style="margin-bottom:4px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div style="font-size:22px;font-weight:800;">${money(projectedMRR)}<span class="text-faint" style="font-size:13px;font-weight:600;"> / ${money(goalTarget)}</span></div>
            <div class="text-faint" style="font-size:11.5px;">Projected MRR from signed clients this month</div>
          </div>
          ${isOwner ? `<span class="small-link" id="db-set-goal">Set Goal</span>` : ""}
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${goalPct}%"></div></div>
        <div class="text-faint" style="font-size:11px;margin-top:6px;">${goalPct}% of target — tap for the client list</div>
        ${goalPace ? `
        <div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="status-pill ${goalPace.onPace ? "paid" : "stale"}">${goalPace.onPace ? "On pace" : "Behind pace"}</span>
          ${!goalPace.onPace ? `<span class="text-faint" style="font-size:11px;">${money(Math.round(goalPace.perDayNeeded))}/day needed to catch up</span>` : ""}
        </div>
        ` : ""}
      </div>

      <div class="section-title">Needs Follow-up</div>
      <div class="card ${stale.length ? "glow-card" : ""}" id="db-stale-card" style="margin-bottom:4px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div style="font-size:22px;font-weight:800;">${stale.length}</div>
            <div class="text-faint" style="font-size:11.5px;">${
              stale.length
                ? `Active lead${stale.length === 1 ? "" : "s"} with no update in ${STALE_DAYS}+ days`
                : `Nothing's gone quiet — every active lead's been touched in the last ${STALE_DAYS} days`
            }</div>
          </div>
          ${stale.length ? `<span class="status-pill stale">Going cold</span>` : ""}
        </div>
      </div>

      <div class="section-title">Win-Back Candidates</div>
      <div class="card" id="db-winback-card" style="margin-bottom:4px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div style="font-size:22px;font-weight:800;">${winback.length}</div>
            <div class="text-faint" style="font-size:11.5px;">${
              winback.length
                ? `Dead lead${winback.length === 1 ? "" : "s"} sitting untouched for ${WINBACK_DAYS}+ days — worth a second look`
                : `No long-dormant dead leads right now`
            }</div>
          </div>
          ${winback.length ? `<span class="status-pill dead">Revisit?</span>` : ""}
        </div>
      </div>

      <div class="section-title">Data Check</div>
      <div class="card ${zeroMrr.length ? "glow-card" : ""}" id="db-zeromrr-card" style="margin-bottom:4px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div style="font-size:22px;font-weight:800;">${zeroMrr.length}</div>
            <div class="text-faint" style="font-size:11.5px;">${
              zeroMrr.length
                ? `Signed client${zeroMrr.length === 1 ? "" : "s"} with no MRR set — probably a missed retainer amount, quietly understating every revenue number`
                : `Every signed client has an MRR value set — nice`
            }</div>
          </div>
          ${zeroMrr.length ? `<span class="status-pill stale">Check MRR</span>` : ""}
        </div>
      </div>

      <div class="card ${noFollowUp.length ? "glow-card" : ""}" id="db-nofollowup-card" style="margin-bottom:4px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div style="font-size:22px;font-weight:800;">${noFollowUp.length}</div>
            <div class="text-faint" style="font-size:11.5px;">${
              noFollowUp.length
                ? `Active lead${noFollowUp.length === 1 ? "" : "s"} with no follow-up date set — invisible to Due Today until someone sets one`
                : `Every active lead has a follow-up date set — nice`
            }</div>
          </div>
          ${noFollowUp.length ? `<span class="status-pill stale">Set reminder</span>` : ""}
        </div>
      </div>

      ${isOwner ? `
      <div class="section-title">Unassigned Leads</div>
      <div class="card ${unassigned.length ? "glow-card" : ""}" id="db-unassigned-card" style="margin-bottom:4px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div style="font-size:22px;font-weight:800;">${unassigned.length}</div>
            <div class="text-faint" style="font-size:11.5px;">${
              unassigned.length
                ? `Active lead${unassigned.length === 1 ? "" : "s"} with nobody assigned — easy to lose track of`
                : `Every active lead has someone assigned to it`
            }</div>
          </div>
          ${unassigned.length ? `<span class="status-pill stale">Assign</span>` : ""}
        </div>
      </div>

      ${orphaned.length ? `
      <div class="card glow-card" id="db-orphaned-card" style="margin-bottom:4px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div style="font-size:22px;font-weight:800;">${orphaned.length}</div>
            <div class="text-faint" style="font-size:11.5px;">Active lead${orphaned.length === 1 ? "" : "s"} still assigned to a removed teammate — needs reassigning</div>
          </div>
          <span class="status-pill blocked">Reassign</span>
        </div>
      </div>
      ` : ""}
      ` : ""}

      ${hasBizData ? `
      <div class="section-title">Business Snapshot</div>
      <div class="stat-grid cols-3" id="db-biz-grid" style="margin-bottom:4px;">
        <div class="stat-card purple" data-go="invoices" data-filter="sent"><div class="num">${money(outstandingInvoices)}</div><div class="label">Outstanding</div></div>
        <div class="stat-card ${overdueInvoices ? "accent" : ""}" data-go="invoices" data-filter="sent"><div class="num">${overdueInvoices}</div><div class="label">Overdue Inv.</div></div>
        <div class="stat-card" data-go="contracts" data-filter="sent"><div class="num">${contractsAwaitingSignature}</div><div class="label">Awaiting Sig.</div></div>
        <div class="stat-card" data-go="projects" data-filter="in_progress"><div class="num">${activeProjects}</div><div class="label">Active Projects</div></div>
      </div>

      <div class="section-title">Revenue at Risk</div>
      <div class="card ${atRisk.length ? "glow-card" : ""}" id="db-risk-card" style="margin-bottom:4px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div style="font-size:22px;font-weight:800;">${atRisk.length}</div>
            <div class="text-faint" style="font-size:11.5px;">${
              atRisk.length
                ? `Signed client${atRisk.length === 1 ? "" : "s"} showing warning signs — overdue billing, a blocked project, or no invoice yet`
                : `No signed clients showing warning signs right now`
            }</div>
          </div>
          ${atRisk.length ? `<span class="status-pill blocked">At risk</span>` : ""}
        </div>
      </div>

      <div class="section-title">Churned Clients</div>
      <div class="card" id="db-churn-card" style="margin-bottom:4px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div class="num" style="font-size:22px;font-weight:800;">…</div>
            <div class="label text-faint" style="font-size:11.5px;">Loading…</div>
          </div>
        </div>
      </div>

      <div class="section-title">Overdue Projects</div>
      <div class="card ${overdueProj.length ? "glow-card" : ""}" id="db-overdue-proj-card" style="margin-bottom:4px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div style="font-size:22px;font-weight:800;">${overdueProj.length}</div>
            <div class="text-faint" style="font-size:11.5px;">${
              overdueProj.length
                ? `Project${overdueProj.length === 1 ? "" : "s"} past their due date and not marked complete`
                : `No projects past their due date right now`
            }</div>
          </div>
          ${overdueProj.length ? `<span class="status-pill dead">Overdue</span>` : ""}
        </div>
      </div>

      <div class="section-title">Delivery Not Started</div>
      <div class="card ${signedNoProject.length ? "glow-card" : ""}" id="db-noproject-card" style="margin-bottom:4px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div style="font-size:22px;font-weight:800;">${signedNoProject.length}</div>
            <div class="text-faint" style="font-size:11.5px;">${
              signedNoProject.length
                ? `Signed client${signedNoProject.length === 1 ? "" : "s"} with no project started — delivery work isn't being tracked anywhere`
                : `Every signed client has a project started`
            }</div>
          </div>
          ${signedNoProject.length ? `<span class="status-pill stale">Start project</span>` : ""}
        </div>
      </div>

      <div class="section-title">Client Anniversaries</div>
      <div class="card ${anniversaries.length ? "glow-card" : ""}" id="db-anniversary-card" style="margin-bottom:4px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div style="font-size:22px;font-weight:800;">${anniversaries.length}</div>
            <div class="text-faint" style="font-size:11.5px;">${
              anniversaries.length
                ? `Signed client${anniversaries.length === 1 ? "" : "s"} within ${ANNIVERSARY_WINDOW_DAYS} days of a yearly sign-up anniversary — worth a renewal check-in`
                : `No clients approaching a sign-up anniversary right now`
            }</div>
          </div>
          ${anniversaries.length ? `<span class="status-pill paid">Renewal</span>` : ""}
        </div>
      </div>
      ` : ""}

      ${store.gridPlans.length ? `
      <div class="section-title">Grid Plans Needing Changes</div>
      <div class="card ${gridAttention.length ? "glow-card" : ""}" id="db-gridattention-card" style="margin-bottom:4px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div style="font-size:22px;font-weight:800;">${gridAttention.length}</div>
            <div class="text-faint" style="font-size:11.5px;">${
              gridAttention.length
                ? `Grid plan${gridAttention.length === 1 ? "" : "s"} sent back with changes requested — worth a look before the client waits too long`
                : `No grid plans currently waiting on changes`
            }</div>
          </div>
          ${gridAttention.length ? `<span class="status-pill blocked">Changes requested</span>` : ""}
        </div>
      </div>
      ` : ""}

      <div class="section-title">This Month — Leaderboard</div>
      <div id="db-leaderboard" style="margin-bottom:12px;"></div>

      ${isOwner ? `
      <div class="section-title">Team Workload</div>
      <div id="db-workload" style="margin-bottom:12px;"></div>
      ` : ""}

      <div class="section-title">This Week — Team</div>
      <div id="db-week-total" class="stat-grid" style="margin-bottom:12px;"></div>
      <div id="db-week-team"></div>

      <div class="section-title">Status Breakdown</div>
      <div class="card" id="db-status-chart"></div>
    </div>
  `);
  root.appendChild(wrap);

  if (showChecklist) {
    const checklistEl = wrap.querySelector("#db-checklist-items");
    checklistItems.forEach((item) => {
      const row = el(`
        <div class="task-row ${item.done ? "done" : ""}" style="cursor:pointer;">
          <div class="task-check ${item.done ? "done" : ""}">${item.done ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="m5 13 4 4L19 7"/></svg>' : ""}</div>
          <div class="task-label">${esc(item.label)}</div>
          ${!item.done ? '<span class="text-faint" style="font-size:13px;">→</span>' : ""}
        </div>
      `);
      row.addEventListener("click", async () => {
        if (item.action === "goal") { openGoalModal(goalTarget); return; }
        const { switchView } = await import("../main.js");
        switchView(item.view);
      });
      checklistEl.appendChild(row);
    });
    wrap.querySelector("#db-checklist-dismiss").addEventListener("click", (e) => {
      e.stopPropagation();
      localStorage.setItem(checklistDismissKey(), "1");
      wrap.querySelector("#db-checklist-wrap")?.remove();
    });
  }

  wrap.querySelector("#db-share-recap").addEventListener("click", () => {
    const text = buildRecapText(weeklyRecapStats());
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  });

  // status grid
  const grid = wrap.querySelector("#db-status-grid");
  STATUS_ORDER.forEach((s) => {
    const card = el(`
      <div class="stat-card" style="cursor:pointer;" data-status="${s}">
        <div class="num">${byStatus[s]}</div>
        <div class="label">${statusLabel(s)}</div>
      </div>
    `);
    card.addEventListener("click", () => goToPipelineStatus(s));
    grid.appendChild(card);
  });

  if (isOwner) {
    wrap.querySelector("#db-set-goal").addEventListener("click", (e) => {
      e.stopPropagation();
      openGoalModal(goalTarget);
    });
  }
  wrap.querySelector("#db-goal-card").addEventListener("click", () => openGoalDetailModal(signed));
  wrap.querySelector("#db-stale-card").addEventListener("click", () => openStaleListModal(stale));
  wrap.querySelector("#db-winback-card").addEventListener("click", () => openWinBackModal(winback));
  const riskCard = wrap.querySelector("#db-risk-card");
  if (riskCard) riskCard.addEventListener("click", () => openRiskModal(atRisk));
  const overdueProjCard = wrap.querySelector("#db-overdue-proj-card");
  if (overdueProjCard) overdueProjCard.addEventListener("click", () => openOverdueProjectsModal(overdueProj));
  const gridAttentionCard = wrap.querySelector("#db-gridattention-card");
  if (gridAttentionCard) gridAttentionCard.addEventListener("click", () => openGridPlansAttentionModal(gridAttention));
  const noProjectCard = wrap.querySelector("#db-noproject-card");
  if (noProjectCard) {
    noProjectCard.addEventListener("click", () =>
      openProspectListModal(
        "Signed, No Project Started",
        signedNoProject.map((p) => ({ prospect: p, meta: `Signed ${timeAgo(p.updated_at)}` })),
        "Every signed client has a project started."
      )
    );
  }
  const anniversaryCard = wrap.querySelector("#db-anniversary-card");
  if (anniversaryCard) {
    anniversaryCard.addEventListener("click", () =>
      openProspectListModal(
        "Client Anniversaries",
        anniversaries.map((a) => ({
          prospect: a.prospect,
          meta: `${money(a.prospect.mrr)} MRR · ${a.years}yr · ${a.daysAway >= 0 ? a.daysAway + "d away" : Math.abs(a.daysAway) + "d ago"}`,
        })),
        "No clients approaching a sign-up anniversary right now."
      )
    );
  }
  wrap.querySelector("#db-nofollowup-card").addEventListener("click", () =>
    openProspectListModal(
      "No Follow-up Date Set",
      noFollowUp.map((p) => ({ prospect: p, meta: `${statusLabel(p.status)} · last touched ${timeAgo(p.updated_at)}` })),
      "Every active lead has a follow-up date set — nice."
    )
  );
  wrap.querySelector("#db-zeromrr-card").addEventListener("click", () =>
    openProspectListModal(
      "Signed, No MRR Set",
      zeroMrr.map((p) => ({ prospect: p, meta: `Signed ${timeAgo(p.updated_at)}` })),
      "Every signed client has an MRR value set — nice."
    )
  );
  const unassignedCard = wrap.querySelector("#db-unassigned-card");
  if (unassignedCard) {
    unassignedCard.addEventListener("click", () =>
      openProspectListModal(
        "Unassigned Active Leads",
        unassigned.map((p) => ({ prospect: p, meta: `${statusLabel(p.status)} · updated ${timeAgo(p.updated_at)}` })),
        "Every active lead has someone assigned to it."
      )
    );
  }
  const orphanedCard = wrap.querySelector("#db-orphaned-card");
  if (orphanedCard) {
    orphanedCard.addEventListener("click", () =>
      openProspectListModal(
        "Assigned to a Removed Teammate",
        orphaned.map((p) => ({ prospect: p, meta: `${statusLabel(p.status)} · updated ${timeAgo(p.updated_at)}` })),
        "No active leads are stuck with a removed teammate."
      )
    );
  }

  // Each card jumps to its list pre-filtered to the status it's actually
  // counting, instead of dumping onto the unfiltered "All" view — same
  // deep-link pattern Pipeline's own status grid already uses
  // (goToPipelineStatus below). "Awaiting Sig." and "Active Projects" are
  // each really a multi-status count (draft+sent / not_started+in_progress+
  // blocked) that a single filter chip can't capture exactly, so they land
  // on the single closest status (sent / in_progress) rather than "all".
  wrap.querySelectorAll("#db-biz-grid [data-go]").forEach((card) => {
    card.style.cursor = "pointer";
    card.addEventListener("click", async () => {
      const target = card.dataset.go;
      const filter = card.dataset.filter;
      if (filter === "sent" && target === "invoices") {
        const { setInvoiceStatusFilter } = await import("./invoices.js");
        setInvoiceStatusFilter("sent");
      } else if (filter === "sent" && target === "contracts") {
        const { setContractStatusFilter } = await import("./contracts.js");
        setContractStatusFilter("sent");
      } else if (filter && target === "projects") {
        const { setProjectStatusFilter } = await import("./projects.js");
        setProjectStatusFilter(filter);
      }
      const { switchView } = await import("../main.js");
      switchView(target);
    });
  });

  // status bar chart
  const chartEl = wrap.querySelector("#db-status-chart");
  const maxCount = Math.max(1, ...STATUS_ORDER.map((s) => byStatus[s]));
  chartEl.innerHTML = "";
  STATUS_ORDER.forEach((s) => {
    const row = el(`
      <div style="margin-bottom:9px;cursor:pointer;" data-status="${s}">
        <div class="flex-between" style="font-size:11.5px;margin-bottom:3px;">
          <span class="text-dim">${statusLabel(s)}</span><span class="text-faint">${byStatus[s]}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${(byStatus[s] / maxCount) * 100}%"></div></div>
      </div>
    `);
    row.addEventListener("click", () => goToPipelineStatus(s));
    chartEl.appendChild(row);
  });

  loadWeeklyStats(wrap);
  loadLeaderboard(wrap);
  if (hasBizData) loadChurned(wrap);
  if (isOwner) renderWorkload(wrap);
}

// Once a prospect goes signed -> dead, `prospects.status` alone can't tell
// you it used to be a paying client — it looks identical to a lead that
// simply never converted. That's a materially different (and costlier)
// event for an agency: losing revenue already won is worth investigating
// (delivery problem? pricing issue?), not just re-pitching like a cold
// lead the way Win-Back Candidates treats every dead lead. The signed ->
// dead transition itself is only recorded in status_history (readable
// org-wide under RLS, same source the Leaderboard already reads), so this
// is fetched async like that widget rather than derived from store.prospects.
async function loadChurned(wrap) {
  const { data, error } = await sb
    .from("status_history")
    .select("prospect_id, changed_at")
    .eq("old_status", "signed")
    .eq("new_status", "dead")
    .order("changed_at", { ascending: false });

  const card = wrap.querySelector("#db-churn-card");
  if (!card) return;
  if (error) { toast(error.message, "error"); return; }

  // A non-owner's local `store.prospects` is RLS-scoped to their own
  // prospects, so prospectById() naturally comes back null for anyone
  // else's churned client — filtering those out keeps this accurate per
  // viewer instead of needing separate owner/agent branches.
  const rows = (data || [])
    .map((h) => ({ prospect: prospectById(h.prospect_id), changedAt: h.changed_at }))
    .filter((r) => r.prospect);
  const lostMRR = rows.reduce((sum, r) => sum + (Number(r.prospect.mrr) || 0), 0);

  card.innerHTML = `
    <div class="flex-between">
      <div>
        <div style="font-size:22px;font-weight:800;">${rows.length}</div>
        <div class="text-faint" style="font-size:11.5px;">${
          rows.length
            ? `Signed client${rows.length === 1 ? "" : "s"} lost — ${money(lostMRR)} MRR churned`
            : `No signed clients have churned — nice`
        }</div>
      </div>
      ${rows.length ? `<span class="status-pill dead">Churned</span>` : ""}
    </div>
  `;
  card.addEventListener("click", () =>
    openProspectListModal(
      "Churned Clients",
      rows
        .slice()
        .sort((a, b) => (Number(b.prospect.mrr) || 0) - (Number(a.prospect.mrr) || 0))
        .map((r) => ({ prospect: r.prospect, meta: `${money(Number(r.prospect.mrr) || 0)} MRR · churned ${timeAgo(r.changedAt)}` })),
      "No signed clients have churned — nice."
    )
  );
}

// Ranks the whole team by deals signed this month — the one number that
// matters most, front and center, instead of buried in the unranked
// per-agent breakdown below. Pulled straight from status_history, which is
// readable org-wide under RLS (unlike the prospects table, which a non-owner
// only sees their own slice of), so the board is accurate for everyone, not
// just the owner.
async function loadLeaderboard(wrap) {
  const since = firstOfMonth();
  const { data, error } = await sb
    .from("status_history")
    .select("changed_by")
    .eq("new_status", "signed")
    .gte("changed_at", since);
  if (error) { toast(error.message, "error"); return; }

  const board = wrap.querySelector("#db-leaderboard");
  if (!board) return;
  board.innerHTML = "";

  const counts = {};
  (data || []).forEach((h) => {
    if (!h.changed_by) return;
    counts[h.changed_by] = (counts[h.changed_by] || 0) + 1;
  });

  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) {
    board.appendChild(el(`<div class="text-faint" style="font-size:12.5px;">No deals signed yet this month.</div>`));
    return;
  }

  const MEDALS = ["🥇", "🥈", "🥉"];
  ranked.forEach(([agentId, count], rank) => {
    const person = profileById(agentId);
    const name = person?.full_name || person?.email || "Unknown";
    const row = el(`
      <div class="card" style="margin-bottom:8px;display:flex;align-items:center;gap:10px;">
        <div style="font-size:16px;font-weight:800;width:26px;text-align:center;flex:0 0 auto;">${MEDALS[rank] || "#" + (rank + 1)}</div>
        ${avatarHTML(name, person?.avatar_url, 28, 11)}
        <div style="flex:1;min-width:0;font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(name)}</div>
        <div style="font-weight:800;font-size:14px;color:var(--gold-soft);flex:0 0 auto;">${count} signed</div>
      </div>
    `);
    board.appendChild(row);
  });
}

// Shows how many *active* leads (not signed/dead) currently sit with each
// agent — a capacity/fairness view, distinct from This Week's activity
// counts (which measure recent output, not current load). Synchronous —
// unlike the leaderboard/weekly stats, this doesn't need a fresh
// status_history query since it just re-slices store.prospects, which an
// owner already has the full org-wide copy of under RLS. Owner-only for the
// same reason Unassigned Leads is: a non-owner's local copy of
// store.prospects is RLS-limited to their own prospects, so this would be
// silently wrong for anyone else.
function renderWorkload(wrap) {
  const board = wrap.querySelector("#db-workload");
  if (!board) return;
  board.innerHTML = "";

  const counts = {};
  store.prospects.forEach((p) => {
    if (["signed", "dead"].includes(p.status) || !p.assigned_to) return;
    counts[p.assigned_to] = (counts[p.assigned_to] || 0) + 1;
  });

  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) {
    board.appendChild(el(`<div class="text-faint" style="font-size:12.5px;">No active leads currently assigned to anyone.</div>`));
    return;
  }

  const maxCount = Math.max(...ranked.map(([, c]) => c));
  ranked.forEach(([agentId, count]) => {
    const person = profileById(agentId);
    const name = person?.full_name || person?.email || "Unknown";
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          ${avatarHTML(name, person?.avatar_url, 22, 9.5)}
          <span style="flex:1;min-width:0;font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(name)}</span>
          <span style="font-weight:800;font-size:13.5px;flex:0 0 auto;">${count} active</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${(count / maxCount) * 100}%"></div></div>
      </div>
    `);
    row.addEventListener("click", () => {
      const list = store.prospects
        .filter((p) => p.assigned_to === agentId && !["signed", "dead"].includes(p.status))
        .map((p) => ({ prospect: p, meta: statusLabel(p.status) }));
      openProspectListModal(`${name}'s Active Leads`, list, "No active leads.");
    });
    board.appendChild(row);
  });
}

async function goToPipelineStatus(status) {
  const [{ switchView }, { setStatusFilter }] = await Promise.all([import("../main.js"), import("./pipeline.js")]);
  setStatusFilter(status);
  switchView("pipeline");
}

async function goToGridPlan(planId) {
  const [{ switchView }, { openGridPlanId }] = await Promise.all([import("../main.js"), import("./gridPlans.js")]);
  openGridPlanId(planId);
  switchView("gridplans");
}

function openProspectListModal(title, list, emptyMsg = "Nothing here yet.") {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">${esc(title)}</div>
      <div id="db-modal-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#db-modal-list");
  if (!list.length) {
    listEl.appendChild(el(`<div class="text-faint" style="font-size:12.5px;">${esc(emptyMsg)}</div>`));
  } else {
    list.forEach(({ prospect, meta }) => {
      const row = el(`
        <div class="card" style="margin-bottom:8px;cursor:pointer;">
          <div class="flex-between">
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(prospect?.business_name || "Unknown business")}</div>
              <div class="text-faint" style="font-size:11px;">${esc(meta || "")}</div>
            </div>
            ${prospect ? `<span class="status-pill ${esc(prospect.status)}">${esc(statusLabel(prospect.status))}</span>` : ""}
          </div>
        </div>
      `);
      if (prospect) {
        row.addEventListener("click", () => {
          closeModal();
          openProspectDetail(prospect);
        });
      }
      listEl.appendChild(row);
    });
  }
  openModal(box);
}

function openStaleListModal(staleList) {
  const list = staleList
    .slice()
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at)) // most stale first
    .map((p) => ({ prospect: p, meta: `${statusLabel(p.status)} · last touched ${timeAgo(p.updated_at)}` }));
  openProspectListModal("Needs Follow-up", list, "Nothing's gone quiet — nice work staying on top of it.");
}

function openWinBackModal(list) {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Win-Back Candidates</div>
      <div id="db-winback-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#db-winback-list");
  const emptyMsg = () => el(`<div class="text-faint" style="font-size:12.5px;">No long-dormant dead leads right now.</div>`);
  const sorted = list.slice().sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at)); // longest-dead first
  if (!sorted.length) {
    listEl.appendChild(emptyMsg());
  } else {
    sorted.forEach((p) => {
      const row = el(`
        <div class="card" style="margin-bottom:8px;">
          <div class="flex-between" style="gap:10px;">
            <div style="min-width:0;cursor:pointer;" data-open>
              <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.business_name)}</div>
              <div class="text-faint" style="font-size:11px;">Dead ${timeAgo(p.updated_at)}</div>
            </div>
            <button class="btn btn-ghost btn-sm" style="flex:0 0 auto;width:auto;" data-reopen>Reopen</button>
          </div>
        </div>
      `);
      row.querySelector("[data-open]").addEventListener("click", () => {
        closeModal();
        openProspectDetail(p);
      });
      row.querySelector("[data-reopen]").addEventListener("click", async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.disabled = true;
        const { error } = await sb.from("prospects").update({ status: "not_contacted" }).eq("id", p.id);
        if (error) { btn.disabled = false; return toast(error.message, "error"); }
        toast(`${p.business_name} moved back to Not Contacted`, "success");
        row.remove();
        if (!listEl.children.length) listEl.appendChild(emptyMsg());
      });
      listEl.appendChild(row);
    });
  }
  openModal(box);
}

function openRiskModal(list) {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Revenue at Risk</div>
      <div id="db-risk-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#db-risk-list");
  if (!list.length) {
    listEl.appendChild(el(`<div class="text-faint" style="font-size:12.5px;">No signed clients showing warning signs right now.</div>`));
  } else {
    list
      .slice()
      .sort((a, b) => b.reasons.length - a.reasons.length)
      .forEach(({ prospect, reasons }) => {
        const row = el(`
          <div class="card" style="margin-bottom:8px;cursor:pointer;">
            <div style="font-weight:700;font-size:13.5px;margin-bottom:6px;">${esc(prospect.business_name)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${reasons.map((r) => `<span class="status-pill blocked">${esc(r)}</span>`).join("")}
            </div>
          </div>
        `);
        row.addEventListener("click", () => {
          closeModal();
          openProspectDetail(prospect);
        });
        listEl.appendChild(row);
      });
  }
  openModal(box);
}

function openOverdueProjectsModal(list) {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Overdue Projects</div>
      <div id="db-overdue-proj-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#db-overdue-proj-list");
  if (!list.length) {
    listEl.appendChild(el(`<div class="text-faint" style="font-size:12.5px;">No projects past their due date right now.</div>`));
  } else {
    list
      .slice()
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
      .forEach((pr) => {
        const prospect = prospectById(pr.prospect_id);
        const row = el(`
          <div class="card" style="margin-bottom:8px;cursor:pointer;">
            <div class="flex-between">
              <div style="min-width:0;">
                <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(pr.name)}</div>
                <div class="text-faint" style="font-size:11px;">${prospect ? esc(prospect.business_name) + " · " : ""}Due ${timeAgo(pr.due_date)}</div>
              </div>
              <span class="status-pill ${esc(pr.status)}">${esc(pr.status.replace("_", " "))}</span>
            </div>
          </div>
        `);
        row.addEventListener("click", () => {
          closeModal();
          openProjectDetail(pr);
        });
        listEl.appendChild(row);
      });
  }
  openModal(box);
}

function openGridPlansAttentionModal(list) {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Grid Plans Needing Changes</div>
      <div id="db-gridattention-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#db-gridattention-list");
  if (!list.length) {
    listEl.appendChild(el(`<div class="text-faint" style="font-size:12.5px;">No grid plans currently waiting on changes.</div>`));
  } else {
    list
      .slice()
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
      .forEach((plan) => {
        const row = el(`
          <div class="card" style="margin-bottom:8px;cursor:pointer;">
            <div class="flex-between">
              <div style="min-width:0;">
                <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(plan.client_name || "Untitled plan")}</div>
                <div class="text-faint" style="font-size:11px;">Updated ${timeAgo(plan.updated_at || plan.created_at)}</div>
              </div>
              <span class="status-pill blocked">Changes requested</span>
            </div>
          </div>
        `);
        row.addEventListener("click", () => {
          closeModal();
          goToGridPlan(plan.id);
        });
        listEl.appendChild(row);
      });
  }
  openModal(box);
}

function openGoalDetailModal(signedProspects) {
  const list = signedProspects
    .slice()
    .sort((a, b) => (Number(b.mrr) || 0) - (Number(a.mrr) || 0))
    .map((p) => ({ prospect: p, meta: money(Number(p.mrr) || 0) + " MRR" }));
  openProspectListModal("Signed Clients — MRR", list, "No signed clients yet this month.");
}

async function loadWeeklyStats(wrap) {
  const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const { data, error } = await sb
    .from("status_history")
    .select("prospect_id, new_status, changed_by, changed_at")
    .gte("changed_at", since)
    .order("changed_at", { ascending: false });

  if (error) { toast(error.message, "error"); return; }
  weeklyHistory = data || [];

  const totals = { sent: 0, replied: 0, meeting_booked: 0, signed: 0 };
  const byAgent = {};
  weeklyHistory.forEach((h) => {
    if (totals[h.new_status] === undefined) return;
    totals[h.new_status]++;
    const agentId = h.changed_by || "unknown";
    byAgent[agentId] ||= { sent: 0, replied: 0, meeting_booked: 0, signed: 0 };
    byAgent[agentId][h.new_status]++;
  });

  const totalEl = wrap.querySelector("#db-week-total");
  if (totalEl) {
    totalEl.innerHTML = "";
    [["sent", "purple"], ["replied", "purple"], ["meeting_booked", "accent"], ["signed", "accent"]].forEach(([metric, cls]) => {
      const card = el(`
        <div class="stat-card ${cls}" style="cursor:pointer;">
          <div class="num">${totals[metric]}</div>
          <div class="label">${METRIC_LABELS[metric]}</div>
        </div>
      `);
      card.addEventListener("click", () => openMetricDetailModal(metric));
      totalEl.appendChild(card);
    });
  }

  const teamEl = wrap.querySelector("#db-week-team");
  if (teamEl) {
    teamEl.innerHTML = "";
    const agentIds = Object.keys(byAgent).filter((id) => id !== "unknown");
    if (!agentIds.length) {
      teamEl.appendChild(el(`<div class="text-faint" style="font-size:12.5px;">No activity yet this week.</div>`));
    } else {
      agentIds.forEach((id) => {
        const person = profileById(id);
        const s = byAgent[id];
        const name = person?.full_name || person?.email || "Unknown";
        const card = el(`
          <div class="card" style="margin-bottom:8px;cursor:pointer;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              ${avatarHTML(name, person?.avatar_url, 22, 9.5)}
              <span style="font-weight:700;font-size:13.5px;">${esc(name)}</span>
            </div>
            <div style="display:flex;gap:14px;font-size:12px;color:var(--text-dim);">
              <span>${s.sent} sent</span><span>${s.replied} replied</span><span>${s.meeting_booked} meetings</span><span class="text-gold">${s.signed} signed</span>
            </div>
          </div>`);
        card.addEventListener("click", () => openAgentDetailModal(id, name));
        teamEl.appendChild(card);
      });
    }
  }
}

function openWeeklyEventsModal(title, entries, emptyMsg) {
  const list = entries.map((h) => ({
    prospect: prospectById(h.prospect_id),
    meta: `${statusLabel(h.new_status)} · ${(profileById(h.changed_by)?.full_name || profileById(h.changed_by)?.email || "Unknown")} · ${timeAgo(h.changed_at)}`,
  }));
  openProspectListModal(title, list, emptyMsg);
}

function openMetricDetailModal(metric) {
  const entries = weeklyHistory.filter((h) => h.new_status === metric);
  openWeeklyEventsModal(`This Week — ${METRIC_LABELS[metric]}`, entries, "Nothing this week yet.");
}

function openAgentDetailModal(agentId, name) {
  const entries = weeklyHistory.filter((h) => (h.changed_by || "unknown") === agentId);
  openWeeklyEventsModal(`This Week — ${name}`, entries, "No activity this week.");
}

function openGoalModal(current) {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Set Monthly Revenue Goal</div>
      <div class="field">
        <label>Target MRR (USD)</label>
        <input id="goal-input" type="number" min="0" value="${current || ""}" placeholder="e.g. 3000" />
      </div>
      <button class="btn btn-gold" id="goal-save">Save Goal</button>
    </div>
  `);
  box.querySelector("#goal-save").addEventListener("click", async () => {
    const val = Number(box.querySelector("#goal-input").value) || 0;
    const { error } = await sb
      .from("monthly_goal")
      .upsert({ month: firstOfMonth(), target_mrr: val, set_by: store.profile.id }, { onConflict: "org_id,month" });
    if (error) return toast(error.message, "error");
    const { data } = await sb.from("monthly_goal").select("*").eq("month", firstOfMonth()).maybeSingle();
    store.monthlyGoal = data;
    toast("Goal updated", "success");
    closeModal();
    renderDashboard();
  });
  openModal(box);
}

export function initDashboardView() {
  on("prospects", () => { if (isActive()) renderDashboard(); });
  on("monthlyGoal", () => { if (isActive()) renderDashboard(); });
  on("contracts", () => { if (isActive()) renderDashboard(); });
  on("invoices", () => { if (isActive()) renderDashboard(); });
  on("projects", () => { if (isActive()) renderDashboard(); });
}
function isActive() {
  return document.getElementById("view-dashboard")?.classList.contains("active");
}
