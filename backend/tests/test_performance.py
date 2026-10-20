"""Performance analysis + test runner API."""
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(__file__).resolve().parent / "test_eyra_perf.sqlite"
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["EYRA_DB_PATH"] = str(TEST_DB)
os.environ["EYRA_ALLOW_LOCAL_FALLBACK"] = "true"
os.environ["GROQ_API_KEY"] = ""

from app.main import app  # noqa: E402
from app.database import init_db  # noqa: E402
from tests.conftest import use_test_db

FIB = """
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)
"""


@pytest.fixture()
def client():
    use_test_db(TEST_DB)
    init_db()
    with TestClient(app) as c:
        yield c


def test_performance_analyze_fib(client: TestClient):
    r = client.post(
        "/api/performance/analyze",
        json={"code": FIB, "language": "python", "file_name": "fib.py"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["complexity"]["time"] == "O(2^n)"
    assert data["complexity"]["space"] == "O(n)"
    assert data["complexity"]["pattern"] == "recursive_fibonacci"
    assert data["tests"]["total"] >= 1
    assert data["suggestion"]["applied_transform"] is True


def test_performance_optimize_fib(client: TestClient):
    r = client.post(
        "/api/performance/optimize",
        json={
            "code": FIB,
            "language": "python",
            "target_time": "O(n)",
            "target_space": "O(1)",
        },
    )
    assert r.status_code == 200, r.text
    sug = r.json()["suggestion"]
    assert sug["applied_transform"] is True
    assert "for _ in range" in sug["optimized_code"]
    assert sug["optimized_time"] == "O(n)"


def test_performance_generate_and_run_tests(client: TestClient):
    gen = client.post(
        "/api/performance/tests/generate",
        json={"code": FIB, "language": "python"},
    )
    assert gen.status_code == 200, gen.text
    cases = gen.json()["cases"]
    assert len(cases) >= 3

    # Optimize first so tests don't explode on recursive fib(10)
    opt = client.post(
        "/api/performance/optimize",
        json={"code": FIB, "language": "python"},
    ).json()["suggestion"]["optimized_code"]

    run = client.post(
        "/api/performance/tests/run",
        json={
            "code": opt,
            "language": "python",
            "file_name": "fib.py",
            "cases": cases,
            "case_ids": [1, 2, 3],
        },
    )
    assert run.status_code == 200, run.text
    body = run.json()
    assert body["passed"] >= 1
    assert "Ran" in body["log"]


SCRIPT = """
numbers = [1, 2, 3]
print(numbers[-1])
assert numbers[-1] == 3
"""


def test_script_generation_and_run_distinguishes_pass_rate_from_coverage(client: TestClient):
    gen = client.post(
        "/api/performance/tests/generate",
        json={"code": SCRIPT, "language": "python", "file_name": "test.py"},
    )
    assert gen.status_code == 200, gen.text
    generated = gen.json()
    assert generated["mode"] == "script"
    assert generated["coverage"]["measured"] is False
    assert generated["coverage"]["percent"] is None
    cases = generated["cases"]
    assert cases[0]["expected_stdout_contains"] == ["3"]
    assert all(case["call"] is None for case in cases)

    run = client.post(
        "/api/performance/tests/run",
        json={
            "code": SCRIPT,
            "language": "python",
            "file_name": "test.py",
            "cases": cases,
            "case_ids": [cases[0]["id"]],
        },
    )
    assert run.status_code == 200, run.text
    body = run.json()
    assert body["passed"] == 1
    assert body["pass_rate_percent"] == 100.0
    # Coverage is now really measured by line tracing, and stays distinct
    # from the pass rate.
    assert body["coverage"]["measured"] is True
    assert body["coverage"]["percent"] == 100.0
    assert body["coverage"]["covered_lines"] == body["coverage"]["total_lines"]
    assert body["cases"][0]["status"] == "passed"


def test_tsx_generation_is_supported_via_js_adapter(client: TestClient):
    gen = client.post(
        "/api/performance/tests/generate",
        json={
            "code": "export function add(a: number, b: number): number { return a + b; }\n",
            "language": "typescriptreact",
            "file_name": "ee.tsx",
        },
    )
    assert gen.status_code == 200, gen.text
    body = gen.json()
    assert body["notice"] is None
    assert body["cases"]
    assert body["mode"] == "function"
    assert body["analysis"]["functions"] == ["add"]


def test_performance_basis_labels_are_honest(client: TestClient):
    py = client.post(
        "/api/performance/analyze",
        json={"code": FIB, "language": "python", "file_name": "fib.py"},
    )
    assert py.status_code == 200, py.text
    assert py.json()["complexity"]["basis"] == "python_ast"

    js = client.post(
        "/api/performance/analyze",
        json={
            "code": "function sumAll(items) { let t = 0; for (const x of items) { for (const y of items) { t += x * y; } } return t; }\n",
            "language": "javascript",
            "file_name": "sum.js",
        },
    )
    assert js.status_code == 200, js.text
    cx = js.json()["complexity"]
    assert cx["basis"] == "js_structural"
    assert "structural" in cx["basis_label"].lower()
    assert cx["time"] == "O(n^2)"
    assert cx["pattern"] == "nested_loops"

    java = client.post(
        "/api/performance/analyze",
        json={"code": "class A { void f() { for (;;) { for (;;) {} } } }\n", "language": "java", "file_name": "A.java"},
    )
    assert java.status_code == 200, java.text
    jcx = java.json()["complexity"]
    assert jcx["basis"] == "heuristic"
    assert jcx["time_label"].startswith("Heuristic estimate")


def test_js_complexity_straight_line_and_recursion():
    from app.performance import analyze_complexity

    straight = analyze_complexity("function add(a, b) { return a + b; }\n", language="javascript")
    assert straight.time == "O(1)"
    assert straight.basis == "js_structural"

    fib = analyze_complexity(
        "function fib(n) { if (n <= 1) { return n; } return fib(n - 1) + fib(n - 2); }\n",
        language="typescript",
    )
    assert fib.time == "O(2^n)"
    assert fib.pattern == "recursive_branching"


def test_js_fib_never_gets_python_rewrite():
    from app.performance import suggest_optimized_local

    out = suggest_optimized_local(
        "function fib(n) { if (n <= 1) { return n; } return fib(n - 1) + fib(n - 2); }\n",
        language="javascript",
    )
    assert out["applied_transform"] is False
    assert "def fibonacci" not in out["optimized_code"]


def test_generate_and_run_report_actual_language_and_file(client: TestClient):
    gen = client.post(
        "/api/performance/tests/generate",
        json={
            "code": "export function add(a: number, b: number): number { return a + b; }\n",
            "language": "typescriptreact",
            "file_name": "ee.tsx",
        },
    )
    assert gen.status_code == 200, gen.text
    body = gen.json()
    assert body["language"] == "typescript"
    assert body["file_name"] == "ee.tsx"
    run = client.post(
        "/api/performance/tests/run",
        json={
            "code": "export function add(a: number, b: number): number { return a + b; }\n",
            "language": "typescriptreact",
            "file_name": "ee.tsx",
            "cases": body["cases"],
        },
    )
    assert run.status_code == 200, run.text
    rbody = run.json()
    assert rbody["language"] == "typescript"
    assert rbody["file_name"] == "ee.tsx"
    assert rbody["passed"] == rbody["total"]


def test_unsupported_language_generation_is_honest(client: TestClient):
    gen = client.post(
        "/api/performance/tests/generate",
        json={
            "code": "public class App { public static void main(String[] args) {} }\n",
            "language": "java",
            "file_name": "App.java",
        },
    )
    assert gen.status_code == 200, gen.text
    body = gen.json()
    assert body["cases"] == []
    assert body["mode"] == "unsupported"
    assert "does not support" in body["notice"]


def test_nonexistent_target_and_invalid_case_ids_are_not_passes(client: TestClient):
    code = "def add(a: int, b: int):\n    return a + b\n"
    gen = client.post(
        "/api/performance/tests/generate",
        json={"code": code, "language": "python", "function_name": "test"},
    )
    assert gen.status_code == 200, gen.text
    case = gen.json()["cases"][0]
    assert case["generation_defect"] == "target_not_found"

    unknown = client.post(
        "/api/performance/tests/run",
        json={"code": code, "language": "python", "cases": [case], "case_ids": [999]},
    )
    assert unknown.status_code == 422

    duplicate = client.post(
        "/api/performance/tests/run",
        json={"code": code, "language": "python", "cases": [case, case]},
    )
    assert duplicate.status_code == 422
