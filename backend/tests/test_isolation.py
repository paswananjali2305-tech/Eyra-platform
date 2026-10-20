"""Two users cannot read each other's runtime history or audit gateway."""
import os
from pathlib import Path

from fastapi.testclient import TestClient

TEST_DB = Path(__file__).resolve().parent / "test_eyra_isolation.sqlite"
os.environ["EYRA_DB_PATH"] = str(TEST_DB)
os.environ["EYRA_SKIP_AUDIT_ENGINE"] = "1"
os.environ["EYRA_ALLOW_LOCAL_FALLBACK"] = "true"
os.environ["GROQ_API_KEY"] = ""

from app.database import init_db  # noqa: E402
from app.main import app  # noqa: E402
from tests.conftest import use_test_db  # noqa: E402


def _register(client, email, username):
    response = client.post(
        "/api/auth/register",
        json={"email": email, "username": username, "password": "test-pass-1"},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_users_cannot_read_each_others_history():
    use_test_db(TEST_DB)
    if TEST_DB.exists():
        TEST_DB.unlink()
    init_db()
    with TestClient(app) as client:
        token_a = _register(client, "a@example.com", "user_a")
        token_b = _register(client, "b@example.com", "user_b")
        analyzed = client.post(
            "/api/analyze",
            headers={"Authorization": f"Bearer {token_a}"},
            json={
                "file_name": "test.py",
                "language": "python",
                "project_name": "default",
                "code_snippet": "print(1/0)\n",
                "terminal_output": "ZeroDivisionError: division by zero",
                "stack_trace": "ZeroDivisionError: division by zero",
            },
        )
        assert analyzed.status_code == 200, analyzed.text
        session_id = analyzed.json()["session_id"]

        hist_a = client.get("/api/history", headers={"Authorization": f"Bearer {token_a}"})
        hist_b = client.get("/api/history", headers={"Authorization": f"Bearer {token_b}"})
        mem_b = client.get("/api/memory", headers={"Authorization": f"Bearer {token_b}"})
        assert hist_a.status_code == 200
        assert any(item["session_id"] == session_id for item in hist_a.json()["items"])
        assert hist_b.json()["total"] == 0
        assert mem_b.json()["total"] == 0
        foreign = client.get(
            f"/api/history/{session_id}",
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert foreign.status_code == 404
        assert "code_snippet" not in foreign.json()
        assert "print(1/0)" not in foreign.text


def test_audit_gateway_requires_authentication():
    use_test_db(TEST_DB)
    init_db()
    with TestClient(app) as client:
        denied = client.get("/api/audit/scans")
        assert denied.status_code == 401
        cleared = client.delete("/api/audit/scans")
        assert cleared.status_code == 401
