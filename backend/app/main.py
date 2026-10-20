from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Annotated

from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
import httpx
import sqlite3

from app import __version__
from app.agent import run_investigation
from app.agent.groq_reasoner import enrich_findings_with_groq
from app.audit_engine import start_audit_engine, stop_audit_engine
from app.audit_auth import audit_identity_headers
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
from app.extension_auth import (
    EXTENSION_PREFIX,
    exchange_connect_code,
    issue_connect_code,
    revoke_extension_credential,
)
from app.extension_launch import (
    ensure_vsix,
    extension_status,
    open_local_extension,
)
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
    execution_timing,
    list_sessions,
    record_run_duration,
    stats,
    update_config,
)
from app.performance import (
    build_performance_payload,
    generate_test_cases,
    measure_line_coverage,
    run_test_case,
    suggest_optimized_maybe_llm,
)
from app.runtimes import execute_snippet, list_runtime_capabilities
from app.runtimes.registry import normalize_language_id
from app.jstestgen import analyze_js_structure
from app.testgen import analyze_python_structure
from app.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    AuthLoginRequest,
    AuthRegisterRequest,
    AuthTokenResponse,
    AuthUserPublic,
    ExtensionCodeResponse,
    ExtensionExchangeRequest,
    ExtensionOpenRequest,
    ExtensionOpenResponse,
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


@app.post("/api/auth/extension/code", response_model=ExtensionCodeResponse)
def extension_connect_code(
    user: Annotated[AuthUser, Depends(get_current_user)],
) -> ExtensionCodeResponse:
    """Issue a two-minute, single-use code for the signed-in web user."""
    code, expires_in = issue_connect_code(user.id)
    return ExtensionCodeResponse(code=code, expires_in=expires_in)


@app.post("/api/auth/extension/exchange", response_model=AuthTokenResponse)
def extension_exchange(body: ExtensionExchangeRequest) -> AuthTokenResponse:
    """Exchange a connect code for a revocable credential on the same account."""
    token, row = exchange_connect_code(body.code)
    user = user_from_row(row)
    return AuthTokenResponse(access_token=token, user=_public_user(user))


@app.post("/api/auth/extension/disconnect")
def extension_disconnect(request: Request) -> dict[str, bool]:
    """Revoke the presented extension credential. A web login token is left valid."""
    auth = request.headers.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = auth[7:].strip()
    if not token.startswith(EXTENSION_PREFIX):
        raise HTTPException(
            status_code=400,
            detail="This is not an extension credential. The web session was not changed.",
        )
    revoked = revoke_extension_credential(token)
    if not revoked:
        raise HTTPException(status_code=401, detail="Extension credential is invalid, expired, or revoked")
    return {"revoked": True}


@app.get("/api/extension/status")
def api_extension_status(
    editor: Annotated[str, Query(pattern="^(auto|cursor|vscode)$")] = "vscode",
) -> dict:
    """Local extension readiness — not Marketplace presence. Target editor is VS Code."""
    return extension_status(editor)


@app.post("/api/extension/open", response_model=ExtensionOpenResponse)
def api_extension_open(body: ExtensionOpenRequest) -> ExtensionOpenResponse:
    """Install the repo VSIX into VS Code (or EDH fallback) and open EYRA.

    Does not pass tokens or auto-sign-in. Connect from Web stays separate.
    """
    result = open_local_extension(body.editor)
    return ExtensionOpenResponse(
        ok=result.ok,
        editor=result.editor,
        extension_id=result.extension_id,
        uri=result.uri,
        vsix_path=result.vsix_path,
        installed=result.installed,
        opened=result.opened,
        mode=result.mode,
        message=result.message,
        detail=result.detail,
    )


@app.get("/api/extension/vsix")
def api_extension_vsix_download() -> FileResponse:
    """Download the locally packaged EYRA VSIX for manual install."""
    try:
        vsix = ensure_vsix()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return FileResponse(
        path=vsix,
        media_type="application/octet-stream",
        filename=Path(vsix).name,
    )


@app.get("/api/status", response_model=StatusResponse)
def status(
    user: Annotated[AuthUser | None, Depends(get_optional_user)] = None,
) -> StatusResponse:
    s = get_settings()
    counts = stats(user_id=user.id if user else None)
    timing = execution_timing(user_id=user.id if user else None)
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
        avg_execution_ms=timing["avg_execution_ms"],
        execution_count=int(timing["execution_count"] or 0),
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
def execute(
    body: ExecuteRequest,
    user: Annotated[AuthUser | None, Depends(get_optional_user)] = None,
) -> ExecuteResponse:
    """Execute editor buffer via the multilingual runtime registry (temp dir + timeout)."""
    s = get_settings()
    result = execute_snippet(
        code=body.code,
        language=body.language,
        file_name=body.file_name or "snippet",
        timeout_s=s.eyra_exec_timeout_s,
    )
    if user and result.runtime_available and result.status != "RUNTIME_UNAVAILABLE":
        record_run_duration(user.id, result.duration_ms)
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
    lang_token = normalize_language_id(body.language)
    if lang_token in {"javascript", "typescript"}:
        structure = analyze_js_structure(body.code)
    elif lang_token == "python":
        structure = analyze_python_structure(body.code)
    else:
        structure = {"functions": [], "classes": [], "imports": [], "assertions": 0, "top_level_executable": False}
    analysis = {
        "functions": structure.get("functions", []),
        "classes": structure.get("classes", []),
        "imports": structure.get("imports", []),
        "assertions": structure.get("assertions", 0),
        "top_level_executable": bool(structure.get("top_level_executable")),
        "parse_error": structure.get("parse_error"),
    }
    notice = None
    if lang_token not in {"python", "javascript", "typescript"}:
        notice = (
            f"Automatic test generation does not support {body.language} yet. "
            f"Supported generators: Python, JavaScript, and TypeScript. "
            f"No test cases were generated."
        )
    mode = cases[0].get("mode") if cases else ("unsupported" if notice else "clarification")
    return {
        "cases": cases,
        "mode": mode,
        "notice": notice,
        "language": lang_token,
        "file_name": body.file_name,
        "target": cases[0].get("target") if cases else None,
        "analysis": analysis,
        "total": len(cases),
        "passed": 0,
        "failed": 0,
        "error": 0,
        "skipped": 0,
        "not_run": len(cases),
        "coverage": {
            "status": "unavailable",
            "measured": False,
            "percent": None,
            "reason": "Coverage instrumentation was not run during test generation.",
        },
    }


@app.post("/api/performance/tests/run")
def performance_tests_run(body: PerformanceRunTestsRequest) -> dict:
    """Run generated (or provided) test cases against the buffer via soft sandbox."""
    cases = list(body.cases or [])
    if not cases:
        cases = generate_test_cases(body.code, language=body.language)
    if body.case_ids:
        available = {int(c.get("id", -1)) for c in cases}
        unknown = [item for item in body.case_ids if item not in available]
        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown test case id(s): {unknown}")
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

    def count(status: str) -> int:
        return sum(1 for c in merged if str(c.get("status", "")).lower() == status)

    passed = count("passed")
    failed = count("failed")
    error = count("error")
    skipped = count("skipped")
    not_run = count("not_run")
    evaluated = passed + failed
    pass_rate = round((passed / evaluated) * 100, 1) if evaluated else None
    coverage = measure_line_coverage(
        body.code,
        results,
        language=body.language,
        file_name=body.file_name,
    )
    coverage_line = (
        f"> Line coverage {coverage['percent']}% ({coverage['covered_lines']}/{coverage['total_lines']} lines) — {coverage['reason']}"
        if coverage["measured"]
        else f"> Coverage unavailable: {coverage['reason']}"
    )
    log_lines = [
        f"> Ran {len(results)} test(s)",
        f"> Passed {passed} · Failed {failed} · Error {error} · Skipped {skipped} · Not run {not_run}",
        coverage_line,
    ]
    for r in results:
        detail = r.get("failure_reason") or ""
        log_lines.append(
            f"> #{r.get('id')} {r.get('description')} → {r.get('status')} "
            f"(expected={r.get('expected_result') or r.get('expected')!r} actual={r.get('actual')!r})"
            f"{f' — {detail}' if detail else ''}"
        )
    return {
        "cases": merged,
        "total": len(merged),
        "passed": passed,
        "failed": failed,
        "error": error,
        "skipped": skipped,
        "executed": 0,
        "not_run": not_run,
        "pass_rate_percent": pass_rate,
        "coverage": coverage,
        "language": normalize_language_id(body.language),
        "file_name": body.file_name,
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
async def audit_gateway(
    path: str,
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    """Proxy to the Code Audit engine. Identity is the validated Brain token, then re-signed."""
    # SSE: stream through without buffering JSON wrapper
    if path.endswith("/events") and request.method == "GET":
        url = f"{audit_base()}/api/{path}"
        try:
            client = httpx.AsyncClient(timeout=None)

            async def event_stream():
                try:
                    async with client.stream(
                        "GET",
                        url,
                        params=dict(request.query_params),
                        headers=audit_identity_headers(user.id),
                    ) as res:
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

    return await proxy_request(request, f"/api/{path}", user_id=user.id)
