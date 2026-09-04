import { sb, CONFIGURED } from "./supabaseClient.js";
import { store, on, loadAll, startRealtime, refreshProspects } from "./state.js";
import { initAuthScreen, loadOwnProfile } from "./auth.js";
import { initGlobalUI, openSheet, closeSheet, openModal, closeModal } from "./ui.js";
import { el, esc, fmtDate, withTimeout, avatarHTML } from "./utils.js";
import { initGlobalSearch } from "./globalSearch.js";
import { initTheme, toggleTheme } from "./theme.js";

import { renderPipeline, initPipelineView, openAddProspectSheet } from "./views/pipeline.js";
import { openProspectDetail } from "./views/prospectDetail.js";
import { renderDashboard, initDashboardView } from "./views/dashboard.js";
import { renderNiches, initNichesView } from "./views/niches.js";
import { renderMessages, initMessagesView } from "./views/messages.js";
import { renderTasks, initTasksView } from "./views/tasks.js";
import { renderActivity, initActivityView } from "./views/activity.js";
import { renderTeam, initTeamView } from "./views/team.js";
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

const VIEWS = {
  pipeline: renderPipeline,
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
};
const PRIMARY_TABS = ["dashboard", "pipeline", "tasks", "messages"];
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
  VIEWS[name]?.();
  window.scrollTo(0, 0);
}

function openMoreMenu() {
  const box = el(`
    <div>
      <div class="task-row" data-go="niches" style="cursor:pointer;">
        <div class="task-label">Niche Strategy Matrix</div>
      </div>
      <div class="task-row" data-go="pipelinevalue" style="cursor:pointer;">
        <div class="task-label">Pipeline Value Calculator</div>
      </div>
      <div class="task-row" id="more-deal-pricing" style="cursor:pointer;">
        <div class="task-label">Deal Pricing Calculator</div>
      </div>
      <div class="task-row" data-go="contracts" style="cursor:pointer;">
        <div class="task-label">Contracts</div>
      </div>
      <div class="task-row" data-go="invoices" style="cursor:pointer;">
        <div class="task-label">Invoices</div>
      </div>
      <div class="task-row" data-go="projects" style="cursor:pointer;">
        <div class="task-label">Projects</div>
      </div>
      <div class="task-row" data-go="gridplans" style="cursor:pointer;">
        <div class="task-label">Grid Plans</div>
      </div>
      <div class="task-row" data-go="services" style="cursor:pointer;">
        <div class="task-label">Services &amp; Packages</div>
      </div>
      <div class="task-row" data-go="portfolio" style="cursor:pointer;">
        <div class="task-label">Portfolio Studio</div>
      </div>
      <div class="task-row" data-go="community" style="cursor:pointer;">
        <div class="task-label">Community Feed</div>
      </div>
      <div class="task-row" data-go="activity" style="cursor:pointer;">
        <div class="task-label">Team Activity Feed</div>
      </div>
      <div class="task-row" data-go="team" style="cursor:pointer;">
        <div class="task-label">Team &amp; Settings</div>
      </div>
      <div class="task-row" id="more-install-app" style="cursor:pointer;">
        <div class="task-label">📲 Get the App</div>
      </div>
      <div class="task-row" id="more-shortcuts" style="cursor:pointer;">
        <div class="task-label">⌨️ Keyboard Shortcuts</div>
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
  ["3", "Go to Daily Plan"],
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

function setOfflineBanner() {
  const banner = document.getElementById("offline-banner");
  if (!banner) return;
  banner.classList.toggle("show", !navigator.onLine);
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
  document.getElementById("auth-screen").style.display = "flex";
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

    document.getElementById("boot-loading").style.display = "none";
    document.getElementById("app-shell").style.display = "block";
    switchView("dashboard");
    refreshDueBadge();
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
