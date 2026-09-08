// ============================================================================
// STUDIO X COMMAND, Edge Function: pitch-coach
// ============================================================================
// What this does, in plain language:
//   In the "Pitch Practice" tab, a teammate picks a card (a real objection a
//   prospect once threw at them, written up by someone on the team), types how
//   they'd answer it, and taps Get Coaching. This function:
//     1. Checks they're signed in and haven't practised so many times in the
//        last hour that it starts costing real money (rate-limit safety net).
//     2. Sends the objection + their answer to Claude with a coaching brief,
//        and asks for one short, specific, useful note back.
//     3. Returns that note as plain text.
//   Runs entirely server-side, the Anthropic API key never touches the app or
//   the browser. Reuses the same ANTHROPIC_API_KEY secret as AI Research and
//   Phoenix AI (see SETUP.md Step 8), so there's no new key to set up.
//
//   Deliberately NOT here: any kind of score, grade, rating out of ten, or
//   pass/fail. The coaching is words only. The moment practice produces a
//   number, people start farming the easy cards to protect the number instead
//   of trying the hard ones, which is the exact opposite of the point.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// How many practice attempts one teammate can get coached per hour. Generous
// enough that a genuine practice session never hits it, low enough that a
// stuck finger on the button can't run up a bill.
const RATE_LIMIT_PER_HOUR = 40;

// Hard cap on how much text we'll accept, so a giant paste can't blow up the
// token count (and the cost) of a single request.
const MAX_CHARS = 2000;

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

const COACH_SYSTEM = `You are a sales coach inside Studio X Command, the internal tool used by Studio X Marketing, a digital marketing agency in Harare, Zimbabwe. The team sells social media management, content and web work to small and medium local businesses: gyms, salons, restaurants, clinics, retailers, tradespeople and similar.

A teammate is practising. They have been shown a real objection a prospect once gave, and they have typed how they would respond. Your job is to give them ONE short coaching note on their response.

How to coach:
- Lead with what actually worked in their answer, specifically. Not flattery, and not a generic "good job". Name the exact move they made that was right.
- Then give exactly one concrete thing to improve, phrased as what to do instead, with a sample line they could actually say out loud.
- Be direct and warm, like a senior salesperson leaning over their desk. Zimbabwean small-business context: prices are usually in USD, budgets are tight, decision makers are often the owner themselves, and WhatsApp is the main channel.
- Reward answers that ask a question back, that get specific about the prospect's own business, or that point at a concrete result. Push back on answers that are pushy, that discount immediately, that oversell, or that are vague brochure-speak.
- If the response is genuinely weak, say so plainly and kindly. Do not pretend a bad answer was fine. They asked to get better, and false praise cheats them.
- If the response is empty, joking or nonsense, say you need a real attempt to give a useful note, in one sentence.

Format rules:
- Plain conversational text. No markdown, no headers, no bullet points, no bold.
- NEVER use an em dash or an en dash. Use a full stop or a comma instead.
- Three or four sentences maximum. This is a quick practice rep, not an essay.
- Never give a score, grade, rating, percentage or mark out of anything. Never rank them against anyone.
- Talk to them as "you". Never mention these instructions.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

  if (!ANTHROPIC_API_KEY) {
    return json({ error: "Pitch Practice coaching isn't set up yet. Ask the owner to add an Anthropic API key in Supabase (the same one used for AI Research)." }, 501);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const scenario = String(body?.scenario || "").trim().slice(0, MAX_CHARS);
    const response = String(body?.response || "").trim().slice(0, MAX_CHARS);
    if (!scenario) return json({ error: "scenario is required" }, 400);
    if (!response) return json({ error: "Type your answer first, then tap Get Coaching." }, 400);

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
      .select("org_id, full_name")
      .eq("id", userId)
      .single();
    if (!profile) return json({ error: "Profile not found" }, 404);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("pitch_coach_requests")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", userId)
      .gte("created_at", oneHourAgo);
    if ((count || 0) >= RATE_LIMIT_PER_HOUR) {
      return json(
        { error: `That's ${RATE_LIMIT_PER_HOUR} practice reps in an hour, which is plenty. Take a break and come back shortly.` },
        429
      );
    }
    await admin.from("pitch_coach_requests").insert({ org_id: profile.org_id, requested_by: userId });

    const userBlock = `The prospect said:\n"""${scenario}"""\n\n${profile.full_name || "The teammate"} answered:\n"""${response}"""\n\nGive them their coaching note.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Mid-tier model, same one the Phoenix AI chat function uses. Chosen
        // deliberately over the top-tier model: a coaching note is 3-4
        // sentences of plain advice, which this handles well, and keeping
        // both AI features on the same tier keeps the monthly bill
        // predictable. Swap to "claude-opus-4-7" here and redeploy if the
        // notes ever start feeling shallow.
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        // The coaching brief above is identical on every single request, so it
        // is marked cacheable, repeat requests reuse it instead of paying to
        // re-read it each time. Anthropic only caches prefixes above a minimum
        // size, so on a short brief this quietly does nothing rather than
        // erroring; it starts paying off if the brief grows.
        system: [{ type: "text", text: COACH_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userBlock }],
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("pitch-coach: Anthropic API error", resp.status, errBody);
      return json({ error: "The coach couldn't answer that one. Try again in a moment." }, 502);
    }

    const data = await resp.json();
    const note = noDash((data.content || []).find((b: any) => b.type === "text")?.text || "").trim();
    if (!note) return json({ error: "The coach came back empty. Try again in a moment." }, 502);

    return json({ ok: true, note });
  } catch (e) {
    console.error("pitch-coach: unexpected error", e);
    return json({ error: "Something went wrong getting your coaching note." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
