import json
import csv
import io
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from backend.database import get_db
from backend.models import Prospect
from backend.schemas import ProspectCreate, ProspectUpdate, ProspectOut
from backend.services.enrichment import enrich_prospect
from backend.services.scoring import score_prospect

router = APIRouter(prefix="/api/prospects", tags=["prospects"])


async def run_enrichment(prospect_id: int):
    """Background task: enrich and re-score a prospect."""
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        p = db.query(Prospect).filter(Prospect.id == prospect_id).first()
        if not p:
            return
        p.enrichment_status = "running"
        db.commit()

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

        # Re-score
        p.score = score_prospect(
            phone=p.phone, whatsapp=p.whatsapp, email=p.email,
            instagram=p.instagram, facebook=p.facebook, linkedin=p.linkedin,
            website=p.website, google_rating=p.google_rating, review_count=p.review_count,
            weaknesses_json=p.weaknesses, niche=p.niche,
        )
        p.updated_at = datetime.utcnow()
        db.commit()
    except Exception as e:
        db = SessionLocal()
        p = db.query(Prospect).filter(Prospect.id == prospect_id).first()
        if p:
            p.enrichment_status = "failed"
            db.commit()
    finally:
        db.close()


@router.get("", response_model=List[ProspectOut])
def list_prospects(
    db: Session = Depends(get_db),
    niche: Optional[str] = None,
    score: Optional[str] = None,
    status: Optional[str] = None,
    city: Optional[str] = None,
    has_website: Optional[bool] = None,
    has_whatsapp: Optional[bool] = None,
    q: Optional[str] = None,
    limit: int = Query(200, le=500),
    offset: int = 0,
):
    qs = db.query(Prospect)
    if niche:
        qs = qs.filter(Prospect.niche == niche)
    if score:
        qs = qs.filter(Prospect.score == score.upper())
    if status:
        qs = qs.filter(Prospect.status == status)
    if city:
        qs = qs.filter(func.lower(Prospect.city) == city.lower())
    if has_website is not None:
        if has_website:
            qs = qs.filter(Prospect.website.isnot(None), Prospect.website != "")
        else:
            qs = qs.filter(or_(Prospect.website.is_(None), Prospect.website == ""))
    if has_whatsapp is not None:
        if has_whatsapp:
            qs = qs.filter(Prospect.whatsapp.isnot(None), Prospect.whatsapp != "")
        else:
            qs = qs.filter(or_(Prospect.whatsapp.is_(None), Prospect.whatsapp == ""))
    if q:
        term = f"%{q}%"
        qs = qs.filter(or_(
            Prospect.business_name.ilike(term),
            Prospect.suburb.ilike(term),
            Prospect.address.ilike(term),
            Prospect.notes.ilike(term),
        ))
    return qs.order_by(Prospect.date_added.desc()).offset(offset).limit(limit).all()


@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    total = db.query(func.count(Prospect.id)).scalar()
    hot = db.query(func.count(Prospect.id)).filter(Prospect.score == "HOT").scalar()
    warm = db.query(func.count(Prospect.id)).filter(Prospect.score == "WARM").scalar()
    cold = db.query(func.count(Prospect.id)).filter(Prospect.score == "COLD").scalar()
    contacted_today = db.query(func.count(Prospect.id)).filter(
        func.date(Prospect.last_contacted) == func.date(datetime.utcnow())
    ).scalar()

    by_status = {}
    for row in db.query(Prospect.status, func.count(Prospect.id)).group_by(Prospect.status).all():
        by_status[row[0]] = row[1]

    by_niche = {}
    for row in db.query(Prospect.niche, func.count(Prospect.id)).group_by(Prospect.niche).all():
        by_niche[row[0]] = row[1]

    return {
        "total": total,
        "hot": hot,
        "warm": warm,
        "cold": cold,
        "contacted_today": contacted_today,
        "by_status": by_status,
        "by_niche": by_niche,
    }


@router.get("/map-pins")
def get_map_pins(db: Session = Depends(get_db)):
    """Lightweight endpoint for map: only id, lat, lng, score, business_name, status."""
    prospects = db.query(
        Prospect.id, Prospect.lat, Prospect.lng, Prospect.score,
        Prospect.business_name, Prospect.status, Prospect.niche
    ).filter(Prospect.lat.isnot(None)).all()
    return [
        {"id": p.id, "lat": p.lat, "lng": p.lng, "score": p.score,
         "business_name": p.business_name, "status": p.status, "niche": p.niche}
        for p in prospects
    ]


@router.get("/{prospect_id}", response_model=ProspectOut)
def get_prospect(prospect_id: int, db: Session = Depends(get_db)):
    p = db.query(Prospect).filter(Prospect.id == prospect_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Prospect not found")
    return p


@router.post("", response_model=ProspectOut)
async def create_prospect(
    data: ProspectCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    # Dedupe: check phone+name for manual entries
    if data.phone:
        existing = db.query(Prospect).filter(
            func.lower(Prospect.business_name) == data.business_name.lower(),
            Prospect.phone == data.phone,
        ).first()
        if existing:
            return existing

    p = Prospect(**data.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    background_tasks.add_task(run_enrichment, p.id)
    return p


@router.patch("/{prospect_id}", response_model=ProspectOut)
def update_prospect(prospect_id: int, data: ProspectUpdate, db: Session = Depends(get_db)):
    p = db.query(Prospect).filter(Prospect.id == prospect_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Prospect not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    p.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{prospect_id}")
def delete_prospect(prospect_id: int, db: Session = Depends(get_db)):
    p = db.query(Prospect).filter(Prospect.id == prospect_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Prospect not found")
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.post("/{prospect_id}/re-enrich")
async def re_enrich(prospect_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    p = db.query(Prospect).filter(Prospect.id == prospect_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Prospect not found")
    p.enrichment_status = "pending"
    db.commit()
    background_tasks.add_task(run_enrichment, prospect_id)
    return {"ok": True, "message": "Enrichment started"}


@router.post("/import/csv")
async def import_csv(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
):
    content = await file.read()
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    added = 0
    dupes = 0
    errors = 0

    for row in reader:
        try:
            name = row.get("business_name") or row.get("name") or ""
            niche = row.get("niche") or "aesthetics"
            if not name:
                continue

            phone = row.get("phone") or None
            # Dedupe
            existing = db.query(Prospect).filter(
                func.lower(Prospect.business_name) == name.lower()
            ).first()
            if existing:
                dupes += 1
                continue

            p = Prospect(
                business_name=name,
                niche=niche,
                phone=phone,
                email=row.get("email") or None,
                website=row.get("website") or None,
                address=row.get("address") or None,
                suburb=row.get("suburb") or None,
                city=row.get("city") or "Harare",
                notes=row.get("notes") or None,
                source="import",
            )
            db.add(p)
            db.commit()
            db.refresh(p)
            background_tasks.add_task(run_enrichment, p.id)
            added += 1
        except Exception:
            errors += 1
            continue

    return {"added": added, "duplicates": dupes, "errors": errors}
