from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import httpx

from app import __version__
from app.agent import run_investigation
from app.agent.groq_reasoner import enrich_findings_with_groq
from app.audit_proxy import audit_base, proxy_json, proxy_request
from app.config import get_settings
from app.database import (
    database_ok,
    get_config,
    get_session,
    init_db,
    list_sessions,
    stats,
    update_config,
)
from app.executor import execute_python
from app.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    ConfigResponse,
    ConfigUpdateRequest,
    EnrichFindingsRequest,
    EnrichFindingsResponse,
    EnrichedFinding,
    ExecuteRequest,
    ExecuteResponse,
    HistoryListResponse,
    StatusResponse,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="EYRA Brain",
    description="Intelligent Runtime Debugging Agent — Brain API",
    version=__version__,
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "eyra-brain", "version": __version__}


@app.get("/api/status", response_model=StatusResponse)
def status() -> StatusResponse:
    s = get_settings()
    counts = stats()
    return StatusResponse(
        service="eyra-brain",
        version=__version__,
        healthy=database_ok(),
        backend_url=f"http://{s.eyra_host}:{s.eyra_port}",
        groq_configured=s.groq_configured,
        groq_model=s.groq_model_runtime,
        groq_model_runtime=s.groq_model_runtime,
        groq_model_audit=s.groq_model_audit,
        local_fallback_enabled=s.eyra_allow_local_fallback,
        database_path=s.eyra_db_path,
        database_ok=database_ok(),
        session_count=counts["session_count"],
        verified_count=counts["verified_count"],
        open_investigations=counts["open_investigations"],
        extension_note=(
            "VS Code Eyes is a separate client. This endpoint does not prove extension "
            "connectivity; the web UI reports Eyes status from local preferences."
        ),
    )


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze(body: AnalyzeRequest) -> AnalyzeResponse:
    return await run_investigation(body)


@app.get("/api/history", response_model=HistoryListResponse)
def history(
    q: str | None = Query(default=None),
    status: str | None = Query(default=None),
    language: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> HistoryListResponse:
    total, items = list_sessions(q=q, status=status, language=language, limit=limit, offset=offset)
    return HistoryListResponse(total=total, items=items)


@app.get("/api/history/{session_id}", response_model=AnalyzeResponse)
def history_detail(session_id: str) -> AnalyzeResponse:
    result = get_session(session_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return result


@app.get("/api/config", response_model=ConfigResponse)
def read_config() -> ConfigResponse:
    return get_config()


@app.put("/api/config", response_model=ConfigResponse)
def write_config(body: ConfigUpdateRequest) -> ConfigResponse:
    return update_config(
        project_name=body.project_name,
        retention_days=body.retention_days,
        privacy_store_code=body.privacy_store_code,
        preferred_language=body.preferred_language,
    )


@app.get("/api/memory", response_model=HistoryListResponse)
def memory(
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> HistoryListResponse:
    """SQLite-backed memory listing (keyword search only — no embeddings)."""
    total, items = list_sessions(q=q, limit=limit, offset=offset)
    return HistoryListResponse(total=total, items=items)


@app.post("/api/enrich-findings", response_model=EnrichFindingsResponse)
async def enrich_findings(body: EnrichFindingsRequest) -> EnrichFindingsResponse:
    """Audit-path LLM enrichment using the stronger Groq model (repo findings)."""
    s = get_settings()
    limit = body.limit or s.eyra_audit_enrich_limit
    issues = list(body.issues or [])[:limit]
    if not issues:
        return EnrichFindingsResponse(
            model=s.model_for_profile(body.profile),
            profile=body.profile,
            reasoning_source="local_heuristic",
            issues=[],
            architecture_health={
                "riskRating": "Low Risk",
                "recommendedNextSprint": ["No findings to enrich"],
            },
        )

    if s.groq_configured:
        try:
            enriched, architecture, model = await enrich_findings_with_groq(
                s,
                issues,
                profile=body.profile,
                partial_features=body.partial_features,
            )
            return EnrichFindingsResponse(
                model=model,
                profile=body.profile,
                reasoning_source="groq",
                issues=enriched,
                architecture_health=architecture,
            )
        except Exception as exc:  # noqa: BLE001
            if not s.eyra_allow_local_fallback:
                raise HTTPException(status_code=502, detail=f"Audit enrichment failed: {exc}") from exc

    # Local heuristic fallback (template-like)
    fallback_issues = [
        EnrichedFinding(
            id=i.id or f"issue-{idx}",
            aiExplanation=(
                f"Heuristic review: {i.title or i.ruleId or 'finding'} in "
                f"{i.file or 'unknown'}:{i.line or '?'} — prioritize remediation by severity."
            ),
            patchDiff="",
        )
        for idx, i in enumerate(issues)
    ]
    high = any((i.severity or "").lower() == "critical" for i in issues)
    return EnrichFindingsResponse(
        model=s.model_for_profile(body.profile),
        profile=body.profile,
        reasoning_source="local_heuristic",
        issues=fallback_issues,
        architecture_health={
            "riskRating": "High Risk" if high else "Moderate Risk",
            "recommendedNextSprint": [
                "Triage Critical/High findings first",
                "Remove secrets from source and rotate credentials",
                "Add regression tests around auth and payment paths",
            ],
        },
    )


@app.post("/api/execute", response_model=ExecuteResponse)
def execute(body: ExecuteRequest) -> ExecuteResponse:
    """Run a Python snippet in a sandboxed subprocess (timeout, no network APIs)."""
    if (body.language or "python").lower() not in {"python", "py", "python3"}:
        raise HTTPException(status_code=400, detail="Only Python execution is supported")
    s = get_settings()
    result = execute_python(body.code, timeout_s=s.eyra_exec_timeout_s)
    return ExecuteResponse(**result)


@app.get("/api/audit/health")
async def audit_health() -> dict:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(f"{audit_base()}/api/health")
            data = res.json() if res.content else {}
            return {
                "status": "ok" if res.is_success else "degraded",
                "audit_engine": data,
                "audit_base_url": audit_base(),
            }
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "down",
            "audit_base_url": audit_base(),
            "error": str(exc),
        }


@app.api_route("/api/audit/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def audit_gateway(path: str, request: Request):
    """Proxy to Eyraaaa CodeAudit engine (upload/scan/report)."""
    # SSE: stream through without buffering JSON wrapper
    if path.endswith("/events") and request.method == "GET":
        url = f"{audit_base()}/api/{path}"
        try:
            client = httpx.AsyncClient(timeout=None)

            async def event_stream():
                try:
                    async with client.stream("GET", url, params=dict(request.query_params)) as res:
                        async for chunk in res.aiter_bytes():
                            yield chunk
                finally:
                    await client.aclose()

            return StreamingResponse(event_stream(), media_type="text/event-stream")
        except httpx.ConnectError as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Audit engine unreachable at {audit_base()}",
            ) from exc

    return await proxy_request(request, f"/api/{path}")
