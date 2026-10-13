"""Java, C++, and Go adapters."""

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
    which,
    write_source,
)


class JavaRuntime(RuntimeAdapter):
    language_id = "java"
    display_name = "Java"
    aliases = ("jvm",)

    def probe(self) -> RuntimeInfo:
        javac = which("javac")
        java = which("java")
        if not javac or not java:
            return RuntimeInfo(
                language=self.language_id,
                runtime="jdk",
                available=False,
                detail="javac/java not found on PATH",
            )
        return RuntimeInfo(
            language=self.language_id,
            runtime="jdk",
            available=True,
            version=probe_version([javac, "-version"]),
            detail=javac,
        )

    def execute(self, code: str, *, file_name: str, timeout_s: float) -> ExecutionResult:
        info = self.probe()
        if not info.available:
            return unavailable_result(self.language_id, "jdk", info.detail or "JDK unavailable")
        javac = which("javac") or "javac"
        java = which("java") or "java"
        class_name = _java_public_class(code) or "Main"
        with temp_workdir("eyra_java_") as tmp:
            root = Path(tmp)
            src = write_source(root, f"{class_name}.java", code)
            c_exit, c_out, c_err, c_to, c_ms = run_argv(
                [javac, str(src)],
                cwd=root,
                timeout_s=min(timeout_s, 60.0),
            )
            if c_to:
                return _timeout(self.language_id, info, c_out, c_err, c_ms, phase="compile")
            if c_exit != 0:
                return ExecutionResult(
                    language=self.language_id,
                    runtime=info.runtime,
                    runtime_version=info.version,
                    runtime_available=True,
                    status="COMPILE_ERROR",
                    phase="compile",
                    ok=False,
                    exit_code=c_exit,
                    stdout=c_out,
                    stderr=c_err,
                    duration_ms=c_ms,
                    error_type="CompileError",
                    diagnostics=c_err,
                    source_evidence=f"javac {src.name}",
                )
            code_exit, stdout, stderr, timed_out, ms = run_argv(
                [java, "-cp", str(root), class_name],
                cwd=root,
                timeout_s=timeout_s,
            )
            return _exec_result(
                self.language_id,
                info,
                code_exit,
                stdout,
                stderr,
                timed_out,
                c_ms + ms,
                evidence=f"java {class_name}",
            )


class CppRuntime(RuntimeAdapter):
    language_id = "cpp"
    display_name = "C++"
    aliases = ("c++", "cplusplus", "cxx")

    def probe(self) -> RuntimeInfo:
        for cmd in ("g++", "clang++", "c++"):
            path = which(cmd)
            if path:
                return RuntimeInfo(
                    language=self.language_id,
                    runtime=cmd,
                    available=True,
                    version=probe_version([path, "--version"]),
                    detail=path,
                )
        return RuntimeInfo(
            language=self.language_id,
            runtime="g++",
            available=False,
            detail="g++/clang++ not found on PATH",
        )

    def execute(self, code: str, *, file_name: str, timeout_s: float) -> ExecutionResult:
        info = self.probe()
        if not info.available:
            return unavailable_result(self.language_id, "g++", info.detail or "C++ compiler unavailable")
        compiler = info.detail or "g++"
        with temp_workdir("eyra_cpp_") as tmp:
            root = Path(tmp)
            name = file_name if file_name.endswith((".cpp", ".cc", ".cxx")) else "snippet.cpp"
            src = write_source(root, name, code)
            binary = root / ("program.exe" if _is_windows() else "program")
            c_exit, c_out, c_err, c_to, c_ms = run_argv(
                [compiler, str(src), "-O0", "-std=c++17", "-o", str(binary)],
                cwd=root,
                timeout_s=min(timeout_s, 60.0),
            )
            if c_to:
                return _timeout(self.language_id, info, c_out, c_err, c_ms, phase="compile")
            if c_exit != 0 or not binary.exists():
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
                    stderr=c_err,
                    duration_ms=c_ms,
                    error_type="CompileError",
                    diagnostics=c_err,
                    source_evidence=f"{info.runtime} {src.name}",
                )
            code_exit, stdout, stderr, timed_out, ms = run_argv(
                [str(binary)],
                cwd=root,
                timeout_s=timeout_s,
            )
            return _exec_result(
                self.language_id,
                info,
                code_exit,
                stdout,
                stderr,
                timed_out,
                c_ms + ms,
                evidence=str(binary.name),
            )


class GoRuntime(RuntimeAdapter):
    language_id = "go"
    display_name = "Go"
    aliases = ("golang",)

    def probe(self) -> RuntimeInfo:
        go = which("go")
        if not go:
            return RuntimeInfo(
                language=self.language_id,
                runtime="go",
                available=False,
                detail="go toolchain not found on PATH",
            )
        return RuntimeInfo(
            language=self.language_id,
            runtime="go",
            available=True,
            version=probe_version([go, "version"]),
            detail=go,
        )

    def execute(self, code: str, *, file_name: str, timeout_s: float) -> ExecutionResult:
        info = self.probe()
        if not info.available:
            return unavailable_result(self.language_id, "go", info.detail or "Go unavailable")
        go = info.detail or "go"
        with temp_workdir("eyra_go_") as tmp:
            root = Path(tmp)
            name = file_name if file_name.endswith(".go") else "main.go"
            src = write_source(root, name, code)
            # Ensure module for go run
            run_argv([go, "mod", "init", "eyra_snippet"], cwd=root, timeout_s=10.0)
            code_exit, stdout, stderr, timed_out, ms = run_argv(
                [go, "run", str(src)],
                cwd=root,
                timeout_s=timeout_s,
            )
            if timed_out:
                return _timeout(self.language_id, info, stdout, stderr, ms, phase="execute")
            if code_exit != 0 and _looks_like_compile(stderr):
                return ExecutionResult(
                    language=self.language_id,
                    runtime=info.runtime,
                    runtime_version=info.version,
                    runtime_available=True,
                    status="COMPILE_ERROR",
                    phase="compile",
                    ok=False,
                    exit_code=code_exit,
                    stdout=stdout,
                    stderr=stderr,
                    duration_ms=ms,
                    error_type="CompileError",
                    diagnostics=stderr,
                    source_evidence=f"go run {src.name}",
                )
            return _exec_result(
                self.language_id,
                info,
                code_exit,
                stdout,
                stderr,
                False,
                ms,
                evidence=f"go run {src.name}",
            )


class CRuntime(RuntimeAdapter):
    """Optional C adapter (gcc/clang) — registered for completeness."""

    language_id = "c"
    display_name = "C"
    aliases = ("clang",)

    def probe(self) -> RuntimeInfo:
        for cmd in ("gcc", "clang", "cc"):
            path = which(cmd)
            if path:
                return RuntimeInfo(
                    language=self.language_id,
                    runtime=cmd,
                    available=True,
                    version=probe_version([path, "--version"]),
                    detail=path,
                )
        return RuntimeInfo(
            language=self.language_id,
            runtime="gcc",
            available=False,
            detail="gcc/clang not found on PATH",
        )

    def execute(self, code: str, *, file_name: str, timeout_s: float) -> ExecutionResult:
        info = self.probe()
        if not info.available:
            return unavailable_result(self.language_id, "gcc", info.detail or "C compiler unavailable")
        compiler = info.detail or "gcc"
        with temp_workdir("eyra_c_") as tmp:
            root = Path(tmp)
            name = file_name if file_name.endswith((".c", ".h")) else "snippet.c"
            src = write_source(root, name, code)
            binary = root / ("program.exe" if _is_windows() else "program")
            c_exit, c_out, c_err, c_to, c_ms = run_argv(
                [compiler, str(src), "-O0", "-std=c11", "-o", str(binary)],
                cwd=root,
                timeout_s=min(timeout_s, 60.0),
            )
            if c_to:
                return _timeout(self.language_id, info, c_out, c_err, c_ms, phase="compile")
            if c_exit != 0 or not binary.exists():
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
                    stderr=c_err,
                    duration_ms=c_ms,
                    error_type="CompileError",
                    diagnostics=c_err,
                    source_evidence=f"{info.runtime} {src.name}",
                )
            code_exit, stdout, stderr, timed_out, ms = run_argv(
                [str(binary)],
                cwd=root,
                timeout_s=timeout_s,
            )
            return _exec_result(
                self.language_id,
                info,
                code_exit,
                stdout,
                stderr,
                timed_out,
                c_ms + ms,
                evidence=str(binary.name),
            )


def _java_public_class(code: str) -> str | None:
    m = re.search(r"\bpublic\s+class\s+([A-Za-z_][\w]*)", code or "")
    return m.group(1) if m else None


def _is_windows() -> bool:
    return sys.platform.startswith("win")


def _looks_like_compile(stderr: str) -> bool:
    return bool(
        re.search(r":\d+:\d+:|syntax error|undefined:|cannot find package|build failed", stderr or "", re.I)
    )


def _timeout(
    language: str,
    info: RuntimeInfo,
    stdout: str,
    stderr: str,
    ms: int,
    *,
    phase: str,
) -> ExecutionResult:
    return ExecutionResult(
        language=language,
        runtime=info.runtime,
        runtime_version=info.version,
        runtime_available=True,
        status="TIMEOUT",
        phase=phase,
        ok=False,
        exit_code=124,
        stdout=stdout,
        stderr=stderr,
        timed_out=True,
        duration_ms=ms,
        error_type="TimeoutError",
        diagnostics=stderr,
    )


def _exec_result(
    language: str,
    info: RuntimeInfo,
    code_exit: int,
    stdout: str,
    stderr: str,
    timed_out: bool,
    ms: int,
    *,
    evidence: str,
) -> ExecutionResult:
    if timed_out:
        return _timeout(language, info, stdout, stderr, ms, phase="execute")
    ok = code_exit == 0
    return ExecutionResult(
        language=language,
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
        error_type=None if ok else infer_error_type(stderr),
        diagnostics=stderr if not ok else "",
        stack_trace=stderr if not ok else "",
        source_evidence=evidence,
    )
