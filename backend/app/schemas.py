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
    ok: bool
    exit_code: int
    stdout: str
    stderr: str
    error_type: str | None = None


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


class HistoryListResponse(BaseModel):
    total: int
    items: list[HistoryItem]


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


class ConfigResponse(BaseModel):
    project_name: str
    retention_days: int
    privacy_store_code: bool
    preferred_language: str
    backend_url: str
    groq_configured: bool
    groq_model: str
    supported_languages: list[str]
    notes: dict[str, Any]
