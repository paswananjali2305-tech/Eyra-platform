from __future__ import annotations

import json
import re
from typing import Any

import httpx

from app.agent.local_reasoner import ReasoningDraft, reason_locally
from app.config import Settings
from app.schemas import (
    AnalyzeRequest,
    EnrichedFinding,
    EnrichFinding,
    EvidenceItem,
    SuggestedCorrection,
    VerificationResult,
)


SYSTEM_PROMPT = """You are EYRA, an intelligent runtime debugging agent.
Analyze the supplied runtime context and return ONLY valid JSON with keys:
error_type, error_summary, root_cause, explanation, evidence (list of {kind, detail, location}),
suggested_summary, corrected_code, verification_status (verified|unverified|not_run|failed),
verification_detail, confidence (0-1 number).

Rules:
- Prefer evidence from the provided code, stack trace, and terminal output.
- Do not claim verification unless the evidence clearly supports the conclusion.
- Human-in-the-loop: suggest fixes for developer review; never instruct destructive shell commands.
- Keep corrected_code minimal and safe.
"""

AUDIT_ENRICH_PROMPT = """You are EYRA Codebase Audit, a security and quality analyst.
Given static-analysis findings from a repository scan, return ONLY valid JSON:
{
  "items": [
    {"id": "...", "aiExplanation": "...", "patchDiff": "unified diff string"}
  ],
  "architectureHealth": {
    "riskRating": "High Risk|Moderate Risk|Low Risk",
    "recommendedNextSprint": ["...", "..."]
  }
}

Rules:
- One item per input finding id (preserve ids).
- aiExplanation: concise semantic impact (2-4 sentences).
- patchDiff: minimal unified diff when a safe fix is clear; else empty string.
- Prefer secure defaults (parameterized queries, env secrets, typed exceptions).
- Do not invent files that were not provided.
"""


async def _groq_chat_json(
    settings: Settings,
    *,
    model: str,
    system: str,
    user_payload: dict[str, Any],
    timeout_s: float = 90.0,
) -> dict[str, Any]:
    payload = {
        "model": model,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user_payload)},
        ],
    }
    base = (getattr(settings, "llm_base_url", None) or "").rstrip("/")
    if not base:
        provider = (getattr(settings, "llm_provider", None) or "groq").lower()
        if provider == "openai":
            base = "https://api.openai.com/v1"
        elif provider == "openrouter":
            base = "https://openrouter.ai/api/v1"
        else:
            base = "https://api.groq.com/openai/v1"
    headers = {
        "Authorization": f"Bearer {settings.groq_api_key}",
        "Content-Type": "application/json",
    }
    if "openrouter.ai" in base:
        headers["HTTP-Referer"] = "https://eyra.local"
        headers["X-Title"] = "EYRA"
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        response = await client.post(
            f"{base}/chat/completions",
            headers=headers,
            json=payload,
        )
    if response.status_code >= 400:
        raise RuntimeError(
            f"LLM API error HTTP {response.status_code}: {response.text[:300]}"
        )
    data = response.json()
    content = data["choices"][0]["message"]["content"]
    return _parse_json_content(content)


async def reason_with_groq(
    req: AnalyzeRequest,
    settings: Settings,
    *,
    model: str | None = None,
) -> ReasoningDraft:
    chosen = model or settings.model_for_profile(req.reasoning_profile)
    parsed = await _groq_chat_json(
        settings,
        model=chosen,
        system=SYSTEM_PROMPT,
        user_payload={
            "file_name": req.file_name,
            "language": req.language,
            "code_snippet": req.code_snippet,
            "terminal_output": req.terminal_output,
            "stack_trace": req.stack_trace,
            "error_type": req.error_type,
            "reasoning_profile": req.reasoning_profile,
        },
        timeout_s=60.0,
    )
    draft = _draft_from_parsed(req, parsed)
    draft.reasoning_note = (
        f"Reasoning produced by Groq ({chosen}). Treat as assistive hypothesis until verified."
    )
    return draft


async def enrich_findings_with_groq(
    settings: Settings,
    issues: list[EnrichFinding],
    *,
    profile: str = "audit",
    partial_features: list[dict[str, Any]] | None = None,
) -> tuple[list[EnrichedFinding], dict[str, Any], str]:
    model = settings.model_for_profile(profile)
    compact = [
        {
            "id": i.id or f"issue-{idx}",
            "ruleId": i.ruleId,
            "file": i.file,
            "line": i.line,
            "severity": i.severity,
            "type": i.type,
            "title": i.title,
            "description": (i.description or "")[:800],
            "snippet": (i.snippet or "")[:1200],
        }
        for idx, i in enumerate(issues)
    ]
    parsed = await _groq_chat_json(
        settings,
        model=model,
        system=AUDIT_ENRICH_PROMPT,
        user_payload={
            "issues": compact,
            "partialFeaturesCount": len(partial_features or []),
        },
        timeout_s=120.0,
    )
    by_id = {
        str(item.get("id")): item
        for item in (parsed.get("items") or [])
        if isinstance(item, dict) and item.get("id") is not None
    }
    enriched: list[EnrichedFinding] = []
    for row in compact:
        hit = by_id.get(str(row["id"]), {})
        enriched.append(
            EnrichedFinding(
                id=row["id"],
                aiExplanation=str(
                    hit.get("aiExplanation")
                    or f"Semantic review of {row.get('title') or row['id']} in {row.get('file')}."
                ),
                patchDiff=str(hit.get("patchDiff") or ""),
            )
        )
    architecture = parsed.get("architectureHealth") or {
        "riskRating": "Moderate Risk",
        "recommendedNextSprint": [
            "Triage Critical/High findings first",
            "Remove secrets from source and rotate credentials",
            "Add tests around auth and payment paths",
        ],
    }
    return enriched, architecture, model


def _parse_json_content(content: str) -> dict[str, Any]:
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", content)
        if not match:
            raise
        return json.loads(match.group(0))


def _draft_from_parsed(req: AnalyzeRequest, parsed: dict[str, Any]) -> ReasoningDraft:
    fallback = reason_locally(req)
    evidence_raw = parsed.get("evidence") or []
    evidence: list[EvidenceItem] = []
    for item in evidence_raw:
        if isinstance(item, dict):
            evidence.append(
                EvidenceItem(
                    kind=str(item.get("kind", "note")),
                    detail=str(item.get("detail", "")),
                    location=item.get("location"),
                )
            )
    if not evidence:
        evidence = fallback.evidence

    v_status = str(parsed.get("verification_status", "unverified"))
    if v_status not in {"verified", "unverified", "not_run", "failed"}:
        v_status = "unverified"

    corrected = str(parsed.get("corrected_code") or fallback.suggested_correction.corrected_code)
    return ReasoningDraft(
        error_type=str(parsed.get("error_type") or fallback.error_type),
        error_summary=str(parsed.get("error_summary") or fallback.error_summary),
        root_cause=str(parsed.get("root_cause") or fallback.root_cause),
        explanation=str(parsed.get("explanation") or fallback.explanation),
        evidence=evidence,
        suggested_correction=SuggestedCorrection(
            summary=str(parsed.get("suggested_summary") or fallback.suggested_correction.summary),
            corrected_code=corrected,
            diff_unified=fallback.suggested_correction.diff_unified,
            apply_mode="review_and_copy",
        ),
        verification=VerificationResult(
            status=v_status,  # type: ignore[arg-type]
            method="groq_plus_evidence",
            detail=str(parsed.get("verification_detail") or "LLM assessment of supplied evidence."),
            is_hypothesis_only=v_status != "verified",
        ),
        confidence=float(parsed.get("confidence") or fallback.confidence or 0.6),
        reasoning_note="Reasoning produced by Groq LLM. Treat as assistive hypothesis until verified.",
    )
