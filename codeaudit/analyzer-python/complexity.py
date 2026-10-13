"""
Code Complexity & Cognitive Load Analyzer
Measures Cyclomatic Complexity, Max Nesting Depth, and Function Length.
"""
import ast
import re
from typing import Dict, Any, List

class ComplexityVisitor(ast.NodeVisitor):
    def __init__(self):
        self.functions: List[Dict[str, Any]] = []
        self.current_depth = 0
        self.max_file_depth = 0

    def visit_FunctionDef(self, node: ast.FunctionDef):
        complexity = 1  # Base complexity
        max_func_depth = 0
        func_lines = node.end_lineno - node.lineno + 1 if hasattr(node, 'end_lineno') else 1

        # Calculate complexity and nesting within this function
        for child in ast.walk(node):
            if isinstance(child, (ast.If, ast.While, ast.For, ast.AsyncFor, ast.ExceptHandler, ast.With, ast.AsyncWith)):
                complexity += 1
            elif isinstance(child, ast.BoolOp):
                complexity += len(child.values) - 1

        self.functions.append({
            "name": node.name,
            "line": node.lineno,
            "length": func_lines,
            "complexity": complexity,
            "status": "High" if complexity > 10 else "Moderate" if complexity > 5 else "Clean"
        })
        self.generic_visit(node)


def calculate_nesting_depth(content: str) -> int:
    """Estimates maximum indentation nesting depth based on indent levels and braces"""
    lines = content.splitlines()
    max_depth = 0
    current_depth = 0
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("//"):
            continue
        # Count leading indentation
        leading_spaces = len(line) - len(line.lstrip(" "))
        depth = leading_spaces // 4
        if depth > max_depth:
            max_depth = depth
    return max_depth


def analyze_complexity(filepath: str, content: str) -> Dict[str, Any]:
    lines = content.splitlines()
    total_loc = len([l for l in lines if l.strip() and not l.strip().startswith(("#", "//", "/*", "*"))])
    max_nesting = calculate_nesting_depth(content)

    functions = []
    avg_complexity = 1.0

    if filepath.endswith(".py"):
        try:
            tree = ast.parse(content, filename=filepath)
            visitor = ComplexityVisitor()
            visitor.visit(tree)
            functions = visitor.functions
            if functions:
                avg_complexity = round(sum(f["complexity"] for f in functions) / len(functions), 1)
        except Exception:
            pass
    else:
        # Heuristic function and branch finder for JS/TS
        func_matches = re.findall(r"(?:function\s+([a-zA-Z0-9_$]+)|([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)", content)
        branch_count = len(re.findall(r"\b(if|else if|for|while|switch|case|catch|\?)\b", content))
        func_count = max(1, len(func_matches))
        avg_complexity = round(branch_count / func_count, 1)

    issues = []
    # Flag excessively complex functions
    for func in functions:
        if func["complexity"] >= 10:
            issues.append({
                "id": f"COMPLEX-FUNC-{func['line']}",
                "ruleId": "METRIC-HIGH-COMPLEXITY",
                "file": filepath,
                "line": func["line"],
                "column": 1,
                "severity": "Medium" if func["complexity"] < 15 else "High",
                "type": "Code Smell",
                "title": f"High Cyclomatic Complexity in '{func['name']}'",
                "description": f"Function '{func['name']}' has a cyclomatic complexity of {func['complexity']} (recommended limit: 10). High branch density impedes comprehension and makes unit testing combinatorial.",
                "confidence": 0.95,
                "snippet": f"def {func['name']}(): ... ({func['length']} lines, {func['complexity']} branches)",
                "suggestion": "Decompose function into smaller sub-methods or apply early return guards."
            })
        if func["length"] > 60:
            issues.append({
                "id": f"LONG-FUNC-{func['line']}",
                "ruleId": "METRIC-LONG-FUNCTION",
                "file": filepath,
                "line": func["line"],
                "column": 1,
                "severity": "Low",
                "type": "Code Smell",
                "title": f"Oversized Function '{func['name']}' ({func['length']} lines)",
                "description": f"Function spans {func['length']} lines. Long functions violate Single Responsibility and heighten risk of side-effects.",
                "confidence": 0.9,
                "snippet": f"{func['name']} [{func['length']} LOC]",
                "suggestion": "Extract discrete operations into helper utilities."
            })

    if max_nesting >= 5:
        issues.append({
            "id": f"DEEP-NESTING-1",
            "ruleId": "METRIC-DEEP-NESTING",
            "file": filepath,
            "line": 1,
            "column": 1,
            "severity": "Medium",
            "type": "Code Smell",
            "title": f"Excessive Indentation Depth ({max_nesting} levels)",
            "description": f"File reaches an indentation nesting depth of {max_nesting} levels (recommended limit: 4). Deep nesting is an anti-pattern known as 'Arrow Anti-Pattern' or 'Pyramid of Doom'.",
            "confidence": 0.92,
            "snippet": f"Max nesting depth: {max_nesting} levels",
            "suggestion": "Flatten logic with guard clauses, invert condition checks, or extract nested loops into generators."
        })

    return {
        "loc": total_loc,
        "maxNesting": max_nesting,
        "avgComplexity": avg_complexity,
        "functions": functions,
        "issues": issues
    }
