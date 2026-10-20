"""Code performance analysis: complexity heuristics, optimize suggestions, test generation/run.

Honest local heuristics (AST / pattern matching). Optional Groq enrichment when configured.
"""

from __future__ import annotations

import ast
import base64
import bisect
import json
import re
import subprocess
import tempfile
import textwrap
import types
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.jstestgen import (
    _skip_string,
    analyze_js_structure,
    discover_js_functions,
    generate_js_cases,
)
from app.runtimes import execute_snippet
from app.runtimes.base import safe_env, which
from app.runtimes.registry import normalize_language_id
from app.testgen import analyze_python_structure, generate_cases_for_code

COMPLEXITY_ORDER = ["O(1)", "O(log n)", "O(n)", "O(n log n)", "O(n^2)", "O(2^n)"]

COMPLEXITY_BARS = [
    {"label": "O(1)", "height": 12},
    {"label": "O(log n)", "height": 22},
    {"label": "O(n)", "height": 40},
    {"label": "O(n log n)", "height": 55},
    {"label": "O(n^2)", "height": 75},
    {"label": "O(2^n)", "height": 100},
]


@dataclass
class ComplexityResult:
    time: str = "O(n)"
    space: str = "O(1)"
    time_label: str = "Estimated"
    space_label: str = "Estimated"
    time_severity: str = "medium"  # low|medium|high
    space_severity: str = "low"
    notes: list[str] = field(default_factory=list)
    function_name: str | None = None
    pattern: str | None = None
    # How the estimate was derived — never "measured" for static analysis.
    # python_ast | js_structural | heuristic
    basis: str = "python_ast"
    basis_label: str = "Parser-derived (Python AST)"


def _severity_for(big_o: str) -> str:
    if big_o in ("O(2^n)", "O(n^2)"):
        return "high" if big_o == "O(2^n)" else "medium"
    if big_o in ("O(n log n)", "O(n)"):
        return "medium" if big_o == "O(n log n)" else "low"
    return "low"


def _label_for(big_o: str, *, space: bool = False) -> str:
    mapping = {
        "O(1)": "Estimated - constant",
        "O(log n)": "Estimated - logarithmic",
        "O(n)": "Estimated - linear" if not space else "Estimated - linear auxiliary",
        "O(n log n)": "Estimated - linearithmic",
        "O(n^2)": "Estimated - quadratic",
        "O(2^n)": "Estimated - exponential",
    }
    if space and big_o == "O(n)":
        return "Estimated - recursion stack"
    return mapping.get(big_o, "Estimated")


def analyze_complexity_python(code: str) -> ComplexityResult:
    result = ComplexityResult()
    result.notes.append(
        "Complexity is estimated from AST patterns (loops, recursion, known algorithms)."
    )
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        result.time = "O(?)"
        result.space = "O(?)"
        result.time_label = "Parse failed"
        result.space_label = "Parse failed"
        result.time_severity = "high"
        result.space_severity = "medium"
        result.notes.append(f"SyntaxError: {exc.msg}")
        return result

    funcs: list[ast.FunctionDef | ast.AsyncFunctionDef] = [
        n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    if funcs:
        # Prefer non-main entry
        primary = next((f for f in funcs if f.name not in ("main",)), funcs[0])
        result.function_name = primary.name

    # Nested loop depth
    max_loop_depth = 0

    class LoopVisitor(ast.NodeVisitor):
        def __init__(self) -> None:
            self.depth = 0
            self.max_depth = 0

        def visit_For(self, node: ast.For) -> None:  # noqa: N802
            self.depth += 1
            self.max_depth = max(self.max_depth, self.depth)
            self.generic_visit(node)
            self.depth -= 1

        def visit_While(self, node: ast.While) -> None:  # noqa: N802
            self.depth += 1
            self.max_depth = max(self.max_depth, self.depth)
            self.generic_visit(node)
            self.depth -= 1

    lv = LoopVisitor()
    lv.visit(tree)
    max_loop_depth = lv.max_depth

    # Recursion detection
    recursive = False
    for f in funcs:
        for node in ast.walk(f):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name) and node.func.id == f.name:
                    recursive = True
                if isinstance(node.func, ast.Attribute) and node.func.attr == f.name:
                    recursive = True

    code_l = code.lower()
    is_fib = bool(re.search(r"\bfib(onacci)?\b", code_l))
    is_merge = "mergesort" in code_l.replace("_", "") or "merge_sort" in code_l
    is_quick = "quicksort" in code_l.replace("_", "") or "quick_sort" in code_l
    is_binsearch = "binary_search" in code_l or ("bisect" in code_l)

    if is_fib and recursive:
        result.time = "O(2^n)"
        result.space = "O(n)"
        result.pattern = "recursive_fibonacci"
        result.notes.append("Detected classic recursive Fibonacci (branching recursion).")
    elif recursive and max_loop_depth == 0:
        result.time = "O(2^n)" if is_fib else "O(n)"
        result.space = "O(n)"
        result.pattern = "recursion"
        result.notes.append("Recursive calls detected; stack depth counted toward space.")
    elif max_loop_depth >= 2:
        result.time = "O(n^2)"
        result.space = "O(1)"
        result.pattern = "nested_loops"
        result.notes.append(f"Nested loops depth={max_loop_depth} → quadratic time estimate.")
    elif is_merge or is_quick:
        result.time = "O(n log n)"
        result.space = "O(n)" if is_merge else "O(log n)"
        result.pattern = "divide_conquer_sort"
    elif is_binsearch or max_loop_depth == 0 and "while" in code_l and ("mid" in code_l or "// 2" in code):
        result.time = "O(log n)"
        result.space = "O(1)"
        result.pattern = "binary_search"
    elif max_loop_depth == 1:
        result.time = "O(n)"
        result.space = "O(1)"
        result.pattern = "single_loop"
    else:
        result.time = "O(1)"
        result.space = "O(1)"
        result.pattern = "straight_line"

    result.time_label = _label_for(result.time)
    result.space_label = _label_for(result.space, space=True)
    result.time_severity = _severity_for(result.time)
    result.space_severity = _severity_for(result.space)
    return result


_LOOP_KEYWORD = re.compile(r"\b(?:for|while|do)\b")


def _js_loop_depth(body: str) -> int:
    """Max loop nesting depth in a JS/TS function body (brace-tracked)."""
    stack: list[bool] = []  # True entries are loop-body scopes
    max_depth = 0
    pending_loop = False
    i = 0
    while i < len(body):
        ch = body[i]
        if ch in "'\"`":
            i = _skip_string(body, i)
            continue
        if body.startswith("//", i):
            nl = body.find("\n", i)
            i = len(body) if nl < 0 else nl + 1
            continue
        if body.startswith("/*", i):
            end = body.find("*/", i + 2)
            i = len(body) if end < 0 else end + 2
            continue
        word = _LOOP_KEYWORD.match(body, i)
        if word:
            pending_loop = True
            i = word.end()
            continue
        if ch == "{":
            stack.append(pending_loop)
            if pending_loop:
                max_depth = max(max_depth, sum(stack))
            pending_loop = False
            i += 1
            continue
        if ch == "}":
            if stack:
                stack.pop()
            i += 1
            continue
        if ch == ";" and pending_loop:
            # Single-statement loop body without braces still nests once.
            max_depth = max(max_depth, sum(stack) + 1)
            pending_loop = False
        i += 1
    return max_depth


def analyze_complexity_js(code: str, language: str = "javascript") -> ComplexityResult:
    """Structural complexity estimate from the JS/TS function scanner.

    Derived from discovered function bodies: loop nesting depth (brace
    tracked) and self-recursion. This is a parser-derived structural
    estimate — not a measured runtime result.
    """
    result = ComplexityResult()
    result.basis = "js_structural"
    result.basis_label = "Parser-derived structural estimate (JS/TS scanner)"
    functions = discover_js_functions(code)
    primary = next((f for f in functions if f["name"] != "main"), functions[0] if functions else None)
    if primary is None:
        result.time, result.space, result.pattern = "O(1)", "O(1)", "straight_line"
        result.notes.append(
            "Structural scan found no function; estimate covers straight-line top-level code only."
        )
    else:
        result.function_name = primary["name"]
        body = primary["body"]
        depth = _js_loop_depth(body)
        self_calls = len(re.findall(rf"\b{re.escape(primary['name'])}\s*\(", body))
        if self_calls >= 2 and depth == 0:
            result.time, result.space, result.pattern = "O(2^n)", "O(n)", "recursive_branching"
            result.notes.append(
                f"'{primary['name']}' calls itself {self_calls} times with no loops; "
                "branching recursion suggests exponential time."
            )
        elif self_calls >= 1 and depth == 0:
            result.time, result.space, result.pattern = "O(n)", "O(n)", "recursion"
            result.notes.append(
                f"'{primary['name']}' is recursive; recursion stack counted toward space."
            )
        elif depth >= 2:
            result.time, result.space, result.pattern = "O(n^2)", "O(1)", "nested_loops"
            result.notes.append(f"Loop nesting depth={depth} in '{primary['name']}' → quadratic estimate.")
        elif depth == 1:
            result.time, result.space, result.pattern = "O(n)", "O(1)", "single_loop"
            result.notes.append(f"Single-level loop in '{primary['name']}' → linear estimate.")
        else:
            result.time, result.space, result.pattern = "O(1)", "O(1)", "straight_line"
            result.notes.append(f"No loops or recursion found in '{primary['name']}'.")
        result.notes.append(
            "Estimate derived from the JS/TS scanner's function/loop structure. "
            "It is not a measured runtime result."
        )
    result.time_label = _label_for(result.time)
    result.space_label = _label_for(result.space, space=True)
    result.time_severity = _severity_for(result.time)
    result.space_severity = _severity_for(result.space)
    return result


def analyze_complexity(code: str, language: str = "python") -> ComplexityResult:
    lang = normalize_language_id(language)
    if lang == "python":
        return analyze_complexity_python(code)
    if lang in {"javascript", "typescript"}:
        return analyze_complexity_js(code, lang)
    # Lightweight regex fallback for other languages — labeled heuristic,
    # never presented as a parser-derived or measured result.
    result = ComplexityResult()
    result.basis = "heuristic"
    result.basis_label = "Heuristic estimate (regex scan — not parser-derived)"
    result.notes.append(f"Heuristic scan for {lang} (no parser available for this language).")
    nested = len(re.findall(r"\bfor\b", code)) >= 2
    recursive = bool(re.search(r"\bfib", code, re.I)) and "return" in code
    if recursive:
        result.time, result.space, result.pattern = "O(2^n)", "O(n)", "recursive_like"
    elif nested:
        result.time, result.space, result.pattern = "O(n^2)", "O(1)", "nested_loops"
    else:
        result.time, result.space, result.pattern = "O(n)", "O(1)", "linear_like"
    result.time_label = _label_for(result.time).replace("Estimated", "Heuristic estimate", 1)
    result.space_label = _label_for(result.space, space=True).replace("Estimated", "Heuristic estimate", 1)
    result.time_severity = _severity_for(result.time)
    result.space_severity = _severity_for(result.space)
    return result


def _fib_iterative() -> str:
    return textwrap.dedent(
        '''\
        def fibonacci(n):
            if n <= 1:
                return n
            a, b = 0, 1
            for _ in range(2, n + 1):
                a, b = b, a + b
            return b
        '''
    ).rstrip() + "\n"


def suggest_optimized_local(
    code: str,
    *,
    language: str = "python",
    target_time: str = "O(n)",
    target_space: str = "O(1)",
    goal: str = "",
    complexity: ComplexityResult | None = None,
) -> dict[str, Any]:
    cx = complexity or analyze_complexity(code, language)
    reasons: list[str] = []
    optimized = code
    applied = False
    lang = normalize_language_id(language)

    # The automatic fib rewrite is Python source — never substitute it into
    # a JavaScript/TypeScript (or other language) file.
    if lang != "python" and (
        cx.pattern in {"recursive_fibonacci", "recursive_branching", "recursive_like"}
        or (cx.time == "O(2^n)" and re.search(r"\bfib", code, re.I))
    ):
        reasons = [
            "Branching recursion recomputes the same subproblems exponentially",
            "An iterative two-variable loop reaches O(n) time / O(1) space",
            "No automatic rewrite is applied to non-Python files — rewrite the recursion iteratively in your code",
        ]
    elif cx.pattern == "recursive_fibonacci" or (
        cx.time == "O(2^n)" and re.search(r"\bfib", code, re.I)
    ):
        optimized = _fib_iterative()
        applied = True
        reasons = [
            "Removes redundant recursive calls",
            f"Reduces time complexity from {cx.time} to O(n)",
            f"Reduces space complexity from {cx.space} to O(1)",
            "Uses constant extra memory with two running values",
        ]
    elif cx.pattern == "nested_loops" and target_time in ("O(n)", "O(n log n)", "O(log n)"):
        reasons = [
            "Nested loops dominate runtime; consider hashing / sorting / early exits",
            f"Target time {target_time} usually needs a different algorithm, not a micro-edit",
            "Suggestion keeps your source; refine the algorithm toward the target",
        ]
        optimized = code
    else:
        reasons = [
            f"Current estimate {cx.time} time / {cx.space} space",
            f"Target {target_time} time / {target_space} space",
            goal.strip()
            or "No automatic rewrite available for this pattern — treat targets as guidance",
        ]

    return {
        "current_code": code,
        "optimized_code": optimized,
        "current_time": cx.time,
        "current_space": cx.space,
        "optimized_time": "O(n)" if applied and "fib" in (cx.pattern or "") else target_time,
        "optimized_space": "O(1)" if applied and "fib" in (cx.pattern or "") else target_space,
        "reasons": reasons,
        "applied_transform": applied,
        "reasoning_source": "local_heuristic",
        "function_name": cx.function_name,
        "pattern": cx.pattern,
    }


async def suggest_optimized_maybe_llm(
    code: str,
    *,
    language: str = "python",
    target_time: str = "O(n)",
    target_space: str = "O(1)",
    goal: str = "",
) -> dict[str, Any]:
    local = suggest_optimized_local(
        code,
        language=language,
        target_time=target_time,
        target_space=target_space,
        goal=goal,
    )
    if local.get("applied_transform"):
        return local

    settings = get_settings()
    api_key = (settings.groq_api_key or "").strip()
    if not api_key or not settings.groq_configured:
        return local

    try:
        from openai import OpenAI  # type: ignore

        base_url = (settings.llm_base_url or "").strip() or "https://api.groq.com/openai/v1"
        client = OpenAI(api_key=api_key, base_url=base_url)
        model = settings.model_for_profile("runtime")
        prompt = (
            "You optimize code for asymptotic complexity. Return ONLY JSON with keys: "
            "optimized_code (string), optimized_time, optimized_space, reasons (string array). "
            f"Language={language}. Target time={target_time}, space={target_space}. "
            f"Goal: {goal or 'meet targets'}. Source code:\n```\n{code[:8000]}\n```"
        )
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=2048,
        )
        text = (resp.choices[0].message.content or "").strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        data = json.loads(text)
        opt = str(data.get("optimized_code") or "").strip()
        if not opt:
            return local
        return {
            **local,
            "optimized_code": opt,
            "optimized_time": data.get("optimized_time") or target_time,
            "optimized_space": data.get("optimized_space") or target_space,
            "reasons": list(data.get("reasons") or local["reasons"])[:6],
            "applied_transform": True,
            "reasoning_source": "groq",
        }
    except Exception:
        return local


def _detect_fn_name(code: str, language: str = "python") -> str | None:
    if (language or "python").lower() in ("python", "py"):
        try:
            tree = ast.parse(code)
            for n in tree.body:
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name != "main":
                    return n.name
            for n in tree.body:
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    return n.name
        except SyntaxError:
            pass
    m = re.search(r"\bdef\s+([A-Za-z_]\w*)\s*\(", code)
    return m.group(1) if m else None


def generate_test_cases(
    code: str,
    *,
    language: str = "python",
    function_name: str | None = None,
) -> list[dict[str, Any]]:
    lang = normalize_language_id(language)
    if lang in {"javascript", "typescript"}:
        return generate_js_cases(code, function_name=function_name, language=lang)
    return generate_cases_for_code(code, language=language, function_name=function_name)


def _build_harness(code: str, call_expr: str, language: str = "python") -> str:
    lang = (language or "python").lower()
    if lang not in ("python", "py"):
        # Best-effort: append a print of the expression for JS-like
        if lang in ("javascript", "js", "typescript", "ts"):
            return f"{code.rstrip()}\nconsole.log({call_expr});\n"
        return code
    return (
        f"{code.rstrip()}\n\n"
        f"if __name__ == '__main__':\n"
        f"    print(repr({call_expr}))\n"
    )


def _case_update(
    case: dict[str, Any],
    *,
    status: str,
    actual: Any = None,
    stdout: str | None = None,
    stderr: str | None = None,
    exit_code: int | None = None,
    duration_ms: int = 0,
    failure_reason: str | None = None,
    defect: str | None = None,
    error_type: str | None = None,
) -> dict[str, Any]:
    return {
        **case,
        "actual": actual,
        "actual_result": actual,
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "duration_ms": duration_ms,
        "status": status,
        "failure_reason": failure_reason,
        "generation_defect": defect if defect is not None else case.get("generation_defect"),
        "error_type": error_type,
    }


def _stderr_exception(stderr: str) -> str | None:
    names = re.findall(r"^([A-Za-z_][\w.]*(?:Error|Exception|Warning))(?::|\s)", stderr or "", re.M)
    return names[-1].split(".")[-1] if names else None


def _missing_dependency(stderr: str) -> bool:
    return bool(re.search(
        r"ModuleNotFoundError|ImportError|No module named|Cannot find module|ERR_MODULE_NOT_FOUND|Cannot find package",
        stderr or "",
    ))


def _call_target(call: str | None) -> str | None:
    if not call:
        return None
    try:
        node = ast.parse(call, mode="eval").body
    except SyntaxError:
        return None
    if not isinstance(node, ast.Call):
        return None
    func = node.func
    parts: list[str] = []
    while isinstance(func, ast.Attribute):
        parts.append(func.attr)
        func = func.value
    if isinstance(func, ast.Name):
        parts.append(func.id)
        return ".".join(reversed(parts))
    return None


def _target_exists(code: str, target: str | None) -> bool:
    if not target:
        return True
    structure = analyze_python_structure(code)
    if target in structure.get("functions", []):
        return True
    if "." in target:
        class_name, method_name = target.split(".", 1)
        return any(
            item["name"] == class_name and method_name in item["methods"]
            for item in structure.get("classes", [])
        )
    return False


def _exception_harness(code: str, call: str) -> str:
    return (
        f"{code.rstrip()}\n\n"
        "if __name__ == '__main__':\n"
        "    try:\n"
        f"        print('__EYRA_RETURN__:' + repr({call}))\n"
        "    except BaseException as __eyra_exc:\n"
        "        print('__EYRA_EXCEPTION__:' + type(__eyra_exc).__name__)\n"
    )


def _expected_matches(actual_repr: str, expected: Any) -> bool:
    try:
        actual_value = ast.literal_eval(actual_repr)
    except Exception:
        return actual_repr.strip("'\"") == str(expected).strip("'\"")
    return bool(actual_value == expected)


def _js_harness(code: str, call: str) -> str:
    return (
        f"{code.rstrip()}\n\n"
        "try {\n"
        f"  const __eyra_result = ({call});\n"
        "  console.log('__EYRA_RETURN__:' + JSON.stringify(__eyra_result === undefined ? '__EYRA_UNDEFINED__' : __eyra_result));\n"
        "} catch (__eyra_error) {\n"
        "  console.log('__EYRA_EXCEPTION__:' + (__eyra_error && __eyra_error.constructor ? __eyra_error.constructor.name : 'Error'));\n"
        "}\n"
    )


def _run_js_function_case(
    code: str,
    case: dict[str, Any],
    *,
    language: str,
    file_name: str,
    timeout: int,
    strategy: dict[str, Any],
) -> dict[str, Any]:
    call = str(case.get("call") or strategy.get("call") or "").strip()
    target = str(case.get("target") or case.get("function_name") or _call_target(call) or "")
    if target:
        structure = analyze_js_structure(code)
        if target not in structure["functions"]:
            return _case_update(
                case,
                status="error",
                failure_reason=f"Generation defect: target function '{target}' does not exist in the source.",
                defect="target_not_found",
                error_type="ReferenceError",
            )
    run_file = file_name
    if language == "javascript" and re.search(r"^\s*export\b", code, re.M) and run_file.lower().endswith(".js"):
        # Node treats .js as CommonJS; run ESM sources as .mjs instead.
        run_file = run_file[:-3] + ".mjs"
    result = execute_snippet(
        code=_js_harness(code, call),
        language=language,
        file_name=run_file,
        timeout_s=timeout,
    )
    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "")[:2000]
    common = {
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": result.exit_code,
        "duration_ms": result.duration_ms,
    }
    if not result.runtime_available or result.status in {"UNAVAILABLE", "RUNTIME_UNAVAILABLE"}:
        return _case_update(case, status="error", actual=stdout or None, failure_reason=result.diagnostics or "The JavaScript/TypeScript runner is unavailable.", error_type="RuntimeUnavailable", **common)
    if result.timed_out or result.status == "TIMEOUT":
        return _case_update(case, status="error", actual=stdout or None, failure_reason=f"Test timed out after {timeout}s.", error_type="TimeoutError", **common)
    if _missing_dependency(stderr):
        return _case_update(case, status="error", actual=stderr.strip()[-500:] or stdout or None, failure_reason="A required dependency or project module is unavailable in the isolated runner.", error_type=_stderr_exception(stderr) or "Error", **common)

    return_marker: str | None = None
    exception_marker: str | None = None
    for line in stdout.splitlines():
        if line.startswith("__EYRA_RETURN__:"):
            return_marker = line.split(":", 1)[1]
        if line.startswith("__EYRA_EXCEPTION__:"):
            exception_marker = line.split(":", 1)[1]

    expected_exception = case.get("expected_exception") or strategy.get("expected_exception")
    if exception_marker:
        if expected_exception:
            if exception_marker == str(expected_exception):
                return _case_update(case, status="passed", actual=f"Threw {exception_marker}", **common)
            return _case_update(case, status="failed", actual=f"Threw {exception_marker}", failure_reason=f"Expected {expected_exception}, but {exception_marker} was thrown.", error_type=exception_marker, **common)
        return _case_update(case, status="failed", actual=f"Threw {exception_marker}", failure_reason=f"The call threw {exception_marker} unexpectedly.", error_type=exception_marker, **common)

    if return_marker is None:
        exc = _stderr_exception(stderr) or result.error_type
        return _case_update(case, status="failed", actual=stderr.strip()[-500:] or stdout or None, failure_reason=f"The call did not return a result. {exc or 'Execution failed'}.", error_type=exc, **common)

    if return_marker == "'__EYRA_UNDEFINED__'" or return_marker == '"__EYRA_UNDEFINED__"':
        actual_value: Any = None
        actual_text = "undefined"
    else:
        try:
            actual_value = json.loads(return_marker)
        except Exception:
            actual_value = return_marker
        actual_text = return_marker

    if expected_exception:
        return _case_update(case, status="failed", actual=actual_text, failure_reason=f"Expected {expected_exception}, but the call returned {actual_text}.", **common)
    if not case.get("assert_expected"):
        return _case_update(case, status="skipped", actual=actual_text, failure_reason="The call ran, but no expected result was supplied. Clarify the expected result before counting it as passed.", **common)
    expected = case.get("expected")
    matches = (
        isinstance(actual_value, (int, float))
        and isinstance(expected, (int, float))
        and float(actual_value) == float(expected)
    ) or actual_value == expected
    if matches:
        return _case_update(case, status="passed", actual=actual_text, **common)
    return _case_update(case, status="failed", actual=actual_text, failure_reason=f"Expected {expected!r}, but the call returned {actual_text}.", **common)


def run_test_case(
    code: str,
    case: dict[str, Any],
    *,
    language: str = "python",
    file_name: str = "perf_test.py",
    timeout_s: int | None = None,
) -> dict[str, Any]:
    case_id = case.get("id")
    if isinstance(case_id, bool) or not isinstance(case_id, int) or case_id <= 0:
        return _case_update(
            {**case, "id": -1},
            status="error",
            failure_reason="Invalid test case id. Regenerate the test cases.",
            defect="invalid_case_id",
            error_type="ValidationError",
        )
    strategy = case.get("strategy") if isinstance(case.get("strategy"), dict) else {}
    if case.get("needs_review") or strategy.get("kind") == "clarification":
        return _case_update(
            case,
            status="skipped",
            failure_reason=str(case.get("description") or "This case requires clarification before it can run."),
            defect=str(case.get("generation_defect") or case.get("reason") or "needs_review"),
        )

    lang = normalize_language_id(language)
    mode = str(case.get("mode") or strategy.get("mode") or ("function" if case.get("call") else "script")).lower()
    settings = get_settings()
    timeout = timeout_s or settings.eyra_exec_timeout_s

    if mode == "script":
        if lang not in {"python", "javascript", "typescript"}:
            return _case_update(
                case,
                status="error",
                failure_reason=f"Script execution is not available for {language}.",
                error_type="RuntimeUnavailable",
            )
        result = execute_snippet(
            code=code,
            language=lang,
            file_name=file_name,
            timeout_s=timeout,
        )
        stdout = (result.stdout or "").strip()
        stderr = (result.stderr or "")[:2000]
        common = {
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": result.exit_code,
            "duration_ms": result.duration_ms,
        }
        if not result.runtime_available or result.status in {"UNAVAILABLE", "RUNTIME_UNAVAILABLE"}:
            return _case_update(case, status="error", actual=stdout or None, failure_reason=result.diagnostics or "The script runner is unavailable.", error_type="RuntimeUnavailable", **common)
        if result.timed_out or result.status == "TIMEOUT":
            return _case_update(case, status="error", actual=stdout or None, failure_reason=f"Script timed out after {timeout}s.", error_type="TimeoutError", **common)
        if result.status == "EXECUTION_BLOCKED":
            return _case_update(case, status="error", actual=stdout or None, failure_reason=stderr or "The sandbox blocked this script.", error_type=result.error_type, **common)
        expected_exit = case.get("expected_exit_code")
        if expected_exit is None:
            expected_exit = strategy.get("expected_exit_code", 0)
        expected_stdout = case.get("expected_stdout_contains") or strategy.get("expected_stdout_contains") or []
        if _missing_dependency(stderr):
            return _case_update(case, status="error", actual=stderr.strip()[-500:] or stdout or None, failure_reason="A required dependency or project module is unavailable in the isolated runner.", error_type=_stderr_exception(stderr) or "ModuleNotFoundError", **common)
        if result.exit_code != expected_exit:
            exc = _stderr_exception(stderr)
            reason = f"Expected exit code {expected_exit}, got {result.exit_code}."
            if exc:
                reason += f" {exc}: {(stderr.strip().splitlines()[-1] if stderr.strip() else '')[:240]}"
            return _case_update(case, status="failed", actual=stderr.strip()[-500:] or stdout or None, failure_reason=reason, error_type=exc, **common)
        missing = [item for item in expected_stdout if str(item) not in stdout]
        if missing:
            return _case_update(case, status="failed", actual=stdout or None, failure_reason=f"Expected stdout to contain {missing!r}; actual stdout was {stdout!r}.", **common)
        return _case_update(case, status="passed", actual=stdout or "Script completed with no output.", **common)

    # Function mode.
    call = str(case.get("call") or strategy.get("call") or "").strip()
    if not call:
        return _case_update(
            case,
            status="skipped",
            failure_reason="No executable call was generated for this case.",
            defect="missing_call",
        )
    target = str(case.get("target") or case.get("function_name") or _call_target(call) or "")
    if lang in {"python", "py"} and target and not _target_exists(code, target):
        return _case_update(
            case,
            status="error",
            failure_reason=f"Generation defect: target function '{target}' does not exist in the source.",
            defect="target_not_found",
            error_type="NameError",
        )

    if lang in {"javascript", "typescript"}:
        return _run_js_function_case(
            code,
            case,
            language=lang,
            file_name=file_name,
            timeout=timeout,
            strategy=strategy,
        )

    harness = _exception_harness(code, call) if lang in {"python", "py"} else _build_harness(code, call, language)
    result = execute_snippet(
        code=harness,
        language=language,
        file_name=file_name,
        timeout_s=timeout,
    )
    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "")[:2000]
    common = {
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": result.exit_code,
        "duration_ms": result.duration_ms,
    }
    if not result.runtime_available or result.status in {"UNAVAILABLE", "RUNTIME_UNAVAILABLE"}:
        return _case_update(case, status="error", actual=stdout or None, failure_reason=result.diagnostics or "The test runner is unavailable.", error_type="RuntimeUnavailable", **common)
    if result.timed_out or result.status == "TIMEOUT":
        return _case_update(case, status="error", actual=stdout or None, failure_reason=f"Test timed out after {timeout}s.", error_type="TimeoutError", **common)
    if result.status == "EXECUTION_BLOCKED":
        return _case_update(case, status="error", actual=stdout or None, failure_reason=stderr or "The sandbox blocked this test.", error_type=result.error_type, **common)
    if _missing_dependency(stderr):
        return _case_update(case, status="error", actual=stderr.strip()[-500:] or stdout or None, failure_reason="A required dependency or project module is unavailable in the isolated runner.", error_type=_stderr_exception(stderr) or "ModuleNotFoundError", **common)

    return_marker = None
    exception_marker = None
    for line in stdout.splitlines():
        if line.startswith("__EYRA_RETURN__:"):
            return_marker = line.split(":", 1)[1]
        if line.startswith("__EYRA_EXCEPTION__:"):
            exception_marker = line.split(":", 1)[1]

    expected_exception = case.get("expected_exception") or strategy.get("expected_exception")
    if exception_marker:
        if expected_exception:
            if exception_marker == str(expected_exception):
                return _case_update(case, status="passed", actual=f"Raised {exception_marker}", **common)
            return _case_update(case, status="failed", actual=f"Raised {exception_marker}", failure_reason=f"Expected {expected_exception}, but {exception_marker} was raised.", error_type=exception_marker, **common)
        if exception_marker == "NameError" and target and not _target_exists(code, target):
            return _case_update(case, status="error", actual="Raised NameError", failure_reason=f"Generation defect: target function '{target}' does not exist in the source.", defect="target_not_found", error_type="NameError", **common)
        return _case_update(case, status="failed", actual=f"Raised {exception_marker}", failure_reason=f"The call raised {exception_marker} unexpectedly.", error_type=exception_marker, **common)

    if return_marker is None:
        exc = _stderr_exception(stderr) or result.error_type
        if exc == "NameError" and target and not _target_exists(code, target):
            return _case_update(case, status="error", actual=stderr.strip()[-500:] or stdout or None, failure_reason=f"Generation defect: target function '{target}' does not exist in the source.", defect="target_not_found", error_type="NameError", **common)
        return _case_update(case, status="failed", actual=stderr.strip()[-500:] or stdout or None, failure_reason=f"The call did not return a result. {exc or 'Execution failed'}.", error_type=exc, **common)

    if expected_exception:
        return _case_update(case, status="failed", actual=return_marker, failure_reason=f"Expected {expected_exception}, but the call returned {return_marker}.", **common)
    if not case.get("assert_expected"):
        return _case_update(case, status="skipped", actual=return_marker, failure_reason="The call ran, but no expected result was supplied. Clarify the expected result before counting it as passed.", **common)
    expected = case.get("expected")
    if _expected_matches(return_marker, expected):
        return _case_update(case, status="passed", actual=return_marker, **common)
    return _case_update(case, status="failed", actual=return_marker, failure_reason=f"Expected {expected!r}, but the call returned {return_marker}.", **common)


_COVERAGE_MARKER = "__EYRA_COVERAGE__:"


def _executable_lines(code: str) -> set[int]:
    try:
        compiled = compile(code, "<eyra>", "exec")
    except SyntaxError:
        return set()
    lines: set[int] = set()
    stack = [compiled]
    while stack:
        obj = stack.pop()
        for _start, _end, line in obj.co_lines():
            if line:
                lines.add(line)
        for const in obj.co_consts:
            if isinstance(const, types.CodeType):
                stack.append(const)
    return lines


def _coverage_runner(source: str) -> str:
    return (
        "import sys as _eyra_sys\n"
        "import types as _eyra_types\n"
        f"_eyra_source = {source!r}\n"
        "_eyra_code = compile(_eyra_source, __file__, 'exec')\n"
        "_eyra_codes = set()\n"
        "def _eyra_collect(_obj):\n"
        "    _eyra_codes.add(_obj)\n"
        "    for _const in _obj.co_consts:\n"
        "        if isinstance(_const, _eyra_types.CodeType):\n"
        "            _eyra_collect(_const)\n"
        "_eyra_collect(_eyra_code)\n"
        "_eyra_lines = set()\n"
        "def _eyra_trace(frame, event, arg):\n"
        "    if event == 'line' and frame.f_code in _eyra_codes:\n"
        "        _eyra_lines.add(frame.f_lineno)\n"
        "    return _eyra_trace\n"
        "try:\n"
        "    _eyra_sys.settrace(_eyra_trace)\n"
        "    try:\n"
        "        exec(_eyra_code, {'__name__': '__main__', '__file__': __file__})\n"
        "    except BaseException:\n"
        "        pass\n"
        "finally:\n"
        "    _eyra_sys.settrace(None)\n"
        f"    print('{_COVERAGE_MARKER}' + ','.join(str(n) for n in sorted(_eyra_lines)))\n"
    )


def _coverage_unavailable(reason: str) -> dict[str, Any]:
    return {
        "status": "unavailable",
        "measured": False,
        "percent": None,
        "reason": reason,
        "covered_lines": None,
        "total_lines": None,
    }


def _js_executable_lines(code: str) -> set[int]:
    """Structural estimate of executable JS/TS source lines (1-based)."""
    lines: set[int] = set()
    in_block_comment = False
    for idx, raw in enumerate(code.splitlines(), start=1):
        text = raw.strip()
        if in_block_comment:
            if "*/" in text:
                in_block_comment = False
            continue
        if text.startswith("/*"):
            if "*/" not in text[2:]:
                in_block_comment = True
            continue
        if not text or text.startswith("//"):
            continue
        if re.fullmatch(r"[}\])];?", text):
            continue
        if re.match(r"^(import|export\s+(?:type|interface|declare))\b", text):
            continue
        if re.match(r"^(interface|type)\s+[A-Za-z_$]", text):
            continue
        lines.add(idx)
    return lines


_B64_VALUES = {
    ch: i
    for i, ch in enumerate(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    )
}


def _vlq_decode(segment: str) -> list[int]:
    values: list[int] = []
    shift = 0
    value = 0
    for ch in segment:
        digit = _B64_VALUES.get(ch)
        if digit is None:
            break
        value += (digit & 31) << shift
        if digit & 32:
            shift += 5
            continue
        negative = value & 1
        value >>= 1
        values.append(-value if negative else value)
        shift = 0
        value = 0
    return values


def _sourcemap_line_map(js_text: str) -> dict[int, set[int]] | None:
    """Map generated JS lines (1-based) to original source lines (1-based)."""
    matches = re.findall(
        r"//# sourceMappingURL=data:application/json;base64,([A-Za-z0-9+/=]+)",
        js_text,
    )
    if not matches:
        return None
    try:
        data = json.loads(base64.b64decode(matches[-1]).decode("utf-8", errors="replace"))
    except Exception:
        return None
    mappings = data.get("mappings") or ""
    result: dict[int, set[int]] = {}
    source_idx = 0
    orig_line = 0
    orig_col = 0
    for gen_line0, line in enumerate(mappings.split(";")):
        gen_col = 0
        if not line:
            continue
        for seg in line.split(","):
            if not seg:
                continue
            vals = _vlq_decode(seg)
            if not vals:
                continue
            gen_col += vals[0]
            if len(vals) < 4:
                continue
            source_idx += vals[1]
            orig_line += vals[2]
            orig_col += vals[3]
            if source_idx == 0:
                result.setdefault(gen_line0 + 1, set()).add(orig_line + 1)
    return result


def _v8_covered_lines(cov_dir: Path, file_name_suffix: str, text: str) -> set[int]:
    """Lines executed per Node V8 coverage output for one executed file."""
    line_starts = [0]
    for i, ch in enumerate(text):
        if ch == "\n":
            line_starts.append(i + 1)

    def line_of(offset: int) -> int:
        return bisect.bisect_right(line_starts, offset)

    covered: set[int] = set()
    uncovered: set[int] = set()
    if not cov_dir.is_dir():
        return covered
    for cov_file in cov_dir.glob("coverage-*.json"):
        try:
            data = json.loads(cov_file.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            continue
        for entry in data.get("result", []):
            url = str(entry.get("url") or "")
            if not url.endswith(file_name_suffix):
                continue
            for fn in entry.get("functions", []):
                for rng in fn.get("ranges", []):
                    try:
                        start = int(rng.get("startOffset", 0))
                        end = int(rng.get("endOffset", 0))
                    except (TypeError, ValueError):
                        continue
                    target = covered if rng.get("count", 0) else uncovered
                    for ln in range(line_of(start), line_of(max(start, end - 1)) + 1):
                        target.add(ln)
    # Blocks that never ran (untaken branches) are reported with count 0
    # inside ranges that did run — they must not count as covered.
    return covered - uncovered


def _js_coverage_programs(
    code: str,
    evaluated: list[dict[str, Any]],
) -> list[str]:
    """Build runnable programs (user code + call harnesses) for coverage."""
    programs: list[str] = []
    has_script = False
    tails: list[str] = []
    for case in evaluated:
        strategy = case.get("strategy") if isinstance(case.get("strategy"), dict) else {}
        mode = str(case.get("mode") or strategy.get("mode") or ("function" if case.get("call") else "script")).lower()
        if mode == "script":
            has_script = True
            continue
        call = str(case.get("call") or strategy.get("call") or "").strip()
        if call:
            tails.append(_js_harness("", call))
    if has_script:
        programs.append(code)
    if tails:
        programs.append(code.rstrip() + "".join(tails) + "\n")
    return programs


def _run_node_with_coverage(
    argv: list[str],
    *,
    cwd: Path,
    timeout: float,
) -> Path | None:
    cov_dir = cwd / "eyra_v8cov"
    cov_dir.mkdir(parents=True, exist_ok=True)
    env = safe_env()
    env["NODE_V8_COVERAGE"] = str(cov_dir)
    try:
        subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(cwd),
            env=env,
        )
    except Exception:
        return None
    return cov_dir


def _measure_js_line_coverage(
    code: str,
    results: list[dict[str, Any]],
    *,
    language: str,
    file_name: str,
    timeout_s: int | None = None,
) -> dict[str, Any]:
    """Measure real JS/TS line coverage with Node's V8 coverage.

    JavaScript runs as-is, so V8 ranges map directly onto the source.
    TypeScript is compiled once per program with tsc (inline source map)
    and generated lines are mapped back to the original source lines.
    Returns measured=False with a reason whenever that cannot run.
    """
    node = which("node")
    if not node:
        return _coverage_unavailable("Node.js is not available, so V8 coverage was not measured.")
    evaluated = [r for r in results if str(r.get("status", "")).lower() in {"passed", "failed"}]
    if not evaluated:
        return _coverage_unavailable("No test case was evaluated, so line coverage was not measured.")
    if len(evaluated) > 20:
        return _coverage_unavailable("Too many cases were selected to re-run under V8 coverage.")
    executable = _js_executable_lines(code)
    if not executable:
        return _coverage_unavailable("No executable lines were found in the source.")
    programs = _js_coverage_programs(code, evaluated)
    if not programs:
        return _coverage_unavailable("No runnable test program could be built for coverage.")

    settings = get_settings()
    timeout = timeout_s or settings.eyra_exec_timeout_s
    covered: set[int] = set()
    measured_any = False
    is_ts = language == "typescript"
    base_name = Path((file_name or "snippet").replace("\\", "/")).name

    with tempfile.TemporaryDirectory(prefix="eyra_jscov_") as tmp:
        root = Path(tmp)
        for idx, program in enumerate(programs):
            work = root / f"p{idx}"
            work.mkdir(parents=True, exist_ok=True)
            if is_ts:
                src_name = base_name if base_name.endswith((".ts", ".tsx", ".mts", ".cts")) else "snippet.ts"
                src = work / src_name
                src.write_text(program, encoding="utf-8")
                npx = which("npx")
                if not npx:
                    return _coverage_unavailable("npx is not available to compile TypeScript for coverage.")
                out_dir = work / "eyra_out"
                tsc_args = [
                    npx, "--yes", "-p", "typescript", "tsc", str(src),
                    "--outDir", str(out_dir),
                    "--esModuleInterop", "--target", "ES2020",
                    "--module", "commonjs", "--skipLibCheck",
                    "--inlineSourceMap",
                ]
                if src_name.endswith((".tsx", ".jsx")):
                    tsc_args += ["--jsx", "react"]
                try:
                    subprocess.run(
                        tsc_args,
                        capture_output=True,
                        text=True,
                        timeout=60.0,
                        cwd=str(work),
                        env=safe_env(),
                    )
                except Exception:
                    continue
                out_js = out_dir / (src.stem + ".js")
                if not out_js.exists():
                    continue
                cov_dir = _run_node_with_coverage([node, str(out_js)], cwd=work, timeout=timeout)
                if cov_dir is None:
                    continue
                js_text = out_js.read_text(encoding="utf-8", errors="replace")
                gen_covered = _v8_covered_lines(cov_dir, out_js.name, js_text)
                if not gen_covered:
                    continue
                line_map = _sourcemap_line_map(js_text)
                if line_map is None:
                    return _coverage_unavailable(
                        "The TypeScript compiler did not emit a source map, so covered lines cannot be mapped back to the source."
                    )
                measured_any = True
                for gen_line in gen_covered:
                    covered |= line_map.get(gen_line, set())
            else:
                src_name = base_name if base_name.endswith((".js", ".mjs", ".cjs")) else "snippet.js"
                if src_name.endswith(".js") and re.search(r"^\s*export\b", program, re.M):
                    src_name = src_name[:-3] + ".mjs"
                src = work / src_name
                src.write_text(program, encoding="utf-8")
                cov_dir = _run_node_with_coverage([node, str(src)], cwd=work, timeout=timeout)
                if cov_dir is None:
                    continue
                prog_covered = _v8_covered_lines(cov_dir, src.name, program)
                if prog_covered:
                    measured_any = True
                    user_lines = len(code.splitlines())
                    covered |= {ln for ln in prog_covered if ln <= user_lines}

    if not measured_any:
        return _coverage_unavailable("V8 coverage did not report executed lines for these cases.")
    hit_lines = covered & executable
    percent = round((len(hit_lines) / len(executable)) * 100, 1) if executable else None
    method = (
        "Measured by Node V8 coverage after tsc compilation (lines mapped via source map)"
        if is_ts
        else "Measured by Node V8 coverage"
    )
    return {
        "status": "measured",
        "measured": True,
        "percent": percent,
        "reason": f"{method}: {len(hit_lines)} of {len(executable)} executable lines executed.",
        "covered_lines": len(hit_lines),
        "total_lines": len(executable),
    }


def measure_line_coverage(
    code: str,
    results: list[dict[str, Any]],
    *,
    language: str = "python",
    file_name: str = "perf_test.py",
    timeout_s: int | None = None,
) -> dict[str, Any]:
    """Measure real line coverage by re-running evaluated cases under a tracer.

    Returns measured=False with a reason whenever tracing could not run, so
    callers never present a fabricated percentage.
    """

    def unavailable(reason: str) -> dict[str, Any]:
        return {
            "status": "unavailable",
            "measured": False,
            "percent": None,
            "reason": reason,
            "covered_lines": None,
            "total_lines": None,
        }

    lang_norm = normalize_language_id(language)
    if lang_norm in {"javascript", "typescript"}:
        return _measure_js_line_coverage(
            code,
            results,
            language=lang_norm,
            file_name=file_name,
            timeout_s=timeout_s,
        )
    if lang_norm != "python":
        return unavailable(f"Line coverage is not measured for {language} test runs.")
    executable = _executable_lines(code)
    if not executable:
        return unavailable("No executable lines were found in the source.")
    evaluated = [r for r in results if str(r.get("status", "")).lower() in {"passed", "failed"}]
    if not evaluated:
        return unavailable("No test case was evaluated, so line coverage was not measured.")
    if len(evaluated) > 20:
        return unavailable("Too many cases were selected to re-run under the coverage tracer.")

    settings = get_settings()
    timeout = timeout_s or settings.eyra_exec_timeout_s
    covered: set[int] = set()
    measured_any = False
    for case in evaluated:
        strategy = case.get("strategy") if isinstance(case.get("strategy"), dict) else {}
        mode = str(case.get("mode") or strategy.get("mode") or ("function" if case.get("call") else "script")).lower()
        if mode == "script":
            source = code
        else:
            call = str(case.get("call") or strategy.get("call") or "").strip()
            if not call:
                continue
            source = _exception_harness(code, call)
        result = execute_snippet(
            code=_coverage_runner(source),
            language=language,
            file_name=file_name,
            timeout_s=timeout,
        )
        for line in (result.stdout or "").splitlines():
            if line.startswith(_COVERAGE_MARKER):
                measured_any = True
                payload = line[len(_COVERAGE_MARKER):].strip()
                if payload:
                    for part in payload.split(","):
                        try:
                            covered.add(int(part))
                        except ValueError:
                            continue
    if not measured_any:
        return unavailable("Coverage tracing did not report executed lines for these cases.")
    hit = covered & executable
    percent = round((len(hit) / len(executable)) * 100, 1) if executable else None
    return {
        "status": "measured",
        "measured": True,
        "percent": percent,
        "reason": f"Measured by line tracing: {len(hit)} of {len(executable)} executable lines executed.",
        "covered_lines": len(hit),
        "total_lines": len(executable),
    }


def build_performance_payload(
    code: str,
    *,
    language: str = "python",
    file_name: str = "snippet.py",
    target_time: str = "O(n)",
    target_space: str = "O(1)",
    goal: str = "",
) -> dict[str, Any]:
    cx = analyze_complexity(code, language)
    suggestion = suggest_optimized_local(
        code,
        language=language,
        target_time=target_time,
        target_space=target_space,
        goal=goal,
        complexity=cx,
    )
    tests = generate_test_cases(code, language=language, function_name=cx.function_name)
    active = next((i for i, b in enumerate(COMPLEXITY_BARS) if b["label"] == cx.time), -1)
    return {
        "file_name": file_name,
        "language": language,
        "code": code,
        "complexity": {
            "time": cx.time,
            "space": cx.space,
            "time_label": cx.time_label,
            "space_label": cx.space_label,
            "time_severity": cx.time_severity,
            "space_severity": cx.space_severity,
            "notes": cx.notes,
            "function_name": cx.function_name,
            "pattern": cx.pattern,
            "basis": cx.basis,
            "basis_label": cx.basis_label,
            "bars": [
                {**b, "active": i == active or b["label"] == cx.time} for i, b in enumerate(COMPLEXITY_BARS)
            ],
            "order": COMPLEXITY_ORDER,
        },
        "targets": {
            "time": target_time,
            "space": target_space,
            "goal": goal
            or (
                f"Reduce time toward {target_time} and space toward {target_space} "
                "without changing observable results."
            ),
            "options": COMPLEXITY_ORDER,
        },
        "suggestion": suggestion,
        "tests": {
            "cases": tests,
            "total": len(tests),
            "passed": 0,
            "failed": 0,
            "not_run": len(tests),
        },
        "notes": [
            f"Complexity basis: {cx.basis_label}. Static estimates are not measured runtime results.",
            "Optimized suggestions are pattern-based (and optional LLM when configured).",
            "Generated tests execute your buffer via the EYRA soft sandbox runtime.",
        ],
    }
