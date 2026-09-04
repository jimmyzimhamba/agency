from fastapi import APIRouter
from backend.config import load_settings, save_settings, GOOGLE_MAPS_API_KEY

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
def get_settings():
    data = load_settings()
    data["has_google_key"] = bool(GOOGLE_MAPS_API_KEY)
    data["google_maps_api_key_preview"] = (GOOGLE_MAPS_API_KEY[:8] + "...") if GOOGLE_MAPS_API_KEY else None
    return data


@router.post("")
def update_settings(body: dict):
    current = load_settings()
    # Merge top-level keys (don't blow away niches if only studio_x changes)
    for k, v in body.items():
        current[k] = v
    save_settings(current)
    return {"ok": True}


@router.get("/niches")
def get_niches():
    settings = load_settings()
    return settings.get("niches", [])


@router.get("/google-maps-key")
def get_google_maps_key():
    """Return the API key for frontend map initialization (only served locally)."""
    return {"key": GOOGLE_MAPS_API_KEY}
