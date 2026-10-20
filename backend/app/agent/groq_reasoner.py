from __future__ import annotations

import ast
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


CHAT_SYSTEM_PROMPT = """You are EYRA, a coding copilot in the side chat. You answer like a strong pair-programmer who also knows general questions.

Return ONLY valid JSON with keys:
error_type, error_summary, root_cause, explanation, evidence (list of {kind, detail, location}),
suggested_summary, corrected_code, verification_status (verified|unverified|not_run|failed),
verification_detail, confidence (0-1 number).

How to answer:
- Put the full reply in "explanation". Answer like a person in chat, in short paragraphs.
- Answer the actual question. General questions, how-tos, concepts, and small talk all deserve a real answer. Do not refuse just because the open file is unrelated.
- Use the open code when the question is about it. Otherwise ignore the file and still answer.
- For a normal question: error_type must be "None", error_summary "", root_cause "", corrected_code "".
- Do not invent bugs, diagnostics, or a fix the user did not ask for.
- Prose stays prose. When the answer needs code, put only that code in a fenced block:
  ```python
  if x > 0:
      print(x)
  ```
  Do not wrap the whole answer in a fence, and do not paste code as one long sentence.
- If they ask you to write code, put a short explanation in "explanation" and the code in "corrected_code".
- If the message is Mode: alternate-fix, they want a DIFFERENT solution than previous_suggestion.
  Do not repeat previous_suggestion. Put the new full snippet in corrected_code, name the approach in suggested_summary,
  and explain why it is different in explanation. error_type should be "Alternative".
"""

SYSTEM_PROMPT = """You are EYRA, an intelligent runtime debugging agent.
Analyze the supplied runtime context and return ONLY valid JSON with keys:
error_type, error_summary, root_cause, explanation, evidence (list of {kind, detail, location}),
suggested_summary, corrected_code, verification_status (verified|unverified|not_run|failed),
verification_detail, confidence (0-1 number).

Rules:
- Prefer evidence from the provided code, stack trace, terminal output, and vscode_diagnostics when present.
- vscode_diagnostics (when present) are actual VS Code Problems from the editor. Cite them with kind
  "vscode_diagnostic". Never invent a diagnostic, source location, severity, or diagnostic code that
  was not provided. If vscode_diagnostics is empty or missing, continue normal analysis.
- Do not claim verification unless the evidence clearly supports the conclusion.
- Presence of VS Code diagnostics does NOT mean a suggested fix has been verified.
- Human-in-the-loop: suggest fixes for developer review; never instruct destructive shell commands.
- When there is a real bug, corrected_code must be the FULL code_snippet with the fix applied. Do not leave it empty, and do not return only the changed line.
- suggested_summary is one short sentence, such as: Replace '=' with '==' in the if condition.
"""

BUG_HUNT_PROMPT = """You are EYRA. The user asked you to find bugs and potential issues in the open file.
Return ONLY valid JSON with keys:
error_type, error_summary, root_cause, explanation, evidence (list of {kind, detail, location}),
suggested_summary, corrected_code, verification_status (verified|unverified|not_run|failed),
verification_detail, confidence (0-1 number).

Look for real problems: logic errors, crashes on normal or edge inputs, wrong operators, bad indexing,
off-by-one mistakes, unhandled exceptions, and vscode_diagnostics that were actually provided.

Rules:
- If the code is correct, set error_type to "None", error_summary to "No issues found", root_cause to "",
  and corrected_code to "". Use explanation to say why the code is fine, in one or two sentences.
- "No runtime error" is not a finding. Do not invent a crash, a severity, or a line to fix when the file is sound.
- When you find a potential bug, name it in error_type, describe it in error_summary, and put the FULL
  code_snippet with the fix applied in corrected_code. Do not return only the changed line.
- Never invent a vscode diagnostic that was not provided.
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


def _chat_mode(req: AnalyzeRequest) -> str | None:
    blob = f"{req.stack_trace or ''}\n{req.terminal_output or ''}"
    if "Mode: find-bugs" in blob:
        return "bugs"
    if "Mode: alternate-fix" in blob:
        return "alternate"
    if "Mode: explain-only" in blob or "Chat prompt:" in blob:
        return "chat"
    return None


_NO_ISSUE = re.compile(
    r"no\s+(?:[\w-]+\s+){0,3}(?:errors?|issues?|problems?|bugs?)\b|"
    r"looks\s+correct|code\s+(?:is\s+)?correct|code\s+correctly|all\s+good|nothing\s+(?:is\s+)?wrong",
    re.I,
)


def _system_for_mode(mode: str | None) -> str:
    if mode == "bugs":
        return BUG_HUNT_PROMPT
    if mode:
        return CHAT_SYSTEM_PROMPT
    return SYSTEM_PROMPT


async def _groq_chat_json(
    settings: Settings,
    *,
    model: str,
    system: str,
    user_payload: dict[str, Any],
    timeout_s: float = 90.0,
    temperature: float = 0.1,
) -> dict[str, Any]:
    payload = {
        "model": model,
        "temperature": temperature,
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
    mode = _chat_mode(req)
    parsed = await _groq_chat_json(
        settings,
        model=chosen,
        system=_system_for_mode(mode),
        temperature=0.5 if mode == "alternate" else 0.3 if mode == "chat" else 0.1,
        user_payload={
            "file_name": req.file_name,
            "language": req.language,
            "code_snippet": req.code_snippet,
            "terminal_output": req.terminal_output,
            "stack_trace": req.stack_trace,
            "error_type": req.error_type,
            "reasoning_profile": req.reasoning_profile,
            "vscode_diagnostics": [
                {
                    "message": d.message,
                    "severity": d.severity,
                    "file_name": d.file_name,
                    "line": d.line,
                    "character": d.character,
                    "end_line": d.end_line,
                    "end_character": d.end_character,
                    "source": d.source,
                    "code": d.code,
                }
                for d in (req.diagnostics or [])
            ],
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


_QUOTE_CLAIM = re.compile(
    r"clos(?:e|ing)\s+(?:double\s+|single\s+)?quote|unclosed\s+string|unterminated\s+string|missing\s+quote",
    re.IGNORECASE,
)


def unescape_model_code(code: str) -> str:
    """Turn a one-line JSON-escaped snippet back into source.

    Leave text that already contains real newlines alone so languages that
    write ``\\n`` inside strings (C printf) are not rewritten.
    """
    source = code or ""
    if len(source) >= 2 and source[0] == '"' and source[-1] == '"':
        try:
            parsed = json.loads(source)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, str):
            source = parsed
    if "\n" in source:
        return source.replace("\r\n", "\n")
    # Two or more escaped breaks means a multi-line file was stored as one line.
    # A single \n can be a real escape inside a C or C++ string.
    if source.count("\\n") < 2:
        return source
    return (
        source.replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace('\\"', '"')
        .replace("\\'", "'")
        .replace("\r\n", "\n")
    )


def _same_source(left: str, right: str) -> bool:
    def norm(text: str) -> str:
        lines = [line.rstrip() for line in unescape_model_code(text).splitlines()]
        return "\n".join(lines).strip()

    return norm(left) == norm(right)


def _python_parses(code: str) -> bool:
    try:
        ast.parse(code)
    except SyntaxError:
        return False
    return True


def _claims_unclosed_quote(*texts: str) -> bool:
    return any(_QUOTE_CLAIM.search(text or "") for text in texts)


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

    raw_corrected = parsed.get("corrected_code")
    corrected = unescape_model_code(str(raw_corrected or ""))
    summary = str(parsed.get("suggested_summary") or "")
    error_summary = str(parsed.get("error_summary") or fallback.error_summary)
    explanation = str(parsed.get("explanation") or fallback.explanation)
    error_type = str(parsed.get("error_type") or fallback.error_type)
    root_cause = str(parsed.get("root_cause") or fallback.root_cause)
    source = unescape_model_code(req.code_snippet)
    lang = (req.language or "").lower()
    source_parses = lang in {"python", "py"} and _python_parses(source)
    reported_syntax = "syntaxerror" in f"{req.stack_trace}\n{req.terminal_output}".lower()
    false_quote = (
        source_parses
        and not reported_syntax
        and _claims_unclosed_quote(summary, error_summary, explanation, root_cause)
    )
    same = bool(corrected) and _same_source(corrected, source)
    diff = fallback.suggested_correction.diff_unified
    mode = _chat_mode(req)
    if mode == "chat":
        explanation = str(parsed.get("explanation") or "").strip()
        if not explanation:
            explanation = "I can answer that. Ask it in one sentence and I will reply directly."
        real_bug = error_type.strip().lower() not in {
            "", "none", "null", "n/a", "undefined", "ok", "clean", "no_error", "no error", "-",
        }
        if real_bug and corrected and not same:
            return ReasoningDraft(
                error_type=error_type,
                error_summary=error_summary or summary or "Review the suggested change.",
                root_cause=root_cause,
                explanation=explanation,
                evidence=evidence,
                suggested_correction=SuggestedCorrection(
                    summary=summary or "Review the suggested code changes below.",
                    corrected_code=corrected,
                    diff_unified=None,
                    apply_mode="review_and_copy",
                ),
                verification=VerificationResult(
                    status="not_run",
                    method="chat",
                    detail="Suggested from chat. It has not been executed.",
                    is_hypothesis_only=True,
                ),
                confidence=0.5,
                reasoning_note="Chat found a code change. Review it before applying.",
            )
        if corrected and not same:
            explanation = f"{explanation.rstrip()}\n\n```\n{corrected.strip()}\n```"
        return ReasoningDraft(
            error_type="None",
            error_summary="",
            root_cause="",
            explanation=explanation,
            evidence=[],
            suggested_correction=SuggestedCorrection(
                summary="",
                corrected_code="",
                diff_unified=None,
                apply_mode="review_and_copy",
            ),
            verification=VerificationResult(
                status="not_run",
                method="chat",
                detail="Conversational reply. No bug hunt was run.",
                is_hypothesis_only=True,
            ),
            confidence=0.5,
            reasoning_note="Chat reply. Not a verified investigation.",
        )
    if mode == "alternate":
        if same:
            corrected = ""
        explanation = str(parsed.get("explanation") or "").strip() or "Here is a different approach."
        summary = str(parsed.get("suggested_summary") or "").strip() or "Different solution."
        if not corrected:
            explanation = (
                f"{explanation}\n\nI could not produce a different code change from the previous suggestion. "
                "Tell me the constraint you care about (simpler, faster, or safer) and I will try again."
            )
        return ReasoningDraft(
            error_type="Alternative" if corrected else "None",
            error_summary=summary if corrected else "",
            root_cause="",
            explanation=explanation,
            evidence=[],
            suggested_correction=SuggestedCorrection(
                summary=summary if corrected else "No different code was produced.",
                corrected_code=corrected,
                diff_unified=None,
                apply_mode="review_and_copy",
            ),
            verification=VerificationResult(
                status="not_run",
                method="chat",
                detail="Alternate suggestion. It has not been executed.",
                is_hypothesis_only=True,
            ),
            confidence=0.45,
            reasoning_note="Alternate fix requested in chat. Not verified by execution.",
        )
    bug_clean = False
    if mode == "bugs":
        named_error = bool(re.search(r"(Error|Exception)$", error_type.strip()))
        summary_clean = bool(_NO_ISSUE.search(error_summary) or _NO_ISSUE.search(error_type))
        blank_type = error_type.strip().lower() in {"", "none", "null", "n/a", "finding", "ok", "clean", "-"}
        if summary_clean or (blank_type and not named_error and not error_summary.strip()):
            bug_clean = True
            error_type = "None"
            error_summary = "No issues found"
            corrected = ""
            diff = None
            summary = ""
            if root_cause.strip().lower() in {"n/a", "na", "none", "null", "-", ""}:
                root_cause = ""
            explanation = explanation.strip() or "No potential issues were found. The code looks correct."
    if false_quote or same:
        corrected = ""
        diff = None
    if false_quote:
        summary = "The source already parses. No quote fix is needed."
        explanation = (
            "The supplied source parses. The quote warning came from an escaped copy of the file, "
            "not from a missing quote."
        )
        root_cause = "No unclosed string was found in the supplied source."
        if error_type.lower() in {"syntaxerror", "indentationerror"} or _claims_unclosed_quote(error_summary):
            error_type = "None"
            error_summary = "No syntax error in the supplied source."
        if v_status == "verified":
            v_status = "not_run"
    elif same and _claims_unclosed_quote(summary):
        summary = "No distinct source change was produced for that quote warning."
    elif not corrected and not bug_clean:
        corrected = fallback.suggested_correction.corrected_code
        diff = fallback.suggested_correction.diff_unified
        if not summary:
            summary = fallback.suggested_correction.summary
    if not summary and not bug_clean:
        summary = "No source change is suggested." if not corrected else fallback.suggested_correction.summary
    return ReasoningDraft(
        error_type=error_type,
        error_summary=error_summary,
        root_cause=root_cause,
        explanation=explanation,
        evidence=evidence,
        suggested_correction=SuggestedCorrection(
            summary=summary,
            corrected_code=corrected,
            diff_unified=diff,
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
