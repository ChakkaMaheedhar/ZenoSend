# email_validation.py
import os, re, socket, ssl, random, string, difflib
from typing import Tuple, List, Optional, Dict
from email_validator import validate_email, EmailNotValidError
import dns.resolver

# ---------------------------
# Config (via .env)
# ---------------------------
ALLOW_SMTP_PROBE = os.getenv("ALLOW_SMTP_PROBE", "true").lower() == "true"
# If True, we will still try to probe big providers (Gmail/Outlook/Yahoo). Expect many to stay unverifiable.
PROBE_BLOCKED = os.getenv("PROBE_BLOCKED_PROVIDERS", "true").lower() == "true"
DEFAULT_TIMEOUT = float(os.getenv("VALIDATION_TIMEOUT", "6"))

# SMTP probe envelope sender (null sender <> is sometimes treated differently)
PROBE_MAIL_FROM = os.getenv("PROBE_MAIL_FROM", "probe@localhost.localdomain")

# Stricter accept-all detection: number of random addresses to test
ACCEPT_ALL_PROBES = int(os.getenv("ACCEPT_ALL_PROBES", "2"))  # 2–3 is reasonable

EMAIL_REGEX = re.compile(
    r"^(?P<local>[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*)@(?P<domain>[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$"
)

DISPOSABLE_DOMAINS = {
    "mailinator.com","10minutemail.com","tempmail.com","guerrillamail.com","yopmail.com","trashmail.com"
}
ROLE_ACCOUNTS = {
    "admin","administrator","support","info","hello","sales","contact","billing",
    "accounts","noreply","no-reply","security","abuse","postmaster"
}
FREE_PROVIDERS = {
    "gmail.com","googlemail.com","yahoo.com","ymail.com","outlook.com","hotmail.com","live.com",
    "icloud.com","me.com","aol.com","proton.me","zoho.com","gmx.com","mail.com"
}

# Providers that typically refuse/obfuscate mailbox verification
SMTP_BLOCKLIST_PROVIDERS = {
    "gmail.com": "Google Workspace/Gmail",
    "googlemail.com": "Google Workspace/Gmail",
    "outlook.com": "Microsoft 365/Outlook",
    "hotmail.com": "Microsoft 365/Hotmail",
    "live.com": "Microsoft 365/Live",
    "office365.com": "Microsoft 365",
    "microsoft.com": "Microsoft 365",
    "yahoo.com": "Yahoo",
    "proton.me": "Proton",
    "icloud.com": "Apple iCloud",
    "me.com": "Apple iCloud",
    "aol.com": "AOL",
}

COMMON_DOMAINS = sorted(FREE_PROVIDERS | {
    "gmail.co","gamil.com","gnail.com","gmai.com","yhoo.com","yahoo.co","hotnail.com",
    "outlok.com","icloud.co","me.co","protonmail.com","pm.me","zoho.in","gmx.de","mail.ru"
})

# ---------------------------
# Helpers
# ---------------------------
def normalize(email: str) -> str:
    return email.strip().strip('";').replace(" ", "")

def check_syntax(email: str):
    """Return (ok, local, domain)."""
    try:
        v = validate_email(email, check_deliverability=False)
        return True, v.local_part, v.domain
    except EmailNotValidError:
        m = EMAIL_REGEX.match(email)
        if m:
            return True, m.group("local"), m.group("domain")
        return False, None, None

_mx_cache: Dict[str, Tuple[bool, List[str], str]] = {}

def check_mx(domain: str, timeout: float = DEFAULT_TIMEOUT):
    """Return (has_mx, hosts, provider_guess)."""
    if domain in _mx_cache:
        return _mx_cache[domain]
    try:
        answers = dns.resolver.resolve(domain, "MX", lifetime=timeout)
        hosts = sorted([str(r.exchange).rstrip(".") for r in answers])
        provider_guess = ""
        for h in hosts:
            hl = h.lower()
            if "google" in hl:
                provider_guess = "Google Workspace/Gmail"
            elif "outlook" in hl or "protection.outlook.com" in hl or "microsoft" in hl:
                provider_guess = "Microsoft 365/Outlook"
            elif "yahoodns" in hl or "yahoo" in hl:
                provider_guess = "Yahoo"
            elif "proton" in hl:
                provider_guess = "Proton"
            elif "icloud" in hl or "me.com" in hl:
                provider_guess = "Apple iCloud"
        res = (True, hosts, provider_guess)
        _mx_cache[domain] = res
        return res
    except Exception:
        res = (False, [], "")
        _mx_cache[domain] = res
        return res

def is_disposable(domain: str) -> bool:
    return domain.lower() in DISPOSABLE_DOMAINS

def is_role_account(local: str) -> bool:
    root = local.split("+")[0].split(".")[0].lower()
    return root in ROLE_ACCOUNTS

def provider_blocks_smtp(domain: str) -> Optional[str]:
    d = domain.lower()
    for key, name in SMTP_BLOCKLIST_PROVIDERS.items():
        if d == key or d.endswith("." + key):
            return name
    return None

def typo_suggestion(domain: str) -> Optional[str]:
    fixes = {
        "gamil.com":"gmail.com","gnail.com":"gmail.com","gmai.com":"gmail.com","gmail.co":"gmail.com",
        "yhoo.com":"yahoo.com","yahoo.co":"yahoo.com","hotnail.com":"hotmail.com","outlok.com":"outlook.com",
        "iclod.com":"icloud.com","me.co":"me.com","protonmail.com":"proton.me","pm.me":"proton.me"
    }
    d = domain.lower()
    if d in fixes: return fixes[d]
    cand = difflib.get_close_matches(d, COMMON_DOMAINS, n=1, cutoff=0.86)
    return cand[0] if cand else None

# ---------------------------
# SMTP helpers / probe
# ---------------------------
def _read_resp(fh, sock: socket.socket, timeout: float) -> Tuple[int, str]:
    """
    Read a full SMTP response, handling multi-line continuations (e.g., 250-...).
    Returns (code, text).
    """
    try:
        sock.settimeout(timeout)
    except Exception:
        pass
    lines = []
    first_code: Optional[int] = None
    while True:
        line_b = fh.readline()
        if not line_b:
            break
        line = line_b.decode(errors="ignore").rstrip("\r\n")
        lines.append(line)
        if len(line) >= 4 and line[:3].isdigit():
            code = int(line[:3])
            if first_code is None:
                first_code = code
            # If 4th char is not '-', this is the final line for this response
            if line[3:4] != "-":
                return first_code, "\n".join(lines)
        else:
            # Non-standard line; if we already have at least one line, return
            if lines:
                return first_code or 0, "\n".join(lines)
    return first_code or 0, "\n".join(lines)

def smtp_probe(email: str, mx_hosts: List[str], timeout: float = DEFAULT_TIMEOUT, use_starttls: bool = True):
    """
    Return:
      (True,  "smtp-250")  -> mailbox accepted
      (False, "smtp-5xx")  -> mailbox rejected
      (None,  <reason>)    -> inconclusive (temp fail, starttls required, blocked, etc.)
    """
    if not mx_hosts:
        return None, "no-mx"

    last_reason = "smtp-inconclusive"

    for host in mx_hosts[:3]:
        sock = None
        fh = None
        try:
            sock = socket.create_connection((host, 25), timeout=timeout)
            sock.settimeout(timeout)
            fh = sock.makefile("rwb", buffering=0)

            # Banner
            code, _ = _read_resp(fh, sock, timeout)
            if code != 220:
                last_reason = f"bad-banner-{code}"
                raise Exception("bad banner")

            # EHLO
            fh.write(b"EHLO validator.local\r\n")
            code, ehlo = _read_resp(fh, sock, timeout)
            if code != 250:
                # try HELO
                fh.write(b"HELO validator.local\r\n")
                code, _ = _read_resp(fh, sock, timeout)
                if code != 250:
                    last_reason = f"helo-fail-{code}"
                    raise Exception("helo failed")

            # STARTTLS if offered
            if use_starttls and "STARTTLS" in ehlo.upper():
                fh.write(b"STARTTLS\r\n")
                code, _ = _read_resp(fh, sock, timeout)
                if code == 220:
                    ctx = ssl.create_default_context()
                    sock = ctx.wrap_socket(sock, server_hostname=host)
                    fh = sock.makefile("rwb", buffering=0)
                    # EHLO again after TLS
                    fh.write(b"EHLO validator.local\r\n")
                    code, _ = _read_resp(fh, sock, timeout)
                    if code != 250:
                        last_reason = f"posttls-ehlo-{code}"
                        raise Exception("post-TLS EHLO failed")

            # MAIL FROM (use non-null sender to avoid odd policy edge-cases)
            mf = f"MAIL FROM:<{PROBE_MAIL_FROM}>\r\n".encode()
            fh.write(mf)
            code, _ = _read_resp(fh, sock, timeout)
            if code not in (250, 251):
                last_reason = f"mf-{code or 'unknown'}"
                raise Exception("MAIL FROM rejected")

            # RCPT TO
            rt = f"RCPT TO:<{email}>\r\n".encode()
            fh.write(rt)
            code, _ = _read_resp(fh, sock, timeout)

            # QUIT (best-effort)
            try:
                fh.write(b"QUIT\r\n")
                _ = _read_resp(fh, sock, timeout)
            except Exception:
                pass

            if code == 250:
                try:
                    fh.close(); sock.close()
                except Exception:
                    pass
                return True, "smtp-250"
            if code in (450, 451, 452):
                try:
                    fh.close(); sock.close()
                except Exception:
                    pass
                return None, "smtp-temp"
            if 500 <= code <= 599:
                try:
                    fh.close(); sock.close()
                except Exception:
                    pass
                return False, "smtp-5xx"

            last_reason = f"smtp-{code or 'unknown'}"
            try:
                fh.close(); sock.close()
            except Exception:
                pass

        except Exception:
            # try next MX
            try:
                if fh: fh.close()
                if sock: sock.close()
            except Exception:
                pass
            continue

    return None, last_reason

def is_accept_all(domain: str, mx_hosts: List[str], timeout: float = DEFAULT_TIMEOUT) -> Optional[bool]:
    """
    Probe N random addresses on the same domain.
    True  => *all* N returned 250 (likely accept-all)
    False => *none* returned 250
    None  => mixed/inconclusive
    """
    if not mx_hosts:
        return None
    successes = 0
    attempts = max(1, ACCEPT_ALL_PROBES)
    for _ in range(attempts):
        rnd = ''.join(random.choices(string.ascii_lowercase + string.digits, k=16))
        fake = f"{rnd}@{domain}"
        ok, _ = smtp_probe(fake, mx_hosts, timeout=timeout)
        if ok is True:
            successes += 1
        elif ok is None:
            return None
    if successes == attempts:
        return True
    if successes == 0:
        return False
    return None

# ---------------------------
# Cosmetic score for risky (optional UI)
# ---------------------------
def _fallback_risky_score(checks: dict) -> float:
    score = 0.62
    if checks["is_disposable"]:
        score -= 0.22
    if checks["is_role_address"]:
        score -= 0.12
    if checks["is_free_provider"]:
        score -= 0.03
    if checks.get("is_accept_all") is True:
        score -= 0.18
    if checks.get("unverifiable_provider"):
        score -= 0.08
    return max(0.0, min(0.89, score))

# ---------------------------
# Public API
# ---------------------------
def validate_email_record(email: str, timeout: float = DEFAULT_TIMEOUT, do_smtp: bool = False, accept_all_note: bool = True):
    """
    Strict verdicts:
      - valid   => SMTP 250 AND NOT accept-all
      - invalid => bad-syntax / no-mx / SMTP 5xx
      - risky   => everything else (unverifiable provider, accept-all, timeouts)
    Returns keys: email, verdict, status (same), score, checks, provider, suggestion, reason
    """
    raw = email
    email = normalize(email)
    ok, local, domain = check_syntax(email)

    checks = {
        "has_valid_address_syntax": bool(ok and local and domain),
        "has_mx_or_a_record": False,
        "is_disposable": False,
        "is_role_address": False,
        "is_free_provider": False,
        "is_accept_all": None,
        "smtp_checked": False,
        "smtp_deliverable": False,
        "domain": domain or None,
    }

    if not checks["has_valid_address_syntax"]:
        return {
            "email": raw, "verdict": "invalid", "status": "invalid",
            "score": 0.05, "checks": checks, "provider": None,
            "suggestion": None, "reason": "bad-syntax"
        }

    checks["is_role_address"] = is_role_account(local)
    checks["is_disposable"]   = is_disposable(domain)
    checks["is_free_provider"] = domain.lower() in FREE_PROVIDERS
    suggestion = typo_suggestion(domain)

    has_mx, hosts, provider_guess = check_mx(domain, timeout=timeout)
    checks["has_mx_or_a_record"] = has_mx
    if not has_mx:
        return {
            "email": raw, "verdict": "invalid", "status": "invalid",
            "score": 0.10, "checks": checks,
            "provider": provider_guess or None,
            "suggestion": suggestion, "reason": "no-mx"
        }

    block_name = provider_blocks_smtp(domain)
    unverifiable = False
    smtp_ok = None
    smtp_note = ""

    if do_smtp and ALLOW_SMTP_PROBE:
        checks["smtp_checked"] = True
        if block_name and not PROBE_BLOCKED:
            unverifiable = True
        else:
            smtp_ok, smtp_note = smtp_probe(email, hosts, timeout=timeout)
            if smtp_ok is True:
                checks["smtp_deliverable"] = True
                aa = is_accept_all(domain, hosts, timeout=timeout)
                checks["is_accept_all"] = aa
                if aa is True and accept_all_note:
                    # Accept-all domains are unverifiable pre-send
                    return {
                        "email": raw, "verdict": "risky", "status": "risky",
                        "score": 0.74, "checks": checks,
                        "provider": provider_guess or block_name,
                        "suggestion": suggestion, "reason": "accept-all"
                    }
                # Only path to 'valid'
                return {
                    "email": raw, "verdict": "valid", "status": "valid",
                    "score": 0.95, "checks": checks,
                    "provider": provider_guess or block_name,
                    "suggestion": suggestion, "reason": "smtp-250"
                }
            elif smtp_ok is False:
                return {
                    "email": raw, "verdict": "invalid", "status": "invalid",
                    "score": 0.15, "checks": {**checks, "is_accept_all": False},
                    "provider": provider_guess or block_name,
                    "suggestion": suggestion, "reason": "smtp-5xx"
                }
            else:
                unverifiable = True

    if block_name and not checks["smtp_checked"]:
        unverifiable = True

    reason = "unverifiable" if unverifiable else "dns-only"
    score = _fallback_risky_score({**checks, "unverifiable_provider": unverifiable})
    return {
        "email": raw, "verdict": "risky", "status": "risky",
        "score": round(float(score), 3),
        "checks": checks, "provider": provider_guess or block_name,
        "suggestion": suggestion, "reason": reason if reason else (smtp_note or "dns-only"),
    }
