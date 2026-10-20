"""Language-aware local diagnostic reasoning tests (Phase 2/3)."""

from __future__ import annotations

from app.agent.local_reasoner import classify_diagnostic, reason_locally
from app.schemas import AnalyzeRequest, DiagnosticItem


def _req(**overrides) -> AnalyzeRequest:
    base = {
        "file_name": "add.ts",
        "language": "typescript",
        "code_snippet": "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
        "terminal_output": "",
        "stack_trace": "",
    }
    base.update(overrides)
    return AnalyzeRequest(**base)


def _diag(**overrides) -> DiagnosticItem:
    base = {
        "message": "Cannot find name 'c'.",
        "severity": "error",
        "file_name": "add.ts",
        "line": 1,
        "character": 9,
        "source": "ts",
        "code": "TS2304",
    }
    base.update(overrides)
    return DiagnosticItem(**base)


def test_classify_categories():
    assert classify_diagnostic(_diag()) == "type-check"
    assert classify_diagnostic(_diag(code="TS1005", message="',' expected.")) == "syntax"
    assert classify_diagnostic(_diag(code="TS2307", message="Cannot find module './x'.")) == "dependency"
    assert classify_diagnostic(_diag(source="eslint", code=None, message="Unexpected var.")) == "linter"
    assert classify_diagnostic(_diag(source=None, code=None, message="ReferenceError: foo is not defined")) == "runtime"
    assert classify_diagnostic(_diag(source=None, code=None, message="Execution timed out after 30s")) == "timeout"
    assert classify_diagnostic(_diag(source="pyflakes", code="F821", message="Undefined name 'y'")) == "unknown"


def test_ts_diagnostic_explained_with_exact_location_and_line():
    req = _req(
        code_snippet="export function add(a: number, b: number): number {\n  return a + c;\n}\n",
        diagnostics=[_diag()],
    )
    draft = reason_locally(req)
    assert draft.error_type == "TS2304"
    assert "add.ts:2:10" in draft.explanation
    assert "return a + c" in draft.explanation
    assert "type checker" in draft.root_cause
    # No fabricated corrected code is attached to a diagnostic explanation.
    assert draft.suggested_correction.corrected_code == ""
    assert draft.suggested_correction.diff_unified is None
    assert "Declare 'c'" in draft.suggested_correction.summary
    assert draft.verification.is_hypothesis_only is True


def test_dependency_diagnostic_names_missing_module():
    req = _req(
        file_name="main.ts",
        code_snippet="import { go } from './missing';\ngo();\n",
        diagnostics=[
            _diag(
                file_name="main.ts",
                line=0,
                character=20,
                code="TS2307",
                message="Cannot find module './missing' or its corresponding type declarations.",
            )
        ],
    )
    draft = reason_locally(req)
    assert "dependency" in draft.root_cause or "could not be resolved" in draft.root_cause
    assert "'./missing'" in draft.suggested_correction.summary
    assert draft.suggested_correction.corrected_code == ""


def test_generic_draft_never_fabricates_corrected_code():
    req = _req(
        file_name="app.py",
        language="python",
        code_snippet="raise ValueError('boom')\n",
        terminal_output="ValueError: boom",
    )
    draft = reason_locally(req)
    assert draft.suggested_correction.corrected_code == ""
    assert "No verified automatic fix" in draft.suggested_correction.summary
    assert draft.verification.is_hypothesis_only is True


def test_find_bugs_python_syntax_uses_real_parser_evidence():
    req = _req(
        file_name="broken.py",
        language="python",
        code_snippet="def broken(:\n    pass\n",
        terminal_output="Mode: find-bugs",
    )
    draft = reason_locally(req)
    assert draft.error_type == "SyntaxError"
    assert "broken.py:1" in draft.error_summary
    assert draft.verification.method == "python_ast_parse"
    assert draft.suggested_correction.corrected_code == ""


def test_find_bugs_js_without_diagnostics_is_honest():
    req = _req(terminal_output="Mode: find-bugs")
    draft = reason_locally(req)
    assert draft.error_type == "None"
    assert "cannot parse" in draft.explanation


def test_find_bugs_prefers_error_diagnostics_over_parse():
    req = _req(
        code_snippet="export function add(a: number, b: number): number {\n  return a + c;\n}\n",
        terminal_output="Mode: find-bugs",
        diagnostics=[_diag()],
    )
    draft = reason_locally(req)
    assert draft.error_type == "TS2304"


def test_zero_division_fix_guards_users_own_code():
    req = _req(
        file_name="calc.py",
        language="python",
        code_snippet="a = 10\nb = 0\nprint(a / b)\n",
        terminal_output="ZeroDivisionError: division by zero",
    )
    draft = reason_locally(req)
    corrected = draft.suggested_correction.corrected_code
    assert corrected.startswith("a = 10\nb = 0\n")
    assert "if b != 0:" in corrected
    assert "    print(a / b)" in corrected
    # No invented example program replaces the user's code.
    assert corrected.count("a = 10") == 1
