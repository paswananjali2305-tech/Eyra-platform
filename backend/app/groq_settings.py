"""Persist LLM API key / model choices into backend/.env and reload settings."""

from __future__ import annotations

import os
import re
from pathlib import Path

from app.config import BACKEND_ROOT, get_settings
from app.llm_catalog import curated_models, detect_provider, provider_base_url

ENV_PATH = BACKEND_ROOT / ".env"

# Backward-compatible flat id list (Groq curated).
GROQ_MODEL_OPTIONS: list[str] = [m["id"] for m in curated_models("groq")]


def mask_api_key(key: str) -> str:
    k = (key or "").strip()
    if not k:
        return ""
    if len(k) <= 8:
        return "*" * len(k)
    # ASCII mask so UI never shows mojibake for bullets
    return f"{k[:4]}{'*' * 12}{k[-4:]}"


def looks_masked(value: str | None) -> bool:
    if value is None:
        return True
    v = value.strip()
    if not v:
        return False
    # Treat UI-masked hints (bullets or asterisks) as "do not overwrite"
    if "•" in v or "*" in v or "…" in v:
        return True
    return v.lower() == "(unchanged)"


def _upsert_env(path: Path, updates: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    lines = existing.splitlines()
    keys_done: set[str] = set()
    out: list[str] = []

    for line in lines:
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        if m and m.group(1) in updates:
            key = m.group(1)
            out.append(f"{key}={updates[key]}")
            keys_done.add(key)
        else:
            out.append(line)

    for key, val in updates.items():
        if key not in keys_done:
            if out and out[-1].strip():
                out.append("")
            out.append(f"{key}={val}")

    text = "\n".join(out)
    if text and not text.endswith("\n"):
        text += "\n"
    path.write_text(text, encoding="utf-8")


def apply_groq_config(
    *,
    groq_api_key: str | None = None,
    groq_model: str | None = None,
    groq_model_runtime: str | None = None,
    groq_model_audit: str | None = None,
    llm_provider: str | None = None,
) -> None:
    updates: dict[str, str] = {}

    key_for_detect = None
    if groq_api_key is not None and not looks_masked(groq_api_key):
        updates["GROQ_API_KEY"] = groq_api_key.strip()
        key_for_detect = groq_api_key.strip()

    runtime = (groq_model_runtime or groq_model or "").strip()
    audit = (groq_model_audit or "").strip()
    if runtime:
        updates["GROQ_MODEL_RUNTIME"] = runtime
        updates["GROQ_MODEL"] = runtime
    if audit:
        updates["GROQ_MODEL_AUDIT"] = audit
    elif runtime:
        # Keep audit in sync when only one model is chosen.
        updates["GROQ_MODEL_AUDIT"] = runtime

    if key_for_detect is not None or llm_provider:
        pid = detect_provider(key_for_detect, llm_provider)
        updates["LLM_PROVIDER"] = pid
        updates["LLM_BASE_URL"] = provider_base_url(pid)

    if not updates:
        return

    _upsert_env(ENV_PATH, updates)
    # Process env wins over env_file — keep both in sync for immediate effect.
    for key, val in updates.items():
        os.environ[key] = val
    get_settings.cache_clear()
