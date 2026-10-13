"""Detect LLM provider from API key and return tagged model catalogs."""

from __future__ import annotations

from typing import Any, Literal

import httpx

Tier = Literal["fast", "balanced", "best", ""]

TIER_LABEL = {
    "fast": "Fast",
    "balanced": "Best balanced",
    "best": "Best quality",
    "": "",
}

# Curated chat models + recommendation tags (merged onto live /models lists).
PROVIDER_CATALOG: dict[str, dict[str, Any]] = {
    "groq": {
        "label": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "key_hints": ("gsk_",),
        "models": [
            {"id": "llama-3.1-8b-instant", "tier": "fast", "note": "Lowest latency"},
            {"id": "openai/gpt-oss-20b", "tier": "balanced", "note": "Recommended default"},
            {"id": "llama-3.3-70b-versatile", "tier": "best", "note": "Strong general reasoning"},
            {"id": "openai/gpt-oss-120b", "tier": "best", "note": "Heavier audit enrichment"},
            {"id": "meta-llama/llama-4-scout-17b-16e-instruct", "tier": "fast", "note": "Scout — quick"},
            {"id": "meta-llama/llama-4-maverick-17b-128e-instruct", "tier": "balanced", "note": "Maverick"},
            {"id": "qwen/qwen3-32b", "tier": "balanced", "note": "Qwen 3"},
            {"id": "moonshotai/kimi-k2-instruct", "tier": "", "note": "Kimi K2"},
            {"id": "gemma2-9b-it", "tier": "fast", "note": "Compact"},
            {"id": "mixtral-8x7b-32768", "tier": "", "note": "Legacy Mixtral"},
            {"id": "llama-3.1-70b-versatile", "tier": "", "note": "70B versatile"},
        ],
    },
    "openai": {
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "key_hints": ("sk-", "sk-proj-"),
        "models": [
            {"id": "gpt-4o-mini", "tier": "fast", "note": "Cheap & quick"},
            {"id": "gpt-4.1-mini", "tier": "fast", "note": "Fast 4.1"},
            {"id": "gpt-4o", "tier": "balanced", "note": "Recommended default"},
            {"id": "gpt-4.1", "tier": "balanced", "note": "Strong all-rounder"},
            {"id": "o4-mini", "tier": "balanced", "note": "Reasoning, faster"},
            {"id": "o3-mini", "tier": "best", "note": "Deep reasoning"},
            {"id": "gpt-4.1-nano", "tier": "fast", "note": "Tiny / batch"},
            {"id": "chatgpt-4o-latest", "tier": "", "note": "ChatGPT latest"},
        ],
    },
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "key_hints": ("sk-or-",),
        "models": [
            {"id": "openai/gpt-4o-mini", "tier": "fast", "note": "Via OpenRouter"},
            {"id": "openai/gpt-4o", "tier": "balanced", "note": "Recommended"},
            {"id": "anthropic/claude-sonnet-4", "tier": "best", "note": "Claude Sonnet"},
            {"id": "google/gemini-2.5-flash", "tier": "fast", "note": "Gemini Flash"},
            {"id": "meta-llama/llama-3.3-70b-instruct", "tier": "balanced", "note": "Llama 3.3"},
        ],
    },
}


def detect_provider(api_key: str | None, explicit: str | None = None) -> str:
    if explicit and explicit.strip().lower() in PROVIDER_CATALOG:
        return explicit.strip().lower()
    key = (api_key or "").strip()
    if not key or "•" in key or "*" in key:
        return "groq"
    lower = key.lower()
    # Specific prefixes before generic sk-
    if lower.startswith("gsk_"):
        return "groq"
    if lower.startswith("sk-or-"):
        return "openrouter"
    if lower.startswith("sk-"):
        return "openai"
    return "groq"


def format_model_label(model_id: str, tier: str = "", note: str = "") -> str:
    bits: list[str] = [model_id]
    tier_l = TIER_LABEL.get(tier, "")
    if tier_l:
        bits.append(f"[{tier_l}]")
    if note:
        bits.append(f"— {note}")
    return " ".join(bits)


def curated_models(provider: str) -> list[dict[str, Any]]:
    meta = PROVIDER_CATALOG.get(provider) or PROVIDER_CATALOG["groq"]
    out: list[dict[str, Any]] = []
    for m in meta["models"]:
        mid = m["id"]
        tier = m.get("tier") or ""
        note = m.get("note") or ""
        out.append(
            {
                "id": mid,
                "tier": tier,
                "note": note,
                "label": format_model_label(mid, tier, note),
                "recommended": tier == "balanced",
            }
        )
    # Sort: balanced first, then fast, then best, then rest
    order = {"balanced": 0, "fast": 1, "best": 2, "": 3}
    out.sort(key=lambda x: (order.get(x["tier"], 9), x["id"]))
    return out


def provider_base_url(provider: str) -> str:
    meta = PROVIDER_CATALOG.get(provider) or PROVIDER_CATALOG["groq"]
    return str(meta["base_url"])


def provider_label(provider: str) -> str:
    meta = PROVIDER_CATALOG.get(provider) or PROVIDER_CATALOG["groq"]
    return str(meta["label"])


async def probe_api_key(
    provider: str, api_key: str
) -> tuple[bool, str | None, list[str] | None]:
    """Validate key against provider /models. Returns (ok, error, model_ids)."""
    key = (api_key or "").strip()
    if not key or "•" in key or "*" in key:
        return False, "Enter a valid API key", None
    base = provider_base_url(provider).rstrip("/")
    headers = {"Authorization": f"Bearer {key}"}
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://eyra.local"
        headers["X-Title"] = "EYRA"
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            res = await client.get(f"{base}/models", headers=headers)
        if res.status_code in (401, 403):
            return False, "Invalid or unauthorized API key", None
        if res.status_code >= 400:
            return False, f"Provider error HTTP {res.status_code}", None
        data = res.json()
        items = data.get("data") if isinstance(data, dict) else data
        if not isinstance(items, list):
            return False, "Unexpected provider response", None
        ids: list[str] = []
        for item in items:
            if isinstance(item, dict) and item.get("id"):
                mid = str(item["id"])
                if provider == "openai" and not any(
                    mid.startswith(p)
                    for p in ("gpt-", "o1", "o3", "o4", "chatgpt-", "ft:")
                ):
                    continue
                ids.append(mid)
        return True, None, ids
    except httpx.TimeoutException:
        return False, "Provider timed out", None
    except Exception as exc:
        return False, f"Connection failed: {exc}", None


async def fetch_live_models(provider: str, api_key: str) -> list[str] | None:
    """Return model ids from provider /models, or None on failure."""
    ok, _err, ids = await probe_api_key(provider, api_key)
    return ids if ok else None


def pick_auto_model(models: list[dict[str, Any]], live_ids: list[str] | None) -> dict[str, Any] | None:
    """Prefer Best balanced, else Fast, else Best quality, else first live/curated."""
    if not models:
        return None
    live_set = set(live_ids or [])

    def rank(m: dict[str, Any]) -> tuple[int, int]:
        tier = m.get("tier") or ""
        tier_rank = {"balanced": 0, "fast": 1, "best": 2}.get(tier, 9)
        # Prefer models that exist on the account when live list is present
        live_rank = 0 if (not live_set or m["id"] in live_set) else 1
        return (live_rank, tier_rank)

    return sorted(models, key=rank)[0]


def merge_catalog(
    provider: str,
    live_ids: list[str] | None,
) -> list[dict[str, Any]]:
    curated = curated_models(provider)
    by_id = {m["id"]: m for m in curated}
    if not live_ids:
        return curated

    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    # Curated recommendations first (tagged), even if not yet in live list
    for m in curated:
        merged.append(m)
        seen.add(m["id"])
    # Then remaining live models
    for mid in sorted(live_ids):
        if mid in seen:
            continue
        merged.append(
            {
                "id": mid,
                "tier": "",
                "note": "From your API account",
                "label": format_model_label(mid, "", "From your API account"),
                "recommended": False,
            }
        )
        seen.add(mid)
        if len(merged) >= 80:
            break
    return merged


async def resolve_models_for_key(
    api_key: str | None,
    *,
    provider: str | None = None,
) -> dict[str, Any]:
    pid = detect_provider(api_key, provider)
    ok = False
    error: str | None = None
    live: list[str] | None = None
    if api_key and not ("•" in api_key or "*" in (api_key or "")):
        ok, error, live = await probe_api_key(pid, api_key)
    models = merge_catalog(pid, live if ok else None)
    chosen = pick_auto_model(models, live if ok else None) if ok else None
    return {
        "provider": pid,
        "provider_label": provider_label(pid),
        "base_url": provider_base_url(pid),
        "live": bool(ok and live is not None),
        "ok": ok,
        "error": error,
        "models": models if ok else [],
        "selected_model": chosen["id"] if chosen else None,
        "selected_label": chosen["label"] if chosen else None,
        "selected_tier": chosen.get("tier", "") if chosen else "",
        "hint": (
            f"{provider_label(pid)} key OK — auto model: {chosen['label']}"
            if ok and chosen
            else (error or f"Detected {provider_label(pid)} — key not validated yet.")
        ),
    }
