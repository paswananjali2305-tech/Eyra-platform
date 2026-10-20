import hashlib
import os
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

TEST_DB = Path(__file__).resolve().parent / "test_extension_connect_import.sqlite"
os.environ["EYRA_DB_PATH"] = str(TEST_DB)
os.environ["EYRA_ALLOW_LOCAL_FALLBACK"] = "true"
os.environ["EYRA_SKIP_AUDIT_ENGINE"] = "1"
os.environ["GROQ_API_KEY"] = ""

from tests.conftest import use_test_db
from app.main import app  # noqa: E402
from app.database import init_db  # noqa: E402


def _client(name: str) -> TestClient:
    global TEST_DB
    TEST_DB = Path(__file__).resolve().parent / f"test_extension_connect_{name}.sqlite"
    use_test_db(TEST_DB)
    if TEST_DB.exists():
        TEST_DB.unlink()
    init_db()
    return TestClient(app)


def _register(client: TestClient, username: str) -> dict:
    created = client.post(
        "/api/auth/register",
        json={
            "email": f"{username}@example.com",
            "username": username,
            "password": "test-pass-1",
        },
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert not body["access_token"].startswith("eyra_ext.")
    return body


def _code(client: TestClient, web_token: str) -> str:
    issued = client.post(
        "/api/auth/extension/code",
        headers={"Authorization": f"Bearer {web_token}"},
    )
    assert issued.status_code == 200, issued.text
    body = issued.json()
    assert body["expires_in"] == 120
    assert "access_token" not in body
    return body["code"]


def _exchange(client: TestClient, code: str, extra: dict | None = None) -> TestClient:
    payload = {"code": code}
    if extra:
        payload.update(extra)
    exchanged = client.post("/api/auth/extension/exchange", json=payload)
    return exchanged


def test_exchange_reuses_same_user_and_keeps_password_login():
    with _client("same-user") as client:
        web = _register(client, "connecta")
        code = _code(client, web["access_token"])
        exchanged = _exchange(client, code, {"user_id": "someone-else"})
        assert exchanged.status_code == 200, exchanged.text
        extension = exchanged.json()
        assert extension["access_token"].startswith("eyra_ext.")
        assert extension["user"]["id"] == web["user"]["id"]
        assert extension["user"]["username"] == "connecta"
        assert extension["access_token"] != web["access_token"]

        me = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {extension['access_token']}"},
        )
        assert me.status_code == 200
        assert me.json()["id"] == web["user"]["id"]

        reused = _exchange(client, code)
        assert reused.status_code == 401
        assert reused.json()["detail"] == "Connect code already used"

        still_web = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {web['access_token']}"},
        )
        assert still_web.status_code == 200

        logged_in = client.post(
            "/api/auth/login",
            json={"login": "connecta", "password": "test-pass-1"},
        )
        assert logged_in.status_code == 200
        assert not logged_in.json()["access_token"].startswith("eyra_ext.")
        assert logged_in.json()["user"]["id"] == web["user"]["id"]


def test_invalid_and_expired_codes():
    with _client("expired") as client:
        web = _register(client, "connectb")
        invalid = _exchange(client, "this-is-not-a-real-connect-code")
        assert invalid.status_code == 401
        assert invalid.json()["detail"] == "Invalid connect code"

        code = _code(client, web["access_token"])
        digest = hashlib.sha256(code.encode("utf-8")).hexdigest()
        with sqlite3.connect(TEST_DB) as db:
            stored = db.execute("SELECT code_hash FROM extension_connect_codes").fetchall()
            assert code not in {row[0] for row in stored}
            db.execute(
                "UPDATE extension_connect_codes SET expires_at = 1 WHERE code_hash = ?",
                (digest,),
            )
        expired = _exchange(client, code)
        assert expired.status_code == 401
        assert expired.json()["detail"] == "Connect code expired"


def test_wrong_user_cannot_read_history_or_revoke_other_credential():
    with _client("wrong-user") as client:
        owner = _register(client, "owneruser")
        other = _register(client, "otheruser")
        owner_code = _code(client, owner["access_token"])
        other_code = _code(client, other["access_token"])
        owner_ext = _exchange(client, owner_code)
        other_ext = _exchange(client, other_code)
        assert owner_ext.status_code == 200
        assert other_ext.status_code == 200
        owner_token = owner_ext.json()["access_token"]
        other_token = other_ext.json()["access_token"]
        assert owner_ext.json()["user"]["id"] != other_ext.json()["user"]["id"]

        analyzed = client.post(
            "/api/analyze",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={
                "file_name": "owner.py",
                "language": "python",
                "code_snippet": "a = 10\nb = 0\nprint(a / b)\n",
                "terminal_output": "ZeroDivisionError: division by zero",
            },
        )
        assert analyzed.status_code == 200, analyzed.text
        session_id = analyzed.json()["session_id"]

        foreign = client.get(
            f"/api/history/{session_id}",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert foreign.status_code == 404
        assert "code_snippet" not in foreign.text

        listed = client.get(
            "/api/history",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert listed.status_code == 200
        assert all(item["session_id"] != session_id for item in listed.json()["items"])

        denied = client.post(
            "/api/auth/extension/disconnect",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert denied.status_code == 200
        owner_still = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        assert owner_still.status_code == 200
        other_gone = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert other_gone.status_code == 401


def test_revoked_extension_credential_does_not_sign_out_web():
    with _client("revoked") as client:
        web = _register(client, "connectc")
        code = _code(client, web["access_token"])
        exchanged = _exchange(client, code)
        assert exchanged.status_code == 200
        extension_token = exchanged.json()["access_token"]

        web_disconnect = client.post(
            "/api/auth/extension/disconnect",
            headers={"Authorization": f"Bearer {web['access_token']}"},
        )
        assert web_disconnect.status_code == 400
        web_me = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {web['access_token']}"},
        )
        assert web_me.status_code == 200

        revoked = client.post(
            "/api/auth/extension/disconnect",
            headers={"Authorization": f"Bearer {extension_token}"},
        )
        assert revoked.status_code == 200
        assert revoked.json()["revoked"] is True
        again = client.post(
            "/api/auth/extension/disconnect",
            headers={"Authorization": f"Bearer {extension_token}"},
        )
        assert again.status_code == 401
        blocked = client.get(
            "/api/history",
            headers={"Authorization": f"Bearer {extension_token}"},
        )
        assert blocked.status_code == 401
        web_me = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {web['access_token']}"},
        )
        assert web_me.status_code == 200

        digest = hashlib.sha256(extension_token.encode("utf-8")).hexdigest()
        with sqlite3.connect(TEST_DB) as db:
            db.execute(
                "UPDATE extension_credentials SET revoked_at = NULL, expires_at = 1 WHERE token_hash = ?",
                (digest,),
            )
        expired = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {extension_token}"},
        )
        assert expired.status_code == 401
