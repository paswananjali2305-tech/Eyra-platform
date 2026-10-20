"""Authenticated runs are averaged for the overview card."""

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(__file__).resolve().parent / "test_eyra_exec_time.sqlite"
os.environ["EYRA_DB_PATH"] = str(TEST_DB)
os.environ["EYRA_ALLOW_LOCAL_FALLBACK"] = "true"
os.environ["GROQ_API_KEY"] = ""

from tests.conftest import use_test_db
from app.database import init_db
from app.main import app


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
                "email": "timing@example.com",
                "username": "timinguser",
                "password": "test-pass-1",
            },
        )
        assert created.status_code == 200, created.text
        c.headers["Authorization"] = f"Bearer {created.json()['access_token']}"
        yield c


def test_execute_average_is_reported_for_the_signed_in_user(client: TestClient):
    before = client.get("/api/status")
    assert before.status_code == 200
    assert before.json()["avg_execution_ms"] is None
    assert before.json()["execution_count"] == 0

    for _ in range(2):
        ran = client.post(
            "/api/execute",
            json={"code": "print(1)\n", "language": "python", "file_name": "t.py"},
        )
        assert ran.status_code == 200, ran.text
        body = ran.json()
        assert body["runtime_available"] is True
        assert isinstance(body["duration_ms"], int)

    status = client.get("/api/status").json()
    assert status["execution_count"] == 2
    assert isinstance(status["avg_execution_ms"], int)
    assert status["avg_execution_ms"] >= 0

    bare = TestClient(app)
    anonymous = bare.get("/api/status")
    assert anonymous.status_code == 200
    assert anonymous.json()["avg_execution_ms"] is None
    assert anonymous.json()["execution_count"] == 0
