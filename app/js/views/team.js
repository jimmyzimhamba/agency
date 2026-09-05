import { sb } from "../supabaseClient.js";
import { store, on, emit, profileById } from "../state.js";
import { el, esc, avatarHTML, timeAgo, money } from "../utils.js";
import { toast } from "../utils.js";
import { signOut } from "../auth.js";
import { confirmModal, openModal, closeModal } from "../ui.js";
import { pushSupported, isPushEnabled, enablePush, disablePush } from "../push.js";
import { getTheme, setTheme } from "../theme.js";
import { BADGES } from "../badges.js";

// The team roster showed everyone's role but nothing about whether they're
// actually working the pipeline right now — an owner had to open Activity
// and filter per-person, one at a time, to find out who's gone quiet.
// activityLog is already loaded org-wide (readable under RLS for every
// role, same as dashboard.js relies on) and newest-first, so the first row
// matching a given actor_id is that person's most recent action.
const INACTIVE_DAYS = 3;

// Shown under a teammate's role picker once they're set to one of the new
// grid-plan-specific roles, so the owner can see at a glance what that role
// actually unlocks without having to go look it up. "Agent" and "Owner"
// keep their existing full-access meaning everywhere else in the app, so
// they don't need a hint here.
const GRID_ROLE_HINTS = {
  manager: "Full access to Grid Plan Review, same as Agent — can build plans and send them to clients.",
  designer: "Can edit grid plans (captions, media, reorder) but can't send a plan to a client.",
  contributor: "View-only on Grid Plan Review — can't edit or send plans.",
};
function lastActivityFor(profileId) {
  return store.activityLog.find((a) => a.actor_id === profileId)?.created_at || null;
}
function daysSinceActivity(iso) {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// Every existing performance surface is either time-boxed (Monthly
// Leaderboard — this month's signed count only, no revenue) or capacity-only
// (Team Workload — owner-only, active-lead count only, no win rate/MRR).
// Nothing answers "what have I actually closed, ever, and how good is my
// hit rate" for an individual — this is that durable, personal number.
// Win rate is signed ÷ everyone actually engaged past Not Contacted, since
// leads never touched aren't a fair denominator for a "hit rate."
// agentId defaults to the logged-in user (self view), but accepts any
// profile id so an owner can pull the same numbers for a teammate — see
// openTeammatePerformanceModal below.
function myPerformanceStats(agentId = store.profile?.id) {
  const mine = store.prospects.filter((p) => p.assigned_to === agentId);
  const signed = mine.filter((p) => p.status === "signed");
  const engaged = mine.filter((p) => p.status !== "not_contacted");
  const mrr = signed.reduce((s, p) => s + (Number(p.mrr) || 0), 0);
  const winRate = engaged.length ? Math.round((signed.length / engaged.length) * 100) : 0;
  // Reply rate isolates the *outreach* step from the *closing* step: of
  // everyone actually contacted, how many replied or moved further, vs.
  // sitting unanswered? Win rate alone conflates the two — an agent with a
  // low win rate but a high reply rate needs closing coaching, one with a
  // low reply rate needs messaging/targeting help. Same denominator as
  // winRate (engaged), different numerator.
  const repliedOrBeyond = mine.filter((p) => ["replied", "meeting_booked", "signed"].includes(p.status));
  const replyRate = engaged.length ? Math.round((repliedOrBeyond.length / engaged.length) * 100) : 0;
  return {
    active: mine.filter((p) => !["signed", "dead"].includes(p.status)).length,
    signedCount: signed.length,
    mrr,
    winRate,
    replyRate,
    signedList: signed,
  };
}

// Owner-only drill-down from a teammate's roster card: "My Performance"
// above only ever shows the logged-in user their own numbers, and Team
// Workload on the Dashboard (a separate, owner-only widget) only shows a
// raw active-lead count per agent — no signed count, MRR, win rate, or
// reply rate. This reuses myPerformanceStats() (now agent-id-aware) to give
// an owner the same breakdown for anyone else on the team.
function openTeammatePerformanceModal(profile) {
  const perf = myPerformanceStats(profile.id);
  const box = el(`
    <div>
      <div class="section-title mt-0">${esc(profile.full_name || profile.email)}'s Performance</div>
      <div class="stat-grid" style="margin-bottom:16px;" id="tm-teammate-perf"></div>
    </div>
  `);
  const grid = box.querySelector("#tm-teammate-perf");
  grid.innerHTML = `
    <div class="stat-card"><div class="num">${perf.active}</div><div class="label">Active Leads</div></div>
    <div class="stat-card accent" id="tm-teammate-signed-card" style="cursor:pointer;"><div class="num">${perf.signedCount}</div><div class="label">Signed (All-Time)</div></div>
    <div class="stat-card purple" id="tm-teammate-mrr-card" style="cursor:pointer;"><div class="num">${money(perf.mrr)}</div><div class="label">MRR Won</div></div>
    <div class="stat-card"><div class="num">${perf.winRate}%</div><div class="label">Win Rate</div></div>
    <div class="stat-card"><div class="num">${perf.replyRate}%</div><div class="label">Reply Rate</div></div>
  `;
  grid.querySelector("#tm-teammate-signed-card").addEventListener("click", () => openMySignedModal(perf.signedList));
  grid.querySelector("#tm-teammate-mrr-card").addEventListener("click", () => openMySignedModal(perf.signedList));
  openModal(box);
}

// All-time point total for one person, from the points_totals DB view (see
// supabase/migration_points.sql) — never computed by summing pointsLog
// client-side, since that list is capped to the last 200 org-wide events
// and would silently under-count a very active team.
function totalPointsFor(profileId) {
  return store.pointsTotals.find((t) => t.profile_id === profileId)?.total_points || 0;
}

// Tap a name on the points leaderboard (or your own Points stat card) to
// see WHY — a plain list of recent point-earning events, newest first.
// Pulled from the same capped, org-wide pointsLog the store already keeps
// in memory (no extra query) — on a very active team someone's older events
// may have scrolled out of that shared window, but the TOTAL shown at the
// top is always exact regardless, straight from points_totals.
function openPointsBreakdownModal(profile, total) {
  const events = store.pointsLog.filter((e) => e.profile_id === profile.id).slice(0, 20);
  const box = el(`
    <div>
      <div class="section-title mt-0">${esc(profile.full_name || profile.email)}'s Points</div>
      <div class="stat-card accent" style="margin-bottom:16px;"><div class="num">${total}</div><div class="label">Total Points</div></div>
      <div class="section-title mt-0" style="font-size:11px;">Badges</div>
      <div class="badges-grid" id="tm-modal-badges-grid" style="margin-bottom:6px;"></div>
      <div id="tm-points-events"></div>
    </div>
  `);
  renderBadgesGrid(box.querySelector("#tm-modal-badges-grid"), profile.id);
  const listEl = box.querySelector("#tm-points-events");
  if (!events.length) {
    listEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;padding:10px 0;">No recent events to show.</div>`;
  } else {
    events.forEach((e) => {
      listEl.appendChild(el(`
        <div class="card" style="margin-bottom:8px;">
          <div class="flex-between">
            <span style="font-size:13px;">${esc(e.reason)}</span>
            <span class="text-gold" style="font-size:12px;font-weight:700;">+${e.points}</span>
          </div>
          <div class="text-faint" style="font-size:10.5px;margin-top:2px;">${timeAgo(e.created_at)}</div>
        </div>
      `));
    });
  }
  openModal(box);
}

// Everyone-visible leaderboard — deliberately separate from the MRR-based
// "Team Leaderboard" below, which stays owner-only since it's revenue.
// Points reward the DOING of the work (adding a prospect, a follow-up
// landing, finishing daily tasks) rather than only who happened to close
// the one big deal this month, so a consistent grinder shows up here even
// on a month they don't personally sign anything. Ranked purely by
// all-time total_points — no revenue involved anywhere in this section.
function renderPointsLeaderboard(wrap) {
  const box = wrap.querySelector("#tm-points-leaderboard");
  if (!box) return;

  const ranked = store.profiles
    .filter((p) => p.active !== false)
    .map((p) => ({ profile: p, total: totalPointsFor(p.id) }))
    .sort((a, b) => b.total - a.total);

  if (!ranked.length) {
    box.innerHTML = `<div class="text-faint" style="font-size:12.5px;">No points earned yet — they show up as soon as someone adds a prospect, sends a follow-up, or checks off a daily task.</div>`;
    return;
  }

  box.innerHTML = "";
  ranked.forEach((entry, i) => {
    const rank = i + 1;
    const { profile: p, total } = entry;
    const isSelf = p.id === store.profile.id;
    const row = el(`
      <div class="card" style="margin-bottom:8px;cursor:pointer;${rank === 1 ? "border-color:var(--gold-line,var(--gold));" : ""}">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="${rank === 1 ? "text-gold" : "text-faint"}" style="width:18px;text-align:center;font-weight:800;font-size:14px;flex:0 0 auto;">${rank === 1 ? "🏆" : rank}</div>
          ${avatarHTML(p.full_name || p.email, p.avatar_url, 30, 11)}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.full_name || p.email)}${isSelf ? " (You)" : ""}</div>
            <div class="text-faint" style="font-size:11px;">Tap for recent activity</div>
          </div>
          <div style="text-align:right;flex:0 0 auto;">
            <div class="${rank === 1 ? "text-gold" : ""}" style="font-weight:800;font-size:13px;">${total}</div>
            <div class="text-faint" style="font-size:10px;">points</div>
          </div>
        </div>
      </div>
    `);
    row.addEventListener("click", () => openPointsBreakdownModal(p, total));
    box.appendChild(row);
  });
}

// Which badge keys a person has actually unlocked, from badges_earned (see
// supabase/migration_badges.sql — server-only writes, so this is always the
// real, earned set, never something the client can fake).
function earnedBadgeKeysFor(profileId) {
  return new Set(store.badgesEarned.filter((b) => b.profile_id === profileId).map((b) => b.badge_key));
}

function badgeEarnedAtFor(profileId, badgeKey) {
  return store.badgesEarned.find((b) => b.profile_id === profileId && b.badge_key === badgeKey)?.earned_at || null;
}

// Tap any badge (locked or unlocked) to see what it is and how to get it —
// a toast's ~2.6s auto-dismiss is too short for a full description, so this
// uses the same openModal() pattern as the points breakdown above instead.
function openBadgeInfoModal(badge, isEarned, earnedAt) {
  const box = el(`
    <div style="text-align:center;">
      <div class="icon-badge${isEarned ? (badge.tier === "gold" ? " gold" : "") : " locked"}" style="width:64px;height:64px;border-radius:18px;margin:0 auto 14px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:32px;height:32px;">${badge.icon}</svg>
      </div>
      <div style="font-weight:800;font-size:16px;margin-bottom:6px;">${esc(badge.label)}</div>
      <div class="text-faint" style="font-size:12.5px;line-height:1.5;margin-bottom:12px;">${esc(badge.desc)}</div>
      <div style="font-size:12px;font-weight:700;" class="${isEarned ? "text-gold" : "text-faint"}">${isEarned ? "Earned " + timeAgo(earnedAt) : "🔒 Not earned yet"}</div>
    </div>
  `);
  openModal(box);
}

// Renders the badge wall for one person into `container` — unlocked badges
// in full color (gold tier gets the gold tint, same as everywhere else in
// the app), locked ones dimmed via .icon-badge.locked. Every badge in the
// catalog always shows (so people can see what's still to unlock), never
// just the earned subset.
function renderBadgesGrid(container, profileId) {
  const earned = earnedBadgeKeysFor(profileId);
  container.innerHTML = "";
  BADGES.forEach((badge) => {
    const isEarned = earned.has(badge.key);
    const chip = el(`
      <div class="badge-chip${isEarned ? "" : " locked"}">
        <div class="icon-badge${isEarned ? (badge.tier === "gold" ? " gold" : "") : " locked"}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${badge.icon}</svg>
        </div>
        <div class="badge-chip-label">${esc(badge.label)}</div>
      </div>
    `);
    chip.addEventListener("click", () => openBadgeInfoModal(badge, isEarned, badgeEarnedAtFor(profileId, badge.key)));
    container.appendChild(chip);
  });
}

// Owner-only ranked view of the whole team's numbers, side by side. Every
// existing performance surface is one-person-at-a-time (My Performance is
// self-only, the roster's "View Performance" link is a one-off drill-down
// per teammate) — nothing lets an owner see who's actually leading at a
// glance without opening each person individually. Reuses
// myPerformanceStats(agentId), already parameterized for exactly this, so
// this is pure aggregation over data already in the store: no new query,
// no new table. Ranked by MRR won (the number that actually matters to the
// business), with signed count and win rate as tiebreakers/context.
function renderLeaderboard(wrap) {
  const box = wrap.querySelector("#tm-leaderboard");
  if (!box) return;

  const ranked = store.profiles
    .filter((p) => p.active !== false)
    .map((p) => ({ profile: p, perf: myPerformanceStats(p.id) }))
    .sort((a, b) =>
      b.perf.mrr - a.perf.mrr ||
      b.perf.winRate - a.perf.winRate ||
      b.perf.signedCount - a.perf.signedCount
    );

  if (!ranked.length) {
    box.innerHTML = `<div class="text-faint" style="font-size:12.5px;">No team members yet.</div>`;
    return;
  }

  box.innerHTML = "";
  ranked.forEach((entry, i) => {
    const rank = i + 1;
    const { profile: p, perf } = entry;
    const isSelf = p.id === store.profile.id;
    const row = el(`
      <div class="card" style="margin-bottom:8px;${rank === 1 ? "border-color:var(--gold-line,var(--gold));" : ""}">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="${rank === 1 ? "text-gold" : "text-faint"}" style="width:18px;text-align:center;font-weight:800;font-size:13px;flex:0 0 auto;">${rank}</div>
          ${avatarHTML(p.full_name || p.email, p.avatar_url, 30, 11)}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.full_name || p.email)}${isSelf ? " (You)" : ""}</div>
            <div class="text-faint" style="font-size:11px;">${perf.signedCount} signed · ${perf.winRate}% win rate</div>
          </div>
          <div style="text-align:right;flex:0 0 auto;">
            <div class="text-gold" style="font-weight:800;font-size:13px;">${money(perf.mrr)}</div>
            <div class="text-faint" style="font-size:10px;">MRR</div>
          </div>
        </div>
      </div>
    `);
    row.addEventListener("click", () => (isSelf ? openMySignedModal(perf.signedList) : openTeammatePerformanceModal(p)));
    row.style.cursor = "pointer";
    box.appendChild(row);
  });
}

// Every existing performance metric on this page (Team Leaderboard's
// MRR/win-rate above, Team Workload on the Dashboard, Personalization by
// Agent on Message Kit) is keyed off assigned_to — who owns/closes a lead.
// created_by (who actually logged the lead in the first place, written on
// every insert in bulkImport.js and prospectForm.js) is never read anywhere
// else in the app. Sourcing and ownership can be different people entirely —
// e.g. an owner bulk-imports a list, then hands the leads out to reps to
// work — and that split has been completely invisible until now. Counts
// every prospect ever logged (not just active ones), since "who found this"
// doesn't change once a lead moves through the pipeline or dies.
function leadsSourcedByAgent() {
  const counts = {};
  store.prospects.forEach((p) => {
    if (!p.created_by) return;
    counts[p.created_by] = (counts[p.created_by] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([agentId, count]) => ({ agentId, count }))
    .sort((a, b) => b.count - a.count);
}

function renderLeadsSourced(wrap) {
  const box = wrap.querySelector("#tm-sourced");
  if (!box) return;
  const ranked = leadsSourcedByAgent();
  if (!ranked.length) {
    box.innerHTML = `<div class="text-faint" style="font-size:12.5px;">No leads logged yet.</div>`;
    return;
  }
  box.innerHTML = "";
  ranked.forEach((r, i) => {
    const p = profileById(r.agentId);
    const rank = i + 1;
    const row = el(`
      <div class="card" style="margin-bottom:8px;${rank === 1 ? "border-color:var(--gold-line,var(--gold));" : ""}">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="${rank === 1 ? "text-gold" : "text-faint"}" style="width:18px;text-align:center;font-weight:800;font-size:13px;flex:0 0 auto;">${rank}</div>
          ${avatarHTML(p?.full_name || p?.email, p?.avatar_url, 30, 11)}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p?.full_name || p?.email || "Unknown")}</div>
          </div>
          <div class="text-faint" style="font-size:12px;flex:0 0 auto;">${r.count} lead${r.count === 1 ? "" : "s"}</div>
        </div>
      </div>
    `);
    box.appendChild(row);
  });
}

function openMySignedModal(signedList) {
  const box = el(`
    <div>
      <div class="section-title mt-0">My Signed Clients</div>
      <div id="tm-signed-list"></div>
    </div>
  `);
  const listEl = box.querySelector("#tm-signed-list");
  if (!signedList.length) {
    listEl.innerHTML = `<div class="text-faint" style="font-size:12.5px;padding:10px 0;">No signed clients yet.</div>`;
  } else {
    signedList
      .slice()
      .sort((a, b) => (Number(b.mrr) || 0) - (Number(a.mrr) || 0))
      .forEach((p) => {
        listEl.appendChild(el(`
          <div class="card" style="margin-bottom:8px;">
            <div class="flex-between">
              <span style="font-size:13px;font-weight:600;">${esc(p.business_name)}</span>
              <span class="text-gold" style="font-size:12px;">${money(p.mrr || 0)}/mo</span>
            </div>
          </div>
        `));
      });
  }
  openModal(box);
}

export function renderTeam() {
  const root = document.getElementById("view-team");
  root.innerHTML = "";
  const isOwner = store.profile?.role === "owner";

  const wrap = el(`
    <div>
      <div class="page-title">Team<span class="accent">.</span></div>

      <div class="card" style="margin-bottom:16px;">
        <div class="flex-between">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;">
            ${avatarHTML(store.profile?.full_name || store.profile?.email, store.profile?.avatar_url, 40, 14)}
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(store.profile?.full_name || store.profile?.email)}</div>
              <div class="text-faint" style="font-size:12px;text-transform:capitalize;">${esc(store.profile?.role)}</div>
            </div>
          </div>
          <span class="small-link" id="tm-edit-profile" style="flex:0 0 auto;">Edit</span>
        </div>
      </div>

      <div class="section-title mt-0">My Performance</div>
      <div class="stat-grid" style="margin-bottom:16px;" id="tm-my-performance"></div>

      <div class="flex-between" style="margin-bottom:2px;">
        <div class="section-title mt-0" style="margin-bottom:0;">🏆 Points Leaderboard</div>
      </div>
      <div class="text-faint" style="font-size:11px;margin:2px 0 10px;line-height:1.4;">Everyone can see this one. Points come from doing the work — adding a prospect, a follow-up, a signed deal, finishing your daily tasks — not just closed revenue.</div>
      <div id="tm-points-leaderboard" style="margin-bottom:16px;"></div>

      <div class="section-title mt-0">🎖️ My Badges</div>
      <div class="text-faint" style="font-size:11px;margin:2px 0 10px;line-height:1.4;">Tap any badge — locked ones show what you need to do to unlock them.</div>
      <div class="badges-grid" id="tm-badges-grid"></div>

      ${isOwner ? `
      <div class="section-title mt-0">Team Leaderboard</div>
      <div id="tm-leaderboard" style="margin-bottom:16px;"></div>

      <div class="section-title mt-0">Leads Sourced</div>
      <div id="tm-sourced" style="margin-bottom:16px;"></div>
      ` : ""}

      <div class="card" style="margin-bottom:16px;">
        <div class="flex-between" style="margin-bottom:2px;">
          <div style="font-weight:700;font-size:13.5px;">${esc(store.organization?.name || "Your Agency")}</div>
        </div>
        <div class="text-faint" style="font-size:11.5px;margin:4px 0 10px;line-height:1.4;">Share this invite code with new teammates so they land in your agency when they sign up.</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <code style="flex:1;background:var(--black-card);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;letter-spacing:0.5px;">${esc(store.organization?.invite_code || "—")}</code>
          <button class="btn btn-ghost btn-sm" id="tm-copy-invite" style="width:auto;">Copy</button>
        </div>
        ${isOwner ? `<button class="btn btn-ghost btn-sm" id="tm-regen-invite" style="width:auto;margin-top:9px;">Regenerate Code</button>` : ""}
      </div>

      <div class="card" style="margin-bottom:16px;">
        <div class="flex-between">
          <div style="min-width:0;padding-right:12px;">
            <div style="font-weight:700;font-size:13.5px;">Appearance</div>
            <div class="text-faint" style="font-size:11.5px;margin-top:4px;line-height:1.4;">Switch between dark and light mode. This is a per-device setting — it won't change how the app looks for your teammates.</div>
          </div>
          <label class="switch" title="Toggle light/dark mode">
            <input type="checkbox" id="tm-theme-switch" />
            <span class="track"><span class="thumb"></span></span>
          </label>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px;">
        <div class="flex-between" style="margin-bottom:2px;">
          <div style="font-weight:700;font-size:13.5px;">Notifications</div>
          <span class="text-faint" style="font-size:11px;" id="tm-notif-status">Checking…</span>
        </div>
        <div class="text-faint" style="font-size:11.5px;margin:4px 0 10px;line-height:1.4;">Get a pop-up when a prospect is added or assigned to you — even when the app isn't open.</div>
        <button class="btn btn-ghost btn-sm" id="tm-notif-toggle" style="width:auto;" disabled>...</button>
      </div>

      <div class="card" style="margin-bottom:16px;">
        <div class="flex-between">
          <div style="min-width:0;padding-right:12px;">
            <div style="font-weight:700;font-size:13.5px;">Email Notifications</div>
            <div class="text-faint" style="font-size:11.5px;margin-top:4px;line-height:1.4;">Get an email when a prospect is added or assigned to you, and when an invoice goes overdue.</div>
          </div>
          <label class="switch" title="Toggle email notifications">
            <input type="checkbox" id="tm-email-notif-switch" />
            <span class="track"><span class="thumb"></span></span>
          </label>
        </div>
      </div>

      <div class="section-title mt-0">Team Members</div>
      <div id="tm-list"></div>

      <div class="divider"></div>
      <button class="btn btn-ghost" id="tm-signout">Sign Out</button>
      <p class="text-faint" style="font-size:11px;text-align:center;margin-top:20px;">Agency Command · ${esc(store.organization?.name || "Sales & Team Sync")}</p>
      <p class="text-faint" style="font-size:10px;text-align:center;margin-top:4px;opacity:0.6;">build sxc-v158</p>
    </div>
  `);
  root.appendChild(wrap);

  wrap.querySelector("#tm-signout").addEventListener("click", () => {
    confirmModal({
      title: "Sign out?",
      body: "You'll need your email and password to sign back in.",
      confirmLabel: "Sign Out",
      onConfirm: () => signOut(),
    });
  });

  wrap.querySelector("#tm-edit-profile").addEventListener("click", openEditProfileModal);

  const themeSwitch = wrap.querySelector("#tm-theme-switch");
  themeSwitch.checked = getTheme() === "light";
  themeSwitch.addEventListener("change", () => setTheme(themeSwitch.checked ? "light" : "dark"));

  const perf = myPerformanceStats();
  const myPoints = totalPointsFor(store.profile.id);
  const perfEl = wrap.querySelector("#tm-my-performance");
  perfEl.innerHTML = `
    <div class="stat-card accent" id="tm-points-card" style="cursor:pointer;"><div class="num">🏆 ${myPoints}</div><div class="label">Points</div></div>
    <div class="stat-card"><div class="num">${perf.active}</div><div class="label">Active Leads</div></div>
    <div class="stat-card accent" id="tm-signed-card" style="cursor:pointer;"><div class="num">${perf.signedCount}</div><div class="label">Signed (All-Time)</div></div>
    <div class="stat-card purple" id="tm-mrr-card" style="cursor:pointer;"><div class="num">${money(perf.mrr)}</div><div class="label">MRR Won</div></div>
    <div class="stat-card"><div class="num">${perf.winRate}%</div><div class="label">Win Rate</div></div>
    <div class="stat-card"><div class="num">${perf.replyRate}%</div><div class="label">Reply Rate</div></div>
  `;
  perfEl.querySelector("#tm-points-card").addEventListener("click", () => openPointsBreakdownModal(store.profile, myPoints));
  perfEl.querySelector("#tm-signed-card").addEventListener("click", () => openMySignedModal(perf.signedList));
  perfEl.querySelector("#tm-mrr-card").addEventListener("click", () => openMySignedModal(perf.signedList));

  renderPointsLeaderboard(wrap);
  renderBadgesGrid(wrap.querySelector("#tm-badges-grid"), store.profile.id);
  if (isOwner) { renderLeaderboard(wrap); renderLeadsSourced(wrap); }

  wireNotificationsToggle(wrap);
  wireEmailNotificationsToggle(wrap);
  wireInviteCode(wrap, isOwner);

  const listEl = wrap.querySelector("#tm-list");
  store.profiles.forEach((p) => {
    const isSelf = p.id === store.profile.id;
    const isMemberActive = p.active !== false;
    const lastActive = lastActivityFor(p.id);
    const stale = isMemberActive && daysSinceActivity(lastActive) >= INACTIVE_DAYS;
    const card = el(`
      <div class="card" style="margin-bottom:8px;${isMemberActive ? "" : "opacity:0.55;"}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="display:flex;align-items:center;gap:9px;min-width:0;">
            ${avatarHTML(p.full_name || p.email, p.avatar_url, 30, 11)}
            <div style="min-width:0;">
              <div style="font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.full_name || p.email)}</div>
              <div class="text-faint" style="font-size:11px;">${esc(p.email)}</div>
            </div>
          </div>
          ${isOwner && !isSelf && isMemberActive
            ? `<select class="role-select" data-id="${p.id}" style="width:auto;padding:6px 8px;font-size:12px;">
                 <option value="agent" ${p.role === "agent" ? "selected" : ""}>Agent</option>
                 <option value="manager" ${p.role === "manager" ? "selected" : ""}>Manager</option>
                 <option value="designer" ${p.role === "designer" ? "selected" : ""}>Designer</option>
                 <option value="contributor" ${p.role === "contributor" ? "selected" : ""}>Contributor</option>
                 <option value="owner" ${p.role === "owner" ? "selected" : ""}>Owner</option>
               </select>`
            : `<span class="tier-pill ${p.role === "owner" ? "A" : "C"}" style="text-transform:uppercase;">${esc(p.role)}</span>`}
        </div>
        ${isOwner && !isSelf && isMemberActive && GRID_ROLE_HINTS[p.role]
          ? `<div class="text-faint" style="font-size:10.5px;margin-top:4px;">${GRID_ROLE_HINTS[p.role]}</div>`
          : ""}
        ${isMemberActive
          ? stale
            ? `<span class="status-pill stale" style="margin-top:6px;display:inline-block;">${lastActive ? "Inactive · " + timeAgo(lastActive) : "No activity yet"}</span>`
            : `<div class="text-faint" style="font-size:11px;margin-top:6px;">Active ${timeAgo(lastActive)}</div>`
          : `<div class="text-faint" style="font-size:11px;margin-top:6px;">Access removed — can't sign in.</div>`}
        ${isOwner && !isSelf ? `<div style="display:flex;align-items:center;gap:14px;margin-top:9px;flex-wrap:wrap;">` : ""}
        ${isOwner && !isSelf && isMemberActive
          ? `<span class="small-link" data-view-perf>View Performance</span>`
          : ""}
        ${isOwner && !isSelf
          ? `<button class="btn btn-ghost btn-sm" data-access style="width:auto;${isMemberActive ? "color:#e05d5d;" : ""}">${isMemberActive ? "Remove access" : "Restore access"}</button>`
          : ""}
        ${isOwner && !isSelf ? `</div>` : ""}
      </div>
    `);
    const viewPerfLink = card.querySelector("[data-view-perf]");
    if (viewPerfLink) viewPerfLink.addEventListener("click", () => openTeammatePerformanceModal(p));
    const sel = card.querySelector(".role-select");
    if (sel) {
      sel.addEventListener("change", async () => {
        const { error } = await sb.from("profiles").update({ role: sel.value }).eq("id", p.id);
        if (error) return toast(error.message, "error");
        toast("Role updated", "success");
        await refetchProfiles();
      });
    }
    const accessBtn = card.querySelector("[data-access]");
    if (accessBtn) {
      accessBtn.addEventListener("click", () => {
        if (isMemberActive) {
          confirmModal({
            title: `Remove ${p.full_name || p.email}'s access?`,
            body: "They'll be signed out and won't be able to log back in. Everything they've already done stays in the pipeline — you can restore their access any time.",
            confirmLabel: "Remove Access",
            danger: true,
            onConfirm: () => callManageAccess(p, "deactivate"),
          });
        } else {
          callManageAccess(p, "reactivate");
        }
      });
    }
    listEl.appendChild(card);
  });

  if (!store.profiles.length) {
    listEl.appendChild(el(`<div class="text-faint" style="font-size:12.5px;">No team members yet.</div>`));
  }
}

async function refetchProfiles() {
  const { data } = await sb.from("profiles").select("*").order("full_name");
  store.profiles = data || [];
  renderTeam();
}

// After a name or avatar change: profiles has no realtime subscription (see
// state.js), so we refetch the roster ourselves instead of waiting on a push
// that'll never come. Also mirrors the change into store.profile + emits
// "profile" so the always-visible sidebar chip (main.js's renderSidebarUser)
// updates immediately too.
async function refreshAfterProfileEdit(patch) {
  store.profile = { ...store.profile, ...patch };
  emit("profile");
  await refetchProfiles();
}

function openEditProfileModal() {
  const p = store.profile;
  const box = el(`
    <div>
      <div style="font-weight:800;font-size:16px;margin-bottom:14px;">Edit Profile</div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:20px;">
        <div id="ep-avatar-wrap" style="position:relative;cursor:pointer;width:76px;height:76px;">
          <span id="ep-avatar-slot" style="display:block;width:76px;height:76px;">${avatarHTML(p.full_name || p.email, p.avatar_url, 76, 26)}</span>
          <div style="position:absolute;bottom:0;right:0;background:var(--purple-soft,#a78bfa);border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:2px solid var(--black-card);pointer-events:none;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#0b0a12" stroke-width="2.4"><path d="M4 7h3l2-2h6l2 2h3v13H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
          </div>
        </div>
        <input type="file" id="ep-file-input" accept="image/*" style="display:none;" />
        <span class="small-link" id="ep-change-photo">Change Photo</span>
      </div>
      <div class="field">
        <label>Full Name</label>
        <input id="ep-name-input" type="text" value="${esc(p.full_name || "")}" placeholder="Your name" />
      </div>
      <button class="btn btn-gold" id="ep-save" style="margin-top:12px;">Save Changes</button>
    </div>
  `);

  const fileInput = box.querySelector("#ep-file-input");
  const slot = box.querySelector("#ep-avatar-slot");
  const openPicker = () => fileInput.click();
  box.querySelector("#ep-avatar-wrap").addEventListener("click", openPicker);
  box.querySelector("#ep-change-photo").addEventListener("click", openPicker);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Please choose an image file", "error");
    if (file.size > 5 * 1024 * 1024) return toast("Image must be under 5MB", "error");

    // Instant local preview while the upload's in flight — feels responsive
    // even on a slow connection, and gets overwritten with the real URL
    // (or reverted, on failure) once the upload settles.
    const localPreview = URL.createObjectURL(file);
    slot.innerHTML = `<span class="avatar" style="width:76px;height:76px;"><img src="${localPreview}" alt="" /></span>`;

    const extMatch = /\.([a-z0-9]+)$/i.exec(file.name || "");
    const ext = (extMatch ? extMatch[1] : "jpg").toLowerCase();
    const path = `${store.profile.id}/avatar.${ext}`;

    const { error: upErr } = await sb.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: "3600" });
    if (upErr) {
      toast(upErr.message || "Upload failed", "error");
      slot.innerHTML = avatarHTML(store.profile.full_name || store.profile.email, store.profile.avatar_url, 76, 26);
      return;
    }

    const { data: pub } = sb.storage.from("avatars").getPublicUrl(path);
    // Cache-bust: the storage path never changes (we always overwrite the
    // same file), so without a query param every browser/CDN would keep
    // showing the old cached image after a re-upload.
    const url = pub.publicUrl + "?t=" + Date.now();
    const { error: dbErr } = await sb.from("profiles").update({ avatar_url: url }).eq("id", store.profile.id);
    if (dbErr) return toast(dbErr.message, "error");

    slot.innerHTML = avatarHTML(store.profile.full_name || store.profile.email, url, 76, 26);
    toast("Photo updated", "success");
    await refreshAfterProfileEdit({ avatar_url: url });
  });

  box.querySelector("#ep-save").addEventListener("click", async () => {
    const name = box.querySelector("#ep-name-input").value.trim();
    if (!name) return toast("Name can't be empty", "error");
    const { error } = await sb.from("profiles").update({ full_name: name }).eq("id", store.profile.id);
    if (error) return toast(error.message, "error");
    toast("Profile updated", "success");
    closeModal();
    await refreshAfterProfileEdit({ full_name: name });
  });

  openModal(box);
}

// Calls the manage-team-member Edge Function (owner-only, verified again
// server-side) to ban/unban the login and flip profiles.active together.
// See supabase/functions/manage-team-member — nothing about the teammate's
// history is ever deleted, this only locks/unlocks their sign-in.
async function callManageAccess(p, action) {
  const { data, error } = await sb.functions.invoke("manage-team-member", {
    body: { user_id: p.id, action },
  });
  if (error) return toast(error.message || "Couldn't update access", "error");
  if (data?.error) return toast(data.error, "error");
  toast(action === "deactivate" ? "Access removed" : "Access restored", "success");
  await refetchProfiles();
}

function wireInviteCode(wrap, isOwner) {
  const copyBtn = wrap.querySelector("#tm-copy-invite");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const code = store.organization?.invite_code;
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        toast("Invite code copied", "success");
      } catch {
        toast("Couldn't copy — long-press the code to select it", "error");
      }
    });
  }

  if (!isOwner) return;
  const regenBtn = wrap.querySelector("#tm-regen-invite");
  if (!regenBtn) return;
  regenBtn.addEventListener("click", () => {
    confirmModal({
      title: "Regenerate invite code?",
      body: "The old code stops working immediately — anyone you've already shared it with won't be able to use it to join.",
      confirmLabel: "Regenerate",
      danger: true,
      onConfirm: async () => {
        const { data, error } = await sb.rpc("regenerate_invite_code");
        if (error) return toast(error.message, "error");
        store.organization = { ...store.organization, invite_code: data };
        toast("Invite code regenerated", "success");
        renderTeam();
      },
    });
  });
}

async function wireNotificationsToggle(wrap) {
  const statusEl = wrap.querySelector("#tm-notif-status");
  const btn = wrap.querySelector("#tm-notif-toggle");
  if (!statusEl || !btn) return;

  if (!pushSupported()) {
    statusEl.textContent = "Not supported here";
    btn.textContent = "Unavailable";
    return;
  }

  const refresh = async () => {
    const on = await isPushEnabled();
    statusEl.textContent = on ? "On" : "Off";
    btn.textContent = on ? "Turn Off" : "Turn On";
    btn.disabled = false;
  };

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const wasOn = await isPushEnabled();
    if (wasOn) await disablePush();
    else await enablePush();
    await refresh();
  });

  await refresh();
}

function wireEmailNotificationsToggle(wrap) {
  const switchEl = wrap.querySelector("#tm-email-notif-switch");
  if (!switchEl) return;

  switchEl.checked = store.profile.email_notifications_enabled !== false;

  switchEl.addEventListener("change", async () => {
    const next = switchEl.checked;
    switchEl.disabled = true;
    const { error } = await sb
      .from("profiles")
      .update({ email_notifications_enabled: next })
      .eq("id", store.profile.id);
    switchEl.disabled = false;
    if (error) {
      switchEl.checked = !next;
      toast(error.message, "error");
      return;
    }
    store.profile = { ...store.profile, email_notifications_enabled: next };
    toast(next ? "Email notifications turned on" : "Email notifications turned off", "success");
  });
}

export function initTeamView() {
  on("profiles", () => { if (isActive()) renderTeam(); });
  on("organization", () => { if (isActive()) renderTeam(); });
  on("activityLog", () => { if (isActive()) renderTeam(); });
  on("prospects", () => { if (isActive()) renderTeam(); });
  on("pointsTotals", () => { if (isActive()) renderTeam(); });
  on("badgesEarned", () => { if (isActive()) renderTeam(); });
}
function isActive() {
  return document.getElementById("view-team")?.classList.contains("active");
}
