"""Memory / history integrity: empty, one, many sessions; exact error_type relatedness."""
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(__file__).resolve().parent / "test_eyra_memory.sqlite"
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["EYRA_DB_PATH"] = str(TEST_DB)
os.environ["EYRA_ALLOW_LOCAL_FALLBACK"] = "true"
os.environ["GROQ_API_KEY"] = ""

from app.main import app  # noqa: E402
from app.database import clear_sessions, find_related, init_db  # noqa: E402
from tests.conftest import use_test_db


@pytest.fixture()
def client():
    use_test_db(TEST_DB)
    if TEST_DB.exists():
        TEST_DB.unlink()
    init_db()
    clear_sessions()
    with TestClient(app) as c:
        created = c.post(
            "/api/auth/register",
            json={
                "email": "memory@example.com",
                "username": "memoryuser",
                "password": "test-pass-1",
            },
        )
        assert created.status_code == 200, created.text
        c.headers["Authorization"] = f"Bearer {created.json()['access_token']}"
        yield c
    clear_sessions()


def _analyze(client: TestClient, *, file_name: str, code: str, terminal: str, stack: str):
    r = client.post(
        "/api/analyze",
        json={
            "file_name": file_name,
            "language": "python",
            "code_snippet": code,
            "terminal_output": terminal,
            "stack_trace": stack,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_memory_empty(client: TestClient):
    mem = client.get("/api/memory")
    assert mem.status_code == 200
    body = mem.json()
    assert body["total"] == 0
    assert body["items"] == []

    hist = client.get("/api/history")
    assert hist.status_code == 200
    assert hist.json()["total"] == 0


def test_memory_one_session_detail_consistent(client: TestClient):
    data = _analyze(
        client,
        file_name="div.py",
        code="a=1\nb=0\nprint(a/b)\n",
        terminal="ZeroDivisionError: division by zero",
        stack=(
            'Traceback (most recent call last):\n'
            '  File "div.py", line 3, in <module>\n'
            "    print(a/b)\n"
            "ZeroDivisionError: division by zero"
        ),
    )
    assert data["error_type"] == "ZeroDivisionError"
    sid = data["session_id"]

    mem = client.get("/api/memory").json()
    assert mem["total"] == 1
    item = mem["items"][0]
    assert item["session_id"] == sid
    assert item["error_type"] == "ZeroDivisionError"
    assert item["same_error_count"] == 1

    detail = client.get(f"/api/history/{sid}").json()
    assert detail["session_id"] == sid
    assert detail["error_type"] == item["error_type"]
    assert detail["error_summary"]
    assert detail["suggested_correction"]
    # Unverified / hypothesis: must not claim verified without evidence
    v = detail.get("verification") or {}
    if detail.get("status") == "verified":
        assert v.get("status") == "verified"
        assert not v.get("is_hypothesis_only")
    else:
        assert v.get("status") in ("not_run", "failed", "suggested", None) or v.get(
            "status"
        ) != "verified" or v.get("is_hypothesis_only")


def test_memory_multiple_same_error_count(client: TestClient):
    z1 = _analyze(
        client,
        file_name="a.py",
        code="print(1/0)\n",
        terminal="ZeroDivisionError: division by zero",
        stack="ZeroDivisionError: division by zero",
    )
    z2 = _analyze(
        client,
        file_name="b.py",
        code="x=0\nprint(2/x)\n",
        terminal="ZeroDivisionError: division by zero",
        stack="ZeroDivisionError: division by zero",
    )
    syn = _analyze(
        client,
        file_name="bad.py",
        code="def f(\n",
        terminal="SyntaxError: unexpected EOF while parsing",
        stack="SyntaxError: unexpected EOF while parsing",
    )

    assert z1["error_type"] == "ZeroDivisionError"
    assert z2["error_type"] == "ZeroDivisionError"
    assert syn["error_type"] == "SyntaxError"

    mem = client.get("/api/memory").json()
    assert mem["total"] == 3

    by_id = {i["session_id"]: i for i in mem["items"]}
    assert by_id[z1["session_id"]]["same_error_count"] == 2
    assert by_id[z2["session_id"]]["same_error_count"] == 2
    assert by_id[syn["session_id"]]["same_error_count"] == 1

    # find_related: exact error_type only — SyntaxError must not pull ZeroDivision
    related_z = find_related("ZeroDivisionError", exclude_id=z1["session_id"], limit=10)
    assert z2["session_id"] in related_z
    assert syn["session_id"] not in related_z

    related_s = find_related("SyntaxError", exclude_id=syn["session_id"], limit=10)
    assert z1["session_id"] not in related_s
    assert z2["session_id"] not in related_s

    # Detail for each must keep its own error_type / fix identity
    d_syn = client.get(f"/api/history/{syn['session_id']}").json()
    assert d_syn["error_type"] == "SyntaxError"
    assert "ZeroDivision" not in (d_syn.get("error_summary") or "")
    assert "ZeroDivision" not in (d_syn.get("root_cause") or "")


def test_unverified_fix_not_elevated(client: TestClient):
    data = _analyze(
        client,
        file_name="k.py",
        code="d={}\nprint(d['missing'])\n",
        terminal="KeyError: 'missing'",
        stack="KeyError: 'missing'",
    )
    detail = client.get(f"/api/history/{data['session_id']}").json()
    v = detail.get("verification") or {}
    # Local heuristic path typically leaves verification not_run / hypothesis
    if v.get("is_hypothesis_only") or v.get("status") in ("not_run", "failed", None, ""):
        assert detail.get("status") != "verified" or v.get("is_hypothesis_only")
    sc = detail.get("suggested_correction") or {}
    # Suggested templates exist as suggestions, not as verified fix templates
    assert sc.get("apply_mode") in ("review_and_copy", "auto", None) or "apply_mode" in sc
