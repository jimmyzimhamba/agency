// ============================================================================
// STUDIO X COMMAND, Edge Function: discover-places
// ============================================================================
// What this does, in plain language:
//   A teammate picks a niche (e.g. "Solar Installers") and types an area
//   (e.g. "Borrowdale") in the Discovery tab → the app calls this function →
//   this function:
//     1. Checks the teammate hasn't run too many searches in the last hour
//        (cost/rate-limit safety net, Google charges per search).
//     2. Asks Google Places to search for real businesses matching that
//        niche + area.
//     3. Checks which of those businesses are already somewhere in this
//        organization's pipeline (by Google listing id), so the app can
//        grey those out instead of offering to add them again.
//     4. Returns a clean, ready-to-review list, nothing is added to the
//        pipeline automatically. A human still picks which ones to add.
//   Runs entirely server-side, the Google Maps API key never touches the
//   app or the browser. See SETUP.md for how to deploy this and set that
//   key as a secret.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// How many searches a single teammate can trigger per hour. Google bills
// per search, so this is the hard ceiling that stops a burst of searching
// from running up the bill by accident.
const RATE_LIMIT_PER_HOUR = 12;

// Google's Text Search (New) endpoint caps a single request at 20 results.
const MAX_RESULTS = 20;

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.internationalPhoneNumber",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
].join(",");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { niche_id, area } = await req.json();
    if (!niche_id) {
      return json({ error: "niche_id is required" }, 400);
    }

    if (!GOOGLE_MAPS_API_KEY) {
      return json({ error: "Discovery isn't set up yet. Ask the owner to add a Google Maps API key in Supabase." }, 501);
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

    const { data: profile } = await admin.from("profiles").select("org_id").eq("id", userId).single();
    if (!profile?.org_id) return json({ error: "No organization found for this account" }, 403);
    const orgId = profile.org_id;

    const { data: niche, error: nicheErr } = await admin
      .from("niches")
      .select("name, search_query")
      .eq("id", niche_id)
      .eq("org_id", orgId)
      .single();
    if (nicheErr || !niche) return json({ error: "Niche not found" }, 404);

    // Rate limit: cap searches per teammate per hour.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("discovery_requests")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", userId)
      .gte("created_at", oneHourAgo);
    if ((count || 0) >= RATE_LIMIT_PER_HOUR) {
      return json(
        { error: `Search limit reached (${RATE_LIMIT_PER_HOUR}/hour). This keeps API costs in check. Try again shortly.` },
        429
      );
    }

    await admin.from("discovery_requests").insert({ org_id: orgId, requested_by: userId });

    const queryBase = (niche.search_query || "").trim() || niche.name;
    const areaClause = (area || "").trim();
    const textQuery = areaClause
      ? `${queryBase} in ${areaClause}, Zimbabwe`
      : `${queryBase} in Harare, Zimbabwe`;

    const places = await searchGooglePlaces(GOOGLE_MAPS_API_KEY, textQuery);

    const placeIds = places.map((p: any) => p.id).filter(Boolean);
    let alreadyAdded = new Set<string>();
    if (placeIds.length) {
      const { data: existing } = await admin
        .from("prospects")
        .select("google_place_id")
        .eq("org_id", orgId)
        .in("google_place_id", placeIds);
      alreadyAdded = new Set((existing || []).map((r: any) => r.google_place_id));
    }

    const results = places.map((p: any) => normalizePlace(p, alreadyAdded));

    return json({ ok: true, results, query: textQuery });
  } catch (e) {
    console.error("discover-places: unexpected error", e);
    return json({ error: "Something went wrong searching Google Maps" }, 500);
  }
});

async function searchGooglePlaces(apiKey: string, textQuery: string) {
  const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      languageCode: "en",
      maxResultCount: MAX_RESULTS,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Google Places API ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  return data.places || [];
}

// Google returns phone numbers as "+263 77 123 4567", the app's existing
// prospect records use the local "0..." format everywhere else (matching
// how a teammate would type it by hand), so numbers are normalized here to
// stay consistent with bulk-import/manual-add data.
function normalizePhone(raw: string | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+263")) return "0" + digits.slice(4);
  if (digits.startsWith("263")) return "0" + digits.slice(3);
  return digits;
}

function addressComponent(components: any[] | undefined, ...types: string[]): string {
  if (!components) return "";
  for (const type of types) {
    const match = components.find((c: any) => (c.types || []).includes(type));
    if (match?.longText) return match.longText;
  }
  return "";
}

function normalizePlace(p: any, alreadyAdded: Set<string>) {
  const components = p.addressComponents;
  return {
    google_place_id: p.id,
    business_name: p.displayName?.text || "Untitled Business",
    formatted_address: p.formattedAddress || "",
    area: addressComponent(components, "sublocality", "neighborhood") || "",
    city: addressComponent(components, "locality") || "Harare",
    whatsapp_number: normalizePhone(p.internationalPhoneNumber || p.nationalPhoneNumber),
    website: p.websiteUri || "",
    rating: typeof p.rating === "number" ? p.rating : null,
    user_rating_count: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    business_status: p.businessStatus || null,
    already_added: alreadyAdded.has(p.id),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
