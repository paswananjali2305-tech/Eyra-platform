"""Install and open the local EYRA VS Code/Cursor extension (no Marketplace).

The extension is not published, so vscode://publisher.name/... triggers
"cannot be installed because it was not found". This module packages the
repo's extension/ folder as a VSIX, installs it with the editor CLI, then
opens the registered deep link.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

EYRA_EXTENSION_ID = "eyra-runtime-debugger.eyra-runtime-debugger"
EXTENSION_OPEN_PATH = "/open"

# backend/app → stitch_eyra_runtime_debugger/
_REPO_ROOT = Path(__file__).resolve().parents[2]
_EXTENSION_ROOT = _REPO_ROOT / "extension"
_DIST_DIR = _EXTENSION_ROOT / "dist"


@dataclass(frozen=True)
class EditorBinary:
    kind: str  # cursor | vscode
    path: Path


@dataclass
class OpenExtensionResult:
    ok: bool
    editor: str | None
    extension_id: str
    uri: str | None
    vsix_path: str | None
    installed: bool
    opened: bool
    mode: str  # vsix | development | none
    message: str
    detail: str = ""


def extension_root() -> Path:
    return _EXTENSION_ROOT


def build_open_uri(scheme: str) -> str:
    if scheme not in ("vscode", "cursor"):
        raise ValueError(f"Unsupported scheme: {scheme}")
    return f"{scheme}://{EYRA_EXTENSION_ID}{EXTENSION_OPEN_PATH}"


def _which(name: str) -> Path | None:
    found = shutil.which(name)
    return Path(found) if found else None


def discover_editors() -> list[EditorBinary]:
    """Discover editors. VS Code is the EYRA target; Cursor is optional fallback only."""
    found: list[EditorBinary] = []
    seen: set[str] = set()

    def add(kind: str, path: Path | None) -> None:
        if not path or not path.is_file():
            return
        key = str(path.resolve()).lower()
        if key in seen:
            return
        seen.add(key)
        found.append(EditorBinary(kind=kind, path=path))

    local = os.environ.get("LOCALAPPDATA", "")
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    # VS Code first — that is the supported Open Extension target.
    candidates = [
        ("vscode", _which("code")),
        ("vscode", Path(local) / "Programs" / "Microsoft VS Code" / "Code.exe" if local else None),
        ("vscode", Path(program_files) / "Microsoft VS Code" / "Code.exe"),
        ("cursor", _which("cursor")),
        ("cursor", Path(local) / "Programs" / "cursor" / "Cursor.exe" if local else None),
    ]
    for kind, path in candidates:
        add(kind, path)
    return found


def pick_editor(preference: str = "vscode") -> EditorBinary | None:
    editors = discover_editors()
    if not editors:
        return None
    pref = (preference or "vscode").strip().lower()
    if pref in ("cursor", "vscode"):
        for editor in editors:
            if editor.kind == pref:
                return editor
        return None
    # auto → always prefer VS Code when present
    for editor in editors:
        if editor.kind == "vscode":
            return editor
    return editors[0]


def _run(cmd: list[str], *, cwd: Path | None = None, timeout: float = 180.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        shell=False,
    )


def ensure_compiled(ext_root: Path | None = None) -> None:
    root = ext_root or extension_root()
    main_js = root / "out" / "extension.js"
    if main_js.is_file():
        return
    npm = shutil.which("npm")
    if not npm:
        raise RuntimeError("npm was not found; compile the extension with npm run compile first.")
    result = _run([npm, "run", "compile"], cwd=root, timeout=120.0)
    if result.returncode != 0:
        raise RuntimeError(
            "Extension compile failed.\n"
            + (result.stderr or result.stdout or "npm run compile returned a non-zero exit code.")
        )


def expected_vsix_name(ext_root: Path | None = None) -> str:
    root = ext_root or extension_root()
    import json

    manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    name = manifest["name"]
    version = manifest["version"]
    return f"{name}-{version}.vsix"


def ensure_vsix(ext_root: Path | None = None) -> Path:
    """Compile and package a local VSIX under extension/dist/."""
    root = ext_root or extension_root()
    if not (root / "package.json").is_file():
        raise RuntimeError(f"Extension package.json not found at {root}")
    ensure_compiled(root)
    dist = root / "dist"
    dist.mkdir(parents=True, exist_ok=True)
    vsix = dist / expected_vsix_name(root)
    out_js = root / "out" / "extension.js"
    if vsix.is_file() and out_js.is_file() and vsix.stat().st_mtime >= out_js.stat().st_mtime:
        return vsix

    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("npx was not found; cannot package the local VSIX.")
    # Remove stale packaged files so vsce's output is unambiguous.
    for old in dist.glob("*.vsix"):
        old.unlink(missing_ok=True)
    result = _run(
        [
            npx,
            "--yes",
            "@vscode/vsce@3.2.1",
            "package",
            "--out",
            str(vsix),
            "--allow-missing-repository",
            "--skip-license",
        ],
        cwd=root,
        timeout=240.0,
    )
    if result.returncode != 0 or not vsix.is_file():
        raise RuntimeError(
            "Failed to package the EYRA VSIX.\n"
            + (result.stderr or result.stdout or "vsce package failed.")
        )
    return vsix


def install_vsix(editor: EditorBinary, vsix: Path) -> None:
    result = _run(
        [str(editor.path), "--install-extension", str(vsix.resolve()), "--force"],
        timeout=180.0,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Could not install the local VSIX with {editor.kind}.\n"
            + (result.stderr or result.stdout or "install-extension failed.")
        )
    # Confirm the publisher.name id is present — otherwise VS Code will later
    # treat vscode://… as a Marketplace install and show "was not found".
    listed = _run([str(editor.path), "--list-extensions"], timeout=60.0)
    haystack = (listed.stdout or "").lower()
    if EYRA_EXTENSION_ID.lower() not in haystack and "eyra-runtime-debugger" not in haystack:
        raise RuntimeError(
            "Local VSIX install finished, but EYRA is not in --list-extensions.\n"
            + (listed.stdout or listed.stderr or "")
        )


def _spawn(cmd: list[str]) -> None:
    """Fire-and-forget GUI/editor launch (do not wait on the window)."""
    subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        shell=False,
    )


def open_vscode_with_eyra(editor: EditorBinary, ext_root: Path | None = None) -> None:
    """Open VS Code after a local install — never use vscode:// extension URIs.

    ``--open-url vscode://publisher.name/...`` makes VS Code hit the Marketplace
    when the URI handler is not active yet, producing:
    "The extension '…' cannot be installed because it was not found."
    """
    root = ext_root or extension_root()
    fixture = root / "fixtures" / "phase8"
    args = [
        str(editor.path),
        "--reuse-window",
        "--suppress-popups-on-startup",
    ]
    # Opening a folder wakes the workbench so the EYRA Activity Bar icon is visible.
    if fixture.is_dir():
        args.append(str(fixture))
    try:
        _spawn(args)
    except OSError as exc:
        raise RuntimeError(f"Could not launch VS Code: {exc}") from exc


def launch_extension_development_host(editor: EditorBinary, ext_root: Path | None = None) -> None:
    """Fallback when VSIX packaging is unavailable — same idea as F5, from the Brain."""
    root = ext_root or extension_root()
    ensure_compiled(root)
    fixture = root / "fixtures" / "phase8"
    args = [
        str(editor.path),
        f"--extensionDevelopmentPath={root}",
        "--disable-workspace-trust",
        "--new-window",
        "--suppress-popups-on-startup",
    ]
    if fixture.is_dir():
        args.append(str(fixture))
    try:
        _spawn(args)
    except OSError as exc:
        raise RuntimeError(f"Could not launch Extension Development Host: {exc}") from exc


def open_local_extension(preference: str = "vscode") -> OpenExtensionResult:
    """Install the repo extension into VS Code (or EDH fallback) and open it."""
    editor = pick_editor(preference)
    if not editor:
        return OpenExtensionResult(
            ok=False,
            editor=None,
            extension_id=EYRA_EXTENSION_ID,
            uri=None,
            vsix_path=None,
            installed=False,
            opened=False,
            mode="none",
            message="VS Code was not found on this machine.",
            detail="Install VS Code and ensure `code` is on PATH, or install under Local AppData\\Programs\\Microsoft VS Code.",
        )

    try:
        vsix = ensure_vsix()
        install_vsix(editor, vsix)
        open_vscode_with_eyra(editor)
        return OpenExtensionResult(
            ok=True,
            editor=editor.kind,
            extension_id=EYRA_EXTENSION_ID,
            uri=None,
            vsix_path=str(vsix),
            installed=True,
            opened=True,
            mode="vsix",
            message=(
                "Installed EYRA into VS Code and opened the editor. "
                "Click the EYRA icon in the Activity Bar (left). No Marketplace install."
            ),
        )
    except Exception as vsix_error:  # noqa: BLE001 — fall back to EDH
        try:
            launch_extension_development_host(editor)
            return OpenExtensionResult(
                ok=True,
                editor=editor.kind,
                extension_id=EYRA_EXTENSION_ID,
                uri=None,
                vsix_path=None,
                installed=False,
                opened=True,
                mode="development",
                message=(
                    "Opened EYRA in VS Code via Extension Development Host "
                    "(local folder — not Marketplace)."
                ),
                detail=str(vsix_error),
            )
        except Exception as edh_error:  # noqa: BLE001
            return OpenExtensionResult(
                ok=False,
                editor=editor.kind,
                extension_id=EYRA_EXTENSION_ID,
                uri=None,
                vsix_path=None,
                installed=False,
                opened=False,
                mode="none",
                message="Could not install or open the local EYRA extension.",
                detail=f"VSIX path: {vsix_error}\nEDH path: {edh_error}",
            )


def extension_status(preference: str = "vscode") -> dict:
    editors = discover_editors()
    picked = pick_editor(preference)
    root = extension_root()
    vsix_name = expected_vsix_name(root) if (root / "package.json").is_file() else None
    vsix = (root / "dist" / vsix_name) if vsix_name else None
    return {
        "extension_id": EYRA_EXTENSION_ID,
        "extension_root": str(root),
        "compiled": (root / "out" / "extension.js").is_file(),
        "vsix_ready": bool(vsix and vsix.is_file()),
        "vsix_path": str(vsix) if vsix and vsix.is_file() else None,
        "editors": [{"kind": e.kind, "path": str(e.path)} for e in editors],
        "selected_editor": picked.kind if picked else None,
        "target_editor": "vscode",
        "open_uris": {
            "vscode": build_open_uri("vscode"),
            "cursor": build_open_uri("cursor"),
        },
        "marketplace_published": False,
        "note": (
            "EYRA targets VS Code and is not on the Marketplace. Open Extension installs "
            "the local VSIX with `code --install-extension` and opens VS Code without "
            "vscode:// deep links (those trigger Marketplace 'not found')."
        ),
        "python": sys.executable,
    }
