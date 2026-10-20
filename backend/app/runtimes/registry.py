"""Central language → adapter registry."""

from __future__ import annotations

from app.runtimes.base import ExecutionResult, RuntimeAdapter, unavailable_result
from app.runtimes.compiled_runtimes import CppRuntime, CRuntime, GoRuntime, JavaRuntime
from app.runtimes.javascript_runtime import JavaScriptRuntime, TypeScriptRuntime
from app.runtimes.python_runtime import PythonRuntime

_ADAPTERS: list[RuntimeAdapter] = [
    PythonRuntime(),
    JavaScriptRuntime(),
    TypeScriptRuntime(),
    JavaRuntime(),
    CRuntime(),
    CppRuntime(),
    GoRuntime(),
]

_BY_ID: dict[str, RuntimeAdapter] = {}
for _a in _ADAPTERS:
    _BY_ID[_a.language_id] = _a
    for alias in _a.aliases:
        _BY_ID[alias.lower()] = _a


def normalize_language_id(raw: str | None) -> str:
    s = (raw or "python").strip().lower()
    aliases = {
        "py": "python",
        "python3": "python",
        "js": "javascript",
        "node": "javascript",
        "nodejs": "javascript",
        "javascriptreact": "javascript",
        "ts": "typescript",
        "typescriptreact": "typescript",
        "c++": "cpp",
        "cplusplus": "cpp",
        "cxx": "cpp",
        "golang": "go",
        "jvm": "java",
        "html": "html",
        "css": "css",
        "sql": "sql",
    }
    return aliases.get(s, s)


def get_adapter(language: str | None) -> RuntimeAdapter | None:
    return _BY_ID.get(normalize_language_id(language))


def list_runtime_capabilities() -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for adapter in _ADAPTERS:
        if adapter.language_id in seen:
            continue
        seen.add(adapter.language_id)
        info = adapter.probe()
        out.append(
            {
                "language": adapter.language_id,
                "displayName": adapter.display_name,
                "runtime": info.runtime,
                "available": info.available,
                "version": info.version,
                "detail": info.detail,
                "executable": True,
            }
        )
    # Catalog languages without adapters yet (honest unavailable)
    for lang, label in (
        ("html", "HTML"),
        ("css", "CSS"),
        ("sql", "SQL"),
    ):
        if lang in seen:
            continue
        out.append(
            {
                "language": lang,
                "displayName": label,
                "runtime": None,
                "available": False,
                "version": None,
                "detail": "Adapter not implemented yet — analyze-only",
                "executable": False,
            }
        )
    return out


def execute_snippet(
    *,
    code: str,
    language: str | None,
    file_name: str,
    timeout_s: float = 3.0,
) -> ExecutionResult:
    lang = normalize_language_id(language)
    adapter = get_adapter(lang)
    if not adapter:
        return unavailable_result(
            lang,
            "none",
            f"No executable runtime adapter for language '{lang}'. "
            "Use Analyze for AI review, or switch to a supported Run language.",
        )
    try:
        return adapter.execute(code, file_name=file_name or "snippet", timeout_s=timeout_s)
    except Exception as exc:  # noqa: BLE001
        return ExecutionResult(
            language=lang,
            runtime=adapter.language_id,
            runtime_version=None,
            runtime_available=True,
            status="INTERNAL_ERROR",
            phase="execute",
            ok=False,
            exit_code=1,
            stdout="",
            stderr=str(exc),
            error_type=type(exc).__name__,
            diagnostics=str(exc),
        )
