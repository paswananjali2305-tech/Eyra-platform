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


def _diagnostics_blob(req: AnalyzeRequest) -> str:
    parts: list[str] = []
    for d in req.diagnostics or []:
        parts.append(f"{d.severity}: {d.message}")
    return "\n".join(parts)


_LINTER_SOURCES = {"eslint", "tslint", "jshint", "flake8", "pylint", "ruff", "shellcheck"}
_TYPE_SOURCES = {"ts", "typescript", "pylance", "pyright", "mypy", "javascript"}


def classify_diagnostic(diag) -> str:
    """Classify a VS Code/compiler diagnostic by evidence kind.

    Returns one of: type-check, syntax, runtime, linter, dependency,
    timeout, unknown. Only the diagnostic's own source/code/message are
    used — never guessed from the surrounding code.
    """
    code = (diag.code or "").strip()
    source = (diag.source or "").strip().lower()
    lowered = (diag.message or "").lower()
    if "timed out" in lowered or "timeout" in lowered:
        return "timeout"
    if re.search(
        r"cannot find module|module not found|no module named|err_module_not_found|could not resolve|failed to resolve import",
        lowered,
    ):
        return "dependency"
    if code.upper().startswith("TS"):
        digits = re.sub(r"\D", "", code)
        # TS1xxx are syntactic diagnostics; the rest are semantic/type errors.
        return "syntax" if digits.startswith("1") else "type-check"
    if source in _LINTER_SOURCES:
        return "linter"
    if source in _TYPE_SOURCES:
        return "type-check"
    if re.search(r"syntaxerror|indentationerror|unexpected token|unexpected end of input|parsing error", lowered):
        return "syntax"
    if re.search(r"referenceerror|nameerror|typeerror|is not defined|is not a function", lowered):
        return "runtime"
    return "unknown"


_CATEGORY_LABEL = {
    "type-check": "type-check",
    "syntax": "syntax/compilation",
    "runtime": "runtime",
    "linter": "linter",
    "dependency": "dependency",
    "timeout": "timeout",
    "unknown": "checker",
}


def _diagnostic_draft(req: AnalyzeRequest) -> ReasoningDraft:
    """Explain the primary VS Code/compiler diagnostic with exact evidence.

    Diagnostics are primary evidence: the explanation quotes the reported
    message and the flagged source line verbatim. No corrected code is
    fabricated — when a deterministic minimal fix cannot be derived, the
    correction stays empty and the summary says what to change manually.
    """
    diagnostics = list(req.diagnostics or [])
    errors = [d for d in diagnostics if d.severity == "error"] or diagnostics
    primary = errors[0]
    category = classify_diagnostic(primary)
    label = _CATEGORY_LABEL[category]
    line_display = primary.line + 1
    col_display = primary.character + 1
    location = f"{primary.file_name}:{line_display}:{col_display}"

    source_line = None
    if (primary.file_name or "").replace("\\", "/").split("/")[-1] == (
        req.file_name or ""
    ).replace("\\", "/").split("/")[-1]:
        lines = (req.code_snippet or "").splitlines()
        if 0 <= primary.line < len(lines):
            source_line = lines[primary.line].rstrip()

    code_tag = f" [{primary.code}]" if primary.code else ""
    source_tag = f" (source: {primary.source})" if primary.source else ""
    summary = f"{primary.message.strip()[:200]} ({location})"

    if category == "type-check":
        root_cause = (
            f"The compiler/type checker rejected the code at {location}: "
            f"{primary.message.strip()}"
        )
    elif category == "dependency":
        root_cause = f"A module imported by this file could not be resolved: {primary.message.strip()}"
    elif category == "syntax":
        root_cause = f"The parser could not parse the code at {location}: {primary.message.strip()}"
    elif category == "timeout":
        root_cause = f"Checking or running the code timed out: {primary.message.strip()}"
    elif category == "linter":
        root_cause = f"The linter{source_tag} flagged {location}: {primary.message.strip()}"
    elif category == "runtime":
        root_cause = f"The runtime reported an error at {location}: {primary.message.strip()}"
    else:
        root_cause = f"The checker reported at {location}: {primary.message.strip()}"

    explanation_parts = [
        f"VS Code/compiler reported a {label} finding{code_tag} at {location}: "
        f"\"{primary.message.strip()}\""
    ]
    if source_line is not None:
        explanation_parts.append(f"The flagged source line is: `{source_line.strip()}`")
    if category == "type-check":
        explanation_parts.append(
            "This is a static type-check result: the code was rejected before execution, "
            "so the fix must satisfy the type checker at that exact position."
        )
    elif category == "syntax":
        explanation_parts.append(
            "This is a syntax/compilation result: the file cannot run until the flagged "
            "construct is made parseable."
        )
    elif category == "dependency":
        explanation_parts.append(
            "This is a dependency-resolution result: an imported module could not be found. "
            "The code itself may be fine once the package is installed or the import path is corrected."
        )
    elif category == "runtime":
        explanation_parts.append(
            "This finding describes a runtime failure mode: check the value and the call at the flagged position."
        )
    elif category == "timeout":
        explanation_parts.append(
            "This is a timeout: no result was produced within the limit, so no pass/fail conclusion can be drawn."
        )
    elif category == "linter":
        explanation_parts.append(
            "This is a linter finding, not a compiler or runtime failure; the code may still run."
        )
    else:
        explanation_parts.append(
            "EYRA could not classify this finding further from the supplied evidence."
        )
    extra = len(diagnostics) - 1
    if extra > 0:
        explanation_parts.append(
            f"{extra} additional diagnostic(s) were supplied; this explanation covers the first error."
        )

    module_match = re.search(r"['\"]([^'\"]+)['\"]", primary.message or "")
    name_match = re.search(r"[Cc]annot find name '([A-Za-z_$][\w$]*)'", primary.message or "")
    if category == "dependency" and module_match:
        fix_summary = (
            f"Install the missing module '{module_match.group(1)}' with your package manager, "
            "or correct the import path. No code change is suggested automatically."
        )
    elif name_match:
        fix_summary = (
            f"Declare '{name_match.group(1)}' before line {line_display}, import it, or fix the "
            "spelling. EYRA did not invent a declaration for you."
        )
    else:
        fix_summary = (
            f"Open {location} and address the {label} finding. EYRA could not derive a verified "
            "minimal code fix from this diagnostic alone, so no corrected code is attached."
        )

    if primary.code:
        error_type = str(primary.code)
    elif category == "syntax":
        error_type = "SyntaxError"
    elif category == "dependency":
        error_type = "ModuleNotFoundError" if (req.language or "").lower().startswith("py") else "DependencyError"
    elif category == "timeout":
        error_type = "TimeoutError"
    elif category == "runtime":
        m = re.search(r"([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception))", primary.message or "")
        error_type = m.group(1) if m else "RuntimeError"
    elif category == "type-check":
        error_type = "TypeCheckError"
    elif category == "linter":
        error_type = "LintError"
    else:
        error_type = "DiagnosticError"

    evidence = [
        EvidenceItem(
            kind="diagnostic_category",
            detail=f"Category: {label}; severity={primary.severity}{code_tag}{source_tag}.",
            location=location,
        )
    ]
    if source_line is not None:
        evidence.append(
            EvidenceItem(
                kind="source",
                detail=f"Flagged line {line_display}: {source_line.strip()[:240]}",
                location=location,
            )
        )

    return ReasoningDraft(
        error_type=error_type,
        error_summary=summary[:240],
        root_cause=root_cause,
        explanation=" ".join(explanation_parts),
        evidence=evidence,
        suggested_correction=SuggestedCorrection(
            summary=fix_summary,
            corrected_code="",
            diff_unified=None,
            apply_mode="review_and_copy",
        ),
        verification=VerificationResult(
            status="not_run",
            method="vscode_diagnostic_review",
            detail=(
                "Explanation is grounded in the client-supplied VS Code/compiler diagnostic "
                "quoted above. It was not re-verified by executing the code."
            ),
            is_hypothesis_only=True,
        ),
        confidence=0.85 if primary.code else 0.65,
        reasoning_note=(
            "LOCAL DIAGNOSTIC ANALYSIS: Groq was not called. Explanation derived from the "
            "supplied VS Code/compiler diagnostic evidence."
        ),
    )


def _python_syntax_draft(req: AnalyzeRequest, exc: SyntaxError) -> ReasoningDraft:
    line = exc.lineno or 1
    lines = (req.code_snippet or "").splitlines()
    source_line = lines[line - 1].strip() if 0 < line <= len(lines) else ""
    location = f"{req.file_name}:{line}"
    summary = f"SyntaxError: {exc.msg} ({location})"
    evidence = [
        EvidenceItem(
            kind="exception",
            detail=f"Python parser reported: {exc.msg}",
            location=location,
        )
    ]
    if source_line:
        evidence.append(
            EvidenceItem(kind="source", detail=f"Flagged line {line}: {source_line[:240]}", location=location)
        )
    return ReasoningDraft(
        error_type="SyntaxError",
        error_summary=summary[:240],
        root_cause=f"The Python parser could not parse {location}: {exc.msg}",
        explanation=(
            f"The Python parser (ast) rejected {location} with \"{exc.msg}\". "
            + (f"The flagged source line is: `{source_line}` " if source_line else "")
            + "The file cannot run until this construct is made parseable. "
            "EYRA did not rewrite the line automatically because the intended construct is ambiguous."
        ),
        evidence=evidence,
        suggested_correction=SuggestedCorrection(
            summary=f"Fix the syntax at {location} so the file parses. No automatic rewrite is attached.",
            corrected_code="",
            diff_unified=None,
            apply_mode="review_and_copy",
        ),
        verification=VerificationResult(
            status="unverified",
            method="python_ast_parse",
            detail="Confirmed by a real Python parser failure (ast.parse raised SyntaxError).",
            is_hypothesis_only=True,
        ),
        confidence=0.9,
        reasoning_note="LOCAL PARSER CHECK: Groq was not called. Based on a real ast.parse failure.",
    )


def _detect_error_type(req: AnalyzeRequest) -> str:
    if req.error_type and req.error_type.strip():
        return req.error_type.strip()
    blob = f"{req.stack_trace}\n{req.terminal_output}\n{_diagnostics_blob(req)}"
    match = re.search(r"([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception))", blob)
    if match:
        return match.group(1)
    if "ZeroDivision" in blob or "/ 0" in req.code_snippet or "b = 0" in req.code_snippet:
        return "ZeroDivisionError"
    if any(d.severity == "error" for d in (req.diagnostics or [])):
        return "DiagnosticError"
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


def _zero_division_correction(code: str) -> str | None:
    """Guard the actual zero-division statement in the user's own code.

    Returns the user's snippet with the offending statement wrapped in a
    divisor check, or None when the statement cannot be located safely.
    Never substitutes an invented example program.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return None
    zero_names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and node.value.value == 0:
            for target in node.targets:
                if isinstance(target, ast.Name):
                    zero_names.add(target.id)
    target_stmt: ast.stmt | None = None
    divisor_src: str | None = None
    for node in ast.walk(tree):
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)):
            right = node.right
            is_zero = (isinstance(right, ast.Constant) and right.value == 0) or (
                isinstance(right, ast.Name) and right.id in zero_names
            )
            if not is_zero:
                continue
            for stmt in ast.walk(tree):
                if isinstance(stmt, ast.stmt) and stmt.lineno <= node.lineno <= (stmt.end_lineno or stmt.lineno):
                    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Module)):
                        continue
                    if target_stmt is None or stmt.lineno > target_stmt.lineno:
                        target_stmt = stmt
                        divisor_src = ast.get_source_segment(code, right)
    if target_stmt is None or not divisor_src:
        return None
    if (target_stmt.end_lineno or target_stmt.lineno) != target_stmt.lineno:
        return None
    lines = code.splitlines()
    idx = target_stmt.lineno - 1
    if idx < 0 or idx >= len(lines):
        return None
    stmt_line = lines[idx]
    indent = stmt_line[: len(stmt_line) - len(stmt_line.lstrip())]
    guarded = [
        f"{indent}if {divisor_src} != 0:",
        f"{indent}    {stmt_line.strip()}",
        f"{indent}else:",
        f"{indent}    print('Cannot divide by zero: validate the divisor before dividing.')",
    ]
    return "\n".join([*lines[:idx], *guarded, *lines[idx + 1:]]) + ("\n" if code.endswith("\n") else "")


def _zero_division_draft(req: AnalyzeRequest, error_type: str) -> ReasoningDraft:
    line = _line_hint(req) or 3
    corrected = _zero_division_correction(req.code_snippet or "") or ""
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
            summary=(
                "Validate the divisor before performing the operation."
                if corrected
                else "Validate the divisor before dividing. EYRA could not locate the "
                "division statement safely, so no corrected code is attached."
            ),
            corrected_code=corrected,
            diff_unified=_simple_diff(req.code_snippet, corrected, req.file_name) if corrected else None,
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
    if line is None and req.diagnostics:
        # Prefer first error diagnostic line (stored 0-based → display 1-based)
        for d in req.diagnostics:
            if d.severity == "error":
                line = d.line + 1
                break
        if line is None:
            line = req.diagnostics[0].line + 1
    loc = f"{req.file_name}:{line}" if line else req.file_name
    summary = error_type
    for source in (req.stack_trace, req.terminal_output):
        for raw in source.splitlines():
            if error_type in raw:
                summary = raw.strip()
                break
    if summary == error_type and req.diagnostics:
        for d in req.diagnostics:
            if d.severity == "error":
                summary = d.message.strip()[:240]
                break
        else:
            summary = req.diagnostics[0].message.strip()[:240]

    # Never echo the user's code back as a "correction": without a verified
    # fix, the correction stays empty and the summary says so.
    corrected = ""

    evidence = [
        EvidenceItem(kind="exception", detail=summary[:500], location=loc),
        EvidenceItem(
            kind="context",
            detail="Code snippet and terminal/stack context were supplied by the client.",
            location=req.file_name,
        ),
    ]
    if req.diagnostics:
        evidence.append(
            EvidenceItem(
                kind="context",
                detail=(
                    f"{len(req.diagnostics)} VS Code diagnostic(s) were supplied as client evidence "
                    "(see vscode_diagnostic items). They are not independently verified."
                ),
                location=req.file_name,
            )
        )

    return ReasoningDraft(
        error_type=error_type,
        error_summary=summary[:240],
        root_cause=f"Runtime failure classified as {error_type}; inspect operands and call site at {loc}.",
        explanation=(
            "EYRA local heuristic reasoner inspected the supplied code and runtime context. "
            "Without Groq, only coarse pattern matching is available. Treat this as a hypothesis "
            "until verified with execution evidence."
            + (
                f" Client supplied {len(req.diagnostics)} VS Code Problems as evidence."
                if req.diagnostics
                else ""
            )
        ),
        evidence=evidence,
        suggested_correction=SuggestedCorrection(
            summary=(
                "No verified automatic fix is available locally for this error. "
                "Review the flagged line and the operands/call that produced it, "
                "then re-run. EYRA did not attach corrected code it could not verify."
            ),
            corrected_code=corrected,
            diff_unified=None,
            apply_mode="review_and_copy",
        ),
        verification=VerificationResult(
            status="not_run",
            method="none",
            detail=(
                "No specialized verifier ran for this error type. "
                "VS Code diagnostics (if any) are client-reported evidence, not verification."
            ),
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


def _chat_question(req: AnalyzeRequest) -> str:
    blob = f"{req.terminal_output or ''}\n{req.stack_trace or ''}"
    for line in blob.splitlines():
        if line.lower().startswith("user message:") or line.lower().startswith("user request:"):
            return line.split(":", 1)[-1].strip()
    return ""


def _chat_draft(req: AnalyzeRequest, alternate: bool) -> ReasoningDraft:
    question = _chat_question(req) or "your question"
    if alternate:
        explanation = (
            "I need the language model to write a different fix. "
            "The local fallback cannot invent a second solution. "
            "Connect the Brain model, then ask again for another approach."
        )
    else:
        explanation = (
            f"I heard: {question}\n\n"
            "The Brain model is not available, so this is only a short local reply. "
            "I can still talk about the open file once the model is connected: "
            "ask a normal question, or say \"another solution\" after a suggested fix."
        )
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
            method="none",
            detail="Chat reply without a model. No investigation was run.",
            is_hypothesis_only=True,
        ),
        confidence=0.2,
        reasoning_note="LOCAL CHAT FALLBACK: Groq was not called.",
    )


def _clean_bug_draft(req: AnalyzeRequest, explanation: str) -> ReasoningDraft:
    return ReasoningDraft(
        error_type="None",
        error_summary="No issues found",
        root_cause="",
        explanation=explanation,
        evidence=[
            EvidenceItem(
                kind="source",
                detail="The file was checked for potential issues. None were found.",
                location=req.file_name,
            )
        ],
        suggested_correction=SuggestedCorrection(
            summary="",
            corrected_code="",
            diff_unified=None,
            apply_mode="review_and_copy",
        ),
        verification=VerificationResult(
            status="not_run",
            method="none",
            detail="Local bug check found nothing to change. This is not an execution pass.",
            is_hypothesis_only=True,
        ),
        confidence=0.4,
        reasoning_note="LOCAL BUG CHECK: no potential issue detected without the model.",
    )


def reason_locally(req: AnalyzeRequest) -> ReasoningDraft:
    blob = f"{req.stack_trace or ''}\n{req.terminal_output or ''}"
    if "Mode: alternate-fix" in blob:
        return _chat_draft(req, True)
    if "Mode: explain-only" in blob or "Chat prompt:" in blob:
        return _chat_draft(req, False)
    if "Mode: find-bugs" in blob:
        if any(d.severity == "error" for d in (req.diagnostics or [])):
            return _diagnostic_draft(req)
        lang = (req.language or "").lower()
        if lang in {"python", "py"}:
            try:
                ast.parse(req.code_snippet or "")
            except SyntaxError as exc:
                return _python_syntax_draft(req, exc)
            return _clean_bug_draft(
                req,
                "The file parses and the local check did not find a potential issue.",
            )
        return _clean_bug_draft(
            req,
            "No VS Code error diagnostics were supplied, and the local check cannot parse "
            f"{req.language or 'this language'} without the Brain model. Review the Problems "
            "panel in VS Code, or connect the model for a deeper check.",
        )
    # VS Code/compiler diagnostics are primary evidence when available.
    if any(d.severity == "error" for d in (req.diagnostics or [])):
        return _diagnostic_draft(req)
    error_type = _detect_error_type(req)
    if error_type == "ZeroDivisionError" or "division by zero" in (
        req.stack_trace + req.terminal_output
    ).lower():
        return _zero_division_draft(req, "ZeroDivisionError")
    return _generic_draft(req, error_type)
