from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel


class ProspectBase(BaseModel):
    business_name: str
    niche: str
    address: Optional[str] = None
    suburb: Optional[str] = None
    city: Optional[str] = "Harare"
    lat: Optional[float] = None
    lng: Optional[float] = None
    google_place_id: Optional[str] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    instagram: Optional[str] = None
    facebook: Optional[str] = None
    linkedin: Optional[str] = None
    founder_name: Optional[str] = None
    google_rating: Optional[float] = None
    review_count: Optional[int] = 0
    notes: Optional[str] = None
    source: Optional[str] = "manual"


class ProspectCreate(ProspectBase):
    pass


class ProspectUpdate(BaseModel):
    business_name: Optional[str] = None
    niche: Optional[str] = None
    address: Optional[str] = None
    suburb: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    instagram: Optional[str] = None
    facebook: Optional[str] = None
    linkedin: Optional[str] = None
    founder_name: Optional[str] = None
    google_rating: Optional[float] = None
    review_count: Optional[int] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    last_contacted: Optional[datetime] = None


class ProspectOut(ProspectBase):
    id: int
    status: str
    score: str
    weaknesses: Optional[str] = "[]"
    recommended_channel: Optional[str] = None
    recommended_reason: Optional[str] = None
    opening_line: Optional[str] = None
    enrichment_status: str
    date_added: datetime
    last_contacted: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class OutreachLogCreate(BaseModel):
    prospect_id: int
    channel: str
    template_used: Optional[str] = None
    message_sent: Optional[str] = None
    outcome: Optional[str] = None


class OutreachLogOut(OutreachLogCreate):
    id: int
    timestamp: datetime

    model_config = {"from_attributes": True}


class DiscoveryRequest(BaseModel):
    niche_id: str
    area: str
    city: Optional[str] = "Harare"


class DiscoveryResult(BaseModel):
    new_count: int
    duplicate_count: int
    error_count: int
    message: str


class ImportRow(BaseModel):
    business_name: str
    niche: str
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    suburb: Optional[str] = None
    city: Optional[str] = "Harare"
    notes: Optional[str] = None
