"""Signed identity forwarded from Brain to the Code Audit engine.

The audit process rejects requests that do not carry a valid HMAC. A raw
X-Eyra-User-Id header is not trusted by itself.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from app.audit_engine import current_audit_secret

_HEADER_USER = "x-eyra-user-id"
_HEADER_TS = "x-eyra-ts"
_HEADER_SIG = "x-eyra-sig"


def audit_identity_headers(user_id: str) -> dict[str, str]:
    secret = current_audit_secret()
    if not secret or not user_id:
        return {}
    ts = str(int(time.time()))
    sig = hmac.new(
        secret.encode("utf-8"),
        f"{user_id}.{ts}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Eyra-User-Id": user_id,
        "X-Eyra-Ts": ts,
        "X-Eyra-Sig": sig,
    }


def header_names() -> tuple[str, str, str]:
    return _HEADER_USER, _HEADER_TS, _HEADER_SIG
