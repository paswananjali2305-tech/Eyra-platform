import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Isolate test DB before app import side effects
TEST_DB = Path(__file__).resolve().parent / "test_eyra.sqlite"
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["EYRA_DB_PATH"] = str(TEST_DB)
os.environ["EYRA_ALLOW_LOCAL_FALLBACK"] = "true"
os.environ["GROQ_API_KEY"] = ""

from tests.conftest import use_test_db
from app.main import app  # noqa: E402
from app.database import init_db  # noqa: E402


@pytest.fixture()
def client():
    use_test_db(TEST_DB)
    if TEST_DB.exists():
        TEST_DB.unlink()
    init_db()
    with TestClient(app) as c:
        created = c.post(
            "/api/auth/register",
            json={
                "email": "analyzer@example.com",
                "username": "analyzer",
                "password": "test-pass-1",
            },
        )
        assert created.status_code == 200, created.text
        c.headers["Authorization"] = f"Bearer {created.json()['access_token']}"
        yield c


def test_health(client: TestClient):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_zero_division_analyze_and_history(client: TestClient):
    payload = {
        "file_name": "test.py",
        "language": "python",
        "code_snippet": "a = 10\nb = 0\nprint(a / b)\n",
        "terminal_output": "ZeroDivisionError: division by zero",
        "stack_trace": (
            'Traceback (most recent call last):\n'
            '  File "test.py", line 3, in <module>\n'
            "    print(a / b)\n"
            "ZeroDivisionError: division by zero"
        ),
    }
    r = client.post("/api/analyze", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["error_type"] == "ZeroDivisionError"
    assert "zero" in data["root_cause"].lower()
    assert data["reasoning_source"] == "local_heuristic"
    assert "LOCAL" in data["reasoning_note"].upper() or "local" in data["reasoning_note"].lower()
    assert data["suggested_correction"]["apply_mode"] == "review_and_copy"
    session_id = data["session_id"]

    hist = client.get("/api/history")
    assert hist.status_code == 200
    body = hist.json()
    assert body["total"] >= 1
    assert any(i["session_id"] == session_id for i in body["items"])

    detail = client.get(f"/api/history/{session_id}")
    assert detail.status_code == 200
    assert detail.json()["session_id"] == session_id
    assert detail.json()["file_name"] == "test.py"
    assert "session_id" in detail.json()
    assert "status" in detail.json()
    assert "suggested_correction" in detail.json()


def test_missing_token_is_unauthorized():
    use_test_db(TEST_DB)
    if TEST_DB.exists():
        TEST_DB.unlink()
    init_db()
    with TestClient(app) as c:
        denied = c.post(
            "/api/analyze",
            json={
                "file_name": "test.py",
                "language": "python",
                "code_snippet": "print(1)\n",
                "terminal_output": "ok",
            },
        )
        assert denied.status_code == 401
        history = c.get("/api/history")
        assert history.status_code == 401


def test_invalid_empty_code(client: TestClient):
    r = client.post(
        "/api/analyze",
        json={
            "file_name": "test.py",
            "language": "python",
            "code_snippet": "",
        },
    )
    assert r.status_code == 422


def test_config_engine_toggles_roundtrip(client: TestClient):
    got = client.get("/api/config")
    assert got.status_code == 200
    body = got.json()
    assert body["engine_ast"] is True
    assert body["engine_security"] is True
    assert body["engine_todos"] is True
    assert body["engine_deps"] is True

    saved = client.put(
        "/api/config",
        json={
            "engine_ast": True,
            "engine_security": False,
            "engine_todos": True,
            "engine_deps": False,
        },
    )
    assert saved.status_code == 200, saved.text
    data = saved.json()
    assert data["engine_ast"] is True
    assert data["engine_security"] is False
    assert data["engine_todos"] is True
    assert data["engine_deps"] is False

    again = client.get("/api/config").json()
    assert again["engine_security"] is False
    assert again["engine_deps"] is False
