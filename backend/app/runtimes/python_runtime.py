"""Python adapter — preserves existing EYRA sandbox behavior."""

from __future__ import annotations

import re
import sys
from pathlib import Path

from app.runtimes.base import (
    ExecutionResult,
    RuntimeAdapter,
    RuntimeInfo,
    infer_error_type,
    probe_version,
    run_argv,
    temp_workdir,
    unavailable_result,
    write_source,
)

_BLOCKED = re.compile(
    r"\b(os\.system|subprocess|socket|urllib|requests|httpx|shutil|ctypes|multiprocessing)\b"
    r"|pathlib\.Path\([\"']/"
    r"|open\([\"']/",
    re.I,
)


class PythonRuntime(RuntimeAdapter):
    language_id = "python"
    display_name = "Python"
    aliases = ("py", "python3")

    def probe(self) -> RuntimeInfo:
        version = probe_version([sys.executable, "--version"])
        return RuntimeInfo(
            language=self.language_id,
            runtime="cpython",
            available=True,
            version=version,
            detail=sys.executable,
        )

    def execute(self, code: str, *, file_name: str, timeout_s: float) -> ExecutionResult:
        info = self.probe()
        if _BLOCKED.search(code or ""):
            detail = (
                "Blocked: network / process / filesystem APIs are not allowed in the sandbox."
            )
            return ExecutionResult(
                language=self.language_id,
                runtime=info.runtime,
                runtime_version=info.version,
                runtime_available=True,
                status="EXECUTION_BLOCKED",
                phase="execute",
                ok=False,
                exit_code=1,
                stdout="",
                stderr=detail,
                error_type="SandboxPolicyError",
                diagnostics=detail,
                source_evidence=detail,
            )

        with temp_workdir("eyra_py_") as tmp:
            root = Path(tmp)
            src = write_source(root, file_name if file_name.endswith(".py") else "snippet.py", code)
            code_exit, stdout, stderr, timed_out, ms = run_argv(
                [sys.executable, "-I", str(src)],
                cwd=root,
                timeout_s=timeout_s,
            )
            if timed_out:
                return ExecutionResult(
                    language=self.language_id,
                    runtime=info.runtime,
                    runtime_version=info.version,
                    runtime_available=True,
                    status="TIMEOUT",
                    phase="execute",
                    ok=False,
                    exit_code=124,
                    stdout=stdout,
                    stderr=stderr,
                    timed_out=True,
                    duration_ms=ms,
                    error_type="TimeoutError",
                    diagnostics=stderr,
                    stack_trace=stderr,
                )
            ok = code_exit == 0
            err_type = None if ok else infer_error_type(stderr)
            return ExecutionResult(
                language=self.language_id,
                runtime=info.runtime,
                runtime_version=info.version,
                runtime_available=True,
                status="SUCCESS" if ok else "RUNTIME_ERROR",
                phase="execute",
                ok=ok,
                exit_code=code_exit,
                stdout=stdout,
                stderr=stderr,
                duration_ms=ms,
                error_type=err_type,
                diagnostics=stderr if not ok else "",
                stack_trace=stderr if not ok else "",
                source_evidence=f"python {src.name}",
            )


# Keep module-level helper for any legacy imports.
def execute_python(code: str, timeout_s: float = 3.0) -> dict:
    result = PythonRuntime().execute(code, file_name="snippet.py", timeout_s=timeout_s)
    return {
        "ok": result.ok,
        "exit_code": result.exit_code,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "error_type": result.error_type,
    }
