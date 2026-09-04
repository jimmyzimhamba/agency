"""
Google Places API integration (official API only — no scraping).
Uses Places Text Search and Place Details endpoints.
"""
import asyncio
from typing import Optional
import httpx
from backend.config import GOOGLE_MAPS_API_KEY, USER_AGENT, REQUEST_TIMEOUT, load_settings

PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
PLACES_DETAIL_URL = "https://places.googleapis.com/v1/places/{place_id}"

DETAIL_FIELDS = [
    "id", "displayName", "formattedAddress", "addressComponents",
    "location", "internationalPhoneNumber", "nationalPhoneNumber",
    "websiteUri", "rating", "userRatingCount",
    "regularOpeningHours", "photos", "businessStatus",
    "primaryType", "types",
]


async def text_search(query: str, location_bias: Optional[dict] = None) -> list[dict]:
    """Run a Places Text Search. Returns list of place dicts."""
    if not GOOGLE_MAPS_API_KEY:
        return []

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,"
                             "places.location,places.rating,places.userRatingCount,"
                             "places.internationalPhoneNumber,places.websiteUri,"
                             "places.addressComponents",
        "User-Agent": USER_AGENT,
    }

    body: dict = {"textQuery": query, "languageCode": "en", "maxResultCount": 20}
    if location_bias:
        body["locationBias"] = location_bias

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        try:
            resp = await client.post(PLACES_TEXT_SEARCH_URL, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            return data.get("places", [])
        except Exception as e:
            print(f"Places text search error: {e}")
            return []


def parse_place(place: dict, niche_id: str) -> dict:
    """Convert a Places API place dict into our prospect schema dict."""
    loc = place.get("location", {})
    name = place.get("displayName", {}).get("text", "")
    address = place.get("formattedAddress", "")
    suburb = ""
    city = "Harare"

    # Extract suburb and city from address components
    for comp in place.get("addressComponents", []):
        types = comp.get("types", [])
        text = comp.get("longText", "") or comp.get("shortText", "")
        if "sublocality" in types or "neighborhood" in types:
            suburb = text
        if "locality" in types:
            city = text

    phone = place.get("internationalPhoneNumber") or place.get("nationalPhoneNumber")

    # Normalize phone to WhatsApp-able format
    whatsapp = None
    if phone:
        digits = "".join(filter(str.isdigit, phone))
        if digits.startswith("263"):
            whatsapp = "+" + digits
        elif digits.startswith("0") and len(digits) >= 10:
            whatsapp = "+263" + digits[1:]

    return {
        "business_name": name,
        "niche": niche_id,
        "address": address,
        "suburb": suburb,
        "city": city,
        "lat": loc.get("latitude"),
        "lng": loc.get("longitude"),
        "google_place_id": place.get("id"),
        "phone": phone,
        "whatsapp": whatsapp,
        "website": place.get("websiteUri"),
        "google_rating": place.get("rating"),
        "review_count": place.get("userRatingCount", 0),
        "source": "places",
    }


async def discover_leads(niche_id: str, area: str, city: str = "Harare") -> list[dict]:
    """
    Run all queries for a niche in the given area.
    Returns a list of parsed prospect dicts.
    """
    settings = load_settings()
    queries = []
    for niche in settings.get("niches", []):
        if niche["id"] == niche_id:
            queries = niche.get("queries", [])
            break

    if not queries:
        return []

    all_places: dict[str, dict] = {}

    for query in queries:
        full_query = f"{query} in {area}, {city}, Zimbabwe"
        places = await text_search(full_query)
        for p in places:
            pid = p.get("id")
            if pid and pid not in all_places:
                all_places[pid] = p
        await asyncio.sleep(0.5)  # polite rate limiting

    return [parse_place(p, niche_id) for p in all_places.values()]
