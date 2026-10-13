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

FIB = """
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)
"""


@pytest.fixture()
def client():
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
