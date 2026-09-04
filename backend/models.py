from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Text, DateTime,
    ForeignKey, UniqueConstraint, Index
)
from sqlalchemy.orm import relationship
from backend.database import Base


class Prospect(Base):
    __tablename__ = "prospects"

    id = Column(Integer, primary_key=True, index=True)
    business_name = Column(String(255), nullable=False)
    niche = Column(String(100), nullable=False)
    address = Column(Text)
    suburb = Column(String(100))
    city = Column(String(100), default="Harare")
    lat = Column(Float)
    lng = Column(Float)
    google_place_id = Column(String(255), unique=True, nullable=True)

    phone = Column(String(50))
    whatsapp = Column(String(50))
    email = Column(String(255))
    website = Column(String(500))
    instagram = Column(String(255))
    facebook = Column(String(255))
    linkedin = Column(String(255))
    founder_name = Column(String(255))

    google_rating = Column(Float)
    review_count = Column(Integer, default=0)

    # Pipeline status
    status = Column(String(50), default="new")
    score = Column(String(10), default="COLD")  # HOT / WARM / COLD

    # JSON stored as text
    weaknesses = Column(Text, default="[]")

    recommended_channel = Column(String(50))
    recommended_reason = Column(Text)
    opening_line = Column(Text)

    notes = Column(Text)
    source = Column(String(20), default="manual")  # places | manual | import
    enrichment_status = Column(String(20), default="pending")  # pending | done | failed
    date_added = Column(DateTime, default=datetime.utcnow)
    last_contacted = Column(DateTime)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    outreach_logs = relationship("OutreachLog", back_populates="prospect", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_prospects_niche", "niche"),
        Index("ix_prospects_status", "status"),
        Index("ix_prospects_score", "score"),
        Index("ix_prospects_city", "city"),
    )


class OutreachLog(Base):
    __tablename__ = "outreach_log"

    id = Column(Integer, primary_key=True, index=True)
    prospect_id = Column(Integer, ForeignKey("prospects.id"), nullable=False)
    channel = Column(String(50))
    template_used = Column(String(100))
    message_sent = Column(Text)
    timestamp = Column(DateTime, default=datetime.utcnow)
    outcome = Column(String(100))

    prospect = relationship("Prospect", back_populates="outreach_logs")
