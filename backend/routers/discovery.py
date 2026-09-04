from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.database import get_db
from backend.models import Prospect
from backend.schemas import DiscoveryRequest, DiscoveryResult
from backend.services.places import discover_leads
from backend.services.enrichment import enrich_prospect
from backend.services.scoring import score_prospect
from backend.config import GOOGLE_MAPS_API_KEY

router = APIRouter(prefix="/api/discovery", tags=["discovery"])

# Track progress per discovery run (simple in-memory; single-user tool)
_progress: dict = {"running": False, "total": 0, "done": 0, "new": 0, "dupes": 0, "errors": 0, "message": ""}


@router.get("/progress")
def get_progress():
    return _progress


@router.get("/api-status")
def api_status():
    return {"has_key": bool(GOOGLE_MAPS_API_KEY)}


async def _run_discovery(niche_id: str, area: str, city: str, db_factory):
    global _progress
    _progress = {"running": True, "total": 0, "done": 0, "new": 0, "dupes": 0, "errors": 0, "message": "Searching..."}

    try:
        places = await discover_leads(niche_id, area, city)
        _progress["total"] = len(places)
        _progress["message"] = f"Found {len(places)} businesses. Saving and enriching..."

        db = db_factory()
        try:
            for place in places:
                try:
                    # Dedupe on google_place_id
                    pid = place.get("google_place_id")
                    if pid:
                        existing = db.query(Prospect).filter(Prospect.google_place_id == pid).first()
                        if existing:
                            _progress["dupes"] += 1
                            _progress["done"] += 1
                            continue

                    p = Prospect(**place)
                    db.add(p)
                    db.commit()
                    db.refresh(p)

                    # Enrich inline (one at a time, politely)
                    updates = await enrich_prospect({
                        "business_name": p.business_name,
                        "niche": p.niche,
                        "website": p.website,
                        "phone": p.phone,
                        "whatsapp": p.whatsapp,
                        "email": p.email,
                        "instagram": p.instagram,
                        "facebook": p.facebook,
                        "linkedin": p.linkedin,
                        "google_rating": p.google_rating,
                        "review_count": p.review_count,
                    })

                    for k, v in updates.items():
                        if hasattr(p, k):
                            setattr(p, k, v)

                    p.score = score_prospect(
                        phone=p.phone, whatsapp=p.whatsapp, email=p.email,
                        instagram=p.instagram, facebook=p.facebook, linkedin=p.linkedin,
                        website=p.website, google_rating=p.google_rating, review_count=p.review_count,
                        weaknesses_json=p.weaknesses, niche=p.niche,
                    )
                    db.commit()
                    _progress["new"] += 1

                except Exception as e:
                    _progress["errors"] += 1
                    print(f"Error saving place: {e}")
                finally:
                    _progress["done"] += 1
        finally:
            db.close()

        _progress["running"] = False
        _progress["message"] = (
            f"Done. {_progress['new']} new leads added, "
            f"{_progress['dupes']} duplicates skipped, "
            f"{_progress['errors']} errors."
        )

    except Exception as e:
        _progress["running"] = False
        _progress["message"] = f"Discovery failed: {str(e)}"


@router.post("", response_model=DiscoveryResult)
async def run_discovery(
    req: DiscoveryRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    if not GOOGLE_MAPS_API_KEY:
        return DiscoveryResult(
            new_count=0, duplicate_count=0, error_count=0,
            message="No Google Maps API key configured. Add GOOGLE_MAPS_API_KEY to your .env file."
        )

    if _progress.get("running"):
        return DiscoveryResult(
            new_count=0, duplicate_count=0, error_count=0,
            message="Discovery already running. Check /api/discovery/progress."
        )

    from backend.database import SessionLocal
    background_tasks.add_task(_run_discovery, req.niche_id, req.area, req.city, SessionLocal)

    return DiscoveryResult(
        new_count=0, duplicate_count=0, error_count=0,
        message="Discovery started in background. Poll /api/discovery/progress for updates."
    )
