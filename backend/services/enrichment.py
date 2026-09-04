"""
Website enrichment and weakness audit service.
Fetches each prospect's own public homepage, respects robots.txt,
and detects signals that map to Studio X service angles.
"""
import asyncio
import json
import re
import time
from typing import Optional
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup

from backend.config import USER_AGENT, REQUEST_TIMEOUT, ENRICHMENT_RATE_LIMIT_SECONDS, load_settings

# Simple in-memory cache: url -> (timestamp, result)
_cache: dict[str, tuple[float, dict]] = {}
CACHE_TTL = 86400  # 24 hours


def _cache_get(key: str) -> Optional[dict]:
    if key in _cache:
        ts, val = _cache[key]
        if time.time() - ts < CACHE_TTL:
            return val
    return None


def _cache_set(key: str, val: dict):
    _cache[key] = (time.time(), val)


async def check_robots(client: httpx.AsyncClient, base_url: str) -> bool:
    """Returns True if crawling is allowed for our user agent."""
    try:
        robots_url = urljoin(base_url, "/robots.txt")
        r = await client.get(robots_url, timeout=5)
        if r.status_code == 200:
            parser = RobotFileParser()
            parser.parse(r.text.splitlines())
            return parser.can_fetch(USER_AGENT, base_url)
    except Exception:
        pass
    return True  # assume allowed if robots.txt missing or error


async def fetch_page(url: str) -> dict:
    """Fetch a public webpage and extract signals. Returns enrichment dict."""
    if not url:
        return {}

    cached = _cache_get(url)
    if cached is not None:
        return cached

    # Normalize URL
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    headers = {"User-Agent": USER_AGENT}
    result = {}

    async with httpx.AsyncClient(follow_redirects=True, timeout=REQUEST_TIMEOUT) as client:
        allowed = await check_robots(client, url)
        if not allowed:
            result["robots_blocked"] = True
            _cache_set(url, result)
            return result

        try:
            resp = await client.get(url, headers=headers)
            final_url = str(resp.url)
            result["status_code"] = resp.status_code
            result["is_https"] = final_url.startswith("https://")
            result["load_time_ms"] = None  # httpx doesn't expose timing easily
            result["final_url"] = final_url

            soup = BeautifulSoup(resp.text, "lxml")

            # Mobile viewport
            viewport = soup.find("meta", attrs={"name": re.compile(r"viewport", re.I)})
            result["has_viewport"] = viewport is not None

            # Emails in page
            emails = list(set(re.findall(
                r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
                resp.text
            )))
            # Filter out image/placeholder emails
            emails = [e for e in emails if not re.search(r"\.(png|jpg|gif|svg|webp)$", e, re.I)]
            result["emails"] = emails[:5]

            # Phone numbers (Zimbabwe formats: +263, 07x, 08x)
            phones = list(set(re.findall(
                r"(?:\+263|0)(?:7[1-8]|8[6-8])\d{7}|(?:\+263|0)\d{9}",
                resp.text
            )))
            result["phones"] = phones[:3]

            # Social links
            all_hrefs = [a.get("href", "") for a in soup.find_all("a", href=True)]
            result["instagram"] = next((h for h in all_hrefs if "instagram.com/" in h), None)
            result["facebook"] = next((h for h in all_hrefs if "facebook.com/" in h or "fb.com/" in h), None)
            result["linkedin"] = next((h for h in all_hrefs if "linkedin.com/" in h), None)
            result["whatsapp_link"] = next((h for h in all_hrefs if "wa.me/" in h or "api.whatsapp.com/" in h), None)

            # WhatsApp number from wa.me link
            if result["whatsapp_link"]:
                m = re.search(r"wa\.me/(\d+)", result["whatsapp_link"])
                if m:
                    result["whatsapp_number"] = "+" + m.group(1)

            # Contact form
            result["has_contact_form"] = bool(soup.find("form"))

            # Check for booking
            page_text = resp.text.lower()
            result["has_booking"] = any(w in page_text for w in ["book now", "book appointment", "schedule", "calendly", "bookly"])

            # Schema.org / structured data signals
            result["has_schema"] = bool(soup.find("script", type="application/ld+json"))

        except httpx.ConnectError:
            result["error"] = "connection_error"
        except httpx.TimeoutException:
            result["error"] = "timeout"
        except Exception as e:
            result["error"] = str(e)[:100]

    await asyncio.sleep(ENRICHMENT_RATE_LIMIT_SECONDS)
    _cache_set(url, result)
    return result


def detect_weaknesses(prospect_data: dict, page_data: dict, niche_id: str) -> list[dict]:
    """
    Detect weaknesses and return a list of dicts with:
      code, label, detail, service_angle, opener_fragment
    """
    settings = load_settings()
    niche_angles = {}
    for n in settings.get("niches", []):
        if n["id"] == niche_id:
            niche_angles = n.get("service_angles", {})
            break

    weaknesses = []

    def add(code: str, label: str, detail: str, opener: str):
        weaknesses.append({
            "code": code,
            "label": label,
            "detail": detail,
            "service_angle": niche_angles.get(code, detail),
            "opener_fragment": opener,
        })

    has_website = bool(prospect_data.get("website"))
    page_error = page_data.get("error") or page_data.get("robots_blocked")

    if not has_website:
        add("no_website", "No website found",
            "This business has no public website.",
            "I couldn't find a website for you")

    elif page_error:
        add("no_website", "Website unreachable",
            f"Website returned an error: {page_error}",
            "your website seems to be down")
    else:
        if not page_data.get("is_https"):
            add("no_https", "Website not secure (no HTTPS)",
                "The website loads over HTTP, not HTTPS.",
                "your website is flagged as not secure")

        if not page_data.get("has_viewport"):
            add("slow_website", "Not mobile-friendly",
                "No mobile viewport meta tag detected.",
                "your website isn't mobile-friendly")

        if not page_data.get("has_contact_form") and not page_data.get("emails"):
            add("no_booking", "No clear contact path on website",
                "No contact form or email found on the site.",
                "there's no easy way for customers to contact you online")

    rating = prospect_data.get("google_rating") or 0
    review_count = prospect_data.get("review_count") or 0

    if rating == 0 and review_count == 0:
        add("low_reviews", "No Google Business Profile / reviews",
            "No Google rating or reviews found.",
            "you have no Google reviews showing")
    elif review_count < 15:
        add("low_reviews", f"Only {review_count} Google reviews",
            f"Low review count ({review_count}) reduces trust.",
            f"you only have {review_count} Google reviews")
    elif rating < 4.0:
        add("low_reviews", f"Google rating below 4.0 ({rating}★)",
            f"Rating of {rating} is below the trust threshold.",
            f"your {rating}★ Google rating is costing you bookings")

    ig = prospect_data.get("instagram") or page_data.get("instagram")
    if not ig:
        add("no_instagram", "No Instagram presence",
            "No Instagram account found.",
            "you have no Instagram presence")

    fb = prospect_data.get("facebook") or page_data.get("facebook")
    if not fb:
        add("no_facebook", "No Facebook page",
            "No Facebook business page found.",
            "you have no Facebook page")

    wa = prospect_data.get("whatsapp") or page_data.get("whatsapp_number")
    if not wa:
        add("no_whatsapp", "No WhatsApp Business contact",
            "No WhatsApp number found publicly.",
            "customers can't reach you on WhatsApp")

    return weaknesses


def pick_opening_line(business_name: str, weaknesses: list[dict], recommended_channel: str) -> str:
    if not weaknesses:
        return f"Hi, I came across {business_name} and noticed a few things I could help with."

    top = weaknesses[0]
    opener = top["opener_fragment"]
    name = business_name

    if recommended_channel == "whatsapp":
        return f"Hey! I came across {name} and noticed {opener} — quick question, is that something you're working on?"
    elif recommended_channel in ("instagram", "facebook"):
        return f"Hey! Saw {name}'s page and noticed {opener}. Do you handle your own marketing?"
    elif recommended_channel == "email":
        return f"Hi, I came across {name} recently and noticed {opener}. I help businesses like yours fix this fast — worth a quick chat?"
    else:
        return f"Hi, I noticed {opener} when I looked at {name} online. I think we can fix that — got a minute to talk?"


def recommend_channel(prospect_data: dict, page_data: dict) -> tuple[str, str]:
    """Returns (channel, reason)."""
    wa = (
        prospect_data.get("whatsapp") or
        page_data.get("whatsapp_number") or
        prospect_data.get("phone")
    )
    if wa:
        return "whatsapp", "Highest open rate in Zimbabwe. WhatsApp is where business actually happens here."

    ig = prospect_data.get("instagram") or page_data.get("instagram")
    if ig:
        return "instagram", "They're active on Instagram — a DM shows you actually looked at their page."

    fb = prospect_data.get("facebook") or page_data.get("facebook")
    if fb:
        return "facebook", "Facebook DM is warm and direct — much better than a cold email."

    email = prospect_data.get("email") or (page_data.get("emails", [None])[0] if page_data.get("emails") else None)
    if email:
        return "email", "Email suits a more formal approach — good for larger or corporate businesses."

    li = prospect_data.get("linkedin") or page_data.get("linkedin")
    if li:
        return "linkedin", "LinkedIn reaches the decision maker directly — useful for B2B or corporate targets."

    phone = prospect_data.get("phone")
    if phone:
        return "call", "No digital channel found — a direct call or walk-in is the move for a high-value local business."

    return "visit", "Thin digital footprint — a walk-in or referral is the best path in."


async def enrich_prospect(prospect_dict: dict) -> dict:
    """
    Full enrichment pipeline for one prospect.
    Returns dict of fields to update on the Prospect model.
    """
    website = prospect_dict.get("website") or ""
    page_data = await fetch_page(website) if website else {}

    # Merge found contacts from page into prospect_dict for channel logic
    enriched = dict(prospect_dict)
    if page_data.get("emails") and not enriched.get("email"):
        enriched["email"] = page_data["emails"][0]
    if page_data.get("whatsapp_number") and not enriched.get("whatsapp"):
        enriched["whatsapp"] = page_data["whatsapp_number"]
    if page_data.get("instagram") and not enriched.get("instagram"):
        enriched["instagram"] = page_data["instagram"]
    if page_data.get("facebook") and not enriched.get("facebook"):
        enriched["facebook"] = page_data["facebook"]
    if page_data.get("linkedin") and not enriched.get("linkedin"):
        enriched["linkedin"] = page_data["linkedin"]

    niche_id = prospect_dict.get("niche", "aesthetics")
    weaknesses = detect_weaknesses(enriched, page_data, niche_id)
    channel, reason = recommend_channel(enriched, page_data)
    opening_line = pick_opening_line(enriched.get("business_name", "your business"), weaknesses, channel)

    updates = {
        "weaknesses": json.dumps(weaknesses),
        "recommended_channel": channel,
        "recommended_reason": reason,
        "opening_line": opening_line,
        "enrichment_status": "done",
    }

    # Update discovered contacts
    if enriched.get("email") and not prospect_dict.get("email"):
        updates["email"] = enriched["email"]
    if enriched.get("whatsapp") and not prospect_dict.get("whatsapp"):
        updates["whatsapp"] = enriched["whatsapp"]
    if enriched.get("instagram") and not prospect_dict.get("instagram"):
        updates["instagram"] = enriched["instagram"]
    if enriched.get("facebook") and not prospect_dict.get("facebook"):
        updates["facebook"] = enriched["facebook"]
    if enriched.get("linkedin") and not prospect_dict.get("linkedin"):
        updates["linkedin"] = enriched["linkedin"]

    return updates
