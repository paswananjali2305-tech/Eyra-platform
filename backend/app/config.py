from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = BACKEND_ROOT / "data" / "eyra_memory.sqlite"

DEFAULT_RUNTIME_MODEL = "openai/gpt-oss-20b"
DEFAULT_AUDIT_MODEL = "openai/gpt-oss-120b"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    groq_api_key: str = ""
    # Backward-compatible single model (maps to runtime if runtime unset)
    groq_model: str = DEFAULT_RUNTIME_MODEL
    groq_model_runtime: str = ""
    groq_model_audit: str = ""
    # OpenAI-compatible LLM routing (groq | openai | openrouter)
    llm_provider: str = "groq"
    llm_base_url: str = ""
    eyra_host: str = "127.0.0.1"
    eyra_port: int = 8000
    eyra_db_path: str = str(DEFAULT_DB)
    eyra_allow_local_fallback: bool = True
    eyra_cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:5174,http://127.0.0.1:5174"
    )
    eyra_audit_base_url: str = "http://127.0.0.1:5000"
    eyra_exec_timeout_s: float = 30.0
    eyra_audit_enrich_limit: int = Field(default=12, ge=1, le=40)
    # HMAC secret for access tokens (set EYRA_AUTH_SECRET in .env for production-like demos)
    eyra_auth_secret: str = ""

    @model_validator(mode="after")
    def resolve_model_aliases(self) -> "Settings":
        runtime = (self.groq_model_runtime or self.groq_model or DEFAULT_RUNTIME_MODEL).strip()
        audit = (self.groq_model_audit or DEFAULT_AUDIT_MODEL).strip()
        self.groq_model_runtime = runtime
        self.groq_model_audit = audit
        # Keep groq_model as the runtime model for older clients/status fields
        self.groq_model = runtime
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.eyra_cors_origins.split(",") if o.strip()]

    @property
    def groq_configured(self) -> bool:
        return bool(self.groq_api_key.strip())

    def model_for_profile(self, profile: str) -> str:
        if (profile or "").lower() == "audit":
            return self.groq_model_audit
        return self.groq_model_runtime


@lru_cache
def get_settings() -> Settings:
    return Settings()
