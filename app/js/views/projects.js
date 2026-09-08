import { sb } from "../supabaseClient.js";
import { store, on, prospectById, profileById } from "../state.js";
import { el, esc, fmtDate, todayISO, toast, downloadReminderICS, toCSV, downloadTextFile, buildWhatsAppLink } from "../utils.js";
import { openSheet, closeSheet, confirmModal, openModal, closeModal } from "../ui.js";

const STATUS_LABELS = { not_started: "Not Started", in_progress: "In Progress", blocked: "Blocked", complete: "Complete" };
const STATUSES = ["not_started", "in_progress", "blocked", "complete"];

let filterStatus = "all";
let filterOverdue = false;
let filterIdle = false;
let filterReady = false;

// Lets Dashboard deep-link into a pre-filtered Projects list (mirrors
// pipeline.js's setStatusFilter), instead of always landing on the
// unfiltered "All" view like the Active Projects stat card did before.
export function setProjectStatusFilter(status) {
  filterStatus = status;
}

// Same definition Dashboard's "Overdue Projects" stat card already uses
// (overdueProjects() in dashboard.js) — kept in sync deliberately so a
// project counted as overdue there matches what gets flagged/filtered here.
// Dashboard could only ever tell you *how many* were late; this surfaces
// exactly *which* ones right where the team actually manages delivery.
function isOverdueProject(p) {
  return p.status !== "complete" && p.due_date && p.due_date < todayISO();
}

// Overdue only ever fires *after* a deadline is already blown — nothing
// warns the team beforehand. A project due in 2 days looks visually
// identical to one due in 6 weeks until the moment it flips to Overdue.
// Mirrors invoices.js's "Due Soon" idiom (payment deadlines) applied here to
// delivery deadlines instead — same proactive-warning pattern, different
// table/page, not a duplicate.
const DUE_SOON_DAYS = 3;
function daysUntilDue(p) {
  if (!p.due_date) return null;
  return Math.floor((new Date(p.due_date + "T00:00:00") - new Date(todayISO() + "T00:00:00")) / 86400000);
}
function isDueSoonProject(p) {
  if (p.status === "complete" || !p.due_date || isOverdueProject(p)) return false;
  const d = daysUntilDue(p);
  return d !== null && d >= 0 && d <= DUE_SOON_DAYS;
}

// Overdue only fires when a project has a due_date that's passed — but
// due_date is optional, and plenty of projects get created without one (or
// with a due date weeks out) and then just sit at not_started/in_progress
// with nothing touched for weeks. Dashboard's Revenue at Risk only catches a
// blocked project on a signed client, not a plain stalled one — nothing else
// answers "which in-flight projects have gone quiet," independent of
// whether they even have a deadline. updated_at is already bumped by the
// existing trg_projects_touch trigger on status/date/notes edits, same
// "last touched" proxy Dashboard's staleProspects() already uses for leads.
const IDLE_DAYS = 10;
function daysSinceUpdate(p) {
  const ts = p.updated_at || p.created_at;
  if (!ts) return 0;
  return Math.floor((new Date(todayISO() + "T00:00:00") - new Date(ts.slice(0, 10) + "T00:00:00")) / 86400000);
}
function isIdleProject(p) {
  return p.status !== "complete" && !isOverdueProject(p) && daysSinceUpdate(p) >= IDLE_DAYS;
}

// The checklist and the status dropdown are two separate manual steps —
// a rep ticks off every deliverable but forgets the extra click to flip
// Status to "Complete." That leaves finished work misclassified as
// in-progress: it never counts toward Avg. Delivery Time above (which only
// looks at status='complete' rows), so delivery-time stats stay skewed, and
// an owner scanning "in progress" work has no way to tell it's actually
// done and ready to invoice. Requires at least one checklist item so an
// empty-checklist project (nothing to be "done" yet) never qualifies.
function isReadyToClose(p) {
  if (p.status === "complete") return false;
  const tasks = store.projectTasks.filter((t) => t.project_id === p.id);
  return tasks.length > 0 && tasks.every((t) => t.done);
}

// Overdue and Idle above are both about *in-flight* projects — nothing here
// answers "once a project actually finishes, how long did delivery take?"
// There's no dedicated completed_at column, but trg_projects_touch already
// bumps updated_at on every projects-row edit (the same "last touched" proxy
// Idle leans on above), so for a project sitting at status='complete',
// updated_at is a reasonable stand-in for "the day it was finished." Mirrors
// invoices.js's Avg. Days to Get Paid (created_at → paid_date) — this is
// created_at → updated_at, scoped to completed projects only.
function completedProjectsWithDuration() {
  return store.projects
    .filter((p) => p.status === "complete" && p.created_at && p.updated_at)
    .map((p) => ({ project: p, days: Math.round((new Date(p.updated_at) - new Date(p.created_at)) / 86400000) }))
    .filter((r) => r.days >= 0);
}

// Flag threshold for the drill-down list only — a delivery this slow is
// worth an owner actually looking at, same "worth a second look" spirit as
// invoices.js's own 14-day cutoff on its Slowest Payers modal.
const SLOW_DELIVERY_DAYS = 21;

// Per-project, the checklist only ever answers "is THIS project on track."
// Nothing aggregates ACROSS projects to show which specific deliverable
// keeps stalling team-wide — e.g. every "Client review round" item sitting
// unchecked on several active projects at once is an invisible pattern
// today, even though each individual project's checklist looks fine in
// isolation. Reuses store.projectTasks (already loaded, same table the
// per-project checklist already renders from) — no new query. Counts each
// project at most once per title (a project can't be "stuck" twice on the
// same deliverable), and only surfaces a title once it's recurred on at
// least BOTTLENECK_MIN_PROJECTS active projects, so a one-off custom
// checklist item someone typed for a single client never shows up as a
// false "pattern."
const BOTTLENECK_MIN_PROJECTS = 2;
function bottleneckDeliverables() {
  const counts = {};
  store.projects.forEach((p) => {
    if (p.status === "complete") return;
    const seenTitles = new Set();
    store.projectTasks
      .filter((t) => t.project_id === p.id && !t.done)
      .forEach((t) => {
        const title = (t.title || "").trim();
        if (!title || seenTitles.has(title)) return;
        seenTitles.add(title);
        counts[title] = (counts[title] || 0) + 1;
      });
  });
  return Object.entries(counts)
    .filter(([, count]) => count >= BOTTLENECK_MIN_PROJECTS)
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count);
}

// Every new project starts with a blank checklist — the team retypes the
// same recurring delivery steps by hand for every client, one deliverable at
// a time, and different agents list (or skip) different steps since nothing
// standardizes what a given engagement type actually involves. These are
// just starting points a rep can still edit/remove items from afterward —
// static content baked into the file, no template table needed.
const PROJECT_TEMPLATES = {
  "Client Onboarding": ["Kickoff call scheduled", "Brand assets collected", "Access/logins gathered", "Goals & KPIs confirmed", "Content calendar drafted", "Kickoff recap sent"],
  "Monthly Content Batch": ["Content ideas approved", "Assets/copy drafted", "Client review round", "Revisions applied", "Batch scheduled", "Performance recap sent"],
  "Website / Launch": ["Sitemap approved", "Copy finalized", "Design mockups approved", "Build complete", "Client review round", "Launched & QA'd"],
};

export function renderProjects() {
  const root = document.getElementById("view-projects");
  root.innerHTML = "";

  const completed = completedProjectsWithDuration();
  const avgDeliveryDays = completed.length
    ? Math.round(completed.reduce((sum, r) => sum + r.days, 0) / completed.length)
    : null;
  const dueSoon = store.projects.filter(isDueSoonProject);
  const bottlenecks = bottleneckDeliverables();
  const extraCards = (dueSoon.length ? 1 : 0) + (bottlenecks.length ? 1 : 0);

  const wrap = el(`
    <div>
      <div class="flex-between">
        <div class="page-title mt-0">Projects<span class="accent">.</span></div>
        <div>
          <span class="small-link" id="pj-export-csv">Export CSV</span>
          <span class="small-link" id="pj-new" style="margin-left:12px;">+ New Project</span>
        </div>
      </div>
      <div class="stat-grid ${extraCards === 2 ? "cols-3" : ""}" style="margin-bottom:14px;${extraCards ? "" : "grid-template-columns:1fr;"}">
        <div class="stat-card" id="pj-avg-delivery-card" style="${completed.length ? "cursor:pointer;" : ""}">
          <div class="num">${avgDeliveryDays === null ? "-" : avgDeliveryDays + "d"}</div>
          <div class="label">Avg. Delivery Time${completed.length ? ", tap to see slowest deliveries" : ", no completed projects yet"}</div>
        </div>
        ${dueSoon.length ? `
          <div class="stat-card" id="pj-duesoon-card" style="cursor:pointer;">
            <div class="num">${dueSoon.length}</div>
            <div class="label">Due within ${DUE_SOON_DAYS} days, tap to see</div>
          </div>
        ` : ""}
        ${bottlenecks.length ? `
          <div class="stat-card accent" id="pj-bottleneck-card" style="cursor:pointer;">
            <div class="num">${bottlenecks.length}</div>
            <div class="label">Common bottleneck${bottlenecks.length === 1 ? "" : "s"}, tap to see</div>
          </div>
        ` : ""}
      </div>
      <div class="chip-row" id="pj-status-chips"></div>
      <div id="pj-list"></div>
    </div>
  `);
  root.appendChild(wrap);

  wrap.querySelector("#pj-new").addEventListener("click", () => openNewProjectSheet(null));
  wrap.querySelector("#pj-export-csv").addEventListener("click", exportProjectsCSV);
  if (completed.length) {
    wrap.querySelector("#pj-avg-delivery-card").addEventListener("click", () => openSlowestDeliveriesModal(completed));
  }
  if (dueSoon.length) {
    wrap.querySelector("#pj-duesoon-card").addEventListener("click", () => openDueSoonModal(dueSoon));
  }
  if (bottlenecks.length) {
    wrap.querySelector("#pj-bottleneck-card").addEventListener("click", () => openBottlenecksModal(bottlenecks));
  }

  const chipRow = wrap.querySelector("#pj-status-chips");
  [["all", "All"], ...STATUSES.map((s) => [s, STATUS_LABELS[s]])].forEach(([val, label]) => {
    const chip = el(`<span class="chip ${filterStatus === val ? "active" : ""}">${label}</span>`);
    chip.addEventListener("click", () => { filterStatus = val; renderProjects(); });
    chipRow.appendChild(chip);
  });
  const overdueChip = el(`<span class="chip ${filterOverdue ? "active" : ""}">Overdue</span>`);
  overdueChip.addEventListener("click", () => { filterOverdue = !filterOverdue; renderProjects(); });
  chipRow.appendChild(overdueChip);
  const idleChip = el(`<span class="chip ${filterIdle ? "active" : ""}">Idle</span>`);
  idleChip.addEventListener("click", () => { filterIdle = !filterIdle; renderProjects(); });
  chipRow.appendChild(idleChip);
  const readyChip = el(`<span class="chip ${filterReady ? "active" : ""}">Ready to Close</span>`);
  readyChip.addEventListener("click", () => { filterReady = !filterReady; renderProjects(); });
  chipRow.appendChild(readyChip);

  renderList(wrap.querySelector("#pj-list"));
}

function renderList(listEl) {
  if (!listEl) listEl = document.getElementById("pj-list");
  if (!listEl) return;

  let items = store.projects.slice();
  if (filterStatus !== "all") items = items.filter((p) => p.status === filterStatus);
  if (filterOverdue) items = items.filter(isOverdueProject);
  if (filterIdle) items = items.filter(isIdleProject);
  if (filterReady) items = items.filter(isReadyToClose);
  // Worst-first: overdue projects surface above everything else regardless
  // of when they were last touched, same "don't bury the thing that needs
  // attention" convention tasks.js's Team Checklist sorts worst-progress-first.
  // Idle projects (stalled, no deadline pressure) rank just below overdue
  // ones for the same reason. Ready-to-close is the opposite kind of
  // "needs a look" — not a problem, but an easy action item — so it ranks
  // just below idle rather than competing with genuine warning signs.
  items.sort((a, b) => {
    const aOver = isOverdueProject(a), bOver = isOverdueProject(b);
    if (aOver !== bOver) return aOver ? -1 : 1;
    const aIdle = isIdleProject(a), bIdle = isIdleProject(b);
    if (aIdle !== bIdle) return aIdle ? -1 : 1;
    const aReady = isReadyToClose(a), bReady = isReadyToClose(b);
    if (aReady !== bReady) return aReady ? -1 : 1;
    return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
  });

  listEl.innerHTML = "";
  if (!items.length) {
    listEl.appendChild(el(`
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2a2 2 0 0 1 1.6.8l1.1 1.5h7.1A2.5 2.5 0 0 1 21 9.8v7.7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/></svg>
        <p>No projects yet. Start one once delivery work begins.</p>
      </div>
    `));
    return;
  }

  items.forEach((p) => {
    const prospect = prospectById(p.prospect_id);
    const tasks = store.projectTasks.filter((t) => t.project_id === p.id);
    const doneCount = tasks.filter((t) => t.done).length;
    const overdue = isOverdueProject(p);
    const dueSoonFlag = isDueSoonProject(p);
    const idle = isIdleProject(p);
    const ready = isReadyToClose(p);
    const card = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between" style="margin-bottom:4px;">
          <div style="font-weight:700;font-size:14px;">${esc(p.name)}</div>
          <span>
            ${overdue ? `<span class="status-pill dead">Overdue</span> ` : dueSoonFlag ? `<span class="status-pill stale">Due in ${daysUntilDue(p)}d</span> ` : idle ? `<span class="status-pill stale">Idle · ${daysSinceUpdate(p)}d</span> ` : ready ? `<span class="status-pill complete">All tasks done</span> ` : ""}<span class="status-pill ${p.status}">${STATUS_LABELS[p.status] || p.status}</span>
          </span>
        </div>
        <div class="text-faint" style="font-size:12px;margin-bottom:8px;">
          ${prospect ? esc(prospect.business_name) : "No prospect linked"}
        </div>
        ${tasks.length ? `
          <div class="progress-track" style="margin-top:0;margin-bottom:6px;"><div class="progress-fill" style="width:${Math.round((doneCount / tasks.length) * 100)}%"></div></div>
          <div class="text-faint" style="font-size:11px;">${doneCount} / ${tasks.length} tasks done${p.due_date ? " · Due " + fmtDate(p.due_date) : ""}</div>
        ` : `<div class="text-faint" style="font-size:11px;">${p.due_date ? "Due " + fmtDate(p.due_date) : "No due date"}</div>`}
      </div>
    `);
    card.addEventListener("click", () => openProjectDetail(p));
    listEl.appendChild(card);
  });
}

function exportProjectsCSV() {
  let items = store.projects.slice();
  if (filterStatus !== "all") items = items.filter((p) => p.status === filterStatus);
  if (filterOverdue) items = items.filter(isOverdueProject);
  if (filterIdle) items = items.filter(isIdleProject);
  if (filterReady) items = items.filter(isReadyToClose);
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!items.length) return toast("No projects to export", "error");

  const columns = [
    { label: "Name", get: (p) => p.name },
    { label: "Client", get: (p) => prospectById(p.prospect_id)?.business_name || "" },
    { label: "Status", get: (p) => (isOverdueProject(p) ? "Overdue: " : isIdleProject(p) ? `Idle (${daysSinceUpdate(p)}d): ` : isReadyToClose(p) ? "Ready to close: " : "") + (STATUS_LABELS[p.status] || p.status) },
    { label: "Due Date", get: (p) => p.due_date || "" },
    { label: "Tasks Done", get: (p) => store.projectTasks.filter((t) => t.project_id === p.id && t.done).length },
    { label: "Tasks Total", get: (p) => store.projectTasks.filter((t) => t.project_id === p.id).length },
    { label: "Started By", get: (p) => profileById(p.created_by)?.full_name || "" },
    { label: "Created At", get: (p) => p.created_at ? p.created_at.slice(0, 10) : "" },
  ];

  const csv = toCSV(items, columns);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`projects-export-${stamp}.csv`, csv);
}

// Drill-down for the "Avg. Delivery Time" stat card — the bare average
// alone can't tell an owner *which* projects dragged, so this ranks
// completed projects slowest (longest created_at → updated_at gap) first,
// same modal-list pattern invoices.js's Slowest Payers already uses.
function openSlowestDeliveriesModal(completed) {
  const rows = completed.slice().sort((a, b) => b.days - a.days);
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Slowest Deliveries</div>
      <div id="pj-slow-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#pj-slow-list");
  rows.forEach(({ project, days }) => {
    const prospect = prospectById(project.prospect_id);
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(project.name)}</div>
            <div class="text-faint" style="font-size:11px;">${prospect ? esc(prospect.business_name) : "No prospect linked"}</div>
          </div>
          <span class="status-pill ${days >= SLOW_DELIVERY_DAYS ? "dead" : "complete"}">${days}d</span>
        </div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openProjectDetail(project);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

// Drill-down for the "Due within Xd" stat card — same modal-list pattern as
// openSlowestDeliveriesModal above, soonest-due first so the most urgent
// deadline is the first thing an owner sees.
function openDueSoonModal(projects) {
  const rows = projects.slice().sort((a, b) => daysUntilDue(a) - daysUntilDue(b));
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:12px;">Due Soon</div>
      <div id="pj-duesoon-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#pj-duesoon-list");
  rows.forEach((project) => {
    const prospect = prospectById(project.prospect_id);
    const d = daysUntilDue(project);
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(project.name)}</div>
            <div class="text-faint" style="font-size:11px;">${prospect ? esc(prospect.business_name) : "No prospect linked"}</div>
          </div>
          <span class="status-pill stale">${d === 0 ? "Today" : d === 1 ? "1d" : d + "d"}</span>
        </div>
      </div>
    `);
    row.addEventListener("click", () => {
      closeModal();
      openProjectDetail(project);
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

// Drill-down for the "Common bottlenecks" stat card. Each row is a
// deliverable TITLE (not a single project), so — unlike every other modal
// row in this file — tapping one doesn't open a project detail; it expands
// to show which active projects still have that item unchecked, since
// that's the actual follow-up an owner needs ("who do I nudge").
function openBottlenecksModal(bottlenecks) {
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:4px;">Common Bottlenecks</div>
      <div class="text-faint" style="font-size:11.5px;margin-bottom:12px;">Checklist items still unchecked on ${BOTTLENECK_MIN_PROJECTS}+ active projects at once, tap one to see which.</div>
      <div id="pj-bottleneck-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#pj-bottleneck-list");
  bottlenecks.forEach(({ title, count }) => {
    const stuckProjects = store.projects.filter(
      (p) => p.status !== "complete" && store.projectTasks.some((t) => t.project_id === p.id && !t.done && (t.title || "").trim() === title)
    );
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;">
        <div class="flex-between">
          <div style="min-width:0;">
            <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(title)}</div>
            <div class="text-faint" style="font-size:11px;">Still open on ${count} active project${count === 1 ? "" : "s"}</div>
          </div>
          <span class="status-pill stale">${count}</span>
        </div>
        <div class="bottleneck-projects" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--line);"></div>
      </div>
    `);
    const detail = row.querySelector(".bottleneck-projects");
    row.addEventListener("click", () => {
      const showing = detail.style.display !== "none";
      if (showing) { detail.style.display = "none"; return; }
      if (!detail.childElementCount) {
        stuckProjects.forEach((project) => {
          const prospect = prospectById(project.prospect_id);
          const link = el(`<div class="small-link" style="display:block;margin-bottom:4px;">${esc(project.name)}${prospect ? ": " + esc(prospect.business_name) : ""}</div>`);
          link.addEventListener("click", (e) => {
            e.stopPropagation();
            closeModal();
            openProjectDetail(project);
          });
          detail.appendChild(link);
        });
      }
      detail.style.display = "block";
    });
    listEl.appendChild(row);
  });
  openModal(box);
}

function currentProject(id) {
  return store.projects.find((p) => p.id === id);
}

function openProjectDetail(p0) {
  const p = currentProject(p0.id) || p0;
  const isOwner = store.profile?.role === "owner";
  const prospect = prospectById(p.prospect_id);
  const creator = profileById(p.created_by);

  const box = el(`<div></div>`);
  box.innerHTML = `
    <div style="font-size:19px;font-weight:800;margin-bottom:2px;">${esc(p.name)}</div>
    <div class="text-faint" style="font-size:12.5px;margin-bottom:14px;">
      ${prospect ? esc(prospect.business_name) : "No prospect linked"}${creator ? " · started by " + esc(creator.full_name || creator.email) : ""}
    </div>

    <div class="field" style="margin-bottom:14px;">
      <label>Status</label>
      <select id="pj-status">
        ${STATUSES.map((s) => `<option value="${s}" ${p.status === s ? "selected" : ""}>${STATUS_LABELS[s]}</option>`).join("")}
      </select>
    </div>

    <div class="field-row" style="margin-bottom:14px;">
      <div class="field" style="margin-bottom:0;">
        <label>Start date</label>
        <input id="pj-start" type="date" value="${p.start_date || ""}" />
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Due date</label>
        <input id="pj-due" type="date" value="${p.due_date || ""}" />
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" id="pj-due-ics" style="width:auto;margin:-8px 0 14px;${p.due_date ? "" : "display:none;"}">Add Due Date to Calendar</button>

    <div class="field">
      <label>Notes</label>
      <textarea id="pj-notes" placeholder="Scope, deliverables, anything worth remembering...">${esc(p.notes || "")}</textarea>
    </div>
    <button class="btn btn-ghost" id="pj-save-notes" style="margin-bottom:16px;">Save Notes</button>

    <div class="flex-between mt-0" style="margin-top:20px;margin-bottom:8px;">
      <div class="section-title mt-0" style="margin-bottom:0;">Checklist</div>
      <span class="small-link" id="pj-use-template">Use Template</span>
    </div>
    <div class="chip-row" id="pj-template-picker" style="display:none;margin-bottom:10px;"></div>
    <div class="card" id="pj-checklist" style="margin-bottom:14px;"></div>
    <div class="field-row" style="margin-bottom:16px;">
      <div class="field" style="margin-bottom:0;">
        <input id="pj-task-input" type="text" placeholder="Add a deliverable..." />
      </div>
      <button class="btn btn-ghost btn-sm" id="pj-task-add" style="flex:0 0 auto;width:auto;">Add</button>
    </div>

    <div class="section-title" style="margin-top:20px;">Client Link</div>
    <div class="card" style="margin-bottom:16px;">
      <div class="text-faint" style="font-size:12.5px;line-height:1.5;margin-bottom:10px;" id="pj-share-blurb"></div>
      <div id="pj-share-actions" style="display:flex;gap:8px;flex-wrap:wrap;"></div>
    </div>

    ${isOwner ? `<button class="btn btn-danger" id="pj-delete">Delete Project</button>` : ""}
  `;

  renderShareBox(box, p);

  box.querySelector("#pj-status").addEventListener("change", async (e) => {
    const { error } = await sb.from("projects").update({ status: e.target.value }).eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast("Status updated", "success");
  });
  box.querySelector("#pj-start").addEventListener("change", async (e) => {
    const { error } = await sb.from("projects").update({ start_date: e.target.value || null }).eq("id", p.id);
    if (error) toast(error.message, "error");
  });
  box.querySelector("#pj-due").addEventListener("change", async (e) => {
    const { error } = await sb.from("projects").update({ due_date: e.target.value || null }).eq("id", p.id);
    if (error) toast(error.message, "error");
    const icsBtn = box.querySelector("#pj-due-ics");
    if (icsBtn) icsBtn.style.display = e.target.value ? "" : "none";
  });
  const dueIcsBtn = box.querySelector("#pj-due-ics");
  if (dueIcsBtn) {
    dueIcsBtn.addEventListener("click", () => {
      const dateISO = box.querySelector("#pj-due").value;
      if (!dateISO) return;
      downloadReminderICS(`project-due-${p.name.replace(/[^\w]+/g, "-").toLowerCase()}.ics`, {
        title: `Project due: ${p.name}`,
        description: `${prospect ? prospect.business_name + ": " : ""}${p.name} is due.`,
        dateISO,
      });
      toast("Calendar file downloaded", "success");
    });
  }
  box.querySelector("#pj-save-notes").addEventListener("click", async () => {
    const notes = box.querySelector("#pj-notes").value.trim();
    const { error } = await sb.from("projects").update({ notes }).eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast("Notes saved", "success");
  });

  const addTask = async () => {
    const input = box.querySelector("#pj-task-input");
    const title = input.value.trim();
    if (!title) return;
    const existingTasks = store.projectTasks.filter((t) => t.project_id === p.id);
    const { error } = await sb.from("project_tasks").insert({ project_id: p.id, title, sort_order: existingTasks.length + 1 });
    if (error) return toast(error.message, "error");
    input.value = "";
  };
  box.querySelector("#pj-task-add").addEventListener("click", addTask);
  box.querySelector("#pj-task-input").addEventListener("keydown", (e) => { if (e.key === "Enter") addTask(); });

  const templatePicker = box.querySelector("#pj-template-picker");
  box.querySelector("#pj-use-template").addEventListener("click", () => {
    const showing = templatePicker.style.display !== "none";
    templatePicker.style.display = showing ? "none" : "flex";
    if (showing) return;
    templatePicker.innerHTML = "";
    Object.keys(PROJECT_TEMPLATES).forEach((name) => {
      const chip = el(`<span class="chip">${esc(name)}</span>`);
      chip.addEventListener("click", () => {
        const titles = PROJECT_TEMPLATES[name];
        confirmModal({
          title: "Add checklist items?",
          body: `Add ${titles.length} checklist items from "${esc(name)}"?`,
          confirmLabel: "Add Items",
          onConfirm: async () => {
            const existingTasks = store.projectTasks.filter((t) => t.project_id === p.id);
            const rows = titles.map((title, idx) => ({ project_id: p.id, title, sort_order: existingTasks.length + idx + 1 }));
            const { error } = await sb.from("project_tasks").insert(rows);
            if (error) return toast(error.message, "error");
            toast("Checklist items added", "success");
            templatePicker.style.display = "none";
          },
        });
      });
      templatePicker.appendChild(chip);
    });
  });

  const delBtn = box.querySelector("#pj-delete");
  if (delBtn) {
    delBtn.addEventListener("click", () => {
      confirmModal({
        title: "Delete this project?",
        body: `This permanently removes <b>${esc(p.name)}</b> and its checklist. This can't be undone.`,
        confirmLabel: "Delete",
        danger: true,
        onConfirm: async () => {
          const { error } = await sb.from("projects").delete().eq("id", p.id);
          if (error) toast(error.message, "error");
          else { toast("Project deleted", "success"); closeSheet(); }
        },
      });
    });
  }

  renderChecklist(box, p.id);

  openSheet(p.name, box);

  const offTasks = on("projectTasks", () => renderChecklist(box, p.id));
  const offProjects = on("projects", () => {
    const fresh = currentProject(p.id);
    if (!fresh) return;
    const statusSel = box.querySelector("#pj-status");
    if (statusSel && statusSel.value !== fresh.status) statusSel.value = fresh.status;
  });
  document.getElementById("sheet")._onClose = () => { offTasks(); offProjects(); };
}

// ---- client link -----------------------------------------------------------
//
// Long random token, generated on this device. Same approach and the same
// reasoning as Grid Plans' share link: it gates a public no-login page, so it
// needs to be far too wide to guess. 24 bytes of crypto randomness is 48 hex
// characters — there is no practical number of attempts that finds one, and
// the database function backing the page refuses anything shorter than 16
// characters outright.
function generateShareToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function shareUrlFor(project) {
  return `${location.origin}/project.html?t=${project.share_token}`;
}

function renderShareBox(box, p0) {
  const p = currentProject(p0.id) || p0;
  const blurb = box.querySelector("#pj-share-blurb");
  const actions = box.querySelector("#pj-share-actions");
  if (!blurb || !actions) return;

  const shown = store.projectTasks.filter((t) => t.project_id === p.id && !t.internal).length;
  const hidden = store.projectTasks.filter((t) => t.project_id === p.id && t.internal).length;

  actions.innerHTML = "";

  if (!p.share_token) {
    blurb.innerHTML =
      "Create a link the client can open — no login, no app to install — showing how far along this " +
      "project is. They see the checklist, minus anything you've marked <b>Hide</b>.";
    const btn = el(`<button class="btn btn-primary btn-sm" style="width:auto;">Create Client Link</button>`);
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const token = generateShareToken();
      const { error } = await sb
        .from("projects")
        .update({ share_token: token, shared_at: new Date().toISOString() })
        .eq("id", p.id);
      btn.disabled = false;
      if (error) return toast(error.message, "error");
      // The store is refreshed by Realtime, but the sheet in front of the user
      // has to redraw now rather than whenever that arrives.
      const fresh = { ...p, share_token: token };
      const idx = store.projects.findIndex((x) => x.id === p.id);
      if (idx > -1) store.projects[idx] = { ...store.projects[idx], share_token: token };
      renderShareBox(box, fresh);
      toast("Client link ready", "success");
    });
    actions.appendChild(btn);
    return;
  }

  blurb.innerHTML =
    `This project has a live client link. It shows <b>${shown}</b> checklist item${shown === 1 ? "" : "s"}` +
    (hidden ? `, and hides ${hidden} marked internal` : "") +
    ". Anyone with the link can open it, so send it to the client and nobody else.";

  const copyBtn = el(`<button class="btn btn-primary btn-sm" style="width:auto;">Copy Link</button>`);
  copyBtn.addEventListener("click", async () => {
    const url = shareUrlFor(p);
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", "success");
    } catch {
      // Clipboard access is refused in some in-app browsers. Showing the URL
      // is a worse experience but still a usable one — the alternative is a
      // button that silently does nothing.
      toast(url, "");
    }
  });
  actions.appendChild(copyBtn);

  const prospect = prospectById(p.prospect_id);
  if (prospect?.whatsapp_number) {
    const waBtn = el(`<button class="btn btn-ghost btn-sm" style="width:auto;">Send on WhatsApp</button>`);
    waBtn.addEventListener("click", () => {
      const msg =
        `Hi ${prospect.business_name} — here's a live progress page for "${p.name}". ` +
        `You can open it any time to see where things are: ${shareUrlFor(p)}`;
      window.open(buildWhatsAppLink(prospect.whatsapp_number, msg), "_blank");
    });
    actions.appendChild(waBtn);
  }

  const newBtn = el(`<button class="btn btn-ghost btn-sm" style="width:auto;">Replace Link</button>`);
  newBtn.addEventListener("click", () => {
    confirmModal({
      title: "Replace this link?",
      body:
        "The current link stops working straight away and anyone still holding it sees " +
        "\"this link isn't active\". Use this if it was sent to the wrong person.",
      confirmLabel: "Replace",
      danger: true,
      onConfirm: async () => {
        const token = generateShareToken();
        const { error } = await sb
          .from("projects")
          .update({ share_token: token, shared_at: new Date().toISOString() })
          .eq("id", p.id);
        if (error) return toast(error.message, "error");
        const idx = store.projects.findIndex((x) => x.id === p.id);
        if (idx > -1) store.projects[idx] = { ...store.projects[idx], share_token: token };
        renderShareBox(box, { ...p, share_token: token });
        toast("New link created, the old one is dead", "success");
      },
    });
  });
  actions.appendChild(newBtn);
}

function renderChecklist(box, projectId) {
  const wrap = box.querySelector("#pj-checklist");
  if (!wrap) return;
  const tasks = store.projectTasks.filter((t) => t.project_id === projectId).sort((a, b) => a.sort_order - b.sort_order);

  if (!tasks.length) {
    wrap.innerHTML = `<div class="text-faint" style="font-size:12.5px;">No checklist items yet. Add the first deliverable below.</div>`;
    return;
  }

  wrap.innerHTML = "";
  tasks.forEach((task) => {
    // "Hide"/"Show" controls whether this line appears on the client's page.
    // It exists so the checklist can stay honest: without it the team has to
    // choose between writing a real task ("chase them for the logo, third
    // time") and being able to share the project at all — and given that
    // choice people write vague tasks, which makes the checklist worse for
    // everyone including the team.
    const row = el(`
      <div class="task-row ${task.done ? "done" : ""}">
        <div class="task-check ${task.done ? "done" : ""}" data-toggle>
          ${task.done ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="m5 13 4 4L19 7"/></svg>' : ""}
        </div>
        <div class="task-label" style="flex:1;">
          ${esc(task.title)}
          ${task.internal ? `<span class="text-faint" style="font-size:10.5px;margin-left:6px;">hidden from client</span>` : ""}
        </div>
        <span class="small-link" data-internal style="margin-right:10px;">${task.internal ? "Show" : "Hide"}</span>
        <span class="small-link" data-remove>Remove</span>
      </div>
    `);
    row.querySelector("[data-toggle]").addEventListener("click", async () => {
      const { error } = await sb.from("project_tasks").update({ done: !task.done }).eq("id", task.id);
      if (error) toast(error.message, "error");
    });
    row.querySelector("[data-internal]").addEventListener("click", async () => {
      const { error } = await sb.from("project_tasks").update({ internal: !task.internal }).eq("id", task.id);
      if (error) return toast(error.message, "error");
      toast(task.internal ? "Now visible to the client" : "Hidden from the client", "success");
      // The share box counts visible vs hidden items, so it has to redraw too.
      const project = currentProject(projectId);
      if (project) renderShareBox(box, project);
    });
    row.querySelector("[data-remove]").addEventListener("click", async () => {
      const { error } = await sb.from("project_tasks").delete().eq("id", task.id);
      if (error) toast(error.message, "error");
    });
    wrap.appendChild(row);
  });
}

function openNewProjectSheet(prospect) {
  const box = el(`
    <div>
      <div class="field">
        <label>Project name *</label>
        <input id="npj-name" type="text" placeholder="e.g. Onboarding: WestProp" />
      </div>
      <div class="field">
        <label>Linked prospect</label>
        <select id="npj-prospect">
          <option value="">No prospect linked</option>
          ${store.prospects
            .slice()
            .sort((a, b) => a.business_name.localeCompare(b.business_name))
            .map((p) => `<option value="${p.id}" ${prospect?.id === p.id ? "selected" : ""}>${esc(p.business_name)}</option>`)
            .join("")}
        </select>
      </div>
      <div class="field">
        <label>Due date</label>
        <input id="npj-due" type="date" />
      </div>
      <button class="btn btn-primary" id="npj-save" style="margin-top:6px;">Create Project</button>
    </div>
  `);
  box.querySelector("#npj-save").addEventListener("click", async () => {
    const name = box.querySelector("#npj-name").value.trim();
    if (!name) return toast("Project name is required", "error");
    const payload = {
      name,
      prospect_id: box.querySelector("#npj-prospect").value || null,
      due_date: box.querySelector("#npj-due").value || null,
      created_by: store.profile.id,
    };
    const { error } = await sb.from("projects").insert(payload);
    if (error) return toast(error.message, "error");
    toast("Project created", "success");
    closeSheet();
  });
  openSheet("New Project", box);
}

export { openNewProjectSheet, openProjectDetail };

export function initProjectsView() {
  on("projects", () => { if (isActive()) renderProjects(); });
  on("projectTasks", () => { if (isActive()) renderProjects(); });
  on("prospects", () => { if (isActive()) renderProjects(); });
}
function isActive() {
  return document.getElementById("view-projects")?.classList.contains("active");
}
