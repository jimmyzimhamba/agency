import { sb } from "./supabaseClient.js";
import { celebrateToast } from "./utils.js";
import { badgeByKey } from "./badges.js";

// Generic "you just earned points" star, for the celebratory toast below —
// same star path as the Prospector/Legend badge icons in badges.js, kept
// as its own constant here since this one isn't tied to any specific badge.
const POINTS_STAR_ICON = '<path d="M12 2l2.4 7.2H22l-6 4.6 2.3 7.2-6.3-4.5-6.3 4.5 2.3-7.2-6-4.6h7.6z"/>';

// A tiny shared store. Views subscribe to the keys they care about and
// re-render whenever that data changes (from our own actions or a
// teammate's, via Supabase Realtime).
const listeners = {};

export const store = {
  session: null,
  profile: null,
  organization: null,
  profiles: [],
  niches: [],
  prospects: [],
  notesByProspect: {},
  messagesByProspect: {},
  templates: [],
  dailyTasks: [],
  dailyCompletions: [],
  agentTargets: [],
  activityLog: [],
  monthlyGoal: null,
  contracts: [],
  invoices: [],
  projects: [],
  projectTasks: [],
  gridPlans: [],
  gridPosts: [],
  gridPostMedia: [],
  servicePackages: [],
  portfolioSettings: null,
  portfolioItems: [],
  communityPosts: [],
  communityComments: [],
  communityReactions: [],
  // Gamification — see supabase/migration_points.sql. pointsLog is a recent
  // slice of the ledger (enough for an "activity so far" breakdown per
  // person); pointsTotals is the authoritative all-time sum per profile
  // (from the points_totals view), which the leaderboard actually ranks
  // by — it's never computed by summing pointsLog client-side, since that
  // list is capped and would silently under-count once someone earns more
  // than a screenful of points.
  pointsLog: [],
  pointsTotals: [],
  // Badges — see supabase/migration_badges.sql. Loaded in full (not capped
  // like pointsLog) since expected row count per org is tiny — a handful of
  // teammates times ~14 possible badges each, nowhere near pointsLog's
  // unbounded growth.
  badgesEarned: [],
};

export function on(key, fn) {
  (listeners[key] ||= []).push(fn);
  return () => {
    listeners[key] = listeners[key].filter((f) => f !== fn);
  };
}

export function emit(key) {
  (listeners[key] || []).forEach((fn) => fn(store[key]));
  (listeners["*"] || []).forEach((fn) => fn(key));
}

export function profileById(id) {
  return store.profiles.find((p) => p.id === id) || null;
}

export function nicheById(id) {
  return store.niches.find((n) => n.id === id) || null;
}

// ---- niche colour swatches -------------------------------------------------
// Every agency writes its own niche list, so there is no fixed set to hand-pick
// colours for. Deriving the swatch instead means every niche has one the moment
// it's created: no colour column to migrate, no picker for anyone to fill in,
// and everyone on the team sees the same colour for the same niche without
// anything being stored or synced.
//
// This deliberately does not reuse colorFor() in utils.js. That palette is for
// people's avatars: it's only 7 long, and it's built from the app's own accent
// colours — including the exact gold and purple that mean Tier A and Tier B on
// the very same prospect row. A gold niche dot beside a gold TIER A pill would
// be two unrelated things wearing the same signal.
//
// These are OKLCH hue angles, not HSL ones — the numbers are not
// interchangeable between the two. OKLCH is worth the unfamiliarity here
// because its lightness is perceptually even across hues, and HSL's is not:
// the first cut of this used HSL at a single fixed lightness and the dots
// measured anywhere from 2.5:1 to 9.4:1 against white, so the yellow and lime
// niches were all but invisible in light mode while the blues were fine. In
// OKLCH one lightness value holds its weight all the way round the wheel, so
// every niche is equally easy to pick out. Even spacing works for the same
// reason. Lightness and chroma live in CSS so light mode can adjust all twelve
// in one rule.
const NICHE_HUES = [25, 55, 90, 130, 155, 180, 205, 235, 265, 295, 325, 355];

// Assigned by position rather than by hashing the id, which is the whole
// reason this lives in state.js next to the niche list instead of in utils.js.
// A hash looks fairer but loses to the birthday problem badly: measured over
// 20,000 simulated orgs, ten niches hashed into these twelve hues produced only
// ~7 distinct colours on average, and 99.6% of orgs had at least one pair of
// niches wearing the same colour — which defeats the entire point of colouring
// them. Indexing guarantees the first twelve niches are all different.
//
// Indexed over ids sorted lexically, not over the list's own display order.
// Sorting by id is immutable, so dragging niches into a new order or renaming
// one never repaints anything. It also means neighbouring rows don't get
// neighbouring hues, which matters because adjacent entries in this palette are
// the most similar to each other — exactly the pair you least want side by side.
// Adding or deleting a niche does shift some colours, which is accepted: it's a
// rare, deliberate act, and it happens on the Niche Matrix page where every
// niche and its colour are on screen together, so nothing changes behind
// someone's back.
let hueCache = null;
let hueCacheSource = null;

function nicheHueMap() {
  // store.niches is replaced wholesale on every load, so comparing identity is
  // a sufficient (and cheap) way to know the cache is stale.
  if (hueCache && hueCacheSource === store.niches) return hueCache;
  const map = new Map();
  store.niches
    .map((n) => n.id)
    .sort()
    .forEach((id, i) => map.set(id, NICHE_HUES[i % NICHE_HUES.length]));
  hueCache = map;
  hueCacheSource = store.niches;
  return map;
}

export function nicheHue(nicheOrId) {
  const id = typeof nicheOrId === "string" ? nicheOrId : nicheOrId?.id;
  if (!id) return null;
  const hue = nicheHueMap().get(id);
  return hue === undefined ? null : hue;
}

// The swatch is always rendered immediately before the niche's name and never
// on its own, so the colour is a scanning shortcut rather than the label
// itself. Someone who can't separate two hues loses nothing, and a prospect
// with no niche set simply gets no dot rather than a misleading one.
export function nicheDotHTML(niche) {
  const hue = nicheHue(niche);
  if (hue === null) return "";
  return `<span class="niche-dot" style="--niche-hue:${hue};"></span>`;
}

export function prospectById(id) {
  return store.prospects.find((p) => p.id === id) || null;
}

// Every city currently in use across the pipeline, plus the two we always
// want offered even if nobody's added a prospect there yet. Feeds both the
// Add/Edit Prospect form's suggestions and the Pipeline's city filter chips.
export function knownCities() {
  const set = new Set(["Harare", "Bulawayo"]);
  store.prospects.forEach((p) => { if (p.city) set.add(p.city); });
  return Array.from(set).sort();
}

// Picks the best message template for a prospect: one written specifically
// for their niche if we have it, otherwise the general (niche_id null) one
// for that category.
export function bestTemplateFor(prospect, category = "opener") {
  const nicheMatch = store.templates.find((t) => t.category === category && t.niche_id === prospect?.niche_id);
  if (nicheMatch) return nicheMatch;
  return store.templates.find((t) => t.category === category && !t.niche_id) || null;
}

export async function loadAll() {
  // portfolio_settings/portfolio_items are the one place in the app where a
  // second RLS policy intentionally lets ANYONE read rows across every org
  // (published/public portfolio content, by design — see
  // migration_portfolio.sql). That's fine for the public showcase page, but
  // it means a plain select() here — inside the logged-in app — could pull
  // in another org's published rows alongside our own. Explicitly filtering
  // by our own org_id (known from the profile, already loaded before
  // loadAll() runs) keeps this internal management view scoped to exactly
  // our own catalog, same as every other org-scoped query below relies on
  // RLS alone to do.
  const myOrgId = store.profile?.org_id;

  const [organization, profiles, niches, prospects, templates, dailyTasks, dailyCompletions, agentTargets, activityLog, monthlyGoal, contracts, invoices, projects, projectTasks, gridPlans, gridPosts, gridPostMedia, servicePackages, portfolioSettings, portfolioItems, communityPosts, communityComments, communityReactions, pointsLog, pointsTotals, badgesEarned] =
    await Promise.all([
      sb.from("organizations").select("*").maybeSingle(),
      sb.from("profiles").select("*").order("full_name"),
      sb.from("niches").select("*").order("sort_order"),
      sb.from("prospects").select("*").order("updated_at", { ascending: false }),
      sb.from("message_templates").select("*").order("sort_order"),
      sb.from("daily_tasks").select("*").eq("active", true).order("sort_order"),
      sb.from("daily_task_completions").select("*").eq("work_date", new Date().toISOString().slice(0, 10)),
      sb.from("agent_targets").select("*"),
      sb.from("activity_log").select("*").order("created_at", { ascending: false }).limit(60),
      sb.from("monthly_goal").select("*").eq("month", firstOfMonth()).maybeSingle(),
      sb.from("contracts").select("*").order("created_at", { ascending: false }),
      sb.from("invoices").select("*").order("created_at", { ascending: false }),
      sb.from("projects").select("*").order("created_at", { ascending: false }),
      sb.from("project_tasks").select("*").order("sort_order"),
      sb.from("grid_plans").select("*").order("created_at", { ascending: false }),
      sb.from("grid_posts").select("*").order("position"),
      sb.from("grid_post_media").select("*").order("position"),
      sb.from("service_packages").select("*").order("sort_order"),
      sb.from("portfolio_settings").select("*").eq("org_id", myOrgId).maybeSingle(),
      sb.from("portfolio_items").select("*").eq("org_id", myOrgId).order("sort_order"),
      sb.from("community_posts").select("*").order("created_at", { ascending: false }),
      sb.from("community_comments").select("*").order("created_at", { ascending: true }),
      sb.from("community_reactions").select("*"),
      sb.from("points_log").select("*").order("created_at", { ascending: false }).limit(200),
      sb.from("points_totals").select("*"),
      sb.from("badges_earned").select("*"),
    ]);

  store.organization = organization.data || null;
  store.profiles = profiles.data || [];
  store.niches = niches.data || [];
  store.prospects = prospects.data || [];
  store.templates = templates.data || [];
  store.dailyTasks = dailyTasks.data || [];
  store.dailyCompletions = dailyCompletions.data || [];
  store.agentTargets = agentTargets.data || [];
  store.activityLog = activityLog.data || [];
  store.monthlyGoal = monthlyGoal.data || null;
  store.contracts = contracts.data || [];
  store.invoices = invoices.data || [];
  store.projects = projects.data || [];
  store.projectTasks = projectTasks.data || [];
  store.gridPlans = gridPlans.data || [];
  store.gridPosts = gridPosts.data || [];
  store.gridPostMedia = gridPostMedia.data || [];
  store.servicePackages = servicePackages.data || [];
  store.portfolioSettings = portfolioSettings.data || null;
  store.portfolioItems = portfolioItems.data || [];
  store.communityPosts = communityPosts.data || [];
  store.communityComments = communityComments.data || [];
  store.communityReactions = communityReactions.data || [];
  store.pointsLog = pointsLog.data || [];
  store.pointsTotals = pointsTotals.data || [];
  store.badgesEarned = badgesEarned.data || [];

  emit("organization"); emit("profiles"); emit("niches"); emit("prospects"); emit("templates");
  emit("dailyTasks"); emit("dailyCompletions"); emit("agentTargets");
  emit("activityLog"); emit("monthlyGoal");
  emit("contracts"); emit("invoices"); emit("projects"); emit("projectTasks");
  emit("gridPlans"); emit("gridPosts"); emit("gridPostMedia");
  emit("servicePackages");
  emit("portfolioSettings"); emit("portfolioItems");
  emit("communityPosts"); emit("communityComments"); emit("communityReactions");
  emit("pointsLog"); emit("pointsTotals"); emit("badgesEarned");
}

export function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export async function loadNotesFor(prospectId) {
  const { data } = await sb
    .from("prospect_notes")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: true });
  store.notesByProspect[prospectId] = data || [];
  emit("notes:" + prospectId);
  return store.notesByProspect[prospectId];
}

// Same targeted-per-prospect pattern as loadNotesFor above — a WhatsApp
// thread can only ever be looked at from inside one prospect's detail
// sheet, so there's no reason to pull every org's messages into memory
// up front the way loadAll() does for small, always-visible tables.
export async function loadMessagesFor(prospectId) {
  const { data } = await sb
    .from("whatsapp_messages")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: true });
  store.messagesByProspect[prospectId] = data || [];
  emit("whatsapp:" + prospectId);
  return store.messagesByProspect[prospectId];
}

// Refetches just the prospects table and re-renders. Used as a safety net
// any time we might have missed a Realtime event — e.g. a phone drops the
// websocket while backgrounded/asleep, so a teammate's new prospect never
// arrives as a live event, and the list looks stuck until this runs.
export async function refreshProspects() {
  const { data, error } = await sb.from("prospects").select("*").order("updated_at", { ascending: false });
  if (error) return;
  store.prospects = data || [];
  emit("prospects");
}

let channel;
let hasConnectedBefore = false;
export function startRealtime() {
  if (channel) return;
  channel = sb
    .channel("studio-x-command")
    .on("postgres_changes", { event: "*", schema: "public", table: "prospects" }, (payload) => {
      upsertLocal("prospects", payload);
      emit("prospects");
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_log" }, (payload) => {
      store.activityLog = [payload.new, ...store.activityLog].slice(0, 60);
      emit("activityLog");
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "prospect_notes" }, (payload) => {
      const pid = payload.new.prospect_id;
      if (store.notesByProspect[pid]) {
        store.notesByProspect[pid] = [...store.notesByProspect[pid], payload.new];
        emit("notes:" + pid);
      }
    })
    // Same "only touch it if that prospect's thread is already loaded" rule
    // as prospect_notes above — INSERT appends a new message (inbound reply,
    // or an outbound send from a teammate on another device); UPDATE is a
    // Twilio delivery-status callback (queued -> sent -> delivered -> read,
    // or failed) landing on a message already in the thread.
    .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages" }, (payload) => {
      const pid = (payload.new || payload.old)?.prospect_id;
      if (!pid || !store.messagesByProspect[pid]) return;
      if (payload.eventType === "INSERT") {
        if (!store.messagesByProspect[pid].some((m) => m.id === payload.new.id)) {
          store.messagesByProspect[pid] = [...store.messagesByProspect[pid], payload.new];
        }
      } else if (payload.eventType === "UPDATE") {
        store.messagesByProspect[pid] = store.messagesByProspect[pid].map((m) => (m.id === payload.new.id ? payload.new : m));
      } else if (payload.eventType === "DELETE") {
        store.messagesByProspect[pid] = store.messagesByProspect[pid].filter((m) => m.id !== payload.old.id);
      }
      emit("whatsapp:" + pid);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "daily_task_completions" }, (payload) => {
      upsertLocal("dailyCompletions", payload);
      emit("dailyCompletions");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "contracts" }, (payload) => {
      upsertLocal("contracts", payload);
      emit("contracts");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, (payload) => {
      upsertLocal("invoices", payload);
      emit("invoices");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, (payload) => {
      upsertLocal("projects", payload);
      emit("projects");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "project_tasks" }, (payload) => {
      upsertLocal("projectTasks", payload);
      emit("projectTasks");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "grid_plans" }, (payload) => {
      upsertLocal("gridPlans", payload);
      emit("gridPlans");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "grid_posts" }, (payload) => {
      upsertLocal("gridPosts", payload);
      emit("gridPosts");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "grid_post_media" }, (payload) => {
      upsertLocal("gridPostMedia", payload);
      emit("gridPostMedia");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "service_packages" }, (payload) => {
      upsertLocal("servicePackages", payload);
      emit("servicePackages");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "portfolio_items" }, (payload) => {
      upsertLocal("portfolioItems", payload);
      emit("portfolioItems");
    })
    // portfolio_settings is a single row (or none) per org, not a list, so it
    // doesn't fit upsertLocal's array-of-rows shape — just mirror whatever
    // came through directly.
    .on("postgres_changes", { event: "*", schema: "public", table: "portfolio_settings" }, (payload) => {
      store.portfolioSettings = payload.eventType === "DELETE" ? null : payload.new;
      emit("portfolioSettings");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "community_posts" }, (payload) => {
      upsertLocal("communityPosts", payload);
      emit("communityPosts");
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "community_comments" }, (payload) => {
      upsertLocal("communityComments", payload);
      emit("communityComments");
    })
    // points_log is append-only (never updated/deleted), so this only ever
    // needs to handle INSERT. Updates BOTH the recent-events list (capped,
    // for the "why did I earn this" breakdown) and the running per-person
    // total (points_totals is a DB view, not a realtime-subscribable table,
    // so its numbers are kept in sync here by hand instead of refetching it
    // on every single point earned).
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "points_log" }, (payload) => {
      store.pointsLog = [payload.new, ...store.pointsLog].slice(0, 200);
      const idx = store.pointsTotals.findIndex((t) => t.profile_id === payload.new.profile_id);
      if (idx === -1) {
        store.pointsTotals = [
          ...store.pointsTotals,
          { org_id: payload.new.org_id, profile_id: payload.new.profile_id, total_points: payload.new.points, event_count: 1, last_earned_at: payload.new.created_at },
        ];
      } else {
        const copy = store.pointsTotals.slice();
        copy[idx] = {
          ...copy[idx],
          total_points: copy[idx].total_points + payload.new.points,
          event_count: copy[idx].event_count + 1,
          last_earned_at: payload.new.created_at,
        };
        store.pointsTotals = copy;
      }
      emit("pointsLog");
      emit("pointsTotals");
      // Celebrate it in the moment — but only OUR OWN decent-sized wins
      // (meeting booked, a deal/contract signed, an invoice paid, a project
      // finished — 10+ points), not every little +2/+3 for a note or a
      // daily task, or this would fire constantly and stop feeling special.
      // Teammates' points don't toast for us; they see their own copy of
      // this same event on their own device.
      if (payload.new.profile_id === store.profile?.id && payload.new.points >= 10) {
        celebrateToast({
          icon: POINTS_STAR_ICON,
          title: `+${payload.new.points} points`,
          subtitle: payload.new.reason,
          tier: "gold",
        });
      }
    })
    // badges_earned rows are also append-only (a badge, once unlocked, is
    // never revoked or edited) — INSERT only, same as points_log above.
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "badges_earned" }, (payload) => {
      if (!store.badgesEarned.some((b) => b.id === payload.new.id)) {
        store.badgesEarned = [...store.badgesEarned, payload.new];
        emit("badgesEarned");
        // Every badge unlock is inherently a big moment (there are only 14,
        // ever) — so unlike points above, this always celebrates, no
        // threshold needed. Only for the person who actually earned it.
        if (payload.new.profile_id === store.profile?.id) {
          const badge = badgeByKey(payload.new.badge_key);
          if (badge) {
            celebrateToast({
              icon: badge.icon,
              title: `🎖️ Badge Unlocked: ${badge.label}`,
              subtitle: badge.desc,
              tier: badge.tier,
            });
          }
        }
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "community_reactions" }, (payload) => {
      // Reactions have no natural "updated" case (insert to like, delete to
      // unlike) and no id column consumers key off of for display, but
      // upsertLocal only needs payload.new/old.id to exist, which it does —
      // reused as-is for consistency with every other realtime table here.
      upsertLocal("communityReactions", payload);
      emit("communityReactions");
    })
    .subscribe((status) => {
      // The first SUBSCRIBED is just normal startup — nothing missed yet.
      // Any SUBSCRIBED after that means the socket had dropped and just
      // reconnected, so events during the gap could've been lost silently.
      // Catch up by refetching prospects straight away.
      if (status === "SUBSCRIBED") {
        if (hasConnectedBefore) refreshProspects();
        hasConnectedBefore = true;
      }
    });
}

function upsertLocal(key, payload) {
  const list = store[key];
  if (payload.eventType === "DELETE") {
    store[key] = list.filter((r) => r.id !== payload.old.id);
    return;
  }
  const idx = list.findIndex((r) => r.id === payload.new.id);
  if (idx === -1) store[key] = [payload.new, ...list];
  else {
    const copy = list.slice();
    copy[idx] = payload.new;
    store[key] = copy;
  }
}
