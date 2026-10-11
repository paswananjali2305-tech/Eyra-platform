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
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_created
                ON sessions(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_sessions_error
                ON sessions(error_type);

            CREATE TABLE IF NOT EXISTS app_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                project_name TEXT NOT NULL,
                retention_days INTEGER NOT NULL,
                privacy_store_code INTEGER NOT NULL,
                preferred_language TEXT NOT NULL
            );

            INSERT OR IGNORE INTO app_config (
                id, project_name, retention_days, privacy_store_code, preferred_language
            ) VALUES (1, 'default', 90, 1, 'python');
            """
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


def save_session(result: AnalyzeResponse, store_code: bool = True) -> AnalyzeResponse:
    code = result.code_snippet if store_code else "[redacted by privacy setting]"
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO sessions (
                session_id, file_name, language, code_snippet, terminal_output,
                stack_trace, error_type, error_summary, root_cause, explanation,
                evidence_json, timeline_json, correction_json, verification_json,
                related_json, reasoning_source, reasoning_note, status,
                project_name, confidence, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            ),
        )
    return result


def list_sessions(
    *,
    q: str | None = None,
    status: str | None = None,
    language: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[int, list[HistoryItem]]:
    clauses: list[str] = []
    params: list[Any] = []

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
                   project_name, created_at
            FROM sessions
            {where}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            [*params, limit, offset],
        ).fetchall()

    items: list[HistoryItem] = []
    for row in rows:
        verification = json.loads(row["verification_json"])
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
            )
        )
    return total, items


def get_session(session_id: str) -> AnalyzeResponse | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
    if not row:
        return None
    return row_to_analyze_response(row)


def find_related(error_type: str, exclude_id: str | None = None, limit: int = 5) -> list[str]:
    with get_connection() as conn:
        if exclude_id:
            rows = conn.execute(
                """
                SELECT session_id FROM sessions
                WHERE error_type = ? AND session_id != ?
                ORDER BY created_at DESC LIMIT ?
                """,
                (error_type, exclude_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT session_id FROM sessions
                WHERE error_type = ?
                ORDER BY created_at DESC LIMIT ?
                """,
                (error_type, limit),
            ).fetchall()
    return [r["session_id"] for r in rows]


def stats() -> dict[str, int]:
    with get_connection() as conn:
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
    settings = get_settings()
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM app_config WHERE id = 1").fetchone()
    return ConfigResponse(
        project_name=row["project_name"],
        retention_days=row["retention_days"],
        privacy_store_code=bool(row["privacy_store_code"]),
        preferred_language=row["preferred_language"],
        backend_url=f"http://{settings.eyra_host}:{settings.eyra_port}",
        groq_configured=settings.groq_configured,
        groq_model=settings.groq_model,
        supported_languages=["python", "javascript", "typescript"],
        notes={
            "secrets": "API keys are never exposed via this endpoint.",
            "semantic_search": "Not implemented — sessions use SQLite keyword/error-type matching only.",
            "extension": "VS Code Eyes talks to this Brain over HTTP; connectivity is reported by the client.",
        },
    )


def update_config(
    *,
    project_name: str | None = None,
    retention_days: int | None = None,
    privacy_store_code: bool | None = None,
    preferred_language: str | None = None,
) -> ConfigResponse:
    current = get_config()
    with get_connection() as conn:
        conn.execute(
            """
            UPDATE app_config SET
                project_name = ?,
                retention_days = ?,
                privacy_store_code = ?,
                preferred_language = ?
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
            ),
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
