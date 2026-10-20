"""Run Phase 9 backend tests with a clean import path (avoids foreign `tests` packages)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path = [p for p in sys.path if "ERP" not in p and "cache_erp" not in p]
sys.path.insert(0, str(ROOT))

import pytest

raise SystemExit(
    pytest.main(
        [
            str(ROOT / "tests" / "test_diagnostics.py"),
            str(ROOT / "tests" / "test_analyze.py"),
            "-q",
            "--tb=short",
        ]
    )
)
