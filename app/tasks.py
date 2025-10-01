# app/tasks.py
import os
import smtplib
import logging
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional

from sqlalchemy.orm import Session
from db import SessionLocal
from models import Message, Contact, Campaign

# -------------------------------
# Logging
# -------------------------------
log = logging.getLogger("mailer")
if not log.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# -------------------------------
# Optional Celery (used if REDIS_URL is reachable)
# -------------------------------
CELERY_URL = os.getenv("REDIS_URL")
celery_app = None
if CELERY_URL:
    try:
        from celery import Celery
        celery_app = Celery("sglite", broker=CELERY_URL, backend=CELERY_URL)
        conn = celery_app.connection_for_read()
        conn.ensure_connection(max_retries=1)
        log.info("Celery enabled (broker=%s)", CELERY_URL)
    except Exception as e:
        log.warning("Celery disabled, falling back to sync send. Reason: %s", e)
        celery_app = None

# -------------------------------
# SMTP configuration (env-driven)
# For SendGrid:
#   SMTP_HOST=smtp.sendgrid.net
#   SMTP_PORT=587
#   SMTP_USERNAME=apikey
#   SMTP_PASSWORD=<YOUR_SENDGRID_API_KEY>
#   SMTP_USE_TLS=true
#   SMTP_USE_SSL=false
# Optionally:
#   SMTP_ENVELOPE_FROM=bounce@yourdomain.com
#   SMTP_FROM=no-reply@yourdomain.com   (used as a last-resort fallback)
# -------------------------------
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.sendgrid.net")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "false").lower() == "true"

# Fallback visible From if a campaign forgot to set one
SMTP_FROM_FALLBACK = os.getenv("SMTP_FROM", "no-reply@localhost")
# Preferred envelope MAIL FROM / return-path (optional but recommended for SendGrid single-sender)
SMTP_ENVELOPE_FROM = os.getenv("SMTP_ENVELOPE_FROM", "")

def _send_email(
    to_email: str,
    subject: str,
    html: Optional[str],
    text: Optional[str],
    from_header: Optional[str],
    envelope_from: Optional[str],
) -> None:
    """
    Sends a single email using the configured SMTP server.

    from_header   -> visible 'From:' header the recipient sees
    envelope_from -> SMTP MAIL FROM (Return-Path). With SendGrid Single Sender,
                     this MUST be a verified sender or SendGrid will 550.
    """
    if not html and not text:
        text = "(no content)"

    hdr_from = (from_header or "").strip() or SMTP_FROM_FALLBACK
    env_from = (envelope_from or "").strip() or hdr_from

    log.info("[SMTP] preparing -> To=%s | From(hdr)=%s | From(env)=%s | Host=%s:%s TLS=%s SSL=%s",
             to_email, hdr_from, env_from, SMTP_HOST, SMTP_PORT, SMTP_USE_TLS, SMTP_USE_SSL)

    # Build message
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = hdr_from
    msg["To"] = to_email
    if text:
        msg.attach(MIMEText(text, "plain"))
    if html:
        msg.attach(MIMEText(html, "html"))

    try:
        if SMTP_USE_SSL:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as server:
                server.set_debuglevel(1)  # show SMTP dialogue in logs
                if SMTP_USERNAME:
                    server.login(SMTP_USERNAME, SMTP_PASSWORD)
                resp = server.sendmail(env_from, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
                server.set_debuglevel(1)  # show SMTP dialogue in logs
                server.ehlo()
                if SMTP_USE_TLS:
                    server.starttls()
                    server.ehlo()
                if SMTP_USERNAME:
                    server.login(SMTP_USERNAME, SMTP_PASSWORD)
                resp = server.sendmail(env_from, [to_email], msg.as_string())

        # smtplib returns a dict of failures; empty dict means success
        if resp:
            log.error("SMTP returned per-recipient errors: %s", resp)
            raise smtplib.SMTPDataError(500, b"Per-recipient errors")

        log.info("[SMTP] sent -> To=%s | From(hdr)=%s | From(env)=%s", to_email, hdr_from, env_from)

    except smtplib.SMTPDataError as e:
        # Surface common SendGrid 550 identity errors clearly
        log.error("SMTPDataError while sending to %s: %s %s", to_email, e.smtp_code, e.smtp_error)
        raise
    except Exception as e:
        log.error("Unexpected SMTP error while sending to %s: %r", to_email, e)
        raise

def _send_now(message_id: int) -> None:
    """
    Fetch message + campaign + contact, send, and update DB status.
    """
    db: Session = SessionLocal()
    try:
        message: Message = db.get(Message, message_id)
        if not message:
            log.warning("Message id %s not found", message_id)
            return
        campaign: Campaign = db.get(Campaign, message.campaign_id)
        contact: Contact = db.get(Contact, message.contact_id)

        # Visible From = campaign.from_email (typed in UI)
        visible_from = (campaign.from_email or "").strip() or SMTP_FROM_FALLBACK
        # Envelope From = SMTP_ENVELOPE_FROM (preferred) or the visible From
        envelope_from = (SMTP_ENVELOPE_FROM or visible_from).strip()

        _send_email(
            to_email=contact.email,
            subject=campaign.subject,
            html=campaign.html_body,
            text=campaign.text_body,
            from_header=visible_from,
            envelope_from=envelope_from,
        )

        message.status = "sent"
        message.sent_at = datetime.now(timezone.utc)
        db.commit()

    except Exception as e:
        db.rollback()
        # update message row with error for visibility
        message = db.get(Message, message_id)
        if message:
            message.status = "failed"
            message.error = f"{type(e).__name__}: {e}"
            db.commit()
        raise
    finally:
        db.close()

def enqueue_send(message_id: int) -> None:
    """
    If Celery is available, queue the job; otherwise send synchronously.
    """
    if celery_app:
        celery_app.send_task("send_message_task", args=[message_id])
    else:
        _send_now(message_id)

if celery_app:
    from celery import Celery  # type hints

    @celery_app.task(name="send_message_task", bind=True, max_retries=3, default_retry_delay=10)
    def send_message_task(self, message_id: int):
        try:
            _send_now(message_id)
        except Exception as e:
            # Exponential backoff up to ~5 minutes
            raise self.retry(exc=e, countdown=min(300, 10 * (2 ** self.request.retries)))
