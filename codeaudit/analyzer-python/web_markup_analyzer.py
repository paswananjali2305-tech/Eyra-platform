"""
Heuristic static checks for HTML, CSS, and Markdown.
Media binaries are never analyzed here — only text markup/docs.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List


def _issue(
    filepath: str,
    line: int,
    rule_id: str,
    title: str,
    description: str,
    severity: str,
    suggestion: str,
    snippet: str,
    confidence: float = 0.9,
    issue_type: str = "Markup Risk",
) -> Dict[str, Any]:
    return {
        "id": f"{rule_id}-{line}",
        "ruleId": rule_id,
        "file": filepath,
        "line": line,
        "column": 1,
        "severity": severity,
        "type": issue_type,
        "title": title,
        "description": description,
        "confidence": confidence,
        "snippet": snippet,
        "suggestion": suggestion,
        "sourceTool": "eyra-markup",
    }


def _snippet(lines: List[str], line_idx: int, pad: int = 1) -> str:
    start = max(1, line_idx - pad)
    end = min(len(lines), line_idx + pad)
    return "\n".join(f"{i}: {lines[i - 1]}" for i in range(start, end + 1))


def analyze_html(filepath: str, content: str) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    lines = content.splitlines()
    lower_all = content.lower()

    if "<html" in lower_all and "lang=" not in lower_all:
        issues.append(
            _issue(
                filepath,
                1,
                "HTML-A11Y-001",
                "Missing lang attribute on document",
                "Root HTML document has no lang attribute, which hurts accessibility and SEO.",
                "Medium",
                'Add lang on <html>, e.g. <html lang="en">.',
                lines[0] if lines else "<html>",
                0.85,
                "Accessibility",
            )
        )

    patterns = [
        (
            r"<script[^>]+src=[\"'][^\"']+[\"'][^>]*(?<!defer)(?<!async)>",
            "HTML-PERF-001",
            "Blocking external script without defer/async",
            "External scripts without defer/async can block first paint.",
            "Low",
            "Add defer or async on non-critical script tags.",
            0.75,
            "Performance",
        ),
        (
            r"javascript:\s*",
            "HTML-SEC-001",
            "javascript: URL handler",
            "javascript: URLs are an XSS vector and blocked by modern CSP defaults.",
            "High",
            "Use addEventListener handlers instead of javascript: links.",
            0.92,
            "Security",
        ),
        (
            r"\son\w+\s*=\s*[\"'][^\"']*[\"']",
            "HTML-SEC-002",
            "Inline event handler attribute",
            "Inline onclick/onerror handlers are harder to audit and often blocked by CSP.",
            "Medium",
            "Move handlers to external JS with addEventListener.",
            0.88,
            "Security",
        ),
        (
            r"<iframe(?![^>]*\bsandbox\b)[^>]*>",
            "HTML-SEC-003",
            "iframe without sandbox",
            "Unsandboxed iframes can expand attack surface if src is untrusted.",
            "Medium",
            "Add a restrictive sandbox attribute when embedding third-party content.",
            0.8,
            "Security",
        ),
        (
            r"<a\s+[^>]*target=[\"']_blank[\"'](?![^>]*rel=)",
            "HTML-SEC-004",
            "target=_blank without rel",
            "target=_blank without rel=\"noopener noreferrer\" enables tab-nabbing.",
            "Medium",
            'Add rel="noopener noreferrer" on target="_blank" links.',
            0.9,
            "Security",
        ),
        (
            r"<img(?![^>]*\balt=)[^>]*>",
            "HTML-A11Y-002",
            "Image missing alt attribute",
            "Images without alt text fail basic accessibility checks.",
            "Medium",
            'Add alt="..." (or alt="" for decorative images).',
            0.86,
            "Accessibility",
        ),
        (
            r"http://(?!localhost|127\.0\.0\.1)",
            "HTML-SEC-005",
            "Insecure http:// resource",
            "Loading assets over plain HTTP can cause mixed-content warnings and MITM risk.",
            "Medium",
            "Prefer https:// URLs for external resources.",
            0.84,
            "Security",
        ),
        (
            r"<script(?![^>]*\bsrc=)[^>]*>",
            "HTML-SEC-006",
            "Inline <script> block",
            "Inline scripts complicate CSP and make XSS review harder.",
            "Low",
            "Prefer external .js files with nonce/hash CSP where possible.",
            0.7,
            "Security",
        ),
    ]

    for line_idx, line in enumerate(lines, 1):
        for regex, rule_id, title, desc, sev, sugg, conf, typ in patterns:
            if re.search(regex, line, flags=re.IGNORECASE):
                # Avoid double-flagging target=_blank when rel is on same tag
                if rule_id == "HTML-SEC-004" and re.search(
                    r'rel\s*=\s*["\'][^"\']*noopener', line, flags=re.IGNORECASE
                ):
                    continue
                issues.append(
                    _issue(
                        filepath,
                        line_idx,
                        rule_id,
                        title,
                        desc,
                        sev,
                        sugg,
                        _snippet(lines, line_idx),
                        conf,
                        typ,
                    )
                )

    # Extract inline script bodies and reuse JS-ish danger patterns lightly
    for m in re.finditer(
        r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>",
        content,
        flags=re.IGNORECASE | re.DOTALL,
    ):
        body = m.group(1) or ""
        # Map body start to approximate line
        start_line = content[: m.start()].count("\n") + 1
        for bi, bline in enumerate(body.splitlines(), start_line):
            if re.search(r"\beval\s*\(", bline):
                issues.append(
                    _issue(
                        filepath,
                        bi,
                        "HTML-JS-EVAL",
                        "eval() inside inline script",
                        "eval in page scripts enables arbitrary code execution if input is attacker-controlled.",
                        "Critical",
                        "Remove eval; use JSON.parse or safe parsers.",
                        bline.strip()[:200],
                        0.95,
                        "Security",
                    )
                )
            if re.search(r"\.innerHTML\s*=", bline):
                issues.append(
                    _issue(
                        filepath,
                        bi,
                        "HTML-JS-XSS",
                        "innerHTML assignment in inline script",
                        "Assigning to innerHTML from unsanitized data enables DOM XSS.",
                        "High",
                        "Use textContent or sanitize HTML before injection.",
                        bline.strip()[:200],
                        0.92,
                        "Security",
                    )
                )

    return issues


def analyze_css(filepath: str, content: str) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    lines = content.splitlines()

    patterns = [
        (
            r"expression\s*\(",
            "CSS-SEC-001",
            "Legacy CSS expression()",
            "CSS expression() is obsolete and was an IE script-execution vector.",
            "High",
            "Remove expression(); use modern layout/JS instead.",
            0.95,
            "Security",
        ),
        (
            r"behavior\s*:",
            "CSS-SEC-002",
            "Legacy CSS behavior property",
            "CSS behavior can load HTC/script behaviors in old IE.",
            "Medium",
            "Remove behavior properties.",
            0.9,
            "Security",
        ),
        (
            r"-moz-binding\s*:",
            "CSS-SEC-003",
            "XBL -moz-binding",
            "-moz-binding can load external bindings and is a historical XSS vector.",
            "High",
            "Remove -moz-binding.",
            0.92,
            "Security",
        ),
        (
            r"url\s*\(\s*[\"']?javascript:",
            "CSS-SEC-004",
            "javascript: URL in CSS",
            "javascript: URLs inside CSS url() are unsafe.",
            "Critical",
            "Never use javascript: in CSS urls.",
            0.96,
            "Security",
        ),
        (
            r"!important",
            "CSS-SMELL-001",
            "Heavy use of !important",
            "!important increases specificity wars and makes styles harder to maintain.",
            "Low",
            "Prefer structured specificity over !important except rare overrides.",
            0.65,
            "Code Smell",
        ),
        (
            r"position\s*:\s*fixed",
            "CSS-A11Y-001",
            "Fixed positioning",
            "Fixed elements can obscure content and harm mobile accessibility if overused.",
            "Low",
            "Ensure fixed UI does not trap focus or cover interactive content.",
            0.6,
            "Accessibility",
        ),
    ]

    important_count = 0
    for line_idx, line in enumerate(lines, 1):
        if re.search(r"!important", line, flags=re.IGNORECASE):
            important_count += 1
        for regex, rule_id, title, desc, sev, sugg, conf, typ in patterns:
            if rule_id == "CSS-SMELL-001":
                continue  # reported once below if threshold hit
            if re.search(regex, line, flags=re.IGNORECASE):
                issues.append(
                    _issue(
                        filepath,
                        line_idx,
                        rule_id,
                        title,
                        desc,
                        sev,
                        sugg,
                        _snippet(lines, line_idx),
                        conf,
                        typ,
                    )
                )

    if important_count >= 8:
        issues.append(
            _issue(
                filepath,
                1,
                "CSS-SMELL-001",
                f"Many !important declarations ({important_count})",
                "High volume of !important usually signals brittle CSS architecture.",
                "Low",
                "Refactor selectors/cascade to reduce !important reliance.",
                f"{important_count} !important usages in file",
                0.7,
                "Code Smell",
            )
        )

    return issues


def analyze_markdown(filepath: str, content: str) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    lines = content.splitlines()

    for line_idx, line in enumerate(lines, 1):
        # Hardcoded secrets-looking tokens in docs (light)
        if re.search(r"(?i)(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}", line):
            if not re.search(r"(?i)(example|placeholder|your_|xxx|todo)", line):
                issues.append(
                    _issue(
                        filepath,
                        line_idx,
                        "MD-SEC-001",
                        "Possible secret in Markdown",
                        "Documentation appears to embed a live-looking credential.",
                        "High",
                        "Replace with placeholders; never commit real secrets in docs.",
                        line.strip()[:200],
                        0.8,
                        "Security",
                    )
                )

        # javascript: links in markdown
        if re.search(r"\]\(\s*javascript:", line, flags=re.IGNORECASE):
            issues.append(
                _issue(
                    filepath,
                    line_idx,
                    "MD-SEC-002",
                    "javascript: link in Markdown",
                    "javascript: links in docs can be copied into apps and become XSS vectors.",
                    "Medium",
                    "Use https:// links or omit executable URLs.",
                    line.strip()[:200],
                    0.85,
                    "Security",
                )
            )

        # http:// external links
        if re.search(r"\]\(\s*http://(?!localhost|127\.0\.0\.1)", line, flags=re.IGNORECASE):
            issues.append(
                _issue(
                    filepath,
                    line_idx,
                    "MD-SEC-003",
                    "Insecure http:// link in Markdown",
                    "Documented http:// links encourage insecure fetches.",
                    "Low",
                    "Prefer https:// documentation links.",
                    line.strip()[:200],
                    0.7,
                    "Security",
                )
            )

    if not any(l.strip().startswith("#") for l in lines[:40]):
        if len(lines) > 15:
            issues.append(
                _issue(
                    filepath,
                    1,
                    "MD-STYLE-001",
                    "Markdown missing top-level heading",
                    "Longer docs without an H1/H2 heading are harder to navigate.",
                    "Low",
                    "Start with a # Title heading.",
                    lines[0] if lines else "",
                    0.6,
                    "Documentation",
                )
            )

    return issues


def analyze_web_markup(filepath: str, content: str, ext: str) -> List[Dict[str, Any]]:
    ext = (ext or "").lower()
    if ext in (".html", ".htm"):
        return analyze_html(filepath, content)
    if ext in (".css", ".scss"):
        return analyze_css(filepath, content)
    if ext in (".md", ".markdown"):
        return analyze_markdown(filepath, content)
    return []
