"""Phase 9: VS Code diagnostics on /api/analyze — validation, provenance, compatibility."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(__file__).resolve().parent / "test_eyra_diagnostics.sqlite"
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["EYRA_DB_PATH"] = str(TEST_DB)
os.environ["EYRA_ALLOW_LOCAL_FALLBACK"] = "true"
os.environ["GROQ_API_KEY"] = ""

# Load local conftest by path so a foreign `tests` package on PYTHONPATH cannot shadow it.
import importlib.util  # noqa: E402

_conf_path = Path(__file__).resolve().parent / "conftest.py"
_spec = importlib.util.spec_from_file_location("eyra_backend_conftest", _conf_path)
assert _spec and _spec.loader
_conf = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_conf)
use_test_db = _conf.use_test_db

from app.main import app  # noqa: E402
from app.database import init_db  # noqa: E402
from app.schemas import AnalyzeRequest, DiagnosticItem, EvidenceItem  # noqa: E402
from app.agent.diagnostics_evidence import (  # noqa: E402
    VSCODE_DIAGNOSTIC_KIND,
    evidence_from_diagnostics,
    merge_diagnostic_evidence,
)


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
                "email": "diag@example.com",
                "username": "diaguser",
                "password": "test-pass-1",
            },
        )
        assert created.status_code == 200, created.text
        c.headers["Authorization"] = f"Bearer {created.json()['access_token']}"
        yield c


def _base_payload(**extra):
    body = {
        "file_name": "app.py",
        "language": "python",
        "code_snippet": "x = 1\nprint(x)\n",
        "terminal_output": "",
        "stack_trace": "",
    }
    body.update(extra)
    return body


def test_analyze_without_diagnostics_still_works(client: TestClient):
    r = client.post("/api/analyze", json=_base_payload(
        terminal_output="ZeroDivisionError: division by zero",
        code_snippet="a = 10\nb = 0\nprint(a / b)\n",
    ))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["error_type"] == "ZeroDivisionError"
    assert not any(e["kind"] == VSCODE_DIAGNOSTIC_KIND for e in data["evidence"])


def test_analyze_with_diagnostics_adds_provenance(client: TestClient):
    r = client.post(
        "/api/analyze",
        json=_base_payload(
            diagnostics=[
                {
                    "message": "Undefined name 'y'",
                    "severity": "error",
                    "file_name": "app.py",
                    "line": 1,
                    "character": 6,
                    "source": "pyflakes",
                    "code": "F821",
                },
                {
                    "message": "unused import",
                    "severity": "warning",
                    "file_name": "app.py",
                    "line": 0,
                    "character": 0,
                    "source": "pyflakes",
                },
            ],
        ),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    vscode_items = [e for e in data["evidence"] if e["kind"] == VSCODE_DIAGNOSTIC_KIND]
    assert len(vscode_items) == 2
    assert vscode_items[0]["location"] == "app.py:2"  # 0-based line 1 → display 2
    assert "VS Code error" in vscode_items[0]["detail"]
    assert "Undefined name 'y'" in vscode_items[0]["detail"]
    assert data["verification"]["is_hypothesis_only"] is True
    assert "not verification" in data["verification"]["detail"].lower() or data["verification"]["status"] in {
        "not_run",
        "unverified",
        "failed",
    }


def test_malformed_diagnostics_rejected(client: TestClient):
    bad_severity = client.post(
        "/api/analyze",
        json=_base_payload(
            diagnostics=[
                {
                    "message": "x",
                    "severity": "critical",
                    "file_name": "app.py",
                    "line": 0,
                    "character": 0,
                }
            ],
        ),
    )
    assert bad_severity.status_code == 422

    negative_line = client.post(
        "/api/analyze",
        json=_base_payload(
            diagnostics=[
                {
                    "message": "x",
                    "severity": "error",
                    "file_name": "app.py",
                    "line": -1,
                    "character": 0,
                }
            ],
        ),
    )
    assert negative_line.status_code == 422

    empty_message = client.post(
        "/api/analyze",
        json=_base_payload(
            diagnostics=[
                {
                    "message": "",
                    "severity": "error",
                    "file_name": "app.py",
                    "line": 0,
                    "character": 0,
                }
            ],
        ),
    )
    assert empty_message.status_code == 422


def test_diagnostics_cap_enforced(client: TestClient):
    too_many = [
        {
            "message": f"m{i}",
            "severity": "warning",
            "file_name": "app.py",
            "line": i,
            "character": 0,
        }
        for i in range(51)
    ]
    r = client.post("/api/analyze", json=_base_payload(diagnostics=too_many))
    assert r.status_code == 422


def test_file_name_basename_only():
    item = DiagnosticItem(
        message="oops",
        severity="error",
        file_name=r"C:\Users\secret\project\app.py",
        line=0,
        character=0,
    )
    assert item.file_name == "app.py"


def test_merge_drops_invented_vscode_diagnostics():
    req = AnalyzeRequest(
        file_name="app.py",
        language="python",
        code_snippet="print(1)\n",
        diagnostics=[
            DiagnosticItem(
                message="real",
                severity="error",
                file_name="app.py",
                line=0,
                character=0,
            )
        ],
    )
    client_ev = evidence_from_diagnostics(req)
    draft_ev = [
        EvidenceItem(
            kind=VSCODE_DIAGNOSTIC_KIND,
            detail="[VS Code error] invented",
            location="app.py:99",
        ),
        EvidenceItem(kind="source", detail="from heuristic", location="app.py:1"),
    ]
    merged = merge_diagnostic_evidence(client_ev, draft_ev)
    kinds_locs = [(e.kind, e.location) for e in merged]
    assert (VSCODE_DIAGNOSTIC_KIND, "app.py:1") in kinds_locs
    assert (VSCODE_DIAGNOSTIC_KIND, "app.py:99") not in kinds_locs
    assert ("source", "app.py:1") in kinds_locs


def test_empty_diagnostics_list_ok(client: TestClient):
    r = client.post("/api/analyze", json=_base_payload(diagnostics=[]))
    assert r.status_code == 200, r.text
    assert not any(e["kind"] == VSCODE_DIAGNOSTIC_KIND for e in r.json()["evidence"])


def test_unauthorized_still_blocked():
    use_test_db(TEST_DB)
    if TEST_DB.exists():
        TEST_DB.unlink()
    init_db()
    with TestClient(app) as c:
        denied = c.post(
            "/api/analyze",
            json=_base_payload(
                diagnostics=[
                    {
                        "message": "x",
                        "severity": "error",
                        "file_name": "app.py",
                        "line": 0,
                        "character": 0,
                    }
                ],
            ),
        )
        assert denied.status_code == 401
