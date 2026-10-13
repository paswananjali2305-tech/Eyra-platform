"""Multilingual snippet runtimes for EYRA Runtime Debugging."""

from __future__ import annotations

from app.runtimes.base import ExecutionResult, RuntimeAdapter, RuntimeInfo
from app.runtimes.registry import (
    execute_snippet,
    get_adapter,
    list_runtime_capabilities,
    normalize_language_id,
)

__all__ = [
    "ExecutionResult",
    "RuntimeAdapter",
    "RuntimeInfo",
    "execute_snippet",
    "get_adapter",
    "list_runtime_capabilities",
    "normalize_language_id",
]
