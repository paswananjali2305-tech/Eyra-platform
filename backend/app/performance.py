"""Code performance analysis: complexity heuristics, optimize suggestions, test generation/run.

Honest local heuristics (AST / pattern matching). Optional Groq enrichment when configured.
"""

from __future__ import annotations

import ast
import json
import re
import textwrap
from dataclasses import dataclass, field
from typing import Any

from app.config import get_settings
from app.runtimes import execute_snippet

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


def analyze_complexity(code: str, language: str = "python") -> ComplexityResult:
    lang = (language or "python").lower()
    if lang in ("python", "py"):
        return analyze_complexity_python(code)
    # Lightweight regex fallback for other languages
    result = ComplexityResult()
    result.notes.append(f"Heuristic scan for {lang} (full AST only for Python).")
    nested = len(re.findall(r"\bfor\b", code)) >= 2
    recursive = bool(re.search(r"\bfib", code, re.I)) and "return" in code
    if recursive:
        result.time, result.space, result.pattern = "O(2^n)", "O(n)", "recursive_like"
    elif nested:
        result.time, result.space, result.pattern = "O(n^2)", "O(1)", "nested_loops"
    else:
        result.time, result.space, result.pattern = "O(n)", "O(1)", "linear_like"
    result.time_label = _label_for(result.time)
    result.space_label = _label_for(result.space, space=True)
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

    if cx.pattern == "recursive_fibonacci" or (
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
    fn = function_name or _detect_fn_name(code, language) or "fibonacci"
    cases: list[dict[str, Any]] = []

    if re.search(r"\bfib", fn, re.I) or re.search(r"\bfib", code, re.I):
        fib_vals = {0: 0, 1: 1, 2: 1, 5: 5, 10: 55}
        for i, (inp, exp) in enumerate(fib_vals.items(), start=1):
            cases.append(
                {
                    "id": i,
                    "description": f"fibonacci({inp})",
                    "input": str(inp),
                    "expected": str(exp),
                    "actual": None,
                    "status": "not_run",
                    "call": f"{fn}({inp})",
                }
            )
        return cases

    # Generic scalar smoke cases
    for i, inp in enumerate([0, 1, 2, 5, 10], start=1):
        cases.append(
            {
                "id": i,
                "description": f"{fn}({inp}) smoke",
                "input": str(inp),
                "expected": None,
                "actual": None,
                "status": "not_run",
                "call": f"{fn}({inp})",
            }
        )
    return cases


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


def run_test_case(
    code: str,
    case: dict[str, Any],
    *,
    language: str = "python",
    file_name: str = "perf_test.py",
    timeout_s: int | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    call = case.get("call") or f"{_detect_fn_name(code) or 'main'}({case.get('input', '')})"
    harness = _build_harness(code, str(call), language)
    result = execute_snippet(
        code=harness,
        language=language,
        file_name=file_name,
        timeout_s=timeout_s or settings.eyra_exec_timeout_s,
    )
    actual = (result.stdout or "").strip()
    # Normalize python repr quotes for compare
    expected = case.get("expected")
    status = "error"
    if result.ok:
        if expected is None or expected == "":
            status = "passed"  # smoke: executed cleanly
        else:
            norm_actual = actual.strip("'\"")
            status = "passed" if norm_actual == str(expected).strip() else "failed"
    elif result.timed_out:
        status = "failed"
        actual = actual or "TIMEOUT"
    else:
        status = "failed"
        actual = actual or (result.stderr or result.error_type or "error")[:400]

    return {
        **case,
        "actual": actual,
        "status": status,
        "exit_code": result.exit_code,
        "stderr": (result.stderr or "")[:500],
        "duration_ms": result.duration_ms,
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
            "Complexity estimates use local AST/heuristics — not a formal proof.",
            "Optimized suggestions are pattern-based (and optional LLM when configured).",
            "Generated tests execute your buffer via the EYRA soft sandbox runtime.",
        ],
    }
