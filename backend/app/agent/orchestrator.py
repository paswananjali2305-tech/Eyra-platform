from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from app.agent.diagnostics_evidence import (
    evidence_from_diagnostics,
    merge_diagnostic_evidence,
)
from app.agent.groq_reasoner import reason_with_groq
from app.agent.local_reasoner import reason_locally
from app.config import Settings, get_settings
from app.database import find_related, get_config, new_session_id, save_session
from app.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    SessionStatus,
    TimelineEvent,
)


async def run_investigation(
    req: AnalyzeRequest,
    *,
    user_id: str | None = None,
) -> AnalyzeResponse:
    settings = get_settings()
    config = get_config()

    timeline: list[TimelineEvent] = [
        TimelineEvent(step="Observe", detail="Runtime context accepted and validated.", status="done"),
        TimelineEvent(step="Investigate", detail="Collecting error type and related memory.", status="done"),
    ]

    draft = None
    reasoning_source: str

    model = settings.model_for_profile(req.reasoning_profile)
    if settings.groq_configured:
        timeline.append(
            TimelineEvent(
                step="Reason",
                detail=f"Calling Groq model {model} ({req.reasoning_profile}).",
                status="active",
            )
        )
        try:
            draft = await reason_with_groq(req, settings, model=model)
            reasoning_source = "groq"
            timeline[-1] = TimelineEvent(
                step="Reason",
                detail=f"Groq model {model} returned structured analysis.",
                status="done",
            )
        except Exception as exc:
            if not settings.eyra_allow_local_fallback:
                raise HTTPException(
                    status_code=502,
                    detail=f"Groq reasoning failed and local fallback is disabled: {exc}",
                ) from exc
            draft = reason_locally(req)
            reasoning_source = "local_heuristic"
            timeline[-1] = TimelineEvent(
                step="Reason",
                detail=f"Groq failed ({exc}); used explicitly labeled local heuristic.",
                status="done",
            )
    else:
        if not settings.eyra_allow_local_fallback:
            raise HTTPException(
                status_code=503,
                detail=(
                    "GROQ_API_KEY is not configured. Set it in backend/.env "
                    "or enable EYRA_ALLOW_LOCAL_FALLBACK=true for local heuristic testing."
                ),
            )
        timeline.append(
            TimelineEvent(
                step="Reason",
                detail="GROQ_API_KEY missing — using labeled local heuristic fixture.",
                status="done",
            )
        )
        draft = reason_locally(req)
        reasoning_source = "local_heuristic"

    timeline.append(
        TimelineEvent(
            step="Verify",
            detail=draft.verification.detail,
            status="done" if draft.verification.status != "not_run" else "skipped",
        )
    )
    timeline.append(
        TimelineEvent(step="Respond", detail="Structured report ready for developer review.", status="done")
    )

    # Client VS Code Problems are authoritative evidence — never invented by the model.
    evidence = merge_diagnostic_evidence(
        evidence_from_diagnostics(req),
        draft.evidence,
    )

    if draft.verification.status == "verified":
        status = SessionStatus.VERIFIED
    elif draft.verification.is_hypothesis_only:
        status = SessionStatus.HYPOTHESIS
    else:
        status = SessionStatus.NEEDS_REVIEW

    session_id = new_session_id()
    related = find_related(
        draft.error_type, exclude_id=None, limit=5, user_id=user_id
    )

    result = AnalyzeResponse(
        session_id=session_id,
        status=status,
        error_type=draft.error_type,
        error_summary=draft.error_summary,
        root_cause=draft.root_cause,
        explanation=draft.explanation,
        evidence=evidence,
        execution_timeline=timeline,
        suggested_correction=draft.suggested_correction,
        verification=draft.verification,
        related_session_ids=related,
        reasoning_source=reasoning_source,  # type: ignore[arg-type]
        reasoning_note=draft.reasoning_note,
        file_name=req.file_name,
        language=req.language,
        code_snippet=req.code_snippet,
        terminal_output=req.terminal_output,
        stack_trace=req.stack_trace,
        project_name=req.project_name or config.project_name,
        created_at=datetime.now(timezone.utc),
        confidence=draft.confidence,
    )

    return save_session(
        result, store_code=config.privacy_store_code, user_id=user_id
    )
