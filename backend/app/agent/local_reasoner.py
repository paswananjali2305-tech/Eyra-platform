from __future__ import annotations

import ast
import re
from dataclasses import dataclass

from app.schemas import AnalyzeRequest, EvidenceItem, SuggestedCorrection, VerificationResult


@dataclass
class ReasoningDraft:
    error_type: str
    error_summary: str
    root_cause: str
    explanation: str
    evidence: list[EvidenceItem]
    suggested_correction: SuggestedCorrection
    verification: VerificationResult
    confidence: float
    reasoning_note: str


def _detect_error_type(req: AnalyzeRequest) -> str:
    if req.error_type and req.error_type.strip():
        return req.error_type.strip()
    blob = f"{req.stack_trace}\n{req.terminal_output}"
    match = re.search(r"([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception))", blob)
    if match:
        return match.group(1)
    if "ZeroDivision" in blob or "/ 0" in req.code_snippet or "b = 0" in req.code_snippet:
        return "ZeroDivisionError"
    return "RuntimeError"


def _line_hint(req: AnalyzeRequest) -> int | None:
    for source in (req.stack_trace, req.terminal_output):
        m = re.search(r'File "[^"]+", line (\d+)', source)
        if m:
            return int(m.group(1))
        m = re.search(r"line (\d+)", source, re.I)
        if m:
            return int(m.group(1))
    return None


def _zero_division_draft(req: AnalyzeRequest, error_type: str) -> ReasoningDraft:
    line = _line_hint(req) or 3
    corrected = (
        "a = 10\n"
        "b = 0\n"
        "if b != 0:\n"
        "    print(a / b)\n"
        "else:\n"
        "    print('Cannot divide by zero: validate the divisor before dividing.')\n"
    )
    evidence = [
        EvidenceItem(
            kind="exception",
            detail="ZeroDivisionError indicates a division or modulo with a zero divisor.",
            location=f"{req.file_name}:{line}",
        ),
        EvidenceItem(
            kind="source",
            detail="Source assigns a zero divisor (e.g. `b = 0`) before a division operation.",
            location=req.file_name,
        ),
    ]
    if "ZeroDivisionError" in req.stack_trace or "ZeroDivisionError" in req.terminal_output:
        evidence.append(
            EvidenceItem(
                kind="stack_trace",
                detail="Captured stack/terminal output reports ZeroDivisionError.",
                location=req.file_name,
            )
        )

    verified_static = _static_verify_zero_division(req.code_snippet)
    verification = VerificationResult(
        status="verified" if verified_static else "unverified",
        method="static_evidence_check",
        detail=(
            "Static evidence confirms a zero divisor reaches a division operation."
            if verified_static
            else "Insufficient static evidence to mark verified; treat as hypothesis."
        ),
        is_hypothesis_only=not verified_static,
    )

    return ReasoningDraft(
        error_type=error_type,
        error_summary="ZeroDivisionError: division by zero",
        root_cause="The division operation receives zero as its divisor.",
        explanation=(
            f"At {req.file_name}:{line}, the program performs division while the divisor "
            "evaluates to 0. Variable `b` (or equivalent) is zero, so `a / b` raises "
            "ZeroDivisionError. This is a local heuristic diagnosis "
            "(GROQ_API_KEY not configured)."
        ),
        evidence=evidence,
        suggested_correction=SuggestedCorrection(
            summary="Validate the divisor before performing the operation.",
            corrected_code=corrected,
            diff_unified=_simple_diff(req.code_snippet, corrected, req.file_name),
            apply_mode="review_and_copy",
        ),
        verification=verification,
        confidence=0.92 if verified_static else 0.7,
        reasoning_note=(
            "LOCAL DEVELOPMENT FIXTURE: Groq was not called. "
            "Diagnosis produced by EYRA local heuristic reasoner."
        ),
    )


def _static_verify_zero_division(code: str) -> bool:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return "b = 0" in code and ("/" in code or "//" in code or "%" in code)

    zero_names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            if isinstance(node.value, ast.Constant) and node.value.value == 0:
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        zero_names.add(target.id)

    for node in ast.walk(tree):
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)):
            right = node.right
            if isinstance(right, ast.Constant) and right.value == 0:
                return True
            if isinstance(right, ast.Name) and right.id in zero_names:
                return True
    return False


def _generic_draft(req: AnalyzeRequest, error_type: str) -> ReasoningDraft:
    line = _line_hint(req)
    loc = f"{req.file_name}:{line}" if line else req.file_name
    summary = error_type
    for source in (req.stack_trace, req.terminal_output):
        for raw in source.splitlines():
            if error_type in raw:
                summary = raw.strip()
                break

    corrected = (
        f"# Suggested review for {req.file_name}\n"
        "# EYRA local heuristic could not specialize this error type.\n"
        "# Review the stack trace, guard invalid inputs, and re-run.\n"
        f"{req.code_snippet.rstrip()}\n"
    )

    return ReasoningDraft(
        error_type=error_type,
        error_summary=summary[:240],
        root_cause=f"Runtime failure classified as {error_type}; inspect operands and call site at {loc}.",
        explanation=(
            "EYRA local heuristic reasoner inspected the supplied code and runtime context. "
            "Without Groq, only coarse pattern matching is available. Treat this as a hypothesis "
            "until verified with execution evidence."
        ),
        evidence=[
            EvidenceItem(kind="exception", detail=summary[:500], location=loc),
            EvidenceItem(
                kind="context",
                detail="Code snippet and terminal/stack context were supplied by the client.",
                location=req.file_name,
            ),
        ],
        suggested_correction=SuggestedCorrection(
            summary="Review inputs around the failing line and add defensive checks.",
            corrected_code=corrected,
            diff_unified=None,
            apply_mode="review_and_copy",
        ),
        verification=VerificationResult(
            status="not_run",
            method="none",
            detail="No specialized verifier ran for this error type.",
            is_hypothesis_only=True,
        ),
        confidence=0.45,
        reasoning_note=(
            "LOCAL DEVELOPMENT FIXTURE: Groq was not called. "
            "Generic heuristic only — configure GROQ_API_KEY for LLM reasoning."
        ),
    )


def _simple_diff(original: str, corrected: str, file_name: str) -> str:
    old_lines = original.splitlines()
    new_lines = corrected.splitlines()
    lines = [f"--- a/{file_name}", f"+++ b/{file_name}"]
    for line in old_lines:
        lines.append(f"-{line}")
    for line in new_lines:
        lines.append(f"+{line}")
    return "\n".join(lines)


def reason_locally(req: AnalyzeRequest) -> ReasoningDraft:
    error_type = _detect_error_type(req)
    if error_type == "ZeroDivisionError" or "division by zero" in (
        req.stack_trace + req.terminal_output
    ).lower():
        return _zero_division_draft(req, "ZeroDivisionError")
    return _generic_draft(req, error_type)
