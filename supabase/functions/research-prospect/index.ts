// ============================================================================
// STUDIO X COMMAND, Edge Function: research-prospect
// ============================================================================
// What this does, in plain language:
//   A teammate adds a new prospect in the app → the app calls this function
//   with that prospect's id → this function:
//     1. Checks the teammate is actually allowed to see that prospect, and
//        hasn't run too many researches in the last hour (cost/rate-limit
//        safety net).
//     2. Asks Claude (Anthropic's AI) to search the web for real, current
//        information about that business, then write a ready-to-send
//        3-line WhatsApp message in Studio X's voice, grounded ONLY in
//        what it actually found.
//     3. If research succeeds: saves the message + a short "what we found"
//        summary onto the prospect.
//     4. If research fails for any reason (business not findable online,
//        network hiccup, etc.): saves a clean, honest fallback message
//        instead, clearly flagged "auto-template, review before sending".
//   Runs entirely server-side, the Anthropic API key never touches the
//   app or the browser. See SETUP.md for how to deploy this and set that
//   key as a secret.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// How many research runs a single teammate can trigger per hour. This is the
// hard ceiling that stops a burst of prospect-adding from running up an API
// bill or tripping Anthropic's own rate limits, see SETUP.md for the actual
// cost this maps to (a few cents per prospect).
const RATE_LIMIT_PER_HOUR = 20;

// Caps how many web searches Claude can run for a single prospect. Each
// search costs a fixed, small amount, this is the other half of the cost
// safety net alongside the per-user hourly limit above.
const MAX_SEARCHES_PER_RESEARCH = 3;

const NICHE_FALLBACKS: Record<string, { cost: string; question: string }> = {
  "Real Estate Agencies": {
    cost: "gaps like that usually mean listing enquiries end up going to whichever agency posted most recently, not the one with the best properties.",
    question: "Would it be worth a quick chat about tightening that up?",
  },
  "Car Dealerships": {
    cost: "that usually means browsers scroll past to a dealership with more visible, up-to-date stock instead of picking up the phone.",
    question: "Open to a quick chat about it?",
  },
  "Professional Services (law, accounting, consulting)": {
    cost: "that tends to cost trust before a first enquiry ever comes in, since people check online before they call.",
    question: "Worth a short chat about it?",
  },
  "Solar Installers": {
    cost: "with how much demand there is for solar right now, gaps like that likely mean enquiries are going straight to a competitor with a stronger online presence.",
    question: "Would you be open to a quick chat about it?",
  },
  "Hotels & Lodges": {
    cost: "that usually translates to rooms that stay empty on nights they didn't need to.",
    question: "Worth a quick chat about it?",
  },
  "Events & Wedding Vendors": {
    cost: "in a fast-moving niche like weddings, gaps like that usually mean bookings go to whoever looks most active online, not necessarily the best vendor.",
    question: "Open to a quick chat about it?",
  },
  "Restaurants & Cafes": {
    cost: "that usually means less foot traffic than the food actually deserves.",
    question: "Would you be open to a quick chat about it?",
  },
  "Fashion & Boutiques": {
    cost: "that tends to mean fewer people turning a scroll into an actual sale.",
    question: "Worth a quick chat about it?",
  },
  "Fitness & Gyms": {
    cost: "that usually means fewer new members finding out about you before they sign up somewhere else.",
    question: "Open to a quick chat about it?",
  },
  "Private Healthcare & Clinics": {
    cost: "that tends to cost patient trust before a first enquiry ever comes in.",
    question: "Would you be open to a short chat about it?",
  },
};
const DEFAULT_FALLBACK = {
  cost: "gaps like that usually mean enquiries quietly go to a competitor who looks more active online.",
  question: "Would you be open to a quick chat about it?",
};

const RESEARCH_JSON_SCHEMA = {
  type: "object",
  properties: {
    found_business: { type: "boolean" },
    confidence: { type: "string", enum: ["verified", "partial", "none"] },
    research_summary: {
      type: "string",
      description: "2-3 short sentences, plain language, summarizing what was found (or that nothing verifiable was found).",
    },
    line1_observation: {
      type: "string",
      description: "Line 1 of the outreach message. Must open by naming the business itself, never a person.",
    },
    line2_cost: {
      type: "string",
      description: "Line 2 of the outreach message: what the gap is quietly costing this business.",
    },
    line3_question: {
      type: "string",
      description: "Line 3 of the outreach message: a single low-friction question, no pricing, no links.",
    },
    liora_conflict_suggested: {
      type: "boolean",
      description: "True only if this business is itself a beauty/aesthetics/skincare/salon/spa business.",
    },
  },
  required: [
    "found_business",
    "confidence",
    "research_summary",
    "line1_observation",
    "line2_cost",
    "line3_question",
    "liora_conflict_suggested",
  ],
  additionalProperties: false,
};

function buildSystemPrompt() {
  return `You are a research assistant for Studio X Marketing, a digital marketing agency in Harare, Zimbabwe that helps local businesses grow their online presence. Your job: research ONE specific business using web search, then write a ready-to-send 3-line WhatsApp outreach message in Studio X's brand voice.

STUDIO X BRAND VOICE: warm, direct, Zimbabwean, conversational. Never corporate, never fake-motivational, never full of buzzwords.

RESEARCH RULES:
- Use the web_search tool to look for the business's real online presence: Google Business/Maps listing, Instagram, Facebook, website, reviews.
- Only use SPECIFIC, VERIFIABLE findings: inconsistent posting, no visual identity/branding, broken or missing links, incorrect/incomplete Google listing info, low engagement relative to their size, few reviews for their apparent quality, or a mismatch between their reputation and their online presence.
- If you cannot find or verify this specific business online, do NOT invent or guess details. Set found_business to false and confidence to "none", and instead write a safe, general (but still specific-sounding) observation about that business's niche/industry in Harare that is very likely broadly true.

MESSAGE RULES. The message must follow this exact 3-line formula, no exceptions:
1. Line 1 (Observation): one specific observation about their online presence. This line MUST open by naming the business itself, e.g. "I came across {business_name}...". NEVER address a person or guess an owner's name, even if one turns up in research.
2. Line 2 (Cost): connect that gap to what it is quietly costing THIS business, phrased for their niche: lost bookings, enquiries going to louder competitors, lost mandates/clients, empty tables/rooms/appointments. Pick whichever is actually relevant.
3. Line 3 (One question): a single, low-friction question that opens a conversation. No pricing. No links. Not "let me know if interested", an actual question.

- Never write more than these 3 lines' worth of content. No greeting before, no extra pleasantries after.
- NEVER use an em dash or en dash anywhere in ANY field you return, including research_summary. Not one, not ever. Use a full stop, a comma, or "and"/"but". This is the single most common way a message gets spotted as machine-written, and a message that reads as machine-written does not get a reply.
- Never write a sender name. End the message content logically as if signed by the sender, but do NOT generate a name. The app adds "{{agent_name}}, Studio X Marketing, www.studioxmarketing.com" automatically after your line3_question, so line3_question should NOT include a signature itself.
- Keep it tight enough for WhatsApp. Short sentences, not a wall of text.

LIORA CONFLICT: Studio X also runs Liora, a beauty/aesthetics brand. If this business is itself a beauty/aesthetics/skincare/salon/spa business that would directly compete with Liora, set liora_conflict_suggested to true. Otherwise false.

Respond only through the structured output.`;
}

function buildUserPrompt(p: any, nicheName: string | null) {
  const lines = [
    `Business name: ${p.business_name}`,
    `Niche: ${nicheName || "Unknown"}`,
    `Area: ${p.area || "Unknown, assume Harare, Zimbabwe"}`,
    `Instagram: ${p.instagram || "not provided"}`,
    `Website: ${p.website || "not provided"}`,
    `WhatsApp number on file: ${p.whatsapp_number || "not provided"}`,
    `Notes already on file: ${p.gap_note || "none"}`,
  ];
  return `Research this business and write the outreach message.\n\n${lines.join("\n")}`;
}

// The em dash is banned from anything a prospect reads, because it is the
// clearest signal in written English that a message came out of a machine, and
// these messages go to Harare business owners under a real person's name.
//
// The prompt already forbids it, and this exists because that is not enough on
// its own. A model obeys a "never do X" instruction the vast majority of the
// time, and the failures are invisible: nobody reviewing a stack of twenty
// messages is going to spot the one dash that slipped through, which is
// exactly the one that then goes out. Enforcing it in code makes the rate zero
// rather than nearly zero.
//
// Doing it here rather than only in the app matters too, because this function
// is what WRITES the message into the database. Cleaning it at this point
// means the stored text is right, so it stays right no matter what reads it
// later, including anyone copying it straight out of Supabase.
function noDash(s: string) {
  return (s || "")
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2")
    .replace(/\s*[—–]\s*/g, ", ");
}

function buildOutreachMessage(line1: string, line2: string, line3: string) {
  return `${noDash(line1).trim()} ${noDash(line2).trim()} ${noDash(line3).trim()}\n\n{{agent_name}}, Studio X Marketing\nwww.studioxmarketing.com`;
}

function buildFallback(businessName: string, area: string, nicheName: string | null) {
  const areaClause = area ? ` in ${area}` : "";
  const f = (nicheName && NICHE_FALLBACKS[nicheName]) || DEFAULT_FALLBACK;
  const line1 = `I came across ${businessName}${areaClause} online, and it looks like there's room to build up a stronger, more consistent presence.`;
  const message = buildOutreachMessage(line1, f.cost, f.question);
  return {
    message,
    summary: "Automatic research wasn't able to verify specific details for this business. This is a general opener for their niche. Please review before sending.",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { prospect_id } = await req.json();
    if (!prospect_id) {
      return json({ error: "prospect_id is required" }, 400);
    }

    // Identify the caller from their login token (never trust a client-supplied user id).
    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Not signed in" }, 401);
    }
    const userId = userData.user.id;

    // Load the prospect + the caller's profile via the admin client (RLS is
    // bypassed here, so we re-check visibility by hand below).
    const { data: prospect, error: pErr } = await admin
      .from("prospects")
      .select("*")
      .eq("id", prospect_id)
      .single();
    if (pErr || !prospect) return json({ error: "Prospect not found" }, 404);

    const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).single();
    const isOwner = profile?.role === "owner";
    const canSee = isOwner || prospect.assigned_to === userId || prospect.created_by === userId;
    if (!canSee) return json({ error: "You don't have access to this prospect" }, 403);

    // Rate limit: cap research runs per teammate per hour.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("research_requests")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", userId)
      .gte("created_at", oneHourAgo);
    if ((count || 0) >= RATE_LIMIT_PER_HOUR) {
      return json(
        { error: `Research limit reached (${RATE_LIMIT_PER_HOUR}/hour). This keeps API costs in check. Try again shortly, or write this one by hand for now.` },
        429
      );
    }

    await admin.from("research_requests").insert({ requested_by: userId, prospect_id });
    await admin.from("prospects").update({ research_status: "researching" }).eq("id", prospect_id);

    let nicheName: string | null = null;
    if (prospect.niche_id) {
      const { data: niche } = await admin.from("niches").select("name").eq("id", prospect.niche_id).single();
      nicheName = niche?.name || null;
    }

    let outreach_message: string;
    let research_summary: string;
    let message_source: "ai_generated" | "auto_template";
    let research_status: "done" | "failed";
    let liora_conflict_suggested = false;

    if (!ANTHROPIC_API_KEY) {
      const fb = buildFallback(prospect.business_name, prospect.area, nicheName);
      outreach_message = fb.message;
      research_summary = "AI research isn't set up yet (no API key configured). Using a general opener for this niche. Please review before sending.";
      message_source = "auto_template";
      research_status = "failed";
    } else {
      try {
        const aiResult = await runResearch(ANTHROPIC_API_KEY, prospect, nicheName);
        if (aiResult && aiResult.confidence !== "none") {
          outreach_message = buildOutreachMessage(aiResult.line1_observation, aiResult.line2_cost, aiResult.line3_question);
          research_summary = aiResult.research_summary;
          message_source = "ai_generated";
          research_status = "done";
          liora_conflict_suggested = !!aiResult.liora_conflict_suggested;
        } else {
          // Claude looked but couldn't verify anything specific, still use
          // its niche-aware fallback line rather than ours, it's usually better.
          if (aiResult) {
            outreach_message = buildOutreachMessage(aiResult.line1_observation, aiResult.line2_cost, aiResult.line3_question);
            research_summary = aiResult.research_summary || "Couldn't verify specific details online for this business, so this is a general niche-based opener instead.";
          } else {
            const fb = buildFallback(prospect.business_name, prospect.area, nicheName);
            outreach_message = fb.message;
            research_summary = fb.summary;
          }
          message_source = "auto_template";
          research_status = "done";
          liora_conflict_suggested = !!aiResult?.liora_conflict_suggested;
        }
      } catch (aiError) {
        console.error("research-prospect: Anthropic call failed", aiError);
        const fb = buildFallback(prospect.business_name, prospect.area, nicheName);
        outreach_message = fb.message;
        research_summary = fb.summary;
        message_source = "auto_template";
        research_status = "failed";
      }
    }

    const updatePayload: Record<string, unknown> = {
      outreach_message,
      // Cleaned here as well as in buildOutreachMessage, because the summary is
      // a free-text field the model writes with no structure imposed on it,
      // and Jimmy reads it on screen next to the message itself.
      research_summary: noDash(research_summary),
      message_source,
      research_status,
      researched_at: new Date().toISOString(),
    };
    if (liora_conflict_suggested && !prospect.liora_conflict) {
      updatePayload.liora_conflict = true;
    }
    await admin.from("prospects").update(updatePayload).eq("id", prospect_id);

    await admin.from("activity_log").insert({
      actor_id: userId,
      prospect_id,
      message:
        research_status === "done" && message_source === "ai_generated"
          ? `AI research completed for ${prospect.business_name}`
          : `AI research unavailable for ${prospect.business_name}, auto-template used, needs review`,
    });

    return json({ ok: true, message_source, research_status, research_summary });
  } catch (e) {
    console.error("research-prospect: unexpected error", e);
    return json({ error: "Something went wrong running research" }, 500);
  }
});

async function runResearch(apiKey: string, prospect: any, nicheName: string | null) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1200,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: buildUserPrompt(prospect, nicheName) }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES_PER_RESEARCH }],
      output_config: { format: { type: "json_schema", schema: RESEARCH_JSON_SCHEMA } },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  const textBlock = (data.content || []).slice().reverse().find((b: any) => b.type === "text");
  if (!textBlock) throw new Error("No text block in Anthropic response");
  return JSON.parse(textBlock.text);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
