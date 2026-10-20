"""One-time web-to-extension connect codes and revocable extension credentials.

Password login stays on the existing stateless HMAC token. A connect code is
stored only as a hash, expires in two minutes, and can be exchanged once for an
opaque extension credential bound to the same user.
"""

from __future__ import annotations

import hashlib
import secrets
import time

from fastapi import HTTPException

from app.database import get_connection, get_user_by_id

CONNECT_TTL_S = 120
EXTENSION_TTL_S = 60 * 60 * 24 * 14
EXTENSION_PREFIX = "eyra_ext."


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def issue_connect_code(user_id: str) -> tuple[str, int]:
    raw = secrets.token_urlsafe(32)
    now = int(time.time())
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO extension_connect_codes
                (code_hash, user_id, expires_at, used_at, created_at)
            VALUES (?, ?, ?, NULL, ?)
            """,
            (_digest(raw), user_id, now + CONNECT_TTL_S, now),
        )
    return raw, CONNECT_TTL_S


def exchange_connect_code(raw_code: str) -> tuple[str, object]:
    code = (raw_code or "").strip()
    if not code:
        raise HTTPException(status_code=401, detail="Invalid connect code")
    now = int(time.time())
    digest = _digest(code)
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT user_id, expires_at, used_at
            FROM extension_connect_codes
            WHERE code_hash = ?
            """,
            (digest,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Invalid connect code")
        if row["used_at"] is not None:
            raise HTTPException(status_code=401, detail="Connect code already used")
        if int(row["expires_at"]) <= now:
            raise HTTPException(status_code=401, detail="Connect code expired")
        updated = conn.execute(
            """
            UPDATE extension_connect_codes
            SET used_at = ?
            WHERE code_hash = ? AND used_at IS NULL
            """,
            (now, digest),
        )
        if updated.rowcount != 1:
            raise HTTPException(status_code=401, detail="Connect code already used")
        user = conn.execute("SELECT * FROM users WHERE id = ?", (row["user_id"],)).fetchone()
        if not user:
            raise HTTPException(status_code=401, detail="Invalid connect code")
        token = EXTENSION_PREFIX + secrets.token_urlsafe(32)
        conn.execute(
            """
            INSERT INTO extension_credentials
                (token_hash, user_id, expires_at, revoked_at, created_at)
            VALUES (?, ?, ?, NULL, ?)
            """,
            (_digest(token), user["id"], now + EXTENSION_TTL_S, now),
        )
    return token, user


def extension_user_row(token: str):
    if not token.startswith(EXTENSION_PREFIX):
        return None
    now = int(time.time())
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT user_id, expires_at, revoked_at
            FROM extension_credentials
            WHERE token_hash = ?
            """,
            (_digest(token),),
        ).fetchone()
    if not row or row["revoked_at"] is not None or int(row["expires_at"]) <= now:
        return None
    return get_user_by_id(str(row["user_id"]))


def revoke_extension_credential(token: str) -> bool:
    if not token.startswith(EXTENSION_PREFIX):
        return False
    now = int(time.time())
    with get_connection() as conn:
        updated = conn.execute(
            """
            UPDATE extension_credentials
            SET revoked_at = ?
            WHERE token_hash = ? AND revoked_at IS NULL
            """,
            (now, _digest(token)),
        )
    return updated.rowcount == 1
