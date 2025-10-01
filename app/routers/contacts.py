# app/routers/contacts.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, or_, func
from typing import Optional, List

from deps import get_db, get_current_user
from models import Contact, User
from schemas import ContactIn, ContactOut
from email_validation import validate_email_record

router = APIRouter(prefix="/contacts", tags=["contacts"])


def _to_out(c: Contact, owner_email: Optional[str]) -> ContactOut:
    data = ContactOut.model_validate(c).model_dump()
    data["owner_email"] = owner_email
    return ContactOut(**data)


@router.get("", response_model=List[ContactOut])
def list_contacts(
    status: Optional[str] = None,
    q: Optional[str] = Query(None, description="search across fields"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # base query + owner join to expose owner_email
    stmt = select(Contact, User.email.label("owner_email")).join(
        User, User.id == Contact.owner_id, isouter=True
    )

    # non-admins: only their own contacts
    if user.role != "admin":
        stmt = stmt.where(Contact.owner_id == user.id)

    if status and status != "all":
        stmt = stmt.where(Contact.status == status)

    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Contact.email).like(like),
                func.lower(Contact.first_name).like(like),
                func.lower(Contact.last_name).like(like),
                func.lower(Contact.linkedin_url).like(like),
                func.lower(Contact.company).like(like),
                func.lower(Contact.website).like(like),
                func.lower(Contact.phone).like(like),
                func.lower(Contact.role).like(like),
            )
        )

    rows = db.execute(stmt).all()
    return [_to_out(c, owner_email) for c, owner_email in rows]


@router.post("", response_model=ContactOut, status_code=201)
def create_contact(
    body: ContactIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    e = body.email.lower()
    row = db.execute(select(Contact).where(Contact.email == e)).scalar_one_or_none()
    if row:
        # allow owner/admin to update minimal fields on create attempt
        if user.role != "admin" and row.owner_id != user.id:
            raise HTTPException(status_code=403, detail="Forbidden")
        for f in ("first_name", "last_name", "linkedin_url", "company", "website", "phone", "role"):
            val = getattr(body, f)
            if val is not None:
                setattr(row, f, val)
    else:
        row = Contact(
            email=e,
            first_name=body.first_name,
            last_name=body.last_name,
            linkedin_url=body.linkedin_url,
            company=body.company,
            website=body.website,
            phone=body.phone,
            role=body.role,
            status="new",
            owner_id=user.id,
        )
        db.add(row)

    db.commit(); db.refresh(row)

    owner_email = db.execute(select(User.email).where(User.id == row.owner_id)).scalar_one_or_none()
    return _to_out(row, owner_email)


class ContactUpdate(ContactIn):
    email: Optional[str] = None  # PATCH: optional


@router.patch("/{contact_id}", response_model=ContactOut)
def update_contact(
    contact_id: int,
    body: ContactUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    c = db.get(Contact, contact_id)
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    if user.role != "admin" and c.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    # apply provided fields
    for f in ("first_name", "last_name", "linkedin_url", "company", "website", "phone", "role"):
        val = getattr(body, f)
        if val is not None:
            setattr(c, f, val)

    if body.email is not None:
        c.email = body.email.lower()

    db.commit(); db.refresh(c)
    owner_email = db.execute(select(User.email).where(User.id == c.owner_id)).scalar_one_or_none()
    return _to_out(c, owner_email)


@router.delete("/{contact_id}", status_code=204)
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    c = db.get(Contact, contact_id)
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    if user.role != "admin" and c.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    db.delete(c); db.commit()
    return


# --------- Validate / Re-validate ---------
@router.post("/validate_one")
def validate_one_api(
    payload: dict,
    use_smtp_probe: bool = Query(True, description="SMTP probe on by default"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    email = str(payload.get("email", "")).strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="email required")

    row = db.execute(select(Contact).where(Contact.email == email)).scalar_one_or_none()
    if not row:
        row = Contact(email=email, owner_id=user.id, status="new")
        db.add(row); db.commit(); db.refresh(row)

    res = validate_email_record(email, timeout=8.0, do_smtp=use_smtp_probe)
    status_map = {"valid": "valid", "invalid": "invalid", "risky": "risky"}
    row.status   = status_map.get(res.get("verdict"), "unknown")
    row.reason   = res.get("reason")
    row.provider = res.get("provider")
    db.commit()

    return {
        "id": row.id,
        "email": row.email,
        "status": row.status,
        "reason": row.reason,
        "provider": row.provider,
        "verdict": res["verdict"],
    }


@router.post("/{contact_id}/revalidate", response_model=ContactOut)
def revalidate_contact(
    contact_id: int,
    use_smtp_probe: bool = Query(True),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    c = db.get(Contact, contact_id)
    if not c:
        raise HTTPException(status_code=404, detail="Not found")
    if user.role != "admin" and c.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    res = validate_email_record(c.email, timeout=8.0, do_smtp=use_smtp_probe)
    status_map = {"valid": "valid", "invalid": "invalid", "risky": "risky"}
    c.status   = status_map.get(res.get("verdict"), "unknown")
    c.reason   = res.get("reason")
    c.provider = res.get("provider")
    db.commit(); db.refresh(c)

    owner_email = db.execute(select(User.email).where(User.id == c.owner_id)).scalar_one_or_none()
    return _to_out(c, owner_email)
