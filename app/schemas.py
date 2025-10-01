from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any

# ------------ Contacts ------------
class ContactIn(BaseModel):
    first_name: Optional[str] = None
    last_name:  Optional[str] = None
    email: EmailStr
    linkedin_url: Optional[str] = None
    company: Optional[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None

class ContactOut(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name:  Optional[str] = None
    email: EmailStr
    linkedin_url: Optional[str] = None
    company: Optional[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None
    reason: Optional[str] = None
    provider: Optional[str] = None
    owner_email: Optional[str] = None

    class Config:
        from_attributes = True

# ------------ Campaigns ------------
class CampaignIn(BaseModel):
    name: str
    subject: str
    from_email: EmailStr
    html_body: Optional[str] = None
    text_body: Optional[str] = None

class CampaignOut(BaseModel):
    id: int
    name: str
    subject: str
    from_email: EmailStr

    class Config:
        from_attributes = True

class CampaignStats(BaseModel):
    queued: int
    sent: int
    failed: int

class SendSelectedIn(BaseModel):
    contact_ids: List[int]

# ------------ Validation ------------
class ValidationRequest(BaseModel):
    use_smtp_probe: bool = False
    concurrency: int = 20
    timeout: float = 6.0

class ValidateOneIn(BaseModel):
    email: EmailStr

class ValidationDetail(BaseModel):
    email: EmailStr
    verdict: str
    score: float
    checks: Dict[str, Any]
    provider: Optional[str] = None
    suggestion: Optional[str] = None
    reason: Optional[str] = None

# ------------ Quick Compose ------------
class ComposeIn(BaseModel):
    name: str = "Quick Send"
    subject: str
    from_email: EmailStr
    html_body: Optional[str] = None
    text_body: Optional[str] = None

    to_ids: List[int] = []
    cc_ids: List[int] = []
    bcc_ids: List[int] = []

    to_extra: List[EmailStr] = []
    cc_extra: List[EmailStr] = []
    bcc_extra: List[EmailStr] = []

    validate_extras: bool = True
