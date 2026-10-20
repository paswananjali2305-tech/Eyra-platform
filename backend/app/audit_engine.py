"""Start the in-repo CodeAudit Node engine with Brain (no extra terminal)."""

from __future__ import annotations

import os
import secrets
import socket
import subprocess
import sys
from urllib.parse import urlparse

from app.config import BACKEND_ROOT, get_settings

ENGINE_DIR = BACKEND_ROOT.parent / "codeaudit" / "server"
_proc: subprocess.Popen | None = None
_generated_secret: str = ""


def current_audit_secret() -> str:
    """Secret shared with the audit process. Never invent one for an engine we did not start."""
    configured = get_settings().eyra_audit_internal_secret.strip()
    if configured:
        return configured
    return _generated_secret


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
    """Spawn codeaudit/server if nothing is already listening on the audit port.

    Does not kill whatever is already bound. A pre-started engine must be launched
    with the same EYRA_AUDIT_INTERNAL_SECRET the Brain is using.
    """
    global _proc, _generated_secret
    if os.environ.get("EYRA_SKIP_AUDIT_ENGINE") == "1":
        return
    port = _audit_port()
    secret = get_settings().eyra_audit_internal_secret.strip()
    if _port_open(port):
        if not secret:
            print(
                "[EYRA] Audit port "
                f"{port} is already in use. Not stopping that process. "
                "Set EYRA_AUDIT_INTERNAL_SECRET to the key that process was started with.",
                flush=True,
            )
        return
    if not secret:
        secret = secrets.token_urlsafe(32)
        _generated_secret = secret
    script = ENGINE_DIR / "src" / "server.js"
    if not script.is_file():
        print(f"[EYRA] Audit engine missing at {script}", flush=True)
        return
    env = os.environ.copy()
    env["PORT"] = str(port)
    env["EYRA_AUDIT_INTERNAL_SECRET"] = secret
    env["EYRA_AUDIT_CORS_ORIGINS"] = get_settings().eyra_cors_origins
    kwargs: dict = {
        "cwd": str(ENGINE_DIR),
        "env": env,
        "stdout": subprocess.DEVNULL,
        "stderr": None,
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
