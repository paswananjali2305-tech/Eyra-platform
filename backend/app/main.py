from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import httpx
import sqlite3

from app import __version__
from app.agent import run_investigation
from app.agent.groq_reasoner import enrich_findings_with_groq
from app.audit_engine import start_audit_engine, stop_audit_engine
from app.audit_proxy import audit_base, proxy_json, proxy_request
from app.auth import (
    AuthUser,
    create_access_token,
    get_current_user,
    get_optional_user,
    hash_password,
    user_from_row,
    verify_password,
)
from app.config import get_settings
from app.database import (
    clear_sessions,
    create_user,
    database_ok,
    get_config,
    get_session,
    get_user_by_email,
    get_user_by_login,
    get_user_by_username,
    init_db,
    list_sessions,
    stats,
    update_config,
)
from app.performance import (
    build_performance_payload,
    generate_test_cases,
    run_test_case,
    suggest_optimized_maybe_llm,
)
from app.runtimes import execute_snippet, list_runtime_capabilities
from app.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    AuthLoginRequest,
    AuthRegisterRequest,
    AuthTokenResponse,
    AuthUserPublic,
    ConfigResponse,
    ConfigUpdateRequest,
    LlmModelsRequest,
    LlmModelsResponse,
    LlmModelOption,
    EnrichFindingsRequest,
    EnrichFindingsResponse,
    EnrichedFinding,
    ExecuteRequest,
    ExecuteResponse,
    HistoryListResponse,
    PerformanceAnalyzeRequest,
    PerformanceOptimizeRequest,
    PerformanceRunTestsRequest,
    PerformanceTestsRequest,
    RuntimesListResponse,
    RuntimeCapability,
    StatusResponse,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    start_audit_engine()
    try:
        yield
    finally:
        stop_audit_engine()


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


def _public_user(user: AuthUser) -> AuthUserPublic:
    return AuthUserPublic(
        id=user.id,
        email=user.email,
        username=user.username,
        display_name=user.display_name,
    )


@app.post("/api/auth/register", response_model=AuthTokenResponse)
def auth_register(body: AuthRegisterRequest) -> AuthTokenResponse:
    if get_user_by_email(body.email):
        raise HTTPException(status_code=409, detail="Email already registered")
    if get_user_by_username(body.username):
        raise HTTPException(status_code=409, detail="Username already taken")
    display = body.display_name or body.username
    try:
        row = create_user(
            email=body.email,
            username=body.username,
            display_name=display,
            password_hash=hash_password(body.password),
        )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Account already exists") from exc
    token = create_access_token(user_id=row["id"], username=row["username"])
    return AuthTokenResponse(
        access_token=token,
        user=AuthUserPublic(
            id=row["id"],
            email=row["email"],
            username=row["username"],
            display_name=row["display_name"],
        ),
    )


@app.post("/api/auth/login", response_model=AuthTokenResponse)
def auth_login(body: AuthLoginRequest) -> AuthTokenResponse:
    row = get_user_by_login(body.login)
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email/username or password")
    user = user_from_row(row)
    token = create_access_token(user_id=user.id, username=user.username)
    return AuthTokenResponse(access_token=token, user=_public_user(user))


@app.get("/api/auth/me", response_model=AuthUserPublic)
def auth_me(user: Annotated[AuthUser, Depends(get_current_user)]) -> AuthUserPublic:
    return _public_user(user)


@app.get("/api/status", response_model=StatusResponse)
def status(
    user: Annotated[AuthUser | None, Depends(get_optional_user)] = None,
) -> StatusResponse:
    s = get_settings()
    counts = stats(user_id=user.id if user else None)
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
async def analyze(
    body: AnalyzeRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> AnalyzeResponse:
    return await run_investigation(body, user_id=user.id)


@app.get("/api/history", response_model=HistoryListResponse)
def history(
    user: Annotated[AuthUser, Depends(get_current_user)],
    q: str | None = Query(default=None),
    status: str | None = Query(default=None),
    language: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> HistoryListResponse:
    total, items = list_sessions(
        q=q,
        status=status,
        language=language,
        user_id=user.id,
        limit=limit,
        offset=offset,
    )
    return HistoryListResponse(total=total, items=items)


@app.delete("/api/history")
def history_clear(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> dict[str, int]:
    """Wipe this user's Brain investigation sessions (runtime History Clear Stale Cache)."""
    return {"cleared": clear_sessions(user_id=user.id)}


@app.get("/api/history/{session_id}", response_model=AnalyzeResponse)
def history_detail(
    session_id: str,
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> AnalyzeResponse:
    result = get_session(session_id, user_id=user.id)
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
        engine_ast=body.engine_ast,
        engine_security=body.engine_security,
        engine_todos=body.engine_todos,
        engine_deps=body.engine_deps,
        groq_api_key=body.groq_api_key,
        groq_model=body.groq_model,
        groq_model_runtime=body.groq_model_runtime,
        groq_model_audit=body.groq_model_audit,
        llm_provider=body.llm_provider,
    )


@app.post("/api/config/llm-models", response_model=LlmModelsResponse)
async def list_llm_models(body: LlmModelsRequest) -> LlmModelsResponse:
    """Detect provider from API key and return tagged model options (live when possible)."""
    from app.llm_catalog import resolve_models_for_key

    data = await resolve_models_for_key(body.api_key, provider=body.provider)
    return LlmModelsResponse(
        provider=data["provider"],
        provider_label=data["provider_label"],
        base_url=data["base_url"],
        live=bool(data["live"]),
        ok=bool(data.get("ok")),
        error=data.get("error"),
        hint=data["hint"],
        selected_model=data.get("selected_model"),
        selected_label=data.get("selected_label"),
        selected_tier=data.get("selected_tier") or "",
        models=[LlmModelOption(**m) for m in data["models"]],
    )


@app.get("/api/memory", response_model=HistoryListResponse)
def memory(
    user: Annotated[AuthUser, Depends(get_current_user)],
    q: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> HistoryListResponse:
    """SQLite-backed investigation memory (keyword search + exact error_type relatedness).

    No embeddings, AST fingerprints, or similarity percentages — only stored sessions.
    """
    total, items = list_sessions(q=q, user_id=user.id, limit=limit, offset=offset)
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


@app.get("/api/runtimes", response_model=RuntimesListResponse)
def runtimes() -> RuntimesListResponse:
    """List registered language adapters and host availability (no auto-install)."""
    caps = list_runtime_capabilities()
    return RuntimesListResponse(
        runtimes=[RuntimeCapability.model_validate(c) for c in caps]
    )


@app.post("/api/execute", response_model=ExecuteResponse)
def execute(body: ExecuteRequest) -> ExecuteResponse:
    """Execute editor buffer via the multilingual runtime registry (temp dir + timeout)."""
    s = get_settings()
    result = execute_snippet(
        code=body.code,
        language=body.language,
        file_name=body.file_name or "snippet",
        timeout_s=s.eyra_exec_timeout_s,
    )
    return ExecuteResponse.model_validate(result.to_api_dict())


@app.post("/api/performance/analyze")
def performance_analyze(body: PerformanceAnalyzeRequest) -> dict:
    """Complexity + baseline suggestion + generated tests for the editor buffer."""
    return build_performance_payload(
        body.code,
        language=body.language,
        file_name=body.file_name,
        target_time=body.target_time,
        target_space=body.target_space,
        goal=body.goal,
    )


@app.post("/api/performance/optimize")
async def performance_optimize(body: PerformanceOptimizeRequest) -> dict:
    """Suggest optimized code toward target complexities (local heuristic, optional Groq)."""
    suggestion = await suggest_optimized_maybe_llm(
        body.code,
        language=body.language,
        target_time=body.target_time,
        target_space=body.target_space,
        goal=body.goal,
    )
    return {
        "file_name": body.file_name,
        "language": body.language,
        "suggestion": suggestion,
    }


@app.post("/api/performance/tests/generate")
def performance_tests_generate(body: PerformanceTestsRequest) -> dict:
    cases = generate_test_cases(
        body.code, language=body.language, function_name=body.function_name
    )
    return {
        "cases": cases,
        "total": len(cases),
        "passed": 0,
        "failed": 0,
        "not_run": len(cases),
    }


@app.post("/api/performance/tests/run")
def performance_tests_run(body: PerformanceRunTestsRequest) -> dict:
    """Run generated (or provided) test cases against the buffer via soft sandbox."""
    cases = list(body.cases or [])
    if not cases:
        cases = generate_test_cases(body.code, language=body.language)
    if body.case_ids:
        id_set = set(body.case_ids)
        selected = [c for c in cases if int(c.get("id", -1)) in id_set]
    else:
        selected = cases

    results = [
        run_test_case(
            body.code,
            c,
            language=body.language,
            file_name=body.file_name,
        )
        for c in selected
    ]
    # Merge back into full list when subset run
    by_id = {int(r["id"]): r for r in results}
    merged = []
    for c in cases:
        cid = int(c.get("id", -1))
        merged.append(by_id.get(cid, c))

    passed = sum(1 for c in merged if c.get("status") == "passed")
    failed = sum(1 for c in merged if c.get("status") == "failed")
    not_run = sum(1 for c in merged if c.get("status") == "not_run")
    log_lines = [
        f"> Ran {len(results)} test(s)",
        f"> Passed {passed} · Failed {failed} · Not run {not_run}",
    ]
    for r in results:
        log_lines.append(
            f"> #{r.get('id')} {r.get('description')} → {r.get('status')} "
            f"(expected={r.get('expected')!r} actual={r.get('actual')!r})"
        )
    return {
        "cases": merged,
        "total": len(merged),
        "passed": passed,
        "failed": failed,
        "not_run": not_run,
        "log": "\n".join(log_lines),
    }


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
