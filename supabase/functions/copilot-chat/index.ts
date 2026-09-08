// ============================================================================
// STUDIO X COMMAND, Edge Function: copilot-chat
// ============================================================================
// What this does, in plain language:
//   The "Phoenix" tab lets a teammate type a question like "who hasn't been
//   followed up with this week?" or "what's our signed MRR right now?", //   this function:
//     1. Checks the teammate is signed in and hasn't sent too many messages
//        in the last hour (cost/rate-limit safety net).
//     2. Sends the question to Claude (Anthropic's AI) along with a set of
//        "tools" it can call to look up real pipeline/task/activity/finance
//        data, Claude decides which tools it actually needs, this function
//        runs them against the real database (respecting the same visibility
//        rules as the rest of the app, an agent only sees their own
//        prospects, an owner sees everything), and feeds the results back to
//        Claude until it has a final answer.
//     3. Returns that final answer as plain text.
//   Runs entirely server-side, the Anthropic API key never touches the app
//   or the browser. Reuses the same ANTHROPIC_API_KEY secret as AI Research
//   (see SETUP.md Step 8), no separate key needed. Conversation history is
//   NOT saved anywhere; the frontend keeps it in memory for the current
//   session only and resends it each turn.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// How many chat messages a single teammate can send per hour. Interactive
// chat naturally sends more requests than the one-shot AI features, so this
// is higher than research/discovery's limits, see SETUP.md for the cost
// this maps to.
const RATE_LIMIT_PER_HOUR = 30;

// Caps how many back-and-forth tool lookups Claude can do for one question,
// so a confused loop can't run away and burn tokens.
const MAX_TOOL_ITERATIONS = 4;

// Only the last N turns of conversation are sent to Claude, to keep token
// usage (and cost) predictable even in a long chat session.
const MAX_HISTORY_MESSAGES = 16;

const TOOLS = [
  {
    name: "get_pipeline_overview",
    description:
      "Get a summary of the sales pipeline: how many prospects are in each status (not_contacted, sent, replied, meeting_booked, signed, dead), how many in each tier (A/B/C), total signed MRR, and how many have an overdue follow-up date. Scoped to what the caller can see.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_prospects",
    description:
      "Search/filter the prospect list. Use this to find specific businesses or a filtered list (e.g. 'tier A prospects that haven't been contacted', 'prospects in the Fitness niche'). Returns at most 15 results.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to match against the business name (partial match, case-insensitive)." },
        status: { type: "string", enum: ["not_contacted", "sent", "replied", "meeting_booked", "signed", "dead"] },
        tier: { type: "string", enum: ["A", "B", "C"] },
        niche: { type: "string", description: "Niche name to filter by (partial match, case-insensitive)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_prospect",
    description: "Get full detail on one specific business by name, including its latest notes and status history.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "The business name (or part of it) to look up." } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "get_tasks_today",
    description: "Get today's daily task checklist and completion status for the caller (or, for an owner, a team-wide breakdown).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_team_activity",
    description: "Get the most recent team activity feed entries (prospect status changes, notes added, contracts/invoices created, etc).",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer", description: "How many entries to return, default 15, max 40." } },
      additionalProperties: false,
    },
  },
  {
    name: "get_financial_summary",
    description: "Get a summary of contracts (draft/sent/signed/void) and invoices (draft/sent/paid/void, overdue count) for the whole organization.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

// House rule across this whole app: the em dash never reaches a human. It is
// the most recognisable fingerprint of AI-written text, and the credibility of
// everything this tool produces depends on not reading like a machine wrote
// it. The system prompt below says so too; this is the version that cannot be
// ignored, because a prompt rule is followed almost always and "almost" is not
// good enough when the output goes straight onto someone's screen unread.
function noDash(s: string) {
  return (s || "")
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, "$1 to $2")
    .replace(/\s*[\u2014\u2013]\s*/g, ", ");
}

function buildSystemPrompt(callerName: string, callerRole: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Phoenix, an AI assistant built into Studio X Command, the internal sales tool for Studio X Marketing, a digital marketing agency in Harare, Zimbabwe. You're talking to ${callerName} (role: ${callerRole}). Today's date is ${today}.

Answer questions about the team's sales pipeline, tasks, activity, and finances using the tools provided. Rules:
- Only state facts that came from a tool result. Never guess or invent numbers, names, or dates.
- If a tool returns nothing relevant, say so plainly instead of making something up.
- Money is in USD. Keep answers short and conversational. Plain language, no corporate tone, no markdown headers or tables unless the data genuinely needs a list.
- NEVER use an em dash or an en dash. Use a full stop, a comma, or "and"/"but". It reads as machine-written and this team does not write that way.
- If asked something outside what your tools can look up (e.g. general marketing advice, not this org's data), you can still answer helpfully using your own knowledge, but say clearly when you're doing that instead of quoting data.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

  if (!ANTHROPIC_API_KEY) {
    return json({ error: "Phoenix isn't set up yet. Ask the owner to add an Anthropic API key in Supabase (same one used for AI Research)." }, 501);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { message, history } = await req.json();
    if (!message || typeof message !== "string" || !message.trim()) {
      return json({ error: "message is required" }, 400);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Not signed in" }, 401);
    }
    const userId = userData.user.id;

    const { data: profile } = await admin
      .from("profiles")
      .select("org_id, full_name, role")
      .eq("id", userId)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);
    const isOwner = profile.role === "owner";
    const orgId = profile.org_id;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("copilot_requests")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", userId)
      .gte("created_at", oneHourAgo);
    if ((count || 0) >= RATE_LIMIT_PER_HOUR) {
      return json(
        { error: `Phoenix limit reached (${RATE_LIMIT_PER_HOUR} messages/hour). This keeps API costs in check. Try again shortly.` },
        429
      );
    }
    await admin.from("copilot_requests").insert({ org_id: orgId, requested_by: userId });

    const ctx = { admin, orgId, userId, isOwner };

    const priorTurns = Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES) : [];
    const messages: any[] = priorTurns
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map((m: any) => ({ role: m.role, content: m.content }));
    messages.push({ role: "user", content: message });

    const system = buildSystemPrompt(profile.full_name || "there", profile.role || "agent");
    const finalText = await runCopilotLoop(ANTHROPIC_API_KEY, system, messages, ctx);

    return json({ ok: true, reply: finalText });
  } catch (e) {
    console.error("copilot-chat: unexpected error", e);
    return json({ error: "Something went wrong answering that." }, 500);
  }
});

async function runCopilotLoop(apiKey: string, system: string, messages: any[], ctx: any) {
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system,
        messages,
        tools: TOOLS,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Anthropic API ${resp.status}: ${body}`);
    }
    const data = await resp.json();
    const content = data.content || [];

    if (data.stop_reason !== "tool_use") {
      const textBlock = content.find((b: any) => b.type === "text");
      return noDash(textBlock?.text || "") || "I couldn't come up with an answer to that. Try rephrasing?";
    }

    messages.push({ role: "assistant", content });

    const toolResults = [];
    for (const block of content) {
      if (block.type !== "tool_use") continue;
      let result;
      try {
        result = await executeTool(block.name, block.input || {}, ctx);
      } catch (toolErr) {
        console.error(`copilot-chat: tool ${block.name} failed`, toolErr);
        result = { error: "That lookup failed. Try a different question." };
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return "That took more digging than I could finish. Try asking a more specific question.";
}

// ----------------------------------------------------------------------------
// Tool executors, each one re-implements the same visibility rule the rest
// of the app enforces via RLS (owner sees everything in the org; an agent
// only sees prospects assigned to them or that they created), since the
// admin client bypasses RLS entirely.
// ----------------------------------------------------------------------------

function scopedProspects(ctx: any) {
  let q = ctx.admin.from("prospects").select("*").eq("org_id", ctx.orgId);
  if (!ctx.isOwner) q = q.or(`assigned_to.eq.${ctx.userId},created_by.eq.${ctx.userId}`);
  return q;
}

async function executeTool(name: string, input: any, ctx: any) {
  switch (name) {
    case "get_pipeline_overview":
      return getPipelineOverview(ctx);
    case "search_prospects":
      return searchProspects(input, ctx);
    case "get_prospect":
      return getProspect(input, ctx);
    case "get_tasks_today":
      return getTasksToday(ctx);
    case "get_team_activity":
      return getTeamActivity(input, ctx);
    case "get_financial_summary":
      return getFinancialSummary(ctx);
    default:
      return { error: `Unknown tool ${name}` };
  }
}

async function getPipelineOverview(ctx: any) {
  const { data: prospects, error } = await scopedProspects(ctx).select("status, tier, mrr, follow_up_date");
  if (error) return { error: error.message };
  const today = new Date().toISOString().slice(0, 10);
  const byStatus: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  let signedMrr = 0;
  let overdueFollowUps = 0;
  for (const p of prospects || []) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    byTier[p.tier] = (byTier[p.tier] || 0) + 1;
    if (p.status === "signed") signedMrr += Number(p.mrr || 0);
    if (p.follow_up_date && p.follow_up_date < today && p.status !== "signed" && p.status !== "dead") {
      overdueFollowUps++;
    }
  }
  return { total_prospects: (prospects || []).length, by_status: byStatus, by_tier: byTier, total_signed_mrr: signedMrr, overdue_follow_ups: overdueFollowUps };
}

async function searchProspects(input: any, ctx: any) {
  let q = scopedProspects(ctx).select("business_name, status, tier, area, niche_id, mrr, follow_up_date, whatsapp_number").limit(15);
  if (input.query) q = q.ilike("business_name", `%${input.query}%`);
  if (input.status) q = q.eq("status", input.status);
  if (input.tier) q = q.eq("tier", input.tier);
  if (input.niche) {
    const { data: niches } = await ctx.admin.from("niches").select("id").eq("org_id", ctx.orgId).ilike("name", `%${input.niche}%`);
    const nicheIds = (niches || []).map((n: any) => n.id);
    if (nicheIds.length === 0) return { results: [] };
    q = q.in("niche_id", nicheIds);
  }
  const { data, error } = await q;
  if (error) return { error: error.message };
  return { results: (data || []).map(({ niche_id, ...rest }: any) => rest) };
}

async function getProspect(input: any, ctx: any) {
  const name = (input.name || "").trim();
  if (!name) return { error: "No name given" };
  const { data: matches, error } = await scopedProspects(ctx).ilike("business_name", `%${name}%`).limit(1);
  if (error) return { error: error.message };
  const p = matches?.[0];
  if (!p) return { found: false, message: "No prospect found matching that name (or you don't have access to it)." };

  const { data: notes } = await ctx.admin
    .from("prospect_notes")
    .select("body, created_at")
    .eq("prospect_id", p.id)
    .order("created_at", { ascending: false })
    .limit(5);
  const { data: history } = await ctx.admin
    .from("status_history")
    .select("old_status, new_status, changed_at")
    .eq("prospect_id", p.id)
    .order("changed_at", { ascending: false })
    .limit(5);

  return {
    found: true,
    business_name: p.business_name,
    status: p.status,
    tier: p.tier,
    area: p.area,
    whatsapp_number: p.whatsapp_number,
    website: p.website,
    mrr: p.mrr,
    follow_up_date: p.follow_up_date,
    gap_note: p.gap_note,
    research_summary: p.research_summary,
    recent_notes: (notes || []).map((n: any) => n.body),
    recent_status_changes: history || [],
  };
}

async function getTasksToday(ctx: any) {
  const { data: tasks, error } = await ctx.admin
    .from("daily_tasks")
    .select("id, title, day_type, assigned_to")
    .eq("org_id", ctx.orgId)
    .eq("active", true)
    .order("sort_order");
  if (error) return { error: error.message };

  const today = new Date().toISOString().slice(0, 10);
  const { data: completions } = await ctx.admin
    .from("daily_task_completions")
    .select("task_id, agent_id, completed")
    .eq("org_id", ctx.orgId)
    .eq("work_date", today);

  if (ctx.isOwner) {
    const relevant = (tasks || []);
    const done = (completions || []).filter((c: any) => c.completed).length;
    return { scope: "team", total_tasks: relevant.length, total_completions_today: done };
  }

  const myTasks = (tasks || []).filter((t: any) => !t.assigned_to || t.assigned_to === ctx.userId);
  const myCompletions = new Set(
    (completions || []).filter((c: any) => c.agent_id === ctx.userId && c.completed).map((c: any) => c.task_id)
  );
  return {
    scope: "personal",
    tasks: myTasks.map((t: any) => ({ title: t.title, day_type: t.day_type, completed_today: myCompletions.has(t.id) })),
  };
}

async function getTeamActivity(input: any, ctx: any) {
  const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 40);
  const { data: rows, error } = await ctx.admin
    .from("activity_log")
    .select("message, prospect_id, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(limit * 3);
  if (error) return { error: error.message };

  if (ctx.isOwner) {
    return { entries: (rows || []).slice(0, limit).map((r: any) => ({ message: r.message, at: r.created_at })) };
  }

  const prospectIds = [...new Set((rows || []).filter((r: any) => r.prospect_id).map((r: any) => r.prospect_id))];
  let visibleIds = new Set<string>();
  if (prospectIds.length) {
    const { data: visible } = await ctx.admin
      .from("prospects")
      .select("id")
      .in("id", prospectIds)
      .or(`assigned_to.eq.${ctx.userId},created_by.eq.${ctx.userId}`);
    visibleIds = new Set((visible || []).map((p: any) => p.id));
  }
  const filtered = (rows || []).filter((r: any) => !r.prospect_id || visibleIds.has(r.prospect_id)).slice(0, limit);
  return { entries: filtered.map((r: any) => ({ message: r.message, at: r.created_at })) };
}

async function getFinancialSummary(ctx: any) {
  const { data: contracts, error: cErr } = await ctx.admin.from("contracts").select("status, value").eq("org_id", ctx.orgId);
  if (cErr) return { error: cErr.message };
  const { data: invoices, error: iErr } = await ctx.admin.from("invoices").select("status, amount, due_date").eq("org_id", ctx.orgId);
  if (iErr) return { error: iErr.message };

  const contractsByStatus: Record<string, { count: number; total_value: number }> = {};
  for (const c of contracts || []) {
    const bucket = contractsByStatus[c.status] || { count: 0, total_value: 0 };
    bucket.count++;
    bucket.total_value += Number(c.value || 0);
    contractsByStatus[c.status] = bucket;
  }

  const today = new Date().toISOString().slice(0, 10);
  const invoicesByStatus: Record<string, { count: number; total_amount: number }> = {};
  let overdueCount = 0;
  for (const inv of invoices || []) {
    const bucket = invoicesByStatus[inv.status] || { count: 0, total_amount: 0 };
    bucket.count++;
    bucket.total_amount += Number(inv.amount || 0);
    invoicesByStatus[inv.status] = bucket;
    if (inv.due_date && inv.due_date < today && inv.status !== "paid" && inv.status !== "void") overdueCount++;
  }

  return { contracts_by_status: contractsByStatus, invoices_by_status: invoicesByStatus, overdue_invoices: overdueCount };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
