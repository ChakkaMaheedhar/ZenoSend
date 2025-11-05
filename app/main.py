# app/main.py
import os
from typing import Optional

from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from db import get_db
from models import Campaign, Message
from schemas import (
    CampaignIn, CampaignOut,
    CampaignStats, SendSelectedIn,
    ComposeIn,
)
from tasks import enqueue_send

# Routers
from routers import auth as auth_router
from routers import contacts as contacts_router
from routers import admin_users as admin_users_router
from routers import contacts_import_mapping as contacts_import_mapping_router  # <-- NEW

API_TOKEN = os.getenv("API_TOKEN", "dev-token-change-me")

app = FastAPI(title="SendGrid-Lite API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://163.123.180.171:8080",
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:3000", "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "x-api-key", "content-type", "authorization"],  # important
)

def require_token(x_api_key: Optional[str] = Header(None)):
    if x_api_key != API_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True

# Core routers (under /api)
app.include_router(auth_router.router, prefix="/api")
app.include_router(contacts_router.router, prefix="/api")
app.include_router(admin_users_router.router, prefix="/api")


# Bulk Upload + Mapping (Preview -> Commit)
# If you want these open (no x-api-key), remove `dependencies=[Depends(require_token)]`.
app.include_router(
    contacts_import_mapping_router.router,
    prefix="/api",
    dependencies=[Depends(require_token)]
)

@app.get("/health")
def health():
    return {"ok": True}

# ----------------- Campaigns -----------------
@app.post("/campaigns", response_model=CampaignOut, dependencies=[Depends(require_token)])
def create_campaign(payload: CampaignIn, db: Session = Depends(get_db)):
    c = Campaign(
        name=payload.name, subject=payload.subject, from_email=str(payload.from_email),
        html_body=payload.html_body, text_body=payload.text_body
    )
    db.add(c); db.commit(); db.refresh(c)
    return c

@app.post("/campaigns/{campaign_id}/send", dependencies=[Depends(require_token)])
def send_campaign(campaign_id: int, status_filter: str = "valid", db: Session = Depends(get_db)):
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    contacts = db.execute(
        select(Message).where(Message.campaign_id == campaign_id)
    ).scalars().all()

    if not contacts:
        return {"enqueued": 0, "note": f"No contacts with status={status_filter}"}

    created = 0
    for c in contacts:
        m = Message(campaign_id=campaign_id, contact_id=c.id, status="queued")
        db.add(m); db.flush(); enqueue_send(m.id); created += 1
    db.commit()
    return {"enqueued": created}

@app.post("/campaigns/{campaign_id}/send_selected", dependencies=[Depends(require_token)])
def send_selected_contacts(campaign_id: int, payload: SendSelectedIn, db: Session = Depends(get_db)):
    camp = db.get(Campaign, campaign_id)
    if not camp:
        raise HTTPException(404, "Campaign not found")
    if not payload.contact_ids:
        return {"enqueued": 0, "note": "No contacts selected"}

    enq = 0
    for cid in payload.contact_ids:
        m = Message(campaign_id=camp.id, contact_id=cid, status="queued")
        db.add(m); db.flush(); enqueue_send(m.id); enq += 1
    db.commit()
    return {"enqueued": enq}

@app.get("/campaigns/{campaign_id}/stats", response_model=CampaignStats, dependencies=[Depends(require_token)])
def campaign_stats(campaign_id: int, db: Session = Depends(get_db)):
    counts = dict(
        db.execute(
            select(Message.status, func.count())
            .where(Message.campaign_id == campaign_id)
            .group_by(Message.status)
        ).all()
    )
    return CampaignStats(
        queued=int(counts.get("queued", 0)),
        sent=int(counts.get("sent", 0)),
        failed=int(counts.get("failed", 0))
    )

# ----------------- Quick Compose & Send -----------------
@app.post("/compose/send", dependencies=[Depends(require_token)])
def compose_and_send(payload: ComposeIn, db: Session = Depends(get_db)):
    camp = Campaign(
        name=payload.name, subject=payload.subject, from_email=str(payload.from_email),
        html_body=payload.html_body, text_body=payload.text_body,
    )
    db.add(camp); db.commit(); db.refresh(camp)

    target_ids = set(payload.to_ids + payload.cc_ids + payload.bcc_ids)
    extra_emails = set([str(x).lower() for x in (payload.to_extra + payload.cc_extra + payload.bcc_extra)])
    status_map = {"valid": "valid", "invalid": "invalid", "risky": "risky"}

    from models import Contact
    from email_validation import validate_email_record

    for addr in extra_emails:
        row = db.execute(select(Contact).where(Contact.email == addr)).scalar_one_or_none()
        if not row:
            row = Contact(email=addr, status="new")
            db.add(row); db.flush()
        if payload.validate_extras:
            res = validate_email_record(addr, timeout=6.0, do_smtp=True)
            row.status = status_map.get(res["verdict"], "unknown")
            row.reason = res.get("reason")
            row.provider = res.get("provider")
        target_ids.add(row.id)
    db.commit()

    if not target_ids:
        return {
            "campaign_id": camp.id,
            "selected": 0,
            "valid_recipients": 0,
            "enqueued": 0,
            "note": "No recipients"
        }

    valid_rows = db.execute(
        select(Contact)
        .where(Contact.id.in_(list(target_ids)))
        .where(Contact.status == "valid")
    ).scalars().all()

    enq = 0
    for c in valid_rows:
        m = Message(campaign_id=camp.id, contact_id=c.id, status="queued")
        db.add(m); db.flush(); enqueue_send(m.id); enq += 1
    db.commit()

    return {
        "campaign_id": camp.id,
        "selected": len(target_ids),
        "valid_recipients": len(valid_rows),
        "enqueued": enq
    }
