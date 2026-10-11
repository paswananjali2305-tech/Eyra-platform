"""Safe local Python snippet execution for Runtime Debugging (no network, timeout)."""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path


_BLOCKED = re.compile(
    r"\b(os\.system|subprocess|socket|urllib|requests|httpx|shutil|ctypes|multiprocessing)\b"
    r"|pathlib\.Path\([\"']/"
    r"|open\([\"']/",
    re.I,
)


def execute_python(code: str, timeout_s: float = 3.0) -> dict:
    """Run user code in an isolated temp file; return stdout/stderr/exit."""
    if _BLOCKED.search(code or ""):
        return {
            "ok": False,
            "exit_code": 1,
            "stdout": "",
            "stderr": "Blocked: network / process / filesystem APIs are not allowed in the sandbox.",
            "error_type": "SandboxPolicyError",
        }

    with tempfile.TemporaryDirectory(prefix="eyra_exec_") as tmp:
        script = Path(tmp) / "snippet.py"
        script.write_text(code or "", encoding="utf-8")
        try:
            proc = subprocess.run(
                [sys.executable, "-I", str(script)],
                capture_output=True,
                text=True,
                timeout=timeout_s,
                cwd=tmp,
                env={"PYTHONPATH": "", "PYTHONDONTWRITEBYTECODE": "1"},
            )
            stderr = proc.stderr or ""
            error_type = None
            if proc.returncode != 0 and stderr:
                m = re.search(r"^([A-Za-z_][\w.]*(?:Error|Exception|Warning))", stderr, re.M)
                error_type = m.group(1) if m else "RuntimeError"
            return {
                "ok": proc.returncode == 0,
                "exit_code": proc.returncode,
                "stdout": proc.stdout or "",
                "stderr": stderr,
                "error_type": error_type,
            }
        except subprocess.TimeoutExpired:
            return {
                "ok": False,
                "exit_code": 124,
                "stdout": "",
                "stderr": f"Execution timed out after {timeout_s}s",
                "error_type": "TimeoutError",
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "ok": False,
                "exit_code": 1,
                "stdout": "",
                "stderr": str(exc),
                "error_type": type(exc).__name__,
            }
