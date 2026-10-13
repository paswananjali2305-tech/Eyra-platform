"""Backward-compatible facade — multilingual execution lives in app.runtimes."""

from __future__ import annotations

from app.runtimes.python_runtime import execute_python
from app.runtimes.registry import execute_snippet

__all__ = ["execute_python", "execute_snippet"]
