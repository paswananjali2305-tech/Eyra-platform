from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class SessionStatus(str, Enum):
    NEEDS_REVIEW = "needs_review"
    HYPOTHESIS = "hypothesis"
    VERIFIED = "verified"
    UNVERIFIED = "unverified"
    FAILED = "failed"


class AnalyzeRequest(BaseModel):
    file_name: str = Field(..., min_length=1, max_length=512)
    language: str = Field(default="python", min_length=1, max_length=64)
    code_snippet: str = Field(..., min_length=1, max_length=200_000)
    terminal_output: str = Field(default="", max_length=100_000)
    stack_trace: str = Field(default="", max_length=100_000)
    error_type: str | None = Field(default=None, max_length=128)
    project_name: str = Field(default="default", max_length=128)
    # runtime = fast single-snippet model; audit reserved for heavier paths
    reasoning_profile: Literal["runtime", "audit"] = "runtime"

    @field_validator("file_name")
    @classmethod
    def strip_path_secrets(cls, value: str) -> str:
        # Keep basename only — avoid leaking absolute local paths
        name = value.replace("\\", "/").split("/")[-1].strip()
        if not name:
            raise ValueError("file_name must include a file name")
        return name

    @field_validator("code_snippet", "terminal_output", "stack_trace")
    @classmethod
    def reject_null_bytes(cls, value: str) -> str:
        if "\x00" in value:
            raise ValueError("null bytes are not allowed")
        return value


class ExecuteRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=200_000)
    language: str = Field(default="python", max_length=64)
    file_name: str = Field(default="snippet.py", max_length=512)

    @field_validator("code")
    @classmethod
    def reject_null_bytes_code(cls, value: str) -> str:
        if "\x00" in value:
            raise ValueError("null bytes are not allowed")
        return value


class ExecuteResponse(BaseModel):
    # Legacy fields (Python client / ScopeBot)
    ok: bool
    exit_code: int
    stdout: str
    stderr: str
    error_type: str | None = None
    # Multilingual runtime fields (optional for backward compatibility)
    language: str | None = None
    runtime: str | None = None
    runtime_version: str | None = None
    runtime_available: bool | None = None
    status: str | None = None
    phase: str | None = None
    timed_out: bool | None = None
    duration_ms: int | None = None
    diagnostics: str | None = None
    stack_trace: str | None = None
    source_evidence: str | None = None


class RuntimeCapability(BaseModel):
    language: str
    displayName: str
    runtime: str | None = None
    available: bool
    version: str | None = None
    detail: str | None = None
    executable: bool = True


class RuntimesListResponse(BaseModel):
    runtimes: list[RuntimeCapability]


class EvidenceItem(BaseModel):
    kind: str
    detail: str
    location: str | None = None


class TimelineEvent(BaseModel):
    step: str
    detail: str
    status: Literal["done", "active", "pending", "skipped"] = "done"


class SuggestedCorrection(BaseModel):
    summary: str
    corrected_code: str
    diff_unified: str | None = None
    apply_mode: Literal["review_and_copy"] = "review_and_copy"


class VerificationResult(BaseModel):
    status: Literal["verified", "unverified", "not_run", "failed"]
    method: str
    detail: str
    is_hypothesis_only: bool = True


class AnalyzeResponse(BaseModel):
    session_id: str
    status: SessionStatus
    error_type: str
    error_summary: str
    root_cause: str
    explanation: str
    evidence: list[EvidenceItem]
    execution_timeline: list[TimelineEvent]
    suggested_correction: SuggestedCorrection
    verification: VerificationResult
    related_session_ids: list[str] = Field(default_factory=list)
    reasoning_source: Literal["groq", "local_heuristic"]
    reasoning_note: str
    file_name: str
    language: str
    code_snippet: str
    terminal_output: str
    stack_trace: str
    project_name: str
    created_at: datetime
    confidence: float | None = None


class HistoryItem(BaseModel):
    session_id: str
    file_name: str
    language: str
    error_type: str
    error_summary: str
    root_cause: str
    status: SessionStatus
    verification_status: str
    reasoning_source: str
    project_name: str
    created_at: datetime
    confidence: float | None = None
    # Exact error_type match count in SQLite (not embedding similarity)
    same_error_count: int | None = None


class HistoryListResponse(BaseModel):
    total: int
    items: list[HistoryItem]


class AuthRegisterRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)
    display_name: str | None = Field(default=None, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        if "@" not in email or "." not in email.split("@")[-1]:
            raise ValueError("Enter a valid email address")
        return email

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        name = value.strip()
        if not name.replace("_", "").replace(".", "").replace("-", "").isalnum():
            raise ValueError("Username may only use letters, numbers, ., _, -")
        return name

    @field_validator("display_name")
    @classmethod
    def strip_display(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class AuthLoginRequest(BaseModel):
    login: str = Field(..., min_length=1, max_length=254)
    password: str = Field(..., min_length=1, max_length=128)

    @field_validator("login")
    @classmethod
    def strip_login(cls, value: str) -> str:
        return value.strip()


class AuthUserPublic(BaseModel):
    id: str
    email: str
    username: str
    display_name: str


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AuthUserPublic


class StatusResponse(BaseModel):
    service: str
    version: str
    healthy: bool
    backend_url: str
    groq_configured: bool
    groq_model: str
    groq_model_runtime: str = ""
    groq_model_audit: str = ""
    local_fallback_enabled: bool
    database_path: str
    database_ok: bool
    session_count: int
    verified_count: int
    open_investigations: int
    extension_note: str


class EnrichFinding(BaseModel):
    id: str | None = None
    ruleId: str | None = None
    file: str | None = None
    line: int | None = None
    severity: str | None = None
    type: str | None = None
    title: str | None = None
    description: str | None = None
    snippet: str | None = None


class EnrichFindingsRequest(BaseModel):
    issues: list[EnrichFinding] = Field(default_factory=list)
    partial_features: list[dict[str, Any]] = Field(default_factory=list)
    profile: Literal["audit", "runtime"] = "audit"
    limit: int | None = Field(default=None, ge=1, le=40)


class EnrichedFinding(BaseModel):
    id: str | None = None
    aiExplanation: str
    patchDiff: str


class EnrichFindingsResponse(BaseModel):
    model: str
    profile: str
    reasoning_source: Literal["groq", "local_heuristic"]
    issues: list[EnrichedFinding]
    architecture_health: dict[str, Any]


class ConfigUpdateRequest(BaseModel):
    project_name: str | None = Field(default=None, max_length=128)
    retention_days: int | None = Field(default=None, ge=1, le=3650)
    privacy_store_code: bool | None = None
    preferred_language: str | None = Field(default=None, max_length=64)
    # Codebase audit engine toggles (college project scope)
    engine_ast: bool | None = None
    engine_security: bool | None = None
    engine_todos: bool | None = None
    engine_deps: bool | None = None
    # LLM — full key only on write; masked placeholders are ignored server-side
    groq_api_key: str | None = Field(default=None, max_length=256)
    groq_model: str | None = Field(default=None, max_length=128)
    groq_model_runtime: str | None = Field(default=None, max_length=128)
    groq_model_audit: str | None = Field(default=None, max_length=128)
    llm_provider: str | None = Field(default=None, max_length=32)


class LlmModelOption(BaseModel):
    id: str
    label: str
    tier: str = ""
    note: str = ""
    recommended: bool = False


class LlmModelsRequest(BaseModel):
    api_key: str | None = Field(default=None, max_length=256)
    provider: str | None = Field(default=None, max_length=32)


class LlmModelsResponse(BaseModel):
    provider: str
    provider_label: str
    base_url: str
    live: bool
    ok: bool = False
    error: str | None = None
    hint: str
    selected_model: str | None = None
    selected_label: str | None = None
    selected_tier: str | None = None
    models: list[LlmModelOption]


class ConfigResponse(BaseModel):
    project_name: str
    retention_days: int
    privacy_store_code: bool
    preferred_language: str
    engine_ast: bool = True
    engine_security: bool = True
    engine_todos: bool = True
    engine_deps: bool = True
    backend_url: str
    groq_configured: bool
    groq_model: str
    groq_model_runtime: str = ""
    groq_model_audit: str = ""
    groq_api_key_masked: str = ""
    groq_models: list[str] = Field(default_factory=list)
    llm_provider: str = "groq"
    llm_provider_label: str = "Groq"
    llm_models: list[LlmModelOption] = Field(default_factory=list)
    llm_hint: str = ""
    supported_languages: list[str]
    notes: dict[str, Any]


# --- Performance / Test Analysis ---


class PerformanceAnalyzeRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=200_000)
    language: str = Field(default="python", max_length=64)
    file_name: str = Field(default="snippet.py", max_length=512)
    target_time: str = Field(default="O(n)", max_length=32)
    target_space: str = Field(default="O(1)", max_length=32)
    goal: str = Field(default="", max_length=2000)

    @field_validator("code")
    @classmethod
    def reject_null_bytes_perf(cls, value: str) -> str:
        if "\x00" in value:
            raise ValueError("null bytes are not allowed")
        return value


class PerformanceOptimizeRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=200_000)
    language: str = Field(default="python", max_length=64)
    file_name: str = Field(default="snippet.py", max_length=512)
    target_time: str = Field(default="O(n)", max_length=32)
    target_space: str = Field(default="O(1)", max_length=32)
    goal: str = Field(default="", max_length=2000)

    @field_validator("code")
    @classmethod
    def reject_null_bytes_opt(cls, value: str) -> str:
        if "\x00" in value:
            raise ValueError("null bytes are not allowed")
        return value


class PerformanceTestsRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=200_000)
    language: str = Field(default="python", max_length=64)
    file_name: str = Field(default="snippet.py", max_length=512)
    function_name: str | None = Field(default=None, max_length=128)

    @field_validator("code")
    @classmethod
    def reject_null_bytes_tests(cls, value: str) -> str:
        if "\x00" in value:
            raise ValueError("null bytes are not allowed")
        return value


class PerformanceRunTestsRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=200_000)
    language: str = Field(default="python", max_length=64)
    file_name: str = Field(default="snippet.py", max_length=512)
    cases: list[dict[str, Any]] = Field(default_factory=list)
    case_ids: list[int] | None = None

    @field_validator("code")
    @classmethod
    def reject_null_bytes_run(cls, value: str) -> str:
        if "\x00" in value:
            raise ValueError("null bytes are not allowed")
        return value
