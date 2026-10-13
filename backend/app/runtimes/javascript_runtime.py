"""JavaScript (Node.js) + TypeScript (npx tsc / tsx / ts-node) adapters."""

from __future__ import annotations

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
    which,
    write_source,
)


class JavaScriptRuntime(RuntimeAdapter):
    language_id = "javascript"
    display_name = "JavaScript"
    aliases = ("js", "node", "nodejs")

    def probe(self) -> RuntimeInfo:
        node = which("node")
        if not node:
            return RuntimeInfo(
                language=self.language_id,
                runtime="node",
                available=False,
                detail="Node.js (node) not found on PATH",
            )
        return RuntimeInfo(
            language=self.language_id,
            runtime="node",
            available=True,
            version=probe_version([node, "--version"]),
            detail=node,
        )

    def execute(self, code: str, *, file_name: str, timeout_s: float) -> ExecutionResult:
        info = self.probe()
        if not info.available:
            return unavailable_result(
                self.language_id, "node", info.detail or "Node.js unavailable"
            )
        node = info.detail or "node"
        with temp_workdir("eyra_js_") as tmp:
            root = Path(tmp)
            name = file_name if file_name.endswith((".js", ".mjs", ".cjs")) else "snippet.js"
            src = write_source(root, name, code)
            code_exit, stdout, stderr, timed_out, ms = run_argv(
                [node, str(src)],
                cwd=root,
                timeout_s=timeout_s,
            )
            return _finalize(
                self.language_id,
                info,
                code_exit,
                stdout,
                stderr,
                timed_out,
                ms,
                evidence=f"node {src.name}",
            )


class TypeScriptRuntime(RuntimeAdapter):
    language_id = "typescript"
    display_name = "TypeScript"
    aliases = ("ts",)

    def probe(self) -> RuntimeInfo:
        node = which("node")
        if not node:
            return RuntimeInfo(
                language=self.language_id,
                runtime="typescript",
                available=False,
                detail="Node.js required for TypeScript execution",
            )
        # Prefer tsx, then ts-node, then npx tsc + node
        for tool in ("tsx", "ts-node"):
            path = which(tool)
            if path:
                return RuntimeInfo(
                    language=self.language_id,
                    runtime=tool,
                    available=True,
                    version=probe_version([path, "--version"]),
                    detail=path,
                )
        npx = which("npx")
        if npx:
            return RuntimeInfo(
                language=self.language_id,
                runtime="npx-tsc",
                available=True,
                version=probe_version([node, "--version"]),
                detail=npx,
            )
        return RuntimeInfo(
            language=self.language_id,
            runtime="typescript",
            available=False,
            detail="No tsx / ts-node / npx found for TypeScript",
        )

    def execute(self, code: str, *, file_name: str, timeout_s: float) -> ExecutionResult:
        info = self.probe()
        if not info.available:
            return unavailable_result(
                self.language_id, info.runtime, info.detail or "TypeScript runtime unavailable"
            )
        node = which("node") or "node"
        with temp_workdir("eyra_ts_") as tmp:
            root = Path(tmp)
            name = file_name if file_name.endswith((".ts", ".tsx")) else "snippet.ts"
            src = write_source(root, name, code)

            if info.runtime in {"tsx", "ts-node"} and info.detail:
                code_exit, stdout, stderr, timed_out, ms = run_argv(
                    [info.detail, str(src)],
                    cwd=root,
                    timeout_s=timeout_s,
                )
                return _finalize(
                    self.language_id,
                    info,
                    code_exit,
                    stdout,
                    stderr,
                    timed_out,
                    ms,
                    evidence=f"{info.runtime} {src.name}",
                )

            # Compile with npx tsc then run with node
            npx = info.detail or which("npx")
            if not npx:
                return unavailable_result(
                    self.language_id, "npx-tsc", "npx unavailable for TypeScript compile"
                )
            out_js = root / "snippet.js"
            c_exit, c_out, c_err, c_to, c_ms = run_argv(
                [
                    npx,
                    "--yes",
                    "typescript",
                    "tsc",
                    str(src),
                    "--outFile",
                    str(out_js),
                    "--esModuleInterop",
                    "--target",
                    "ES2020",
                    "--module",
                    "commonjs",
                    "--skipLibCheck",
                ],
                cwd=root,
                timeout_s=min(timeout_s, 60.0),
            )
            if c_to:
                return ExecutionResult(
                    language=self.language_id,
                    runtime=info.runtime,
                    runtime_version=info.version,
                    runtime_available=True,
                    status="TIMEOUT",
                    phase="compile",
                    ok=False,
                    exit_code=124,
                    stdout=c_out,
                    stderr=c_err,
                    timed_out=True,
                    duration_ms=c_ms,
                    error_type="TimeoutError",
                    diagnostics=c_err,
                )
            if c_exit != 0 or not out_js.exists():
                return ExecutionResult(
                    language=self.language_id,
                    runtime=info.runtime,
                    runtime_version=info.version,
                    runtime_available=True,
                    status="COMPILE_ERROR",
                    phase="compile",
                    ok=False,
                    exit_code=c_exit or 1,
                    stdout=c_out,
                    stderr=c_err or "TypeScript compilation failed",
                    duration_ms=c_ms,
                    error_type="CompileError",
                    diagnostics=c_err,
                    source_evidence=f"tsc {src.name}",
                )
            code_exit, stdout, stderr, timed_out, ms = run_argv(
                [node, str(out_js)],
                cwd=root,
                timeout_s=timeout_s,
            )
            return _finalize(
                self.language_id,
                info,
                code_exit,
                stdout,
                stderr,
                timed_out,
                ms,
                evidence=f"node {out_js.name}",
                duration_ms=c_ms + ms,
            )


def _finalize(
    language: str,
    info: RuntimeInfo,
    code_exit: int,
    stdout: str,
    stderr: str,
    timed_out: bool,
    ms: int,
    *,
    evidence: str,
    duration_ms: int | None = None,
) -> ExecutionResult:
    if timed_out:
        return ExecutionResult(
            language=language,
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
            duration_ms=duration_ms if duration_ms is not None else ms,
            error_type="TimeoutError",
            diagnostics=stderr,
            stack_trace=stderr,
            source_evidence=evidence,
        )
    ok = code_exit == 0
    # Node syntax errors often look like compile-time
    status = "SUCCESS" if ok else "RUNTIME_ERROR"
    if not ok and re_syntax_error(stderr):
        status = "COMPILE_ERROR"
    return ExecutionResult(
        language=language,
        runtime=info.runtime,
        runtime_version=info.version,
        runtime_available=True,
        status=status,
        phase="compile" if status == "COMPILE_ERROR" else "execute",
        ok=ok,
        exit_code=code_exit,
        stdout=stdout,
        stderr=stderr,
        duration_ms=duration_ms if duration_ms is not None else ms,
        error_type=None if ok else infer_error_type(stderr, default="RuntimeError"),
        diagnostics=stderr if not ok else "",
        stack_trace=stderr if not ok else "",
        source_evidence=evidence,
    )


def re_syntax_error(stderr: str) -> bool:
    return bool(
        stderr
        and (
            "SyntaxError" in stderr
            or "Unexpected token" in stderr
            or "error TS" in stderr
        )
    )
