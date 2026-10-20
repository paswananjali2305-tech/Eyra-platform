"""Map client-supplied VS Code diagnostics into evidence with clear provenance."""

from __future__ import annotations

from app.schemas import AnalyzeRequest, EvidenceItem

VSCODE_DIAGNOSTIC_KIND = "vscode_diagnostic"


def evidence_from_diagnostics(req: AnalyzeRequest) -> list[EvidenceItem]:
    """Build evidence items that cite actual VS Code Problems (never invented)."""
    items: list[EvidenceItem] = []
    for diag in req.diagnostics or []:
        # Location uses 1-based line for display consistency with stack traces
        location = f"{diag.file_name}:{diag.line + 1}"
        parts = [f"[VS Code {diag.severity}] {diag.message.strip()}"]
        if diag.source:
            parts.append(f"source={diag.source}")
        if diag.code:
            parts.append(f"code={diag.code}")
        detail = "; ".join(parts)[:500]
        items.append(
            EvidenceItem(
                kind=VSCODE_DIAGNOSTIC_KIND,
                detail=detail,
                location=location,
            )
        )
    return items


def merge_diagnostic_evidence(
    diagnostic_evidence: list[EvidenceItem],
    draft_evidence: list[EvidenceItem],
) -> list[EvidenceItem]:
    """Prefer client diagnostics first; never keep invented vscode_diagnostic items."""
    allowed_diag = {(item.location, item.detail) for item in diagnostic_evidence}
    seen: set[tuple[str, str | None, str]] = set()
    merged: list[EvidenceItem] = []
    for item in [*diagnostic_evidence, *draft_evidence]:
        if item.kind == VSCODE_DIAGNOSTIC_KIND and (item.location, item.detail) not in allowed_diag:
            # Model or heuristic invented a VS Code diagnostic — drop it.
            continue
        key = (item.kind, item.location, item.detail)
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged
