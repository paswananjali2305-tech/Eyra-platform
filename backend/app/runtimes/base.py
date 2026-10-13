"""Runtime adapter contract + shared subprocess helpers."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence


# Soft sandbox: strip host secrets / PATH extras; keep minimal env for toolchains.
_SAFE_ENV_KEEP = {
    "PATH",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PATHEXT",
    "COMSPEC",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "LANG",
    "LC_ALL",
    "TERM",
}


@dataclass
class RuntimeInfo:
    language: str
    runtime: str
    available: bool
    version: str | None = None
    detail: str | None = None


@dataclass
class ExecutionResult:
    language: str
    runtime: str
    runtime_version: str | None
    runtime_available: bool
    status: str
    phase: str
    ok: bool
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool = False
    duration_ms: int = 0
    error_type: str | None = None
    diagnostics: str = ""
    stack_trace: str = ""
    source_evidence: str = ""
    extra: dict = field(default_factory=dict)

    def to_api_dict(self) -> dict:
        return {
            "ok": self.ok,
            "exit_code": self.exit_code,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "error_type": self.error_type,
            "language": self.language,
            "runtime": self.runtime,
            "runtime_version": self.runtime_version,
            "runtime_available": self.runtime_available,
            "status": self.status,
            "phase": self.phase,
            "timed_out": self.timed_out,
            "duration_ms": self.duration_ms,
            "diagnostics": self.diagnostics or None,
            "stack_trace": self.stack_trace or None,
            "source_evidence": self.source_evidence or None,
        }


class RuntimeAdapter(ABC):
    language_id: str
    display_name: str
    aliases: tuple[str, ...] = ()

    @abstractmethod
    def probe(self) -> RuntimeInfo:
        """Detect interpreter/compiler availability (no network installs)."""

    @abstractmethod
    def execute(self, code: str, *, file_name: str, timeout_s: float) -> ExecutionResult:
        """Compile/run snippet in a temp directory with argv-only subprocesses."""


def which(cmd: str) -> str | None:
    return shutil.which(cmd)


def probe_version(cmd: Sequence[str], *, timeout_s: float = 3.0) -> str | None:
    try:
        proc = subprocess.run(
            list(cmd),
            capture_output=True,
            text=True,
            timeout=timeout_s,
            env=safe_env(),
        )
        out = (proc.stdout or proc.stderr or "").strip().splitlines()
        return out[0][:200] if out else None
    except Exception:  # noqa: BLE001
        return None


def safe_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for key in _SAFE_ENV_KEEP:
        val = os.environ.get(key)
        if val:
            env[key] = val
    # Explicitly avoid leaking secrets
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["NODE_OPTIONS"] = ""
    return env


def truncate(text: str, limit: int = 80_000) -> str:
    if text is None:
        return ""
    if len(text) <= limit:
        return text
    return text[: limit - 40] + "\n… [output truncated by EYRA sandbox]\n"


def run_argv(
    argv: Sequence[str],
    *,
    cwd: Path,
    timeout_s: float,
) -> tuple[int, str, str, bool, int]:
    """Run argv list (never through a shell). Returns exit, stdout, stderr, timed_out, duration_ms."""
    started = time.perf_counter()
    try:
        proc = subprocess.run(
            list(argv),
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(cwd),
            env=safe_env(),
        )
        ms = int((time.perf_counter() - started) * 1000)
        return (
            int(proc.returncode),
            truncate(proc.stdout or ""),
            truncate(proc.stderr or ""),
            False,
            ms,
        )
    except subprocess.TimeoutExpired as exc:
        ms = int((time.perf_counter() - started) * 1000)
        out = truncate((exc.stdout or "") if isinstance(exc.stdout, str) else "")
        err = truncate((exc.stderr or "") if isinstance(exc.stderr, str) else "")
        if not err:
            err = f"Execution timed out after {timeout_s}s"
        return 124, out, err, True, ms


def write_source(tmp: Path, file_name: str, code: str) -> Path:
    # Basename only — never allow path traversal into the host.
    safe = Path(file_name.replace("\\", "/")).name or "snippet.txt"
    if safe in {".", ".."} or not safe.strip():
        safe = "snippet.txt"
    path = tmp / safe
    path.write_text(code or "", encoding="utf-8")
    return path


def infer_error_type(stderr: str, *, default: str = "RuntimeError") -> str | None:
    if not stderr:
        return None
    m = re.search(r"^([A-Za-z_][\w.]*(?:Error|Exception|Warning))", stderr, re.M)
    if m:
        return m.group(1)
    if re.search(r"error:", stderr, re.I):
        return "CompileError"
    return default


def unavailable_result(
    language: str,
    runtime: str,
    detail: str,
) -> ExecutionResult:
    return ExecutionResult(
        language=language,
        runtime=runtime,
        runtime_version=None,
        runtime_available=False,
        status="RUNTIME_UNAVAILABLE",
        phase="runtime_setup",
        ok=False,
        exit_code=127,
        stdout="",
        stderr=detail,
        error_type="RuntimeUnavailable",
        diagnostics=detail,
        source_evidence=detail,
    )


def temp_workdir(prefix: str = "eyra_exec_"):
    return tempfile.TemporaryDirectory(prefix=prefix)
