"""
HOT / WARM / COLD scoring logic.

HOT:  has_contact AND has_weakness AND (rating >= 4.0 OR premium_niche signals)
WARM: has_contact AND (has_weakness OR decent_signals)
COLD: no_contact OR no_weakness AND no_signals
"""
import json
from typing import Optional

PREMIUM_NICHES = {"aesthetics"}  # high-ticket, cash-pay


def score_prospect(
    phone: Optional[str],
    whatsapp: Optional[str],
    email: Optional[str],
    instagram: Optional[str],
    facebook: Optional[str],
    linkedin: Optional[str],
    website: Optional[str],
    google_rating: Optional[float],
    review_count: Optional[int],
    weaknesses_json: Optional[str],
    niche: Optional[str],
) -> str:
    weaknesses = []
    try:
        weaknesses = json.loads(weaknesses_json or "[]")
    except Exception:
        pass

    has_contact = any([phone, whatsapp, email, instagram, facebook, linkedin])
    has_weakness = len(weaknesses) > 0
    rating = google_rating or 0.0
    reviews = review_count or 0
    is_premium = (niche or "") in PREMIUM_NICHES

    # HOT criteria
    if has_contact and has_weakness:
        # Strong money signals
        if is_premium or (rating >= 4.0 and reviews >= 10) or (reviews >= 20):
            return "HOT"
        # Still hot if multiple contact paths and multiple clear weaknesses
        contact_count = sum(1 for c in [phone, whatsapp, email, instagram, facebook] if c)
        if contact_count >= 2 and len(weaknesses) >= 2:
            return "HOT"
        return "WARM"

    if has_contact and not has_weakness:
        # Reachable but no clear weakness angle — good for brand awareness pitch
        return "WARM"

    if not has_contact and has_weakness:
        # Know what to say but no way in yet
        return "WARM"

    return "COLD"
