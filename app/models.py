from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum, func
from sqlalchemy.orm import relationship
import enum
from db import Base

class Contact(Base):
    __tablename__ = "contacts"
    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String(120), nullable=True)
    last_name  = Column(String(120), nullable=True)
    email = Column(String(320), unique=True, nullable=False, index=True)

    # keep this name; the frontend already expects linkedin_url
    linkedin_url = Column(String(255), nullable=True)

    # ADD THESE:
    company = Column(String(255), nullable=True)
    website = Column(String(255), nullable=True)
    phone   = Column(String(64),  nullable=True)
    role    = Column(String(128), nullable=True)

    status = Column(String(20), nullable=False, default="new")
    reason = Column(String(255), nullable=True)
    provider = Column(String(80), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    owner = relationship("User", back_populates="contacts")


class Campaign(Base):
    __tablename__ = "campaigns"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    subject = Column(String(255), nullable=False)
    from_email = Column(String(255), nullable=False)
    html_body = Column(Text, nullable=True)
    text_body = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=False)
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=False)
    status = Column(String(20), nullable=False, default="queued")  # queued/sent/failed
    error = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)

    campaign = relationship("Campaign")
    contact = relationship("Contact")

class RoleEnum(str, enum.Enum):
    user = "user"
    admin = "admin"

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(Enum(RoleEnum), default=RoleEnum.user, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    contacts = relationship("Contact", back_populates="owner")