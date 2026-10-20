import os

os.environ.setdefault("EYRA_SKIP_AUDIT_ENGINE", "1")
os.environ.setdefault("EYRA_ALLOW_LOCAL_FALLBACK", "true")
os.environ.setdefault("GROQ_API_KEY", "")


def use_test_db(path) -> None:
    os.environ["EYRA_DB_PATH"] = str(path)
    os.environ["EYRA_SKIP_AUDIT_ENGINE"] = "1"
    os.environ["EYRA_ALLOW_LOCAL_FALLBACK"] = "true"
    os.environ["GROQ_API_KEY"] = ""
    from app.config import get_settings

    get_settings.cache_clear()
