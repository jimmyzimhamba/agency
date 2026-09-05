import { sb } from "./supabaseClient.js";

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

  const [organization, profiles, niches, prospects, templates, dailyTasks, dailyCompletions, agentTargets, activityLog, monthlyGoal, contracts, invoices, projects, projectTasks, gridPlans, gridPosts, gridPostMedia, servicePackages, portfolioSettings, portfolioItems, communityPosts, communityComments, communityReactions] =
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

  emit("organization"); emit("profiles"); emit("niches"); emit("prospects"); emit("templates");
  emit("dailyTasks"); emit("dailyCompletions"); emit("agentTargets");
  emit("activityLog"); emit("monthlyGoal");
  emit("contracts"); emit("invoices"); emit("projects"); emit("projectTasks");
  emit("gridPlans"); emit("gridPosts"); emit("gridPostMedia");
  emit("servicePackages");
  emit("portfolioSettings"); emit("portfolioItems");
  emit("communityPosts"); emit("communityComments"); emit("communityReactions");
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
