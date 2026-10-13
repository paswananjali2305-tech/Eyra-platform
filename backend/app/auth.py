from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import get_settings
from app.database import get_user_by_id

_TOKEN_TTL_S = 60 * 60 * 24 * 14  # 14 days
_PBKDF2_ROUNDS = 120_000
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str
    username: str
    display_name: str


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt_b = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt_b,
        _PBKDF2_ROUNDS,
    )
    return f"{salt_b.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split("$", 1)
        salt_b = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except (ValueError, TypeError):
        return False
    candidate = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt_b,
        _PBKDF2_ROUNDS,
    )
    return hmac.compare_digest(candidate, expected)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode((text + pad).encode("ascii"))


def _signing_key() -> bytes:
    secret = get_settings().eyra_auth_secret.strip()
    if not secret:
        # Deterministic local fallback so restarts keep tokens valid in college demos.
        secret = f"eyra-dev:{get_settings().eyra_db_path}"
    return hashlib.sha256(secret.encode("utf-8")).digest()


def create_access_token(*, user_id: str, username: str) -> str:
    payload = {
        "sub": user_id,
        "usr": username,
        "iat": int(time.time()),
        "exp": int(time.time()) + _TOKEN_TTL_S,
    }
    body = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = _b64url_encode(
        hmac.new(_signing_key(), body.encode("ascii"), hashlib.sha256).digest()
    )
    return f"{body}.{sig}"


def decode_access_token(token: str) -> dict:
    try:
        body, sig = token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    expected = _b64url_encode(
        hmac.new(_signing_key(), body.encode("ascii"), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(status_code=401, detail="Invalid token signature")
    try:
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Malformed token") from exc
    if int(payload.get("exp") or 0) < int(time.time()):
        raise HTTPException(status_code=401, detail="Token expired")
    if not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid token subject")
    return payload


def user_from_row(row) -> AuthUser:
    return AuthUser(
        id=row["id"],
        email=row["email"],
        username=row["username"],
        display_name=row["display_name"],
    )


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuthUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authentication required")
    payload = decode_access_token(credentials.credentials)
    row = get_user_by_id(str(payload["sub"]))
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    return user_from_row(row)


async def get_optional_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuthUser | None:
    if credentials is None or credentials.scheme.lower() != "bearer":
        return None
    try:
        payload = decode_access_token(credentials.credentials)
    except HTTPException:
        return None
    row = get_user_by_id(str(payload["sub"]))
    if not row:
        return None
    return user_from_row(row)


def bearer_from_request(request: Request) -> str | None:
    auth = request.headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return None
