"""HTTP proxy helpers for the Eyraaaa CodeAudit Node backend."""

from __future__ import annotations

import httpx
from fastapi import HTTPException, Request, Response

from app.audit_auth import audit_identity_headers
from app.config import get_settings


def audit_base() -> str:
    return get_settings().eyra_audit_base_url.rstrip("/")


async def proxy_json(
    method: str,
    path: str,
    *,
    user_id: str | None = None,
    **kwargs,
) -> Response:
    url = f"{audit_base()}{path}"
    # GitHub shallow-clone can approach 2 minutes; keep headroom over Eyraaaa git timeout
    timeout = httpx.Timeout(180.0, connect=10.0)
    headers = dict(kwargs.pop("headers", None) or {})
    if user_id:
        headers.update(audit_identity_headers(user_id))
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.request(method, url, headers=headers, **kwargs)
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Audit engine unreachable at {audit_base()}. "
                "Start Eyraaaa server (npm start in Eyraaaa/server)."
            ),
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Audit engine timed out") from exc

    return Response(
        content=res.content,
        status_code=res.status_code,
        media_type=res.headers.get("content-type", "application/json"),
    )


async def proxy_request(request: Request, path: str, *, user_id: str) -> Response:
    """Forward request body/query to audit engine with a signed user identity."""
    body = await request.body()
    headers = audit_identity_headers(user_id)
    ct = request.headers.get("content-type")
    if ct:
        headers["content-type"] = ct
    return await proxy_json(
        request.method,
        path,
        user_id=None,
        content=body if body else None,
        headers=headers,
        params=dict(request.query_params),
    )
