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
from tests.conftest import use_test_db
from app.runtimes.base import which  # noqa: E402
from app.runtimes.registry import execute_snippet  # noqa: E402


@pytest.fixture()
def client():
    use_test_db(TEST_DB)
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


def test_react_language_ids_resolve_to_brain_adapters():
    from app.runtimes.registry import get_adapter, normalize_language_id

    assert normalize_language_id("typescriptreact") == "typescript"
    assert normalize_language_id("javascriptreact") == "javascript"
    ts = get_adapter("typescriptreact")
    js = get_adapter("javascriptreact")
    assert ts is not None and ts.language_id == "typescript"
    assert js is not None and js.language_id == "javascript"
    # Existing aliases unchanged
    assert normalize_language_id("py") == "python"
    assert normalize_language_id("c++") == "cpp"
    assert normalize_language_id("golang") == "go"


@pytest.mark.skipif(not (which("tsx") or which("ts-node")), reason="tsx/ts-node not on PATH")
def test_execute_typescript_react_id_success():
    result = execute_snippet(
        code="const n: number = 40 + 2;\nconsole.log('eyra-ts-' + n);\n",
        language="typescriptreact",
        file_name="main.tsx",
        timeout_s=30,
    )
    assert result.ok is True
    assert result.exit_code == 0
    assert result.language == "typescript"
    assert "eyra-ts-42" in result.stdout


@pytest.mark.skipif(
    which("tsx") or which("ts-node") or not which("npx"),
    reason="needs the npx-tsc fallback path (no tsx/ts-node, npx present)",
)
def test_execute_typescript_via_npx_tsc_fallback():
    result = execute_snippet(
        code="const n: number = 40 + 2;\nconsole.log('eyra-tsx-' + n);\n",
        language="typescriptreact",
        file_name="ee.tsx",
        timeout_s=60,
    )
    assert result.ok is True
    assert result.exit_code == 0
    assert result.language == "typescript"
    assert result.runtime == "npx-tsc"
    assert "eyra-tsx-42" in result.stdout


@pytest.mark.skipif(not (which("tsx") or which("ts-node")), reason="tsx/ts-node not on PATH")
def test_execute_typescript_error_classification():
    result = execute_snippet(
        code="throw new Error('ts-boom');\n",
        language="typescript",
        file_name="fail.ts",
        timeout_s=30,
    )
    assert result.ok is False
    assert result.exit_code != 0
    assert result.status in {"RUNTIME_ERROR", "COMPILE_ERROR"}
    assert "ts-boom" in (result.stderr or "")


@pytest.mark.skipif(not which("javac"), reason="javac not on PATH")
def test_execute_java_success_and_compile_error():
    ok = execute_snippet(
        code='public class Main { public static void main(String[] args) { System.out.println("eyra-java"); } }\n',
        language="java",
        file_name="Main.java",
        timeout_s=60,
    )
    assert ok.ok is True
    assert ok.exit_code == 0
    assert "eyra-java" in ok.stdout

    bad = execute_snippet(
        code="public class Main { public static void main(String[] args) { broken!! } }\n",
        language="java",
        file_name="Main.java",
        timeout_s=60,
    )
    assert bad.ok is False
    assert bad.status == "COMPILE_ERROR"
    assert bad.error_type == "CompileError"


@pytest.mark.skipif(not (which("gcc") or which("clang") or which("cc")), reason="C compiler not on PATH")
def test_execute_c_success():
    result = execute_snippet(
        code='#include <stdio.h>\nint main(void) { printf("eyra-c\\n"); return 0; }\n',
        language="c",
        file_name="main.c",
        timeout_s=60,
    )
    assert result.ok is True
    assert result.exit_code == 0
    assert "eyra-c" in result.stdout


@pytest.mark.skipif(
    not (which("g++") or which("clang++") or which("c++")), reason="C++ compiler not on PATH"
)
def test_execute_cpp_success():
    result = execute_snippet(
        code='#include <iostream>\nint main() { std::cout << "eyra-cpp" << std::endl; return 0; }\n',
        language="cpp",
        file_name="main.cpp",
        timeout_s=60,
    )
    assert result.ok is True
    assert result.exit_code == 0
    assert "eyra-cpp" in result.stdout


@pytest.mark.skipif(not which("go"), reason="go toolchain not on PATH")
def test_execute_go_success():
    result = execute_snippet(
        code='package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("eyra-go") }\n',
        language="go",
        file_name="main.go",
        timeout_s=60,
    )
    assert result.ok is True
    assert result.exit_code == 0
    assert "eyra-go" in result.stdout


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
