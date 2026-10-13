"""Start the in-repo CodeAudit Node engine with Brain (no extra terminal)."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
from urllib.parse import urlparse

from app.config import BACKEND_ROOT, get_settings

ENGINE_DIR = BACKEND_ROOT.parent / "codeaudit" / "server"
_proc: subprocess.Popen | None = None


def _audit_port() -> int:
    parsed = urlparse(get_settings().eyra_audit_base_url)
    return parsed.port or 5000


def _port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.4):
            return True
    except OSError:
        return False


def start_audit_engine() -> None:
    """Spawn codeaudit/server if nothing is already listening on the audit port."""
    global _proc
    if os.environ.get("EYRA_SKIP_AUDIT_ENGINE") == "1":
        return
    port = _audit_port()
    if _port_open(port):
        return
    script = ENGINE_DIR / "src" / "server.js"
    if not script.is_file():
        print(f"[EYRA] Audit engine missing at {script}", flush=True)
        return
    env = os.environ.copy()
    env["PORT"] = str(port)
    kwargs: dict = {
        "cwd": str(ENGINE_DIR),
        "env": env,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    try:
        _proc = subprocess.Popen(["node", str(script)], **kwargs)
        print(f"[EYRA] Audit engine starting on http://127.0.0.1:{port}", flush=True)
    except FileNotFoundError:
        print("[EYRA] node not on PATH — Code Audit engine was not started", flush=True)
        _proc = None


def stop_audit_engine() -> None:
    global _proc
    proc = _proc
    _proc = None
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
