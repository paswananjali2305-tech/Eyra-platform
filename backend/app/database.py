from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

from app.config import get_settings
from app.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    ConfigResponse,
    EvidenceItem,
    HistoryItem,
    SessionStatus,
    SuggestedCorrection,
    TimelineEvent,
    VerificationResult,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _connect(db_path: str | Path) -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    settings = get_settings()
    conn = _connect(settings.eyra_db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                username TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                file_name TEXT NOT NULL,
                language TEXT NOT NULL,
                code_snippet TEXT NOT NULL,
                terminal_output TEXT NOT NULL,
                stack_trace TEXT NOT NULL,
                error_type TEXT NOT NULL,
                error_summary TEXT NOT NULL,
                root_cause TEXT NOT NULL,
                explanation TEXT NOT NULL,
                evidence_json TEXT NOT NULL,
                timeline_json TEXT NOT NULL,
                correction_json TEXT NOT NULL,
                verification_json TEXT NOT NULL,
                related_json TEXT NOT NULL,
                reasoning_source TEXT NOT NULL,
                reasoning_note TEXT NOT NULL,
                status TEXT NOT NULL,
                project_name TEXT NOT NULL,
                confidence REAL,
                created_at TEXT NOT NULL,
                user_id TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_created
                ON sessions(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_sessions_error
                ON sessions(error_type);

            CREATE TABLE IF NOT EXISTS run_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_run_samples_user
                ON run_samples(user_id);

            CREATE TABLE IF NOT EXISTS extension_connect_codes (
                code_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                used_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS extension_credentials (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                revoked_at INTEGER,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_extension_credentials_user
                ON extension_credentials(user_id);

            CREATE TABLE IF NOT EXISTS app_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                project_name TEXT NOT NULL,
                retention_days INTEGER NOT NULL,
                privacy_store_code INTEGER NOT NULL,
                preferred_language TEXT NOT NULL,
                engine_ast INTEGER NOT NULL DEFAULT 1,
                engine_security INTEGER NOT NULL DEFAULT 1,
                engine_todos INTEGER NOT NULL DEFAULT 1,
                engine_deps INTEGER NOT NULL DEFAULT 1
            );
            """
        )
        # Existing DBs keep the old schema under CREATE IF NOT EXISTS — migrate first,
        # then seed the singleton row (INSERT must not run before engine_* columns exist).
        _ensure_app_config_engine_columns(conn)
        _ensure_sessions_user_id(conn)
        _ensure_session_kind(conn)
        conn.execute(
            """
            INSERT OR IGNORE INTO app_config (
                id, project_name, retention_days, privacy_store_code, preferred_language,
                engine_ast, engine_security, engine_todos, engine_deps
            ) VALUES (1, 'default', 90, 1, 'python', 1, 1, 1, 1)
            """
        )
        # Startup must not delete sessions by filename or project name.


def _ensure_sessions_user_id(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(sessions)").fetchall()}
    if "user_id" not in cols:
        conn.execute("ALTER TABLE sessions ADD COLUMN user_id TEXT")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)"
    )


def _ensure_session_kind(conn: sqlite3.Connection) -> None:
    """user = normal investigation. internal_test is explicit and never inferred from a filename.

    Legacy rows gain session_kind='user' via the column default. Nothing is deleted.
    """
    cols = {row[1] for row in conn.execute("PRAGMA table_info(sessions)").fetchall()}
    if "session_kind" not in cols:
        conn.execute(
            "ALTER TABLE sessions ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'user'"
        )


def clear_sessions(*, user_id: str | None = None) -> int:
    """Delete Brain investigation sessions (optionally scoped to one user)."""
    with get_connection() as conn:
        if user_id:
            cur = conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        else:
            cur = conn.execute("DELETE FROM sessions")
        return int(cur.rowcount or 0)


def create_user(
    *,
    email: str,
    username: str,
    display_name: str,
    password_hash: str,
) -> dict[str, Any]:
    user_id = str(uuid4())
    created = _utcnow().isoformat()
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO users (id, email, username, display_name, password_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, email, username, display_name, password_hash, created),
        )
    return {
        "id": user_id,
        "email": email,
        "username": username,
        "display_name": display_name,
        "created_at": created,
    }


def get_user_by_id(user_id: str) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def get_user_by_email(email: str) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM users WHERE lower(email) = lower(?)", (email,)
        ).fetchone()


def get_user_by_username(username: str) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM users WHERE lower(username) = lower(?)", (username,)
        ).fetchone()


def get_user_by_login(login: str) -> sqlite3.Row | None:
    """Resolve login by email or username."""
    login = (login or "").strip()
    if not login:
        return None
    if "@" in login:
        return get_user_by_email(login)
    return get_user_by_username(login) or get_user_by_email(login)


def _ensure_app_config_engine_columns(conn: sqlite3.Connection) -> None:
    """Add college-scope engine toggles to existing DBs created before these columns."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(app_config)").fetchall()}
    for name in ("engine_ast", "engine_security", "engine_todos", "engine_deps"):
        if name not in cols:
            conn.execute(
                f"ALTER TABLE app_config ADD COLUMN {name} INTEGER NOT NULL DEFAULT 1"
            )


def row_to_analyze_response(row: sqlite3.Row) -> AnalyzeResponse:
    return AnalyzeResponse(
        session_id=row["session_id"],
        status=SessionStatus(row["status"]),
        error_type=row["error_type"],
        error_summary=row["error_summary"],
        root_cause=row["root_cause"],
        explanation=row["explanation"],
        evidence=[EvidenceItem(**e) for e in json.loads(row["evidence_json"])],
        execution_timeline=[TimelineEvent(**t) for t in json.loads(row["timeline_json"])],
        suggested_correction=SuggestedCorrection(**json.loads(row["correction_json"])),
        verification=VerificationResult(**json.loads(row["verification_json"])),
        related_session_ids=json.loads(row["related_json"]),
        reasoning_source=row["reasoning_source"],
        reasoning_note=row["reasoning_note"],
        file_name=row["file_name"],
        language=row["language"],
        code_snippet=row["code_snippet"],
        terminal_output=row["terminal_output"],
        stack_trace=row["stack_trace"],
        project_name=row["project_name"],
        created_at=datetime.fromisoformat(row["created_at"]),
        confidence=row["confidence"],
    )


def save_session(
    result: AnalyzeResponse,
    store_code: bool = True,
    *,
    user_id: str | None = None,
    session_kind: str = "user",
) -> AnalyzeResponse:
    kind = session_kind if session_kind in {"user", "internal_test"} else "user"
    code = result.code_snippet if store_code else "[redacted by privacy setting]"
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO sessions (
                session_id, file_name, language, code_snippet, terminal_output,
                stack_trace, error_type, error_summary, root_cause, explanation,
                evidence_json, timeline_json, correction_json, verification_json,
                related_json, reasoning_source, reasoning_note, status,
                project_name, confidence, created_at, user_id, session_kind
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result.session_id,
                result.file_name,
                result.language,
                code,
                result.terminal_output,
                result.stack_trace,
                result.error_type,
                result.error_summary,
                result.root_cause,
                result.explanation,
                json.dumps([e.model_dump() for e in result.evidence]),
                json.dumps([t.model_dump() for t in result.execution_timeline]),
                json.dumps(result.suggested_correction.model_dump()),
                json.dumps(result.verification.model_dump()),
                json.dumps(result.related_session_ids),
                result.reasoning_source,
                result.reasoning_note,
                result.status.value,
                result.project_name,
                result.confidence,
                result.created_at.isoformat(),
                user_id,
                kind,
            ),
        )
    return result


def list_sessions(
    *,
    q: str | None = None,
    status: str | None = None,
    language: str | None = None,
    user_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[int, list[HistoryItem]]:
    clauses: list[str] = []
    params: list[Any] = []

    if user_id:
        clauses.append("user_id = ?")
        params.append(user_id)
    # Filename is never used to hide a session. Only an explicit internal_test mark is.
    clauses.append("COALESCE(session_kind, 'user') != 'internal_test'")
    if q:
        clauses.append(
            "(error_type LIKE ? OR file_name LIKE ? OR root_cause LIKE ? OR error_summary LIKE ?)"
        )
        like = f"%{q}%"
        params.extend([like, like, like, like])
    if status:
        clauses.append("status = ?")
        params.append(status)
    if language:
        clauses.append("language = ?")
        params.append(language)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with get_connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) AS c FROM sessions {where}", params).fetchone()["c"]
        rows = conn.execute(
            f"""
            SELECT session_id, file_name, language, error_type, error_summary,
                   root_cause, status, verification_json, reasoning_source,
                   project_name, confidence, created_at
            FROM sessions
            {where}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()

        items: list[HistoryItem] = []
        for row in rows:
            verification = json.loads(row["verification_json"] or "{}")
            # Honest relatedness: count of sessions with the same error_type (exact match)
            if user_id:
                same_n = conn.execute(
                    "SELECT COUNT(*) AS c FROM sessions WHERE error_type = ? AND user_id = ?",
                    (row["error_type"], user_id),
                ).fetchone()["c"]
            else:
                same_n = conn.execute(
                    "SELECT COUNT(*) AS c FROM sessions WHERE error_type = ?",
                    (row["error_type"],),
                ).fetchone()["c"]
            items.append(
                HistoryItem(
                    session_id=row["session_id"],
                    file_name=row["file_name"],
                    language=row["language"],
                    error_type=row["error_type"],
                    error_summary=row["error_summary"],
                    root_cause=row["root_cause"],
                    status=SessionStatus(row["status"]),
                    verification_status=verification.get("status", "not_run"),
                    reasoning_source=row["reasoning_source"],
                    project_name=row["project_name"],
                    created_at=datetime.fromisoformat(row["created_at"]),
                    confidence=row["confidence"],
                    same_error_count=int(same_n or 0),
                )
            )
    return total, items


def get_session(
    session_id: str,
    *,
    user_id: str | None = None,
) -> AnalyzeResponse | None:
    with get_connection() as conn:
        if user_id:
            row = conn.execute(
                """
                SELECT * FROM sessions
                WHERE session_id = ? AND user_id = ?
                  AND COALESCE(session_kind, 'user') != 'internal_test'
                """,
                (session_id, user_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
    if not row:
        return None
    return row_to_analyze_response(row)


def find_related(
    error_type: str,
    exclude_id: str | None = None,
    limit: int = 5,
    *,
    user_id: str | None = None,
) -> list[str]:
    """Related sessions = exact error_type match only (no embeddings / AST fingerprint)."""
    with get_connection() as conn:
        clauses = ["error_type = ?"]
        params: list[Any] = [error_type]
        if user_id:
            clauses.append("user_id = ?")
            params.append(user_id)
        if exclude_id:
            clauses.append("session_id != ?")
            params.append(exclude_id)
        where = " AND ".join(clauses)
        rows = conn.execute(
            f"""
            SELECT session_id FROM sessions
            WHERE {where}
            ORDER BY created_at DESC LIMIT ?
            """,
            [*params, limit],
        ).fetchall()
    return [r["session_id"] for r in rows]


def record_run_duration(user_id: str | None, duration_ms: int) -> None:
    """Store one real sandbox run so overview can average execution time."""
    if not user_id:
        return
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO run_samples (user_id, duration_ms, created_at)
            VALUES (?, ?, ?)
            """,
            (user_id, max(0, int(duration_ms)), _utcnow().isoformat()),
        )


def execution_timing(*, user_id: str | None) -> dict[str, int | None]:
    if not user_id:
        return {"avg_execution_ms": None, "execution_count": 0}
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS c, AVG(duration_ms) AS avg_ms
            FROM run_samples
            WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()
    count = int(row["c"] or 0)
    if count == 0 or row["avg_ms"] is None:
        return {"avg_execution_ms": None, "execution_count": 0}
    return {"avg_execution_ms": int(round(float(row["avg_ms"]))), "execution_count": count}


def stats(*, user_id: str | None = None) -> dict[str, int]:
    with get_connection() as conn:
        if user_id:
            total = conn.execute(
                "SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?", (user_id,)
            ).fetchone()["c"]
            verified = conn.execute(
                "SELECT COUNT(*) AS c FROM sessions WHERE status = ? AND user_id = ?",
                (SessionStatus.VERIFIED.value, user_id),
            ).fetchone()["c"]
            open_count = conn.execute(
                "SELECT COUNT(*) AS c FROM sessions WHERE status IN (?, ?) AND user_id = ?",
                (
                    SessionStatus.NEEDS_REVIEW.value,
                    SessionStatus.HYPOTHESIS.value,
                    user_id,
                ),
            ).fetchone()["c"]
        else:
            total = conn.execute("SELECT COUNT(*) AS c FROM sessions").fetchone()["c"]
            verified = conn.execute(
                "SELECT COUNT(*) AS c FROM sessions WHERE status = ?",
                (SessionStatus.VERIFIED.value,),
            ).fetchone()["c"]
            open_count = conn.execute(
                "SELECT COUNT(*) AS c FROM sessions WHERE status IN (?, ?)",
                (SessionStatus.NEEDS_REVIEW.value, SessionStatus.HYPOTHESIS.value),
            ).fetchone()["c"]
    return {
        "session_count": total,
        "verified_count": verified,
        "open_investigations": open_count,
    }


def get_config() -> ConfigResponse:
    from app.groq_settings import mask_api_key
    from app.llm_catalog import curated_models, detect_provider, provider_label
    from app.schemas import LlmModelOption

    settings = get_settings()
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM app_config WHERE id = 1").fetchone()
    provider = detect_provider(
        settings.groq_api_key if settings.groq_configured else None,
        getattr(settings, "llm_provider", None) or "groq",
    )
    tagged = curated_models(provider)
    model_ids = [m["id"] for m in tagged]
    for m in (settings.groq_model_runtime, settings.groq_model_audit, settings.groq_model):
        if m and m not in model_ids:
            model_ids.insert(0, m)
            tagged.insert(
                0,
                {
                    "id": m,
                    "tier": "",
                    "note": "Currently configured",
                    "label": m,
                    "recommended": False,
                },
            )
    def _engine(key: str) -> bool:
        try:
            return bool(row[key])
        except (IndexError, KeyError):
            return True

    return ConfigResponse(
        project_name=row["project_name"],
        retention_days=row["retention_days"],
        privacy_store_code=bool(row["privacy_store_code"]),
        preferred_language=row["preferred_language"],
        engine_ast=_engine("engine_ast"),
        engine_security=_engine("engine_security"),
        engine_todos=_engine("engine_todos"),
        engine_deps=_engine("engine_deps"),
        backend_url=f"http://{settings.eyra_host}:{settings.eyra_port}",
        groq_configured=settings.groq_configured,
        groq_model=settings.groq_model_runtime or settings.groq_model,
        groq_model_runtime=settings.groq_model_runtime,
        groq_model_audit=settings.groq_model_audit,
        groq_api_key_masked=mask_api_key(settings.groq_api_key),
        groq_models=model_ids,
        llm_provider=provider,
        llm_provider_label=provider_label(provider),
        llm_models=[LlmModelOption(**m) for m in tagged],
        llm_hint=(
            f"Provider: {provider_label(provider)}. "
            "Fast = low latency · Best balanced = recommended · Best quality = strongest."
        ),
        supported_languages=["python", "javascript", "typescript"],
        notes={
            "secrets": "API keys are never returned in full — only a masked hint.",
            "semantic_search": "Not implemented — sessions use SQLite keyword/error-type matching only.",
            "extension": "VS Code Eyes talks to this Brain over HTTP; connectivity is reported by the client.",
            "llm": "Key/model/provider are written to backend/.env and applied immediately.",
            "engines": (
                "engine_ast → AST/quality; engine_security → SEC/secret rules filter; "
                "engine_todos → TODO/partials; engine_deps → offline KNOWN_CVES dependency audit."
            ),
        },
    )


def update_config(
    *,
    project_name: str | None = None,
    retention_days: int | None = None,
    privacy_store_code: bool | None = None,
    preferred_language: str | None = None,
    engine_ast: bool | None = None,
    engine_security: bool | None = None,
    engine_todos: bool | None = None,
    engine_deps: bool | None = None,
    groq_api_key: str | None = None,
    groq_model: str | None = None,
    groq_model_runtime: str | None = None,
    groq_model_audit: str | None = None,
    llm_provider: str | None = None,
) -> ConfigResponse:
    from app.groq_settings import apply_groq_config

    current = get_config()
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE app_config SET
                project_name = ?,
                retention_days = ?,
                privacy_store_code = ?,
                preferred_language = ?,
                engine_ast = ?,
                engine_security = ?,
                engine_todos = ?,
                engine_deps = ?
            WHERE id = 1
            """,
            (
                project_name if project_name is not None else current.project_name,
                retention_days if retention_days is not None else current.retention_days,
                int(
                    privacy_store_code
                    if privacy_store_code is not None
                    else current.privacy_store_code
                ),
                preferred_language
                if preferred_language is not None
                else current.preferred_language,
                int(engine_ast if engine_ast is not None else current.engine_ast),
                int(
                    engine_security
                    if engine_security is not None
                    else current.engine_security
                ),
                int(engine_todos if engine_todos is not None else current.engine_todos),
                int(engine_deps if engine_deps is not None else current.engine_deps),
            ),
        )

    apply_groq_config(
        groq_api_key=groq_api_key,
        groq_model=groq_model,
        groq_model_runtime=groq_model_runtime,
        groq_model_audit=groq_model_audit,
        llm_provider=llm_provider,
    )
    return get_config()


def new_session_id() -> str:
    return f"EYRA-{uuid4().hex[:12].upper()}"


def database_ok() -> bool:
    try:
        with get_connection() as conn:
            conn.execute("SELECT 1").fetchone()
        return True
    except Exception:
        return False
