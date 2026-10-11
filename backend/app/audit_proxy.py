"""HTTP proxy helpers for the Eyraaaa CodeAudit Node backend."""

from __future__ import annotations

import httpx
from fastapi import HTTPException, Request, Response

from app.config import get_settings


def audit_base() -> str:
    return get_settings().eyra_audit_base_url.rstrip("/")


async def proxy_json(method: str, path: str, **kwargs) -> Response:
    url = f"{audit_base()}{path}"
    timeout = httpx.Timeout(120.0, connect=5.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.request(method, url, **kwargs)
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


async def proxy_request(request: Request, path: str) -> Response:
    """Forward request body/query to audit engine."""
    body = await request.body()
    headers = {}
    ct = request.headers.get("content-type")
    if ct:
        headers["content-type"] = ct
    return await proxy_json(
        request.method,
        path,
        content=body if body else None,
        headers=headers,
        params=dict(request.query_params),
    )
