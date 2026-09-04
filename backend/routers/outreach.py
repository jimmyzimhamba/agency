from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import OutreachLog, Prospect
from backend.schemas import OutreachLogCreate, OutreachLogOut
from backend.services.templates import get_library

router = APIRouter(prefix="/api/outreach", tags=["outreach"])


@router.get("/library")
def content_library():
    return get_library()


@router.post("/log", response_model=OutreachLogOut)
def log_outreach(data: OutreachLogCreate, db: Session = Depends(get_db)):
    p = db.query(Prospect).filter(Prospect.id == data.prospect_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Prospect not found")

    log = OutreachLog(**data.model_dump())
    db.add(log)

    # Update prospect last_contacted and status
    p.last_contacted = datetime.utcnow()
    if p.status == "new":
        p.status = "contacted"

    db.commit()
    db.refresh(log)
    return log


@router.get("/log/{prospect_id}", response_model=List[OutreachLogOut])
def get_outreach_log(prospect_id: int, db: Session = Depends(get_db)):
    return (
        db.query(OutreachLog)
        .filter(OutreachLog.prospect_id == prospect_id)
        .order_by(OutreachLog.timestamp.desc())
        .all()
    )
