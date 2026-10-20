"""Code-aware Python test generation."""
import os
from pathlib import Path

os.environ["EYRA_DB_PATH"] = str(Path(__file__).resolve().parent / "test_eyra_testgen.sqlite")
os.environ["EYRA_SKIP_AUDIT_ENGINE"] = "1"
os.environ["EYRA_ALLOW_LOCAL_FALLBACK"] = "true"
os.environ["GROQ_API_KEY"] = ""

from app.performance import generate_test_cases, run_test_case  # noqa: E402

FIB = """
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)
"""

ADD = """
def add(a: int, b: int = 1):
    return a + b
"""

LISTS = """
def total(items: list):
    if not items:
        return 0
    return len(items)
"""

TEXT = """
def shout(text: str):
    return text.upper()
"""

KEYWORD = """
def scale(n: int, *, factor: int = 2):
    if n <= 1:
        return n
    return n * factor
"""


def test_fibonacci_cases_assert_known_values():
    cases = generate_test_cases(FIB, language="python")
    assert cases
    assert all(case["function_name"] == "fibonacci" for case in cases)
    assert all(case["assert_expected"] for case in cases)
    assert any(case["expected"] == 1 and "fibonacci(2)" in case["call"] for case in cases)


def test_numeric_function_uses_signature_not_generic_fn():
    cases = generate_test_cases(ADD, language="python")
    calls = [case["call"] for case in cases]
    assert calls
    assert all(call.startswith("add(") for call in calls)
    assert all(case["assert_expected"] for case in cases)
    assert any(case["expected"] == 2 for case in cases)
    assert any("default" in case["description"] for case in cases)


def test_list_and_string_cases():
    lists = generate_test_cases(LISTS, language="python")
    assert any(case["call"] == "total([])" for case in lists)
    text = generate_test_cases(TEXT, language="python")
    assert any('shout("")' in case["call"] or "shout('')" in case["call"] for case in text)


def test_keyword_only_and_branch():
    cases = generate_test_cases(KEYWORD, language="python")
    assert any("factor=" in case["call"] for case in cases)
    assert any("boundary" in case["description"] for case in cases)


def test_syntax_error_and_dynamic_signature_are_not_run():
    broken = generate_test_cases("def f(\n", language="python")
    assert broken[0]["status"] == "not_run"
    assert broken[0]["call"] is None
    dynamic = generate_test_cases("def f(*args):\n    return args\n", language="python")
    assert dynamic[0]["needs_review"] is True
    assert dynamic[0]["call"] is None


def test_unknown_type_is_not_invented_as_integers():
    cases = generate_test_cases("def mystery(blob):\n    return blob\n", language="python")
    assert cases[0]["needs_review"] is True
    assert "blob" in cases[0]["description"]
    assert cases[0]["call"] is None


def test_case_without_expected_result_is_skipped_not_passed():
    code = "def add(a: int, b: int = 1):\n    return a + b\n"
    case = {
        "id": 1,
        "mode": "function",
        "target": "add",
        "call": "add(1, 1)",
        "assert_expected": False,
        "expected": None,
    }
    ran = run_test_case(code, case, language="python", file_name="add.py")
    assert ran["status"] == "skipped"
    assert ran["actual"] == "2"


def test_asserted_fib_can_pass():
    code = "def fibonacci(n):\n    if n <= 1:\n        return n\n    return n\n"
    case = next(c for c in generate_test_cases(code, language="python") if c["call"] == "fibonacci(2)")
    ran = run_test_case(code, case, language="python", file_name="fib.py")
    assert ran["status"] == "failed"


def test_expected_exception_passes_and_unexpected_exception_fails():
    code = "def boom(n: int):\n    raise RuntimeError('nope')\n"
    case = generate_test_cases(code, language="python")[0]
    assert case["expected_exception"] == "RuntimeError"
    passed = run_test_case(code, case, language="python")
    assert passed["status"] == "passed"

    unexpected = dict(case, expected_exception="ValueError", assert_expected=True)
    failed = run_test_case(code, unexpected, language="python")
    assert failed["status"] == "failed"
    assert "RuntimeError" in (failed["failure_reason"] or "")


def test_missing_runner_and_timeout_are_errors_not_passes():
    missing = run_test_case("def f(n: int):\n    return n\n", {"id": 1, "call": "f(1)", "assert_expected": False}, language="html")
    assert missing["status"] == "error"

    slow = "def spin(n: int):\n    while True:\n        n += 1\n"
    timed = run_test_case(slow, {"id": 1, "call": "spin(1)", "assert_expected": False}, language="python", timeout_s=1)
    assert timed["status"] == "error"
    assert timed["error_type"] == "TimeoutError"


SCRIPT_OK = """
numbers = [1, 2, 3]
print(numbers[-1])
assert numbers[-1] == 3
"""


def test_standalone_script_uses_script_mode_and_passes_on_output():
    cases = generate_test_cases(SCRIPT_OK, language="python")
    assert 2 <= len(cases) <= 5
    assert all(case["mode"] == "script" for case in cases)
    assert all(case["call"] is None for case in cases)
    case = cases[0]
    assert case["expected_stdout_contains"] == ["3"]
    assert case["expected_exit_code"] == 0
    for generated in cases:
        ran = run_test_case(SCRIPT_OK, generated, language="python", file_name="test.py")
        assert ran["status"] == "passed"
        assert ran["exit_code"] == 0
    assert "3" in (run_test_case(SCRIPT_OK, case, language="python", file_name="test.py")["stdout"] or "")


def test_case_counts_stay_within_two_to_five_for_testable_code():
    assert 2 <= len(generate_test_cases(ADD, language="python")) <= 5
    assert 2 <= len(generate_test_cases(FIB, language="python")) <= 5
    script = generate_test_cases("value = 40 + 2\nprint(value)\n", language="python")
    assert 2 <= len(script) <= 5


def test_valid_function_normal_return_passes():
    code = "def add(a: int, b: int):\n    return a + b\n"
    case = next(c for c in generate_test_cases(code, language="python") if c["call"] == "add(1, 1)")
    ran = run_test_case(code, case, language="python", file_name="add.py")
    assert ran["status"] == "passed"
    assert ran["actual"] == "2"


def test_script_failing_assertion_fails_and_runtime_error_is_captured():
    bad_assert = "numbers = [1, 2, 3]\nassert numbers[-1] == 4\n"
    case = generate_test_cases(bad_assert, language="python")[0]
    assert case["mode"] == "script"
    ran = run_test_case(bad_assert, case, language="python", file_name="script.py")
    assert ran["status"] == "failed"
    assert ran["exit_code"] != 0

    broken = "print('start')\nraise ValueError('broken script')\n"
    case = {
        "id": 1,
        "mode": "script",
        "strategy": {"kind": "script_run", "expected_exit_code": 0, "expected_stdout_contains": ["start"]},
        "expected_exit_code": 0,
        "expected_stdout_contains": ["start"],
    }
    ran = run_test_case(broken, case, language="python", file_name="script.py")
    assert ran["status"] == "failed"
    assert "ValueError" in (ran["stderr"] or ran["failure_reason"] or "")


def test_file_with_no_functions_still_tests_top_level_behavior():
    code = "value = 40 + 2\nprint(value)\n"
    cases = generate_test_cases(code, language="python")
    assert cases[0]["mode"] == "script"
    assert cases[0]["expected_stdout_contains"] == ["42"]


def test_nonexistent_target_is_generation_defect_not_user_failure():
    code = "def add(a: int, b: int):\n    return a + b\n"
    cases = generate_test_cases(code, language="python", function_name="test")
    assert cases[0]["generation_defect"] == "target_not_found"
    assert cases[0]["needs_review"] is True
    ran = run_test_case(code, cases[0], language="python", file_name="add.py")
    assert ran["status"] == "skipped"
    assert ran["generation_defect"] == "target_not_found"

    manual = run_test_case(
        code,
        {"id": 99, "mode": "function", "target": "test", "call": "test()", "assert_expected": True, "expected": 0},
        language="python",
        file_name="add.py",
    )
    assert manual["status"] == "error"
    assert manual["generation_defect"] == "target_not_found"


def test_no_safely_testable_behavior_requires_clarification():
    code = "import math\nRESULT = math.pi\n"
    cases = generate_test_cases(code, language="python")
    assert cases
    assert cases[0]["needs_review"] is True
    ran = run_test_case(code, cases[0], language="python", file_name="constants.py")
    assert ran["status"] == "skipped"


def test_unsupported_language_generation_returns_no_fake_cases():
    assert generate_test_cases("public class A {}\n", language="java") == []
    assert generate_test_cases("package main\n", language="go") == []


def test_js_and_ts_generation_no_longer_returns_empty_placeholder():
    ts_cases = generate_test_cases("export function add(a: number, b: number): number { return a + b; }\n", language="typescript")
    assert ts_cases
    assert all(c["target"] == "add" for c in ts_cases if not c["needs_review"])
    jsx_component = "export const App = () => null;\n"
    assert generate_test_cases(jsx_component, language="typescriptreact")


def test_js_script_generation_is_meaningful():
    cases = generate_test_cases("console.log('hi');\n", language="javascriptreact")
    assert cases
    assert cases[0]["mode"] == "script"


def test_missing_dependency_is_error_not_pass():
    code = "import definitely_missing_eyra_dependency\nprint('unreachable')\n"
    cases = generate_test_cases(code, language="python")
    ran = run_test_case(code, cases[0], language="python", file_name="needs_dep.py")
    assert ran["status"] == "error"
    assert ran["error_type"] == "ModuleNotFoundError"
