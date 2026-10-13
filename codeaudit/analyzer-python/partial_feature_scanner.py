"""
Partial and Incomplete Feature Implementation Scanner
Detects TODOs, FIXMEs, stubs, unimplemented errors, and temporary mock returns.
Calculates estimated completion effort and risk level.
"""
import re
from typing import List, Dict, Any

PARTIAL_PATTERNS = [
    {
        "regex": r"(?:\bTODO\b|\bFIXME\b|\bXXX\b|\bHACK\b)[:\s]*(.*)",
        "type": "TODO/FIXME",
        "severity": "Medium",
        "default_effort": 2.5
    },
    {
        "regex": r"(?:raise\s+NotImplementedError|throw\s+new\s+Error\s*\(\s*['\"](?:not implemented|TODO)['\"]\s*\))",
        "type": "Unimplemented Exception",
        "severity": "High",
        "default_effort": 4.0
    },
    {
        "regex": r"(?:return\s+null\s*;\s*\/\/\s*temp|return\s+None\s*#\s*temp|return\s+\{\s*mock:\s*true|\/\/\s*stub)",
        "type": "Mock/Stub Return",
        "severity": "High",
        "default_effort": 3.0
    },
    {
        "regex": r"(?:res\.status\(\s*501\s*\)|res\.status\(\s*200\s*\)\.json\(\s*\{\s*status:\s*['\"]pending_implementation['\"])",
        "type": "Stubbed API Endpoint",
        "severity": "High",
        "default_effort": 5.0
    }
]

def estimate_effort_and_risk(comment: str, pattern_type: str) -> Dict[str, Any]:
    comment_lower = comment.lower()
    effort_hours = 2.0
    risk = "Medium"

    if any(term in comment_lower for term in ["auth", "payment", "security", "encryption", "token", "permission"]):
        risk = "Critical"
        effort_hours += 3.5
    elif any(term in comment_lower for term in ["database", "transaction", "migrate", "race condition", "deadlock"]):
        risk = "High"
        effort_hours += 2.5
    elif any(term in comment_lower for term in ["ui", "style", "cleanup", "refactor", "comment"]):
        risk = "Low"
        effort_hours = 1.0

    if pattern_type == "Unimplemented Exception":
        effort_hours = max(effort_hours, 4.0)
        risk = "High" if risk == "Low" else risk

    return {
        "effortHours": round(effort_hours, 1),
        "risk": risk
    }

def scan_for_partial_implementations(filepath: str, content: str) -> List[Dict[str, Any]]:
    items = []
    lines = content.splitlines()

    for line_idx, line in enumerate(lines, 1):
        for pat in PARTIAL_PATTERNS:
            match = re.search(pat["regex"], line, re.IGNORECASE)
            if match:
                comment_text = match.group(1).strip() if match.groups() else line.strip()
                meta = estimate_effort_and_risk(comment_text, pat["type"])

                start = max(1, line_idx - 2)
                end = min(len(lines), line_idx + 2)
                snippet = "\n".join([f"{i}: {lines[i-1]}" for i in range(start, end + 1)])

                items.append({
                    "id": f"PARTIAL-{line_idx}-{len(items)}",
                    "file": filepath,
                    "line": line_idx,
                    "type": pat["type"],
                    "severity": meta["risk"],
                    "featureDescription": comment_text or f"Incomplete implementation ({pat['type']})",
                    "estimatedEffortHours": meta["effortHours"],
                    "risk": meta["risk"],
                    "snippet": snippet,
                    "aiRecommendation": f"Complete implementation of '{comment_text or pat['type']}' with unit tests and proper validation before shipping to production."
                })

    return items
