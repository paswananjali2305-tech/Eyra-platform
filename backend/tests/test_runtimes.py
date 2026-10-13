"""Multilingual /api/execute + /api/runtimes — real host execution (no mocks)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(__file__).resolve().parent / "test_eyra_runtimes.sqlite"
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["EYRA_DB_PATH"] = str(TEST_DB)
os.environ["EYRA_ALLOW_LOCAL_FALLBACK"] = "true"
os.environ["GROQ_API_KEY"] = ""
os.environ["EYRA_EXEC_TIMEOUT_S"] = "15"

from app.main import app  # noqa: E402
from app.database import init_db  # noqa: E402
from app.runtimes.base import which  # noqa: E402
from app.runtimes.registry import execute_snippet  # noqa: E402


@pytest.fixture()
def client():
    init_db()
    with TestClient(app) as c:
        yield c


def test_runtimes_list(client: TestClient):
    r = client.get("/api/runtimes")
    assert r.status_code == 200, r.text
    body = r.json()
    langs = {item["language"]: item for item in body["runtimes"]}
    assert "python" in langs
    assert langs["python"]["available"] is True
    assert langs["python"]["executable"] is True
    # Catalog-only languages stay honest (no execute adapter)
    assert langs["html"]["available"] is False
    assert langs["html"]["executable"] is False


def test_execute_python_success(client: TestClient):
    r = client.post(
        "/api/execute",
        json={
            "code": "print('eyra-ok')\n",
            "language": "python",
            "file_name": "hello.py",
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["exit_code"] == 0
    assert data["status"] == "SUCCESS"
    assert "eyra-ok" in data["stdout"]
    assert data["language"] == "python"
    assert data["runtime_available"] is True


def test_execute_python_runtime_error(client: TestClient):
    r = client.post(
        "/api/execute",
        json={
            "code": "print(1 / 0)\n",
            "language": "python",
            "file_name": "boom.py",
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is False
    assert data["exit_code"] != 0
    assert data["status"] == "RUNTIME_ERROR"
    assert "ZeroDivisionError" in (data["stderr"] or "")
    assert data["error_type"] == "ZeroDivisionError"
    assert data["stack_trace"]


def test_execute_python_timeout():
    # Direct adapter call with a short limit — avoids multi-second API waits
    result = execute_snippet(
        code="import time\ntime.sleep(30)\n",
        language="python",
        file_name="slow.py",
        timeout_s=0.5,
    )
    assert result.ok is False
    assert result.status == "TIMEOUT"
    assert result.timed_out is True
    assert result.exit_code == 124


def test_execute_unavailable_language(client: TestClient):
    r = client.post(
        "/api/execute",
        json={
            "code": "<h1>hello</h1>",
            "language": "html",
            "file_name": "index.html",
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is False
    assert data["status"] == "RUNTIME_UNAVAILABLE"
    assert data["runtime_available"] is False
    assert data["exit_code"] == 127
    assert data["error_type"] == "RuntimeUnavailable"


@pytest.mark.skipif(not which("node"), reason="node not on PATH")
def test_execute_javascript_success(client: TestClient):
    r = client.post(
        "/api/execute",
        json={
            "code": "console.log('eyra-js')\n",
            "language": "javascript",
            "file_name": "hello.js",
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["status"] == "SUCCESS"
    assert "eyra-js" in data["stdout"]
    assert data["language"] == "javascript"


@pytest.mark.skipif(not which("node"), reason="node not on PATH")
def test_execute_javascript_error(client: TestClient):
    r = client.post(
        "/api/execute",
        json={
            "code": "throw new Error('boom')\n",
            "language": "js",
            "file_name": "fail.js",
        },
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is False
    assert data["status"] in {"RUNTIME_ERROR", "COMPILE_ERROR"}
    assert "boom" in (data["stderr"] or "") or "Error" in (data["stderr"] or "")
