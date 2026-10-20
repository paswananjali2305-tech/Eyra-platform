"""JavaScript/TypeScript test generation and execution tests (Phase 2/3)."""

from __future__ import annotations

import shutil

import pytest

from app.jstestgen import analyze_js_structure, discover_js_functions, generate_js_cases
from app.performance import generate_test_cases, run_test_case

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(not NODE, reason="node not installed")


ADD_TS = (
    "export function add(a: number, b: number): number {\n"
    "  return a + b;\n"
    "}\n"
)

ADD_JS = "function add(a, b) { return a + b; }\n"

CLAMP_JS = (
    "function clamp(value) {\n"
    "  if (value < 0) { return 0; }\n"
    "  if (value > 10) { return 10; }\n"
    "  return value;\n"
    "}\n"
)

THROW_JS = (
    "function parsePositive(n) {\n"
    "  if (n <= 0) { throw new RangeError('must be positive'); }\n"
    "  return n;\n"
    "}\n"
)

SCRIPT_JS = "const numbers = [1, 2, 3];\nconsole.log(numbers[numbers.length - 1]);\n"


def test_discovers_exported_and_arrow_functions():
    structure = analyze_js_structure(
        "export function add(a: number, b: number): number { return a + b; }\n"
        "const double = (n) => n * 2;\n"
    )
    assert structure["functions"] == ["add", "double"]
    details = {f["name"]: f for f in structure["function_details"]}
    assert [p["name"] for p in details["add"]["params"]] == ["a", "b"]
    assert [p["name"] for p in details["double"]["params"]] == ["n"]
    assert structure["classes"] == []


def test_discovers_classes_without_inventing_methods():
    structure = analyze_js_structure("class Counter { increment(x) { return x + 1; } }\n")
    assert structure["classes"] == ["Counter"]
    # Methods are not promoted to standalone functions.
    assert "increment" not in structure["functions"]


def test_generates_cases_from_actual_ts_signature():
    cases = generate_js_cases(ADD_TS, language="typescript")
    assert cases
    assert all(c["target"] == "add" for c in cases if not c["needs_review"])
    by_call = {c["call"]: c for c in cases if c["call"]}
    assert by_call["add(0, 0)"]["expected"] == 0
    assert by_call["add(1, 1)"]["expected"] == 2
    assert by_call["add(2, 1)"]["expected"] == 3


def test_generates_cases_for_clamp_branches():
    cases = generate_js_cases(CLAMP_JS, language="javascript")
    by_call = {c["call"]: c["expected"] for c in cases if c["call"] and c["assert_expected"]}
    assert by_call["clamp(0)"] == 0
    assert by_call["clamp(1)"] == 1
    # Boundary uses the largest generated value; the static evaluator derives
    # the true expectation from the user's code instead of guessing.
    assert by_call["clamp(2)"] == 2


def test_expected_exception_case_for_throwing_function():
    cases = generate_js_cases(THROW_JS, language="javascript")
    exc = [c for c in cases if c.get("expected_exception") == "RangeError"]
    assert exc
    assert exc[0]["assert_expected"] is True
    assert exc[0]["call"] == "parsePositive(0)"


def test_no_invented_expected_values_for_uncallable_params():
    code = "function render(opts) { return opts.theme.name; }\n"
    cases = generate_js_cases(code, language="javascript")
    assert cases
    assert all(c["needs_review"] for c in cases)
    ran = run_test_case(code, cases[0], language="javascript", file_name="render.js")
    assert ran["status"] == "skipped"


def test_async_function_requires_clarification():
    code = "async function loadUser(id) { return { id }; }\n"
    cases = generate_js_cases(code, language="javascript")
    assert cases and cases[0]["needs_review"] is True


def test_unknown_target_is_generation_defect():
    cases = generate_js_cases(ADD_JS, function_name="subtract", language="javascript")
    assert cases[0]["generation_defect"] == "target_not_found"
    assert cases[0]["needs_review"] is True
    manual = run_test_case(
        ADD_JS,
        {"id": 9, "mode": "function", "target": "subtract", "call": "subtract(1, 2)", "assert_expected": True, "expected": -1},
        language="javascript",
        file_name="add.js",
    )
    assert manual["status"] == "error"
    assert manual["generation_defect"] == "target_not_found"


def test_script_mode_observes_console_output():
    cases = generate_js_cases(SCRIPT_JS, language="javascript")
    assert cases[0]["mode"] == "script"
    output = [c for c in cases if c["name"] == "test_script_output"]
    assert output and output[0]["expected_stdout_contains"] == ["3"]


def test_python_generation_unaffected_by_js_adapter():
    cases = generate_test_cases("def add(a: int, b: int):\n    return a + b\n", language="python")
    assert cases[0]["mode"] == "function"
    assert cases[0]["call"].startswith("add(")
    assert cases[0]["expected"] == 0


@needs_node
def test_generated_js_cases_pass_against_correct_code():
    cases = [c for c in generate_js_cases(ADD_JS, language="javascript") if c["assert_expected"]]
    assert cases
    for case in cases:
        ran = run_test_case(ADD_JS, case, language="javascript", file_name="add.js")
        assert ran["status"] == "passed", ran


@needs_node
def test_failing_assertion_is_failed_not_passed():
    broken = "function add(a, b) { return a - b; }\n"
    cases = [c for c in generate_js_cases(ADD_JS, language="javascript") if c["assert_expected"]]
    assert cases
    discriminating = [c for c in cases if c["call"] == "add(1, 1)"]
    assert discriminating
    ran = run_test_case(broken, discriminating[0], language="javascript", file_name="add.js")
    assert ran["status"] == "failed"
    assert ran["actual"] is not None


@needs_node
def test_expected_exception_case_executes():
    cases = generate_js_cases(THROW_JS, language="javascript")
    exc = [c for c in cases if c.get("expected_exception") == "RangeError"][0]
    ran = run_test_case(THROW_JS, exc, language="javascript", file_name="parse.js")
    assert ran["status"] == "passed", ran


@needs_node
def test_script_case_executes_and_matches_output():
    cases = generate_js_cases(SCRIPT_JS, language="javascript")
    output = [c for c in cases if c["name"] == "test_script_output"][0]
    ran = run_test_case(SCRIPT_JS, output, language="javascript", file_name="script.js")
    assert ran["status"] == "passed", ran
    failing = run_test_case("console.log(99);\n", output, language="javascript", file_name="script.js")
    assert failing["status"] == "failed"


@needs_node
def test_missing_dependency_is_error_not_pass():
    code = "import missingPkg from 'eyra-definitely-missing-pkg';\nexport function go() { return missingPkg; }\n"
    case = {
        "id": 1, "mode": "function", "target": "go", "call": "go()",
        "assert_expected": True, "expected": None,
    }
    ran = run_test_case(code, case, language="javascript", file_name="go.js")
    assert ran["status"] == "error"
    assert "unavailable" in (ran["failure_reason"] or "")


@needs_node
def test_js_coverage_measured_and_partial_with_unused_function():
    from app.performance import measure_line_coverage

    code = "function add(a, b) { return a + b; }\nfunction unused(x) {\n  return x * 99;\n}\n"
    cases = generate_js_cases(code, language="javascript")
    results = [run_test_case(code, c, language="javascript", file_name="add.js") for c in cases]
    assert all(r["status"] == "passed" for r in results)
    coverage = measure_line_coverage(code, results, language="javascript", file_name="add.js")
    assert coverage["measured"] is True
    assert coverage["percent"] is not None and coverage["percent"] < 100
    assert coverage["covered_lines"] < coverage["total_lines"]
    assert "V8 coverage" in coverage["reason"]


@needs_node
def test_js_coverage_full_when_every_line_executes():
    from app.performance import measure_line_coverage

    cases = generate_js_cases(ADD_JS, language="javascript")
    results = [run_test_case(ADD_JS, c, language="javascript", file_name="add.js") for c in cases]
    coverage = measure_line_coverage(ADD_JS, results, language="javascript", file_name="add.js")
    assert coverage["measured"] is True
    assert coverage["percent"] == 100.0


@needs_node
def test_ts_coverage_measured_via_tsc_source_map():
    from app.performance import measure_line_coverage

    if not shutil.which("npx"):
        pytest.skip("npx not available for TypeScript coverage")
    code = (
        "export function clampTotal(v: number): number {\n"
        "  if (v > 10) { return 10; }\n"
        "  return v;\n"
        "}\n"
        "function unusedTs(x: number): number {\n"
        "  return x * 99;\n"
        "}\n"
    )
    cases = generate_js_cases(code, language="typescript")
    results = [run_test_case(code, c, language="typescript", file_name="ee.tsx") for c in cases]
    assert all(r["status"] == "passed" for r in results)
    coverage = measure_line_coverage(code, results, language="typescript", file_name="ee.tsx")
    assert coverage["measured"] is True, coverage
    assert coverage["percent"] is not None and coverage["percent"] < 100
    assert "source map" in coverage["reason"]


def test_coverage_unavailable_when_nothing_evaluated():
    from app.performance import measure_line_coverage

    coverage = measure_line_coverage(ADD_JS, [], language="javascript", file_name="add.js")
    assert coverage["measured"] is False
    assert coverage["percent"] is None


@needs_node
def test_ts_function_executes_through_toolchain():
    if not (shutil.which("npx") or shutil.which("tsx") or shutil.which("ts-node")):
        pytest.skip("no TypeScript runner (npx/tsx/ts-node) available")
    cases = [c for c in generate_js_cases(ADD_TS, language="typescript") if c["assert_expected"]]
    assert cases
    ran = run_test_case(ADD_TS, cases[0], language="typescript", file_name="add.ts")
    assert ran["status"] == "passed", ran
