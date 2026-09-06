import { sb, CONFIGURED } from "./supabaseClient.js";
import { store, on, loadAll, startRealtime, refreshProspects } from "./state.js";
import { initAuthScreen, loadOwnProfile } from "./auth.js";
import { initGlobalUI, openSheet, closeSheet, openModal, closeModal } from "./ui.js";
import { el, esc, fmtDate, withTimeout, avatarHTML } from "./utils.js";
import { initGlobalSearch } from "./globalSearch.js";
import { initTheme, toggleTheme } from "./theme.js";
import { initSidebarCollapse, toggleSidebarCollapsed, isSidebarCollapsed } from "./sidebar.js";
import { initOutbox, outboxCount, onOutboxChange, flushOutbox } from "./outbox.js";

import { renderPipeline, initPipelineView, openAddProspectSheet } from "./views/pipeline.js";
import { renderDiscovery, initDiscoveryView } from "./views/discovery.js";
import { renderCopilot } from "./views/copilot.js";
import { openProspectDetail } from "./views/prospectDetail.js";
import { renderDashboard, initDashboardView } from "./views/dashboard.js";
import { renderNiches, initNichesView } from "./views/niches.js";
import { renderMessages, initMessagesView } from "./views/messages.js";
import { renderTasks, initTasksView } from "./views/tasks.js";
import { renderActivity, initActivityView } from "./views/activity.js";
import { renderTeam, initTeamView } from "./views/team.js";
import { openOnboardingWizard } from "./views/onboarding.js";
import { renderPipelineValue, initPipelineValueView } from "./views/pipelineValue.js";
import { openDealPricingCalculator } from "./views/dealPricing.js";
import { openInstallAppSheet } from "./views/installApp.js";
import { renderContracts, initContractsView } from "./views/contracts.js";
import { renderInvoices, initInvoicesView } from "./views/invoices.js";
import { renderProjects, initProjectsView } from "./views/projects.js";
import { renderGridPlans, initGridPlansView, leaveGridPlansView } from "./views/gridPlans.js";
import { renderServices, initServicesView } from "./views/services.js";
import { renderPortfolio, initPortfolioView } from "./views/portfolio.js";
import { renderCommunity, initCommunityView } from "./views/community.js";
import { renderEmpire, initEmpireView } from "./views/empire.js";
import { renderPitchPractice, refreshPitchPractice } from "./views/pitchPractice.js";

const VIEWS = {
  pipeline: renderPipeline,
  discovery: renderDiscovery,
  copilot: renderCopilot,
  empire: renderEmpire,
  dashboard: renderDashboard,
  tasks: renderTasks,
  messages: renderMessages,
  niches: renderNiches,
  activity: renderActivity,
  team: renderTeam,
  pipelinevalue: renderPipelineValue,
  contracts: renderContracts,
  invoices: renderInvoices,
  projects: renderProjects,
  gridplans: renderGridPlans,
  services: renderServices,
  portfolio: renderPortfolio,
  community: renderCommunity,
  pitch: renderPitchPractice,
};
const PRIMARY_TABS = ["dashboard", "pipeline", "tasks", "empire", "messages"];
let currentView = "dashboard";

export function switchView(name) {
  // Grid Plans opens a per-plan Realtime channel (presence + broadcast) the
  // moment a plan is opened in the builder — renderGridPlans() itself tears
  // that down when going back to the plan list, but not if the user jumps
  // straight to some other tab/sidebar link with a plan still open, which
  // would otherwise leave that channel (and its presence heartbeat) running
  // in the background indefinitely.
  if (name !== "gridplans") leaveGridPlansView();
  currentView = name;
  Object.keys(VIEWS).forEach((k) => {
    document.getElementById("view-" + k)?.classList.toggle("active", k === name);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const isMore = btn.dataset.view === "more";
    const matches = PRIMARY_TABS.includes(name) ? btn.dataset.view === name : isMore;
    btn.classList.toggle("active", matches);
  });
  document.querySelectorAll(".sidebar-link[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  // Name the page in the desktop top bar. The text is read straight off the
  // matching sidebar link rather than kept in a second list here, so renaming
  // a nav item in app.html renames it in both places at once and the two can
  // never quietly disagree about what a page is called.
  const pageEl = document.getElementById("topbar-page");
  if (pageEl) {
    const link = document.querySelector(`.sidebar-link[data-view="${name}"] .sidebar-label`);
    pageEl.textContent = link ? link.textContent.trim() : "";
  }
  // The floating "+" only makes sense where it's unambiguous what it adds.
  // It used to float over every single view (Dashboard, Messages, Team,
  // Settings, ...) which made it feel like a stray button rather than a
  // clear "add a prospect" action — so it's now shown only on the Pipeline
  // view (the "Prospects" list), where tapping it obviously means "add one
  // here."
  document.getElementById("fab-add")?.classList.toggle("show", name === "pipeline");
  VIEWS[name]?.();
  window.scrollTo(0, 0);
}

function openMoreMenu() {
  const box = el(`
    <div>
      <div class="task-row" data-go="copilot" style="cursor:pointer;">
        <div class="icon-badge sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 0-7 7c0 2.4 1.2 4.5 3 5.7V17h8v-2.3c1.8-1.2 3-3.3 3-5.7a7 7 0 0 0-7-7Z"/><path d="M9 21h6M10 17v2M14 17v2"/></svg></div>
        <div class="task-label">Copilot</div>
      </div>
      <div class="task-row" data-go="discovery" style="cursor:pointer;">
        <div class="icon-badge sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></div>
        <div class="task-label">Discovery</div>
      </div>
      <div class="task-row" data-go="niches" style="cursor:pointer;">
        <div class="icon-badge sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg></div>
        <div class="task-label">Niche Strategy Matrix</div>
      </div>
      <div class="task-row" data-go="pipelinevalue" style="cursor:pointer;">
        <div class="icon-badge sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8M15 7h6v6"/></svg></div>
        <div class="task-label">Pipeline Value Calculator</div>
      </div>
      <div class="task-row" id="more-deal-pricing" style="cursor:pointer;">
        <div class="icon-badge sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 12h2M12 12h2M16 12h2M8 16h2M12 16h2M16 16h2"/></svg></div>
        <div class="task-label">Deal Pricing Calculator</div>
      </div>
      <div class="task-row" data-go="contracts" style="cursor:pointer;">
        <div class="icon-badge sm gold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M9 12h6M9 16h6M9 8h2"/></svg></div>
        <div class="task-label">Contracts</div>
      </div>
      <div class="task-row" data-go="invoices" style="cursor:pointer;">
        <div class="icon-badge sm gold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg></div>
        <div class="task-label">Invoices</div>
      </div>
      <div class="task-row" data-go="projects" style="cursor:pointer;">
        <div class="icon-badge sm gold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg></div>
        <div class="task-label">Projects</div>
      </div>
      <div class="task-row" data-go="gridplans" style="cursor:pointer;">
        <div class="icon-badge sm gold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></div>
        <div class="task-label">Grid Plans</div>
      </div>
      <div class="task-row" data-go="services" style="cursor:pointer;">
        <div class="icon-badge sm gold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Z"/><path d="M10 5h4v2h-4z"/></svg></div>
        <div class="task-label">Services &amp; Packages</div>
      </div>
      <div class="task-row" data-go="portfolio" style="cursor:pointer;">
        <div class="icon-badge sm gold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="m3 15 4.5-4.5a2 2 0 0 1 2.8 0L15 15M13 13l2-2a2 2 0 0 1 2.8 0L21 14"/><circle cx="8" cy="8.5" r="1.3"/></svg></div>
        <div class="task-label">Portfolio Studio</div>
      </div>
      <div class="task-row" data-go="pitch" style="cursor:pointer;">
        <div class="icon-badge sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3.5 8.5 12 4l8.5 4.5L12 13 3.5 8.5Z"/><path d="M20.5 8.5v5"/><path d="M7 10.7v4.1c0 1.6 2.2 2.9 5 2.9s5-1.3 5-2.9v-4.1"/></svg></div>
        <div class="task-label">Pitch Practice</div>
      </div>
      <div class="task-row" data-go="community" style="cursor:pointer;">
        <div class="icon-badge sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></div>
        <div class="task-label">Community Feed</div>
      </div>
      <div class="task-row" data-go="activity" style="cursor:pointer;">
        <div class="icon-badge sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg></div>
        <div class="task-label">Team Activity Feed</div>
      </div>
      <div class="task-row" data-go="team" style="cursor:pointer;">
        <div class="icon-badge sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.4"/><path d="M2.5 20.5c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6"/><path d="M16 4.6c1.6.5 2.8 2 2.8 3.8s-1.2 3.3-2.8 3.8"/><path d="M17.5 14.7c2.6.6 4.5 2.7 4.5 5.3"/></svg></div>
        <div class="task-label">Team &amp; Settings</div>
      </div>
      <div class="task-row" id="more-install-app" style="cursor:pointer;">
        <div class="icon-badge sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg></div>
        <div class="task-label">Get the App</div>
      </div>
      <div class="task-row" id="more-shortcuts" style="cursor:pointer;">
        <div class="icon-badge sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/></svg></div>
        <div class="task-label">Keyboard Shortcuts</div>
      </div>
    </div>
  `);
  box.querySelectorAll("[data-go]").forEach((row) => {
    row.addEventListener("click", () => {
      closeSheet();
      switchView(row.dataset.go);
    });
  });
  box.querySelector("#more-deal-pricing").addEventListener("click", () => {
    closeSheet();
    openDealPricingCalculator();
  });
  box.querySelector("#more-install-app").addEventListener("click", () => {
    closeSheet();
    openInstallAppSheet();
  });
  box.querySelector("#more-shortcuts").addEventListener("click", () => {
    closeSheet();
    openShortcutsHelp();
  });
  openSheet("More", box);
}

function dueTodayList() {
  const today = new Date().toISOString().slice(0, 10);
  const isOwner = store.profile?.role === "owner";
  return store.prospects.filter((p) => {
    if (!p.follow_up_date || p.follow_up_date > today) return false;
    if (["signed", "dead"].includes(p.status)) return false;
    if (isOwner) return true;
    return p.assigned_to === store.profile?.id;
  });
}

function refreshDueBadge() {
  const due = dueTodayList();
  const badge = document.getElementById("due-badge");
  if (!badge) return;
  if (due.length > 0) { badge.style.display = "flex"; badge.textContent = due.length > 9 ? "9+" : due.length; }
  else badge.style.display = "none";
}

function openDueToday() {
  const due = dueTodayList();
  const box = el(`<div></div>`);
  if (!due.length) {
    box.innerHTML = `<div class="empty-state"><p>Nothing due today. Nice work staying ahead.</p></div>`;
  } else {
    due.forEach((p) => {
      const row = el(`
        <div class="prospect-card tier-${p.tier}" style="margin-bottom:9px;cursor:pointer;">
          <div class="prospect-top">
            <div>
              <div class="prospect-name">${esc(p.business_name)}</div>
              <div class="prospect-meta">Follow up was due ${fmtDate(p.follow_up_date)}</div>
            </div>
            <span class="status-pill ${p.status}">${p.status.replace("_", " ")}</span>
          </div>
        </div>
      `);
      row.addEventListener("click", () => { closeSheet(); openProspectDetail(p); });
      box.appendChild(row);
    });
  }
  openSheet("Due Today", box);
}

const SHORTCUT_KEYS = [
  ["/", "Focus search"],
  ["n", "Add new prospect"],
  ["1", "Go to Dashboard"],
  ["2", "Go to Pipeline"],
  ["3", "Go to Missions"],
  ["4", "Go to Message Kit"],
  ["Esc", "Close sheet / modal"],
  ["?", "Show this list"],
];

function isTypingContext() {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active.isContentEditable;
}

function isOverlayOpen() {
  return document.getElementById("sheet")?.classList.contains("open") || document.getElementById("modal-backdrop")?.classList.contains("open");
}

function openShortcutsHelp() {
  const box = el(`
    <div>
      ${SHORTCUT_KEYS.map(([key, desc]) => `
        <div class="flex-between" style="padding:7px 0;border-bottom:1px solid var(--line);">
          <span style="font-size:13px;">${esc(desc)}</span>
          <kbd style="background:rgba(255,255,255,0.08);border-radius:5px;padding:2px 8px;font-size:12px;font-family:inherit;">${esc(key)}</kbd>
        </div>`).join("")}
      <div class="text-faint" style="font-size:11px;margin-top:10px;">Only active on a physical keyboard, and never while you're typing in a field.</div>
    </div>
  `);
  openModal(box);
}

// Desktop power-user shortcuts. Deliberately ignores anything typed while
// focused in a form field (isTypingContext) so it never hijacks normal
// typing, and skips the single-key nav shortcuts (but not Escape/Cmd+K)
// while a sheet or modal is already open so "n" inside a text field someone
// forgot to click into doesn't fire a second sheet on top of the first.
function initKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      document.getElementById("global-search-input")?.focus();
      return;
    }
    if (e.key === "Escape") {
      closeSheet();
      closeModal();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || isTypingContext() || isOverlayOpen()) return;

    switch (e.key) {
      case "/":
        e.preventDefault();
        document.getElementById("global-search-input")?.focus();
        break;
      case "n":
        openAddProspectSheet();
        break;
      case "1": switchView("dashboard"); break;
      case "2": switchView("pipeline"); break;
      case "3": switchView("tasks"); break;
      case "4": switchView("messages"); break;
      case "?":
        openShortcutsHelp();
        break;
    }
  });
}

// Keeps the toggle button's tooltip/label matching its actual effect —
// "Minimize" when the sidebar is currently full-width, "Expand" once it's
// already collapsed to icons.
function syncSidebarToggleTitle(btn) {
  btn.title = isSidebarCollapsed() ? "Expand sidebar" : "Minimize sidebar";
}

function wireChrome() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.view === "more") openMoreMenu();
      else switchView(btn.dataset.view);
    });
  });
  document.getElementById("btn-profile").addEventListener("click", openMoreMenu);
  document.getElementById("btn-due").addEventListener("click", openDueToday);
  document.getElementById("btn-theme").addEventListener("click", toggleTheme);
  document.getElementById("fab-add").addEventListener("click", openAddProspectSheet);

  document.querySelectorAll(".sidebar-link[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  document.getElementById("sidebar-deal-pricing").addEventListener("click", openDealPricingCalculator);
  document.getElementById("sidebar-foot").addEventListener("click", () => switchView("team"));

  const sidebarToggleBtn = document.getElementById("sidebar-toggle");
  syncSidebarToggleTitle(sidebarToggleBtn);
  sidebarToggleBtn.addEventListener("click", () => {
    toggleSidebarCollapsed();
    syncSidebarToggleTitle(sidebarToggleBtn);
  });

  on("prospects", refreshDueBadge);
  on("prospects", refreshSidebarDueBadge);
  on("profile", renderSidebarUser);
  on("organization", renderOrgBrand);
  renderSidebarUser();
  refreshSidebarDueBadge();
  renderOrgBrand();

  initGlobalSearch();
  initKeyboardShortcuts();
}

// The sidebar/topbar brand mark ships with a static "HARARE OUTREACH"
// placeholder in the HTML (Studio X's own agency). Once store.organization
// loads, swap it for the signed-in user's actual agency name so every
// tenant sees their own branding instead of Studio X's.
function renderOrgBrand() {
  const name = (store.organization?.name || "").trim();
  if (!name) return;
  const label = name.toUpperCase();
  const sidebarEl = document.getElementById("sidebar-org-name");
  const topbarEl = document.getElementById("topbar-org-name");
  if (sidebarEl) sidebarEl.textContent = label;
  if (topbarEl) topbarEl.textContent = label;
}

// Keeps the sidebar's profile chip (avatar, name, role) in sync with
// store.profile — same source the Team view reads from, just mirrored here
// since the sidebar is always on screen at desktop widths.
function renderSidebarUser() {
  const p = store.profile;
  if (!p) return;
  const avatarSlot = document.getElementById("sidebar-avatar-slot");
  const nameEl = document.getElementById("sidebar-user-name");
  const roleEl = document.getElementById("sidebar-user-role");
  if (avatarSlot) {
    avatarSlot.innerHTML = avatarHTML(p.full_name || p.email, p.avatar_url, 32, 12);
  }
  if (nameEl) nameEl.textContent = p.full_name || p.email || "";
  if (roleEl) roleEl.textContent = p.role || "";
}

// Mirrors refreshDueBadge() onto the sidebar's own badge dot, since the
// topbar's due-today bell is de-emphasized once the sidebar is in charge
// of primary navigation at desktop widths.
function refreshSidebarDueBadge() {
  const due = dueTodayList();
  const badge = document.getElementById("sidebar-due-badge");
  if (!badge) return;
  if (due.length > 0) { badge.style.display = "inline-flex"; badge.textContent = due.length > 9 ? "9+" : due.length; }
  else badge.style.display = "none";
}

// The strip under the top bar. It has two separate jobs now, and which one it
// does depends on whether there is anything waiting in the outbox:
//
//   Nothing waiting, no connection — the original message. You can look, and
//   what you're looking at is as fresh as the last time there was signal.
//
//   Something waiting — say so, and keep saying so even after the connection
//   comes back, until it has actually gone. That second part is the important
//   one: the gap between "the phone thinks it has data again" and "the edits
//   have genuinely reached the server" is where the doubt lives, and it is
//   exactly the moment someone would otherwise close the app believing their
//   work was saved.
//
// Tapping it while something is queued tries again straight away, so a rep
// who can see a number sitting there is not stuck waiting on the retry timer.
function setOfflineBanner() {
  const banner = document.getElementById("offline-banner");
  if (!banner) return;
  const waiting = outboxCount();

  if (waiting > 0) {
    const thing = waiting === 1 ? "change" : "changes";
    banner.textContent = navigator.onLine
      ? `Sending ${waiting} ${thing}…`
      : `Offline — ${waiting} ${thing} saved on this phone, will send when you're back online`;
    banner.classList.add("show");
    // "Sending…" is progress, not a problem, so it drops the warning amber
    // and goes purple. Still offline with work queued keeps the amber.
    banner.classList.toggle("sending", navigator.onLine);
  } else {
    banner.textContent = "You're offline, showing the last synced data";
    banner.classList.remove("sending");
    banner.classList.toggle("show", !navigator.onLine);
  }
}

// Safety net for missed Realtime events. Phones suspend the websocket
// whenever the app is backgrounded or the screen locks — Supabase's client
// reconnects on its own (see the SUBSCRIBED handler in state.js), but this
// covers the same ground from the browser's own lifecycle signals too, so a
// prospect a teammate added while you were away shows up the moment you
// come back, without needing a manual reload.
let lastResync = 0;
function resync() {
  if (!store.profile) return;
  const now = Date.now();
  if (now - lastResync < 3000) return; // avoid duplicate bursts (e.g. online + visible firing together)
  lastResync = now;
  refreshProspects();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") resync();
});

// How long we'll wait on any single boot-time network step (checking the
// session, loading the profile, loading the pipeline data) before giving up
// and showing a retry screen. Without this, a stalled request on a flaky
// mobile-data connection has NO error and NO timeout of its own — it just
// hangs forever, which is what left people stuck on the loading spinner
// indefinitely on cellular even though the exact same steps work fine on
// WiFi (where requests rarely stall for this long).
const BOOT_TIMEOUT_MS = 20000;

async function bootApp() {
  initTheme();
  initSidebarCollapse();
  initGlobalUI();

  if (!CONFIGURED) {
    document.getElementById("boot-loading").innerHTML = `
      <div style="padding:30px;text-align:center;max-width:340px;">
        <div style="font-weight:800;font-size:16px;margin-bottom:8px;">Almost there</div>
        <div class="text-faint" style="font-size:13px;line-height:1.5;">
          This app hasn't been connected to your Supabase database yet.
          Open <b>js/config.js</b> and paste in your Project URL and anon key,
          then reload.
        </div>
      </div>`;
    return;
  }

  window.addEventListener("online", () => { setOfflineBanner(); resync(); });
  window.addEventListener("offline", setOfflineBanner);
  onOutboxChange(setOfflineBanner);
  const banner = document.getElementById("offline-banner");
  if (banner) banner.addEventListener("click", () => { if (outboxCount()) flushOutbox(); });
  initOutbox();
  setOfflineBanner();

  try {
    const { data: { session } } = await withTimeout(sb.auth.getSession(), BOOT_TIMEOUT_MS, "Sign-in check");
    if (session) await enterApp(session);
    else showAuthScreen();
  } catch (err) {
    console.error("bootApp: getSession failed", err);
    showBootError("Couldn't reach the server. Check your connection and try again.");
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN") await enterApp(session);
    if (event === "SIGNED_OUT") location.reload();
  });
}

function showAuthScreen() {
  document.getElementById("boot-loading").style.display = "none";
  // "block", not "flex" — .auth-wrap (this element's class) has no flex
  // styling of its own; .auth-shell (its child) is what does the row/column
  // split-screen layout. Toggling *this* wrapper to display:flex turns it
  // into an unintended row-flex container, and a flex item with no
  // flex-grow shrinks to its content width instead of filling the screen —
  // that's what was leaving a dead strip of black down the right edge of
  // the sign-in screen on wide/desktop windows. "block" lets .auth-shell
  // fill 100% of the wrapper's width the normal way.
  document.getElementById("auth-screen").style.display = "block";
  document.getElementById("app-shell").style.display = "none";
  initAuthScreen();
}

// Replaces the boot spinner with a plain-language message and a button that
// reloads the page. Used any time a boot-time network step times out or
// errors, so the app never leaves someone stuck staring at a spinner with
// no way forward except force-quitting.
function showBootError(message) {
  const box = document.getElementById("boot-loading");
  box.innerHTML = `
    <div style="padding:30px;text-align:center;max-width:340px;">
      <div style="font-weight:800;font-size:16px;margin-bottom:8px;">Connection trouble</div>
      <div class="text-faint" style="font-size:13px;line-height:1.5;margin-bottom:18px;">${esc(message)}</div>
      <button class="btn btn-primary" id="boot-retry" style="width:auto;padding:10px 24px;">Try Again</button>
    </div>`;
  box.style.display = "flex";
  document.getElementById("boot-retry").addEventListener("click", () => location.reload());
}

async function enterApp(session) {
  document.getElementById("boot-loading").style.display = "flex";
  document.getElementById("auth-screen").style.display = "none";

  try {
    let profile = await withTimeout(loadOwnProfile(session.user.id), BOOT_TIMEOUT_MS, "Profile load");
    let tries = 0;
    while (!profile && tries < 5) {
      await new Promise((r) => setTimeout(r, 400));
      profile = await withTimeout(loadOwnProfile(session.user.id), BOOT_TIMEOUT_MS, "Profile load");
      tries++;
    }
    if (!profile) {
      showBootError("Couldn't load your profile. Check your connection and try again.");
      return;
    }

    await withTimeout(loadAll(), BOOT_TIMEOUT_MS, "Pipeline data load");
    startRealtime();
    wireChrome();

    initPipelineView();
    initDiscoveryView();
    initDashboardView();
    initNichesView();
    initMessagesView();
    initTasksView();
    initActivityView();
    initTeamView();
    initPipelineValueView();
    initContractsView();
    initInvoicesView();
    initProjectsView();
    initGridPlansView();
    initServicesView();
    initPortfolioView();
    initCommunityView();
    initEmpireView();
    // Pitch Practice loads its own deck lazily the first time the tab is
    // opened (it isn't part of the main loadAll() payload, since most sessions
    // never open it). This just clears anything left from a previous account
    // in the same tab so a new sign-in never sees the last person's cards.
    refreshPitchPractice();

    document.getElementById("boot-loading").style.display = "none";
    document.getElementById("app-shell").style.display = "block";
    switchView("dashboard");
    refreshDueBadge();

    // One-shot flag set in auth.js right before signUp() — see the comment
    // there. Consumed (removed) immediately so a page reload straight after
    // signing up, or a later ordinary sign-in in the same tab, never shows
    // this twice.
    if (sessionStorage.getItem("sxc_just_signed_up") === "1") {
      sessionStorage.removeItem("sxc_just_signed_up");
      openOnboardingWizard();
    }
  } catch (err) {
    console.error("enterApp failed", err);
    showBootError("Couldn't load your data. Check your connection and try again.");
  }
}

bootApp();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
