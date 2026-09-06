import { sb } from "../supabaseClient.js";
import { store, on, nicheById, nicheDotHTML, prospectById, profileById } from "../state.js";
import { el, esc, todayISO, toast, avatarHTML, timeAgo } from "../utils.js";
import { openSheet, closeSheet, confirmModal, openModal } from "../ui.js";
import { openProspectDetail } from "./prospectDetail.js";

export function renderTasks() {
  const root = document.getElementById("view-tasks");
  root.innerHTML = "";
  const isOwner = store.profile?.role === "owner";
  const myId = store.profile?.id;

  const wrap = el(`
    <div>
      <div class="page-title">Missions<span class="accent">.</span></div>

      <div class="stat-grid" style="margin-bottom:16px;grid-template-columns:1fr;" id="tb-streak-wrap"></div>

      <div class="section-title mt-0">Today's Priority Leads</div>
      <div id="tb-hot-leads" style="margin-bottom:16px;"></div>

      <div class="section-title mt-0">Notes Catch-Up</div>
      <div id="tb-notes-catchup" style="margin-bottom:16px;"></div>

      <div class="section-title mt-0">Today's Missions</div>
      <div class="card" id="tb-checklist" style="margin-bottom:16px;"></div>

      <div class="section-title">Your Targets Today</div>
      <div class="card" id="tb-targets" style="margin-bottom:16px;"></div>

      <div class="section-title">This Week Ahead</div>
      <div id="tb-week-ahead" style="margin-bottom:16px;"></div>

      ${isOwner ? `
        <div class="section-title mt-0">Team Pace Today</div>
        <div class="stat-grid" style="margin-bottom:16px;" id="tb-team-pace"></div>

        <div class="flex-between">
          <div class="section-title mt-0">Manage Missions</div>
          <span class="small-link" id="tb-add-task">+ Add Mission</span>
        </div>
        <div class="card" id="tb-manage-tasks" style="margin-bottom:16px;"></div>

        <div class="section-title">Team Missions Today</div>
        <div id="tb-team-checklist" style="margin-bottom:16px;"></div>

        <div class="section-title">Mission Type Completion</div>
        <div id="tb-task-type-breakdown" style="margin-bottom:16px;"></div>

        <div class="section-title">Team Targets</div>
        <div id="tb-manage-targets"></div>
      ` : ""}
    </div>
  `);
  root.appendChild(wrap);

  // checklist — shared tasks (assigned_to is empty) plus anything assigned to me specifically
  const checklistEl = wrap.querySelector("#tb-checklist");
  const myTasks = store.dailyTasks.filter((t) => !t.assigned_to || t.assigned_to === myId);
  if (!myTasks.length) {
    checklistEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;">No missions yet.</div>`;
  } else {
    checklistEl.innerHTML = "";
    myTasks.forEach((task) => {
      const done = store.dailyCompletions.some((c) => c.task_id === task.id && c.agent_id === myId && c.completed);
      const row = el(`
        <div class="task-row ${done ? "done" : ""}">
          <div class="task-check ${done ? "done" : ""}" data-task="${task.id}">
            ${done ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="m5 13 4 4L19 7"/></svg>' : ""}
          </div>
          <div>
            <div class="task-label">${esc(task.title)}</div>
            <div class="task-type">${task.day_type.replace("_", " ")}${task.assigned_to ? " · just for you" : ""}</div>
          </div>
        </div>
      `);
      row.querySelector(".task-check").addEventListener("click", () => toggleTask(task.id, !done));
      checklistEl.appendChild(row);
    });
  }

  renderHotLeads(wrap.querySelector("#tb-hot-leads"), myId, isOwner);
  loadNotesCatchUp(wrap.querySelector("#tb-notes-catchup"));
  loadTargetsProgress(wrap.querySelector("#tb-targets"));
  loadStreak(wrap.querySelector("#tb-streak-wrap"), myTasks, myId);
  renderWeekAhead(wrap.querySelector("#tb-week-ahead"), isOwner, myId);

  if (isOwner) {
    loadTeamPace(wrap.querySelector("#tb-team-pace"));
    wrap.querySelector("#tb-add-task").addEventListener("click", () => openTaskForm(null));
    renderManageTasks(wrap.querySelector("#tb-manage-tasks"));
    renderTeamChecklist(wrap.querySelector("#tb-team-checklist"));
    renderTaskTypeBreakdown(wrap.querySelector("#tb-task-type-breakdown"));
    renderManageTargets(wrap.querySelector("#tb-manage-targets"));
  }
}

// Daily Plan's checklist/targets tell an agent *how much* to do today, but
// nothing tells them *which specific leads* to do it on — they'd otherwise
// have to go sort/scan the whole Pipeline themselves. This surfaces their
// own top 5 untouched-but-hottest prospects right on the page they already
// open every morning. Owners see the org's top 5 unassigned hot leads
// instead, since "my leads" doesn't mean anything for them here.
function hotLeadsForMe(myId, isOwner) {
  return store.prospects
    .filter((p) => p.status === "not_contacted" && (isOwner ? !p.assigned_to : p.assigned_to === myId || !p.assigned_to))
    .slice()
    .sort((a, b) => (b.heat_score || 0) - (a.heat_score || 0))
    .slice(0, 5);
}

function renderHotLeads(container, myId, isOwner) {
  if (!container) return;
  const leads = hotLeadsForMe(myId, isOwner);
  if (!leads.length) {
    container.innerHTML = `<div class="text-faint" style="font-size:12.5px;padding:4px 0;">No untouched hot leads right now, nice work.</div>`;
    return;
  }
  container.innerHTML = "";
  leads.forEach((p) => {
    const niche = nicheById(p.niche_id);
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div>
            <div style="font-weight:700;font-size:13.5px;">${esc(p.business_name)}</div>
            <div class="text-faint" style="font-size:11.5px;">${niche ? nicheDotHTML(niche) : ""}${esc(niche?.name || "")}</div>
          </div>
          <span class="tier-pill ${p.tier}">TIER ${p.tier}</span>
        </div>
        <div class="heat-bar-wrap">
          <div class="heat-bar"><div class="heat-bar-fill" style="width:${p.heat_score}%"></div></div>
          <div class="heat-num">${p.heat_score}</div>
        </div>
      </div>
    `);
    row.addEventListener("click", () => openProspectDetail(p));
    container.appendChild(row);
  });
}

// A rep's actual context on a lead ("asked for a discount", "wants samples
// first") lives in prospect_notes, but the only way to see it was opening
// one prospect at a time — Activity logs *that* a note was left, never the
// content, and scrolls fast since it mixes in every status change too.
// Fetched on demand (not cached in the main store) since it's a small,
// rarely-changing cross-prospect slice — same "query prospect_notes
// directly, rely on its own RLS" pattern dealPricing.js's Recent Quotes
// panel already uses. RLS already scopes this to prospects the viewer can
// see (their own leads, or the whole org for an owner), so no client-side
// filtering by assignee is needed here.
async function loadNotesCatchUp(container) {
  if (!container) return;
  container.innerHTML = `<div class="text-faint" style="font-size:12.5px;">Loading…</div>`;

  const { data, error } = await sb
    .from("prospect_notes")
    .select("id, prospect_id, author_id, body, created_at")
    .order("created_at", { ascending: false })
    .limit(8);

  if (!document.body.contains(container)) return;
  if (error) { container.innerHTML = `<div class="text-faint" style="font-size:12.5px;">${esc(error.message)}</div>`; return; }
  if (!data || !data.length) {
    container.innerHTML = `<div class="text-faint" style="font-size:12.5px;padding:4px 0;">Nothing logged yet, notes your team adds will show up here.</div>`;
    return;
  }

  container.innerHTML = "";
  data.forEach((n) => {
    const prospect = prospectById(n.prospect_id);
    const author = profileById(n.author_id);
    const summary = n.body.length > 140 ? n.body.slice(0, 140).trim() + "…" : n.body;
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
    if (prospect) row.addEventListener("click", () => openProspectDetail(prospect));
    container.appendChild(row);
  });
}

// Owner-only view of who on the team has actually worked through today's
// checklist — without this, an owner has to DM each agent individually or
// dig through Activity to find out. Worst-progress-first so lagging agents
// surface immediately. Purely derived from data already in the store
// (dailyTasks/dailyCompletions/profiles) — no extra query.
function renderTeamChecklist(container) {
  if (!container) return;
  const agents = store.profiles.filter((p) => p.active !== false);
  if (!agents.length) {
    container.innerHTML = `<div class="text-faint" style="font-size:12.5px;">No active team members.</div>`;
    return;
  }
  const rows = agents.map((agent) => {
    const applicable = store.dailyTasks.filter((t) => !t.assigned_to || t.assigned_to === agent.id);
    const doneTasks = applicable.filter((t) =>
      store.dailyCompletions.some((c) => c.task_id === t.id && c.agent_id === agent.id && c.completed)
    );
    const pending = applicable.filter((t) => !doneTasks.includes(t));
    const pct = applicable.length ? Math.round((doneTasks.length / applicable.length) * 100) : 0;
    return { agent, total: applicable.length, done: doneTasks.length, pending, pct };
  });
  rows.sort((a, b) => a.pct - b.pct);

  container.innerHTML = "";
  rows.forEach((r) => {
    const row = el(`
      <div class="card" style="margin-bottom:8px;">
        <div class="flex-between" style="margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${avatarHTML(r.agent.full_name || r.agent.email, r.agent.avatar_url, 26)}
            <span style="font-size:13px;font-weight:600;">${esc(r.agent.full_name || r.agent.email)}</span>
          </div>
          <span class="text-gold" style="font-size:12px;">${r.total ? `${r.done} / ${r.total}` : "-"}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${r.pct}%"></div></div>
        ${r.pending.length ? `<div class="text-faint" style="font-size:11px;margin-top:6px;">Outstanding: ${r.pending.map((t) => esc(t.title)).join(", ")}</div>` : ""}
      </div>
    `);
    container.appendChild(row);
  });
}

const DAY_TYPE_LABELS = { send: "Send", reply: "Reply", follow_up: "Follow-up", deposit: "Deposit", general: "General" };

// "Team Checklist Today" already shows who's behind; this shows *what kind*
// of task the team as a whole tends to skip. A checklist mixes send/reply/
// follow-up/deposit/general items together, so a low overall completion %
// hides whether it's everyone skipping the same type of task (e.g. nobody
// ever ticks off "Follow-up") vs. just scattered misses — that distinction
// is what an owner needs to know to fix the checklist itself, not just chase
// individuals. Purely derived from store.dailyTasks/dailyCompletions/
// profiles (already loaded, already today-scoped per state.js) — no extra
// query. Worst-completion-type first, same ordering convention as
// renderTeamChecklist.
function renderTaskTypeBreakdown(container) {
  if (!container) return;
  const agents = store.profiles.filter((p) => p.active !== false);
  const types = [...new Set(store.dailyTasks.map((t) => t.day_type))];
  if (!agents.length || !types.length) {
    container.innerHTML = `<div class="text-faint" style="font-size:12.5px;">Nothing to show yet.</div>`;
    return;
  }

  const rows = types
    .map((type) => {
      const tasksOfType = store.dailyTasks.filter((t) => t.day_type === type);
      let total = 0, done = 0;
      tasksOfType.forEach((t) => {
        const applicable = t.assigned_to ? agents.filter((a) => a.id === t.assigned_to) : agents;
        applicable.forEach((a) => {
          total++;
          if (store.dailyCompletions.some((c) => c.task_id === t.id && c.agent_id === a.id && c.completed)) done++;
        });
      });
      return { type, total, done, pct: total ? Math.round((done / total) * 100) : 0 };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => a.pct - b.pct);

  if (!rows.length) {
    container.innerHTML = `<div class="text-faint" style="font-size:12.5px;">Nothing to show yet.</div>`;
    return;
  }

  container.innerHTML = "";
  rows.forEach((r) => {
    const row = el(`
      <div class="card" style="margin-bottom:8px;">
        <div class="flex-between" style="margin-bottom:6px;">
          <span style="font-size:13px;font-weight:600;">${esc(DAY_TYPE_LABELS[r.type] || r.type.replace("_", " "))}</span>
          <span class="text-gold" style="font-size:12px;">${r.done} / ${r.total} (${r.pct}%)</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${r.pct}%"></div></div>
      </div>
    `);
    container.appendChild(row);
  });
}

async function toggleTask(taskId, completed) {
  const myId = store.profile.id;
  const work_date = todayISO();
  const { error } = await sb
    .from("daily_task_completions")
    .upsert(
      { task_id: taskId, agent_id: myId, work_date, completed, completed_at: completed ? new Date().toISOString() : null },
      { onConflict: "task_id,agent_id,work_date" }
    );
  if (error) toast(error.message, "error");
}

async function loadTargetsProgress(container) {
  const myId = store.profile.id;
  const myTarget = store.agentTargets.find((t) => t.agent_id === myId) || { daily_sends_target: 15, weekly_meetings_target: 3 };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 86400 * 1000);

  const [{ data: sendsToday }, { data: meetingsWeek }] = await Promise.all([
    sb.from("status_history").select("id").eq("changed_by", myId).eq("new_status", "sent").gte("changed_at", todayStart.toISOString()),
    sb.from("status_history").select("id").eq("changed_by", myId).eq("new_status", "meeting_booked").gte("changed_at", weekStart.toISOString()),
  ]);

  const sendsCount = sendsToday?.length || 0;
  const meetingsCount = meetingsWeek?.length || 0;
  const sendsPct = Math.min(100, Math.round((sendsCount / Math.max(1, myTarget.daily_sends_target)) * 100));
  const meetingsPct = Math.min(100, Math.round((meetingsCount / Math.max(1, myTarget.weekly_meetings_target)) * 100));

  if (!container) return;
  container.innerHTML = `
    <div style="margin-bottom:12px;">
      <div class="flex-between" style="font-size:12.5px;margin-bottom:4px;">
        <span class="text-dim">Sends today</span><span class="text-gold">${sendsCount} / ${myTarget.daily_sends_target}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${sendsPct}%"></div></div>
    </div>
    <div>
      <div class="flex-between" style="font-size:12.5px;margin-bottom:4px;">
        <span class="text-dim">Meetings this week</span><span class="text-gold">${meetingsCount} / ${myTarget.weekly_meetings_target}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${meetingsPct}%"></div></div>
    </div>
  `;
}

const LOW_PACE_PCT = 50;

// "Team Checklist Today" answers whether tasks got ticked off; nothing
// aggregates the *numeric* output targets (sends/meetings) the way
// loadTargetsProgress already does for the logged-in agent alone. This is
// the team-wide version — how much output are we actually producing today
// vs. what everyone's target adds up to, and who's furthest behind.
async function loadTeamPace(container) {
  if (!container) return;
  const agents = store.profiles.filter((p) => p.active !== false);
  if (!agents.length) { container.innerHTML = ""; return; }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 86400 * 1000);

  const [{ data: sendsToday }, { data: meetingsWeek }] = await Promise.all([
    sb.from("status_history").select("changed_by").eq("new_status", "sent").gte("changed_at", todayStart.toISOString()),
    sb.from("status_history").select("changed_by").eq("new_status", "meeting_booked").gte("changed_at", weekStart.toISOString()),
  ]);

  const rows = agents.map((agent) => {
    const target = store.agentTargets.find((t) => t.agent_id === agent.id) || { daily_sends_target: 15, weekly_meetings_target: 3 };
    const sends = (sendsToday || []).filter((r) => r.changed_by === agent.id).length;
    const meetings = (meetingsWeek || []).filter((r) => r.changed_by === agent.id).length;
    const sendsPct = Math.round((sends / Math.max(1, target.daily_sends_target)) * 100);
    const meetingsPct = Math.round((meetings / Math.max(1, target.weekly_meetings_target)) * 100);
    return { agent, sends, sendsTarget: target.daily_sends_target, sendsPct, meetings, meetingsTarget: target.weekly_meetings_target, meetingsPct };
  });

  const totalSends = rows.reduce((s, r) => s + r.sends, 0);
  const totalSendsTarget = rows.reduce((s, r) => s + r.sendsTarget, 0);
  const totalMeetings = rows.reduce((s, r) => s + r.meetings, 0);
  const totalMeetingsTarget = rows.reduce((s, r) => s + r.meetingsTarget, 0);
  const teamSendsPct = Math.round((totalSends / Math.max(1, totalSendsTarget)) * 100);
  const teamMeetingsPct = Math.round((totalMeetings / Math.max(1, totalMeetingsTarget)) * 100);

  container.innerHTML = `
    <div class="stat-card ${teamSendsPct < LOW_PACE_PCT ? "accent" : ""}" id="tb-pace-sends" style="cursor:pointer;">
      <div class="num">${totalSends} / ${totalSendsTarget}</div>
      <div class="label">Team Sends Today (${teamSendsPct}%)</div>
    </div>
    <div class="stat-card ${teamMeetingsPct < LOW_PACE_PCT ? "accent" : ""}" id="tb-pace-meetings" style="cursor:pointer;">
      <div class="num">${totalMeetings} / ${totalMeetingsTarget}</div>
      <div class="label">Team Meetings This Week (${teamMeetingsPct}%)</div>
    </div>
  `;
  container.querySelector("#tb-pace-sends").addEventListener("click", () => openTeamPaceModal(rows, "sends"));
  container.querySelector("#tb-pace-meetings").addEventListener("click", () => openTeamPaceModal(rows, "meetings"));
}

function openTeamPaceModal(rows, metric) {
  const sorted = rows.slice().sort((a, b) => (metric === "sends" ? a.sendsPct - b.sendsPct : a.meetingsPct - b.meetingsPct));
  const box = el(`
    <div>
      <div class="section-title mt-0">${metric === "sends" ? "Sends Pace Today" : "Meetings Pace This Week"}</div>
      <div id="tb-pace-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#tb-pace-list");
  sorted.forEach((r) => {
    const actual = metric === "sends" ? r.sends : r.meetings;
    const target = metric === "sends" ? r.sendsTarget : r.meetingsTarget;
    const pct = metric === "sends" ? r.sendsPct : r.meetingsPct;
    const row = el(`
      <div class="card" style="margin-bottom:8px;">
        <div class="flex-between" style="margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${avatarHTML(r.agent.full_name || r.agent.email, r.agent.avatar_url, 26)}
            <span style="font-size:13px;font-weight:600;">${esc(r.agent.full_name || r.agent.email)}</span>
          </div>
          <span class="text-gold" style="font-size:12px;">${actual} / ${target}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, pct)}%"></div></div>
      </div>
    `);
    listEl.appendChild(row);
  });
  openModal(box);
}

// Rewards showing up day after day, not just today's completion % — nothing
// else in the app tracks consistency over time. Queries completions history
// directly (same "reach past the store's today-only slice" pattern
// loadTargetsProgress already uses for status_history) since a streak needs
// more than just today's data. Today doesn't break the streak if it's not
// finished yet — it just doesn't count until it is.
async function loadStreak(container, myTasks, myId) {
  if (!container) return;
  if (!myTasks.length) { container.innerHTML = ""; return; }

  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("daily_task_completions")
    .select("task_id, work_date")
    .eq("agent_id", myId)
    .eq("completed", true)
    .gte("work_date", since);
  if (error) return;

  const byDate = new Map();
  (data || []).forEach((c) => {
    if (!byDate.has(c.work_date)) byDate.set(c.work_date, new Set());
    byDate.get(c.work_date).add(c.task_id);
  });

  const expected = myTasks.length;
  const today = todayISO();
  let streak = 0;
  let cursor = new Date(today + "T00:00:00");
  let isToday = true;
  while (true) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const doneSet = byDate.get(dateStr);
    const complete = doneSet && doneSet.size >= expected;
    if (complete) {
      streak++;
    } else if (isToday) {
      // Today's checklist isn't finished yet — that alone shouldn't zero out
      // a real streak, so just don't count it and keep looking backward.
    } else {
      break;
    }
    isToday = false;
    cursor.setDate(cursor.getDate() - 1);
    if (streak > 30) break;
  }

  const todayDone = (byDate.get(today)?.size || 0) >= expected;
  container.innerHTML = `
    <div class="stat-card ${streak ? "accent" : ""}">
      <div class="num">🔥 ${streak}</div>
      <div class="label">Day Streak${todayDone ? "" : streak ? ", finish today's checklist to extend it" : ", complete today's checklist to start one"}</div>
    </div>
  `;
}

// "Due Today" (main.js's dueTodayList) only ever looks backward-or-equal —
// it deliberately can't warn you about Thursday's follow-ups on Monday.
// This groups the next 7 days of *upcoming* follow_up_date prospects by day
// so agents can plan ahead instead of only reacting to what's already due.
// Same visibility rule as dueTodayList: owners see everyone's, agents see
// only their own (store.prospects is RLS-scoped that way for non-owners
// anyway, but the assigned_to check keeps shared/unassigned rows out too).
function renderWeekAhead(container, isOwner, myId) {
  if (!container) return;
  const today = todayISO();
  const todayDate = new Date(today + "T00:00:00");

  const upcoming = store.prospects.filter((p) => {
    if (!p.follow_up_date || p.follow_up_date <= today) return false;
    if (["signed", "dead"].includes(p.status)) return false;
    if (!isOwner && p.assigned_to !== myId) return false;
    const days = Math.round((new Date(p.follow_up_date + "T00:00:00") - todayDate) / 86400000);
    return days >= 1 && days <= 7;
  });

  if (!upcoming.length) {
    container.innerHTML = `<div class="card"><div class="text-faint" style="font-size:12.5px;">No follow-ups scheduled in the next 7 days.</div></div>`;
    return;
  }

  const byDate = {};
  upcoming.forEach((p) => { (byDate[p.follow_up_date] = byDate[p.follow_up_date] || []).push(p); });
  const dates = Object.keys(byDate).sort();

  container.innerHTML = "";
  dates.forEach((dateStr) => {
    const d = new Date(dateStr + "T00:00:00");
    const days = Math.round((d - todayDate) / 86400000);
    const label = days === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const group = el(`
      <div class="card" style="margin-bottom:8px;">
        <div class="text-gold" style="font-size:11.5px;font-weight:700;margin-bottom:2px;">${esc(label)}</div>
      </div>
    `);
    byDate[dateStr].forEach((p, idx) => {
      const niche = p.niche_id ? nicheById(p.niche_id) : null;
      const sub = [niche?.name, p.area].filter(Boolean).join(" · ");
      const row = el(`
        <div style="padding:6px 0;${idx > 0 ? "border-top:1px solid var(--line);" : ""}cursor:pointer;">
          <div style="font-size:13px;">${esc(p.business_name)}</div>
          ${sub ? `<div class="text-faint" style="font-size:11px;">${esc(sub)}</div>` : ""}
        </div>
      `);
      row.addEventListener("click", () => openProspectDetail(p));
      group.appendChild(row);
    });
    container.appendChild(group);
  });
}

function renderManageTasks(container) {
  container.innerHTML = "";
  if (!store.dailyTasks.length) {
    container.innerHTML = `<div class="text-faint" style="font-size:12.5px;">No missions yet.</div>`;
    return;
  }
  store.dailyTasks.forEach((task) => {
    const assignee = task.assigned_to ? store.profiles.find((p) => p.id === task.assigned_to) : null;
    const who = assignee ? (assignee.full_name || assignee.email) : "Everyone";
    const row = el(`
      <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--line);">
        <span style="font-size:13px;">
          ${esc(task.title)}
          <span class="text-faint" style="font-size:11px;display:block;">${esc(who)}</span>
        </span>
        <span class="small-link" data-remove>Remove</span>
      </div>
    `);
    row.querySelector("[data-remove]").addEventListener("click", () => {
      confirmModal({
        title: "Remove this mission?",
        body: `"${esc(task.title)}" will be removed from ${assignee ? "their" : "everyone's"} missions.`,
        confirmLabel: "Remove",
        danger: true,
        onConfirm: async () => {
          const { error } = await sb.from("daily_tasks").update({ active: false }).eq("id", task.id);
          if (error) return toast(error.message, "error");
          const { data } = await sb.from("daily_tasks").select("*").eq("active", true).order("sort_order");
          store.dailyTasks = data || [];
          renderTasks();
        },
      });
    });
    container.appendChild(row);
  });
}

function openTaskForm() {
  const box = el(`
    <div>
      <div class="field">
        <label>Mission</label>
        <input id="tk-title" type="text" placeholder="e.g. Send 15 new outreach messages" />
      </div>
      <div class="field">
        <label>Type</label>
        <select id="tk-type">
          <option value="send">Send</option>
          <option value="reply">Reply</option>
          <option value="follow_up">Follow-up</option>
          <option value="deposit">Deposit</option>
          <option value="general" selected>General</option>
        </select>
      </div>
      <div class="field">
        <label>Assign to</label>
        <select id="tk-assignee">
          <option value="">Everyone (shared missions)</option>
          ${store.profiles.filter((p) => p.active !== false).map((p) => `<option value="${p.id}">${esc(p.full_name || p.email)}</option>`).join("")}
        </select>
        <div class="hint">Pick a person to give them this mission only, it won't show up on anyone else's missions. This repeats daily until you remove it.</div>
      </div>
      <button class="btn btn-primary" id="tk-save">Add Mission</button>
    </div>
  `);
  box.querySelector("#tk-save").addEventListener("click", async () => {
    const title = box.querySelector("#tk-title").value.trim();
    if (!title) return toast("Enter a task", "error");
    const assigned_to = box.querySelector("#tk-assignee").value || null;
    const { error } = await sb.from("daily_tasks").insert({
      title, day_type: box.querySelector("#tk-type").value, sort_order: store.dailyTasks.length + 1, assigned_to,
    });
    if (error) return toast(error.message, "error");
    const { data } = await sb.from("daily_tasks").select("*").eq("active", true).order("sort_order");
    store.dailyTasks = data || [];
    toast("Task added", "success");
    closeSheet();
    renderTasks();
  });
  openSheet("Add Checklist Task", box);
}

function renderManageTargets(container) {
  container.innerHTML = "";
  // No point setting a future daily/weekly target for someone whose access
  // has been removed — they can't log in to work toward it.
  store.profiles.filter((agent) => agent.active !== false).forEach((agent) => {
    const t = store.agentTargets.find((x) => x.agent_id === agent.id) || { daily_sends_target: 15, weekly_meetings_target: 3 };
    const card = el(`
      <div class="card" style="margin-bottom:8px;">
        <div style="font-weight:700;font-size:13.5px;margin-bottom:8px;">${esc(agent.full_name || agent.email)}</div>
        <div class="field-row">
          <div class="field" style="margin-bottom:0;">
            <label>Daily sends</label>
            <input type="number" min="0" class="tg-sends" value="${t.daily_sends_target}" />
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Weekly meetings</label>
            <input type="number" min="0" class="tg-meetings" value="${t.weekly_meetings_target}" />
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px;" data-save>Save</button>
      </div>
    `);
    card.querySelector("[data-save]").addEventListener("click", async () => {
      const daily_sends_target = Number(card.querySelector(".tg-sends").value) || 0;
      const weekly_meetings_target = Number(card.querySelector(".tg-meetings").value) || 0;
      const { error } = await sb
        .from("agent_targets")
        .upsert({ agent_id: agent.id, daily_sends_target, weekly_meetings_target }, { onConflict: "agent_id" });
      if (error) return toast(error.message, "error");
      const { data } = await sb.from("agent_targets").select("*");
      store.agentTargets = data || [];
      toast("Target updated", "success");
    });
    container.appendChild(card);
  });
}

export function initTasksView() {
  on("dailyTasks", () => { if (isActive()) renderTasks(); });
  on("dailyCompletions", () => { if (isActive()) renderTasks(); });
  on("agentTargets", () => { if (isActive()) renderTasks(); });
  on("prospects", () => { if (isActive()) renderTasks(); });
}
function isActive() {
  return document.getElementById("view-tasks")?.classList.contains("active");
}
