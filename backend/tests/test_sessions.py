"""Session rows survive restart and are not deleted because of a filename."""
import json
import os
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

TEST_DB = Path(__file__).resolve().parent / "test_eyra_sessions.sqlite"
os.environ["EYRA_DB_PATH"] = str(TEST_DB)
os.environ["EYRA_SKIP_AUDIT_ENGINE"] = "1"
os.environ["EYRA_ALLOW_LOCAL_FALLBACK"] = "true"
os.environ["GROQ_API_KEY"] = ""

from app.database import init_db, list_sessions  # noqa: E402
from app.main import app  # noqa: E402
from tests.conftest import use_test_db  # noqa: E402

PAYLOAD = {
    "language": "python",
    "code_snippet": "print(1)\n",
    "terminal_output": "1",
    "stack_trace": "",
}


def _client():
    use_test_db(TEST_DB)
    if TEST_DB.exists():
        TEST_DB.unlink()
    init_db()
    client = TestClient(app)
    client.__enter__()
    created = client.post(
        "/api/auth/register",
        json={"email": "sess@example.com", "username": "sessuser", "password": "test-pass-1"},
    )
    assert created.status_code == 200, created.text
    client.headers["Authorization"] = f"Bearer {created.json()['access_token']}"
    return client, created.json()["user"]["id"]


def _analyze(client, file_name, project_name):
    body = {**PAYLOAD, "file_name": file_name, "project_name": project_name}
    response = client.post("/api/analyze", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_common_filenames_survive_restart():
    client, user_id = _client()
    try:
        names = [
            ("test.py", "default"),
            ("demo.py", "default"),
            ("snippet.py", "default"),
            ("t.py", "other-project"),
            ("untitled-1.py", "default"),
            ("test.py", "billing"),
        ]
        saved = [_analyze(client, name, project) for name, project in names]
        init_db()
        history = client.get("/api/history")
        assert history.status_code == 200
        body = history.json()
        assert "items" in body and "total" in body
        got = {(item["file_name"], item["project_name"]) for item in body["items"]}
        for name, project in names:
            assert (name, project) in got
        assert body["total"] == len(names)
        detail = client.get(f"/api/history/{saved[0]['session_id']}")
        assert detail.status_code == 200
        assert detail.json()["file_name"] == "test.py"
        _, again = list_sessions(user_id=user_id, limit=20)
        assert len(again) == len(names)
    finally:
        client.__exit__(None, None, None)


def test_legacy_row_without_session_kind_stays_readable():
    use_test_db(TEST_DB)
    if TEST_DB.exists():
        TEST_DB.unlink()
    conn = sqlite3.connect(TEST_DB)
    conn.execute(
        """
        CREATE TABLE sessions (
            session_id TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            language TEXT NOT NULL,
            code_snippet TEXT NOT NULL,
            terminal_output TEXT NOT NULL,
            stack_trace TEXT NOT NULL,
            error_type TEXT NOT NULL,
            error_summary TEXT NOT NULL,
            root_cause TEXT NOT NULL,
            explanation TEXT NOT NULL,
            evidence_json TEXT NOT NULL,
            timeline_json TEXT NOT NULL,
            correction_json TEXT NOT NULL,
            verification_json TEXT NOT NULL,
            related_json TEXT NOT NULL,
            reasoning_source TEXT NOT NULL,
            reasoning_note TEXT NOT NULL,
            status TEXT NOT NULL,
            project_name TEXT NOT NULL,
            confidence REAL,
            created_at TEXT NOT NULL,
            user_id TEXT
        )
        """
    )
    conn.execute(
        """
        INSERT INTO sessions VALUES (
            'EYRA-LEGACY', 'test.py', 'python', 'print(1)', '', '',
            'RuntimeNote', 'summary', 'cause', 'explain',
            '[]', '[]',
            ?, ?,
            '[]', 'local_heuristic', 'note', 'needs_review',
            'default', 0.5, '2026-01-01T00:00:00+00:00', 'legacy-user'
        )
        """,
        (
            json.dumps(
                {
                    "summary": "s",
                    "corrected_code": "print(1)",
                    "apply_mode": "review_and_copy",
                }
            ),
            json.dumps(
                {
                    "status": "not_run",
                    "method": "none",
                    "detail": "n/a",
                    "is_hypothesis_only": True,
                }
            ),
        ),
    )
    conn.commit()
    conn.close()

    init_db()
    init_db()
    total, items = list_sessions(user_id="legacy-user", limit=10)
    assert total == 1
    assert items[0].file_name == "test.py"
    assert items[0].project_name == "default"


def test_internal_test_mark_is_hidden_filename_is_not():
    client, user_id = _client()
    try:
        saved = _analyze(client, "test.py", "default")
        conn = sqlite3.connect(TEST_DB)
        conn.execute(
            "UPDATE sessions SET session_kind = 'internal_test' WHERE session_id = ?",
            (saved["session_id"],),
        )
        conn.commit()
        conn.close()
        history = client.get("/api/history").json()
        assert all(item["session_id"] != saved["session_id"] for item in history["items"])
        missing = client.get(f"/api/history/{saved['session_id']}")
        assert missing.status_code == 404
        visible = _analyze(client, "notes.py", "default")
        again = client.get("/api/history").json()
        assert any(item["session_id"] == visible["session_id"] for item in again["items"])
    finally:
        client.__exit__(None, None, None)
