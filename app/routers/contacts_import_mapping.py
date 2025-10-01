# app/routers/contact_import_mapping.py
import io, json, re, uuid, os
from typing import Dict, Optional
import pandas as pd
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Header
from sqlalchemy.orm import Session
import pdfplumber
import redis
import jwt

from db import get_db
from models import Contact, User
from email_validation import validate_email_record

# ---------- CONFIG ----------
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
UPLOAD_TTL_SECONDS = 60 * 30  # 30 minutes
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-super-secret")
JWT_ALG = os.getenv("JWT_ALG", "HS256")

TARGET_FIELDS = [
    "email", "first_name", "last_name",
    "company", "website", "linkedin", "phone", "role",
]

router = APIRouter(prefix="/contacts/import", tags=["contacts:import"])
rds = redis.Redis.from_url(REDIS_URL, decode_responses=True)

# ---------- auth helper (OPTIONAL user) ----------
def get_current_user_or_none(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Best-effort: try to resolve a user from the JWT; return None if we can't."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        return None

    # Try several common claim names for id/email
    uid = None
    for k in ("sub", "id", "user_id", "uid"):
        v = payload.get(k)
        if v is not None:
            uid = v
            break

    email = payload.get("email") or payload.get("username") or payload.get("user")
    # If sub looks like an email, use it as email
    if not email and isinstance(uid, str) and "@" in uid:
        email = uid

    # Try by numeric id first
    if uid is not None:
        try:
            uid_int = int(uid)
            user = db.get(User, uid_int)
            if user:
                return user
        except Exception:
            pass

    # Fallback: try by email if present
    if email:
        user = db.query(User).filter(User.email == str(email)).first()
        if user:
            return user

    return None  # don't raise; import can proceed without owner

# ---------- helpers ----------
def _safe(s: Optional[str]) -> str: return (s or "").strip()
def _lower(s: Optional[str]) -> str: return (s or "").strip().lower()

def _split_full_name(full: str) -> tuple[str, str]:
    full = _safe(full)
    if not full:
        return "", ""
    parts = re.split(r"\s+", full)
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])

def _read_to_df(upload: UploadFile) -> pd.DataFrame:
    name = upload.filename or ""
    ext = name[name.rfind("."):].lower()
    content = upload.file.read()
    if not content:
        raise HTTPException(400, "Empty file")
    buf = io.BytesIO(content)

    if ext in (".csv", ".tsv", ".txt"):
        sep = "\t" if ext == ".tsv" else ","
        return pd.read_csv(buf, sep=sep, dtype=str).fillna("")
    if ext in (".xls", ".xlsx"):
        return pd.read_excel(buf, dtype=str).fillna("")
    if ext == ".pdf":
        rows = []
        with pdfplumber.open(buf) as pdf:
            for page in pdf.pages[:5]:
                for t in page.extract_tables() or []:
                    if not t or not t[0]:
                        continue
                    header = [str(h or "").strip() for h in t[0]]
                    for r in t[1:]:
                        row = {
                            header[i] if i < len(header) else f"col{i}": str(r[i] or "").strip()
                            for i in range(len(r))
                        }
                        rows.append(row)
        if not rows:
            raise HTTPException(400, "No table data found in PDF")
        return pd.DataFrame(rows).fillna("")

    raise HTTPException(400, f"Unsupported file type: {ext}")

# ---------- STEP 1: PREVIEW ----------
@router.post("/preview")
def preview(file: UploadFile = File(...)):
    df = _read_to_df(file)
    sample = df.head(10).to_dict(orient="records")
    columns = list(df.columns)
    upload_id = str(uuid.uuid4())
    rds.setex(f"import:{upload_id}", UPLOAD_TTL_SECONDS, df.to_json(orient="records"))
    return {"upload_id": upload_id, "columns": columns, "sample": sample, "target_fields": TARGET_FIELDS}

# ---------- STEP 2: COMMIT ----------
@router.post("/commit")
def commit(
    upload_id: str = Form(...),
    mapping_json: str = Form(...),     # JSON: { target_field -> source_column or "" }
    validate: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_or_none),
):
    raw = rds.get(f"import:{upload_id}")
    if not raw:
        raise HTTPException(400, "Upload expired or not found. Re-upload the file.")

    try:
        df = pd.DataFrame(json.loads(raw))
    except Exception as e:
        raise HTTPException(400, f"Failed to load staged data: {e}")

    try:
        mapping: Dict[str, str] = json.loads(mapping_json)
    except Exception:
        raise HTTPException(400, "Invalid mapping_json (must be a JSON object)")

    # require email mapping
    src_email = mapping.get("email", "")
    if not src_email or src_email not in df.columns:
        raise HTTPException(400, "Email mapping is required and must be one of the source columns")

    created = updated = validated = 0

    for _, row in df.iterrows():
        email = _lower(row.get(src_email, ""))
        if not email:
            continue

        def src(name: str) -> str:
            col = mapping.get(name, "")
            return _safe(row.get(col, "")) if col and col in df.columns else ""

        first_name = src("first_name")
        last_name  = src("last_name")
        if (not first_name and not last_name) and (name_col := mapping.get("name", "")) and name_col in df.columns:
            fn, ln = _split_full_name(row.get(name_col, ""))
            first_name = first_name or fn
            last_name  = last_name  or ln

        fields = dict(
            first_name   = first_name or None,
            last_name    = last_name  or None,
            company      = src("company")     or None,
            website      = src("website")     or None,
            linkedin_url = src("linkedin")    or None,
            phone        = src("phone")       or None,
            role         = src("role")        or None,
        )

        obj = db.query(Contact).filter(Contact.email == email).first()
        if obj:
            changed = False
            for k, v in fields.items():
                if v and getattr(obj, k) != v:
                    setattr(obj, k, v); changed = True
            # set owner if not present and we have a user
            if obj.owner_id is None and current_user is not None:
                obj.owner_id = current_user.id; changed = True
            if changed:
                updated += 1
        else:
            obj = Contact(
                email=email,
                status="new",
                owner_id=(current_user.id if current_user else None),
                **fields,
            )
            db.add(obj); db.flush(); created += 1

        if validate:
            res = validate_email_record(obj.email, timeout=8.0, do_smtp=True)
            obj.status   = {"valid":"valid","invalid":"invalid","risky":"risky"}.get(res.get("verdict"), "unknown")
            obj.reason   = res.get("reason")
            obj.provider = res.get("provider")
            validated += 1

    db.commit()
    rds.delete(f"import:{upload_id}")
    return {"created": created, "updated": updated, "validated": validated}
