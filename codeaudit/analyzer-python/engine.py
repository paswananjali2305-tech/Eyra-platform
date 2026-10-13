"""
Main Python Static & AST Analysis Engine
Executes complete static audit across directory tree and outputs structured JSON.
"""
import os
import sys
import json
import argparse
from pathlib import Path
from typing import Dict, Any, List

from ast_parser import analyze_python_ast, analyze_js_ts_heuristics
from complexity import analyze_complexity
from secret_detector import scan_for_secrets
from partial_feature_scanner import scan_for_partial_implementations
from web_markup_analyzer import analyze_web_markup

IGNORE_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build",
    ".idea", ".vscode", "coverage", ".next", "vendor", ".mypy_cache"
}

# Text/source audited by AST/heuristics. Media (jpg/mp3/ico/…) stays excluded.
ALLOWED_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".sql", ".sh", ".env", ".yaml", ".yml",
    ".html", ".htm", ".css", ".scss", ".md", ".markdown",
}

def is_test_file(rel_path: str) -> bool:
    lower = rel_path.lower()
    return any(t in lower for t in ["test", "spec", "_test.py", "test_", ".spec.js", ".test.js", ".test.ts"])

def audit_directory(root_dir: str) -> Dict[str, Any]:
    root_path = Path(root_dir).resolve()
    if not root_path.exists():
        return {"error": f"Path '{root_dir}' does not exist."}

    all_issues: List[Dict[str, Any]] = []
    all_partial_features: List[Dict[str, Any]] = []
    file_summaries: List[Dict[str, Any]] = []
    source_files: List[str] = []
    test_files: List[str] = []
    unreadable_files: List[Dict[str, str]] = []
    parser_failures: List[Dict[str, str]] = []
    unsupported_skipped = 0

    total_loc = 0

    for current_dir, dirs, files in os.walk(root_path):
        # In-place modify dirs to skip ignored directories
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]

        for filename in files:
            file_path = Path(current_dir) / filename
            ext = file_path.suffix.lower()

            if ext not in ALLOWED_EXTENSIONS:
                unsupported_skipped += 1
                continue

            rel_path = str(file_path.relative_to(root_path)).replace("\\", "/")

            if is_test_file(rel_path):
                test_files.append(rel_path)
            else:
                source_files.append(rel_path)

            try:
                content = file_path.read_text(encoding="utf-8", errors="strict")
            except UnicodeDecodeError:
                try:
                    content = file_path.read_text(encoding="utf-8", errors="replace")
                    unreadable_files.append({
                        "file": rel_path,
                        "reason": "decoded_with_replacement (non-utf8 bytes)",
                    })
                except Exception as e:
                    unreadable_files.append({"file": rel_path, "reason": str(e)})
                    continue
            except Exception as e:
                unreadable_files.append({"file": rel_path, "reason": str(e)})
                continue

            file_issues = []

            # 1. AST or Static Bug Patterns
            try:
                if ext == ".py":
                    file_issues.extend(analyze_python_ast(rel_path, content))
                elif ext in (".js", ".jsx", ".ts", ".tsx"):
                    file_issues.extend(analyze_js_ts_heuristics(rel_path, content))
                elif ext in (".html", ".htm", ".css", ".scss", ".md", ".markdown"):
                    file_issues.extend(analyze_web_markup(rel_path, content, ext))
            except Exception as parse_err:
                parser_failures.append({"file": rel_path, "reason": str(parse_err)})
                file_issues.append({
                    "id": f"PARSE-FAIL-{hash(rel_path) % 100000}",
                    "ruleId": "PARSER-FAILURE",
                    "file": rel_path,
                    "line": 1,
                    "column": 1,
                    "severity": "Medium",
                    "type": "Parser Failure",
                    "title": f"Parser failure while analyzing '{Path(rel_path).name}'",
                    "description": f"Static analysis could not fully parse this file: {parse_err}",
                    "confidence": 0.7,
                    "snippet": "",
                    "suggestion": "Inspect file encoding/syntax; unsupported constructs may need manual review.",
                    "sourceTool": "eyra-ast",
                })

            # 2. Hardcoded Secrets
            secret_issues = scan_for_secrets(rel_path, content)
            file_issues.extend(secret_issues)

            # 3. Complexity & Metrics
            comp_data = analyze_complexity(rel_path, content)
            total_loc += comp_data["loc"]
            file_issues.extend(comp_data["issues"])

            # 4. Incomplete/Partial Features
            partial_items = scan_for_partial_implementations(rel_path, content)
            all_partial_features.extend(partial_items)

            # Convert partial implementations with high risk into issues as well
            for p in partial_items:
                if p["risk"] in ("Critical", "High"):
                    file_issues.append({
                        "id": f"PARTIAL-ISSUE-{p['id']}",
                        "ruleId": "PARTIAL-IMPL-001",
                        "file": rel_path,
                        "line": p["line"],
                        "column": 1,
                        "severity": p["risk"],
                        "type": "Partial Implementation",
                        "title": f"Incomplete Feature: {p['featureDescription'][:60]}",
                        "description": f"Partial code or unresolved stub found ({p['type']}). Estimated remaining engineering effort: ~{p['estimatedEffortHours']}h.",
                        "confidence": 0.95,
                        "snippet": p["snippet"],
                        "suggestion": p["aiRecommendation"]
                    })

            file_summaries.append({
                "file": rel_path,
                "loc": comp_data["loc"],
                "avgComplexity": comp_data["avgComplexity"],
                "maxNesting": comp_data["maxNesting"],
                "issuesCount": len(file_issues),
                "severityBreakdown": {
                    "Critical": sum(1 for i in file_issues if i["severity"] == "Critical"),
                    "High": sum(1 for i in file_issues if i["severity"] == "High"),
                    "Medium": sum(1 for i in file_issues if i["severity"] == "Medium"),
                    "Low": sum(1 for i in file_issues if i["severity"] == "Low"),
                }
            })

            all_issues.extend(file_issues)

    # 5. Test Coverage Gap Check
    coverage_gaps = []
    for src in source_files:
        stem = Path(src).stem
        has_test = any(stem in t for t in test_files)
        if not has_test and Path(src).suffix in (".py", ".js", ".ts", ".jsx", ".tsx"):
            # Check if it has functions
            coverage_gaps.append(src)
            all_issues.append({
                "id": f"TEST-GAP-{hash(src) % 100000}",
                "ruleId": "TEST-COVERAGE-GAP",
                "file": src,
                "line": 1,
                "column": 1,
                "severity": "Medium",
                "type": "Test Gap",
                "title": f"Missing Unit Test Suite for '{Path(src).name}'",
                "description": f"Source module '{src}' does not have an associated test file (e.g. test_{Path(src).name} or {Path(src).stem}.test.js). Regression risk is high during refactoring.",
                "confidence": 0.88,
                "snippet": f"Module: {src}\nStatus: No corresponding test file located in codebase.",
                "suggestion": f"Create automated unit tests covering core functions in '{src}'."
            })

    # 6. Calculate Health Score (0 - 100)
    # Deductions: Critical = -15 pts, High = -8 pts, Medium = -3 pts, Low = -1 pt
    crit_count = sum(1 for i in all_issues if i["severity"] == "Critical")
    high_count = sum(1 for i in all_issues if i["severity"] == "High")
    med_count = sum(1 for i in all_issues if i["severity"] == "Medium")
    low_count = sum(1 for i in all_issues if i["severity"] == "Low")

    deductions = (crit_count * 12) + (high_count * 6) + (med_count * 2) + (low_count * 0.5)
    # Scale with LOC so 5 issues in 10,000 LOC doesn't drop score to 0
    loc_factor = max(1.0, total_loc / 300)
    adjusted_deduction = deductions / (loc_factor ** 0.5)

    health_score = max(10, min(100, round(100 - adjusted_deduction)))

    # Grade determination
    if health_score >= 90:
        grade = "A+"
    elif health_score >= 80:
        grade = "B"
    elif health_score >= 65:
        grade = "C"
    elif health_score >= 50:
        grade = "D"
    else:
        grade = "F"

    limitations = []
    if unreadable_files:
        limitations.append("unreadable_files")
    if parser_failures:
        limitations.append("parser_failures")
    if unsupported_skipped:
        limitations.append("unsupported_extensions_skipped")

    result = {
        "timestamp": os.path.getmtime(root_dir) if os.path.exists(root_dir) else 0,
        "summary": {
            "healthScore": health_score,
            "grade": grade,
            "totalFiles": len(file_summaries),
            "totalLoc": total_loc,
            "totalIssues": len(all_issues),
            "severity": {
                "Critical": crit_count,
                "High": high_count,
                "Medium": med_count,
                "Low": low_count
            },
            "issueTypes": {
                "Security": sum(1 for i in all_issues if i["type"] == "Security"),
                "Bug Risk": sum(1 for i in all_issues if i["type"] == "Bug Risk"),
                "Partial Implementation": sum(1 for i in all_issues if i["type"] == "Partial Implementation"),
                "Code Smell": sum(1 for i in all_issues if i["type"] == "Code Smell"),
                "Test Gap": sum(1 for i in all_issues if i["type"] == "Test Gap"),
                "Parser Failure": sum(1 for i in all_issues if i["type"] == "Parser Failure"),
            },
            "partialFeaturesCount": len(all_partial_features),
            "totalEffortHours": round(sum(p["estimatedEffortHours"] for p in all_partial_features), 1),
            "testFilesCount": len(test_files),
            "sourceFilesCount": len(source_files),
            "coverageGapCount": len(coverage_gaps),
            "unreadableFileCount": len(unreadable_files),
            "parserFailureCount": len(parser_failures),
            "unsupportedSkippedCount": unsupported_skipped,
        },
        "issues": all_issues,
        "partialFeatures": all_partial_features,
        "files": file_summaries,
        "unreadableFiles": unreadable_files[:50],
        "parserFailures": parser_failures[:50],
        "limitations": limitations,
        "analyzerStatus": {
            "eyraAst": "FINDINGS" if all_issues else "PASS",
            "note": "Custom EYRA AST/heuristics engine (not Ruff/Radon)",
        },
    }

    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CodeAudit AI Python Analysis Engine")
    parser.add_argument("--path", required=True, help="Directory to analyze")
    parser.add_argument("--output", help="Optional output JSON file")
    args = parser.parse_args()

    data = audit_directory(args.path)

    json_str = json.dumps(data, indent=2)
    if args.output:
        Path(args.output).write_text(json_str, encoding="utf-8")
    else:
        print(json_str)
