import os
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

TEST_DB = Path(__file__).resolve().parent / "test_extension_launch.sqlite"
os.environ["EYRA_DB_PATH"] = str(TEST_DB)
os.environ["EYRA_ALLOW_LOCAL_FALLBACK"] = "true"
os.environ["EYRA_SKIP_AUDIT_ENGINE"] = "1"
os.environ["GROQ_API_KEY"] = ""

from tests.conftest import use_test_db
from app.extension_launch import (
    EYRA_EXTENSION_ID,
    build_open_uri,
    extension_root,
    extension_status,
    open_local_extension,
    OpenExtensionResult,
)
from app.main import app  # noqa: E402
from app.database import init_db  # noqa: E402


def _client() -> TestClient:
    use_test_db(TEST_DB)
    if TEST_DB.exists():
        TEST_DB.unlink()
    init_db()
    return TestClient(app)


def test_build_open_uri_has_no_secrets():
    assert build_open_uri("vscode") == f"vscode://{EYRA_EXTENSION_ID}/open"
    assert build_open_uri("cursor") == f"cursor://{EYRA_EXTENSION_ID}/open"
    assert "token" not in build_open_uri("vscode")
    assert "code" not in build_open_uri("cursor")


def test_extension_status_reports_unpublished():
    status = extension_status("vscode")
    assert status["extension_id"] == EYRA_EXTENSION_ID
    assert status["marketplace_published"] is False
    assert status["target_editor"] == "vscode"
    assert Path(status["extension_root"]) == extension_root()
    assert "vscode" in status["open_uris"]


def test_api_extension_status():
    client = _client()
    res = client.get("/api/extension/status")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["extension_id"] == EYRA_EXTENSION_ID
    assert body["marketplace_published"] is False
    assert body["target_editor"] == "vscode"


def test_api_extension_open_uses_local_installer(monkeypatch):
    client = _client()

    def fake_open(preference: str = "vscode") -> OpenExtensionResult:
        assert preference in ("auto", "cursor", "vscode")
        return OpenExtensionResult(
            ok=True,
            editor="vscode",
            extension_id=EYRA_EXTENSION_ID,
            uri=None,  # never return Marketplace deep links from Open Extension
            vsix_path=str(extension_root() / "dist" / "eyra-runtime-debugger-0.5.4.vsix"),
            installed=True,
            opened=True,
            mode="vsix",
            message="Installed EYRA into VS Code and opened the editor.",
        )

    with patch("app.main.open_local_extension", side_effect=fake_open):
        res = client.post("/api/extension/open", json={"editor": "vscode"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["mode"] == "vsix"
    assert body["installed"] is True
    assert body["editor"] == "vscode"
    assert body["uri"] is None


def test_open_local_extension_reports_missing_editor():
    with patch("app.extension_launch.pick_editor", return_value=None):
        result = open_local_extension("vscode")
    assert result.ok is False
    assert result.mode == "none"
    assert "vs code" in result.message.lower()


def test_pick_editor_auto_prefers_vscode():
    from app.extension_launch import EditorBinary, pick_editor

    vscode = EditorBinary(kind="vscode", path=Path("C:/fake/Code.exe"))
    cursor = EditorBinary(kind="cursor", path=Path("C:/fake/Cursor.exe"))
    with patch("app.extension_launch.discover_editors", return_value=[cursor, vscode]):
        picked = pick_editor("auto")
    assert picked is not None
    assert picked.kind == "vscode"
