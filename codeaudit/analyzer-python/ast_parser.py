"""
AST and Static Bug Pattern Analyzer for Python and JS/TS
Identifies syntax issues, runtime traps, unhandled exceptions, dangerous functions, and missing try/catches.
"""
import ast
import re
from typing import List, Dict, Any

class CodeBugVisitor(ast.NodeVisitor):
    def __init__(self, filename: str, lines: List[str]):
        self.filename = filename
        self.lines = lines
        self.issues: List[Dict[str, Any]] = []

    def add_issue(self, line: int, col: int, rule_id: str, title: str, description: str, severity: str, confidence: float, suggestion: str = ""):
        snippet = ""
        if 1 <= line <= len(self.lines):
            start = max(1, line - 2)
            end = min(len(self.lines), line + 2)
            snippet = "\n".join([f"{i}: {self.lines[i-1]}" for i in range(start, end + 1)])

        self.issues.append({
            "id": f"{rule_id}-{line}-{col}",
            "ruleId": rule_id,
            "file": self.filename,
            "line": line,
            "column": col,
            "severity": severity,       # Critical, High, Medium, Low
            "type": "Bug Risk",
            "title": title,
            "description": description,
            "confidence": confidence,
            "snippet": snippet,
            "suggestion": suggestion
        })

    def visit_FunctionDef(self, node: ast.FunctionDef):
        # Check for mutable default arguments
        for arg, default in zip(reversed(node.args.args), reversed(node.args.defaults)):
            if isinstance(default, (ast.List, ast.Dict, ast.Set)):
                self.add_issue(
                    line=node.lineno,
                    col=node.col_offset,
                    rule_id="PY-BUG-001",
                    title="Mutable Default Argument",
                    description=f"Function '{node.name}' defines mutable default argument '{arg.arg}'. Default mutable arguments persist across function calls leading to state mutation bugs.",
                    severity="High",
                    confidence=0.98,
                    suggestion=f"Set default parameter to None and initialize '{arg.arg} = []' inside the function."
                )

        # Check for empty function or stub pass
        if len(node.body) == 1 and isinstance(node.body[0], ast.Pass):
            self.add_issue(
                line=node.lineno,
                col=node.col_offset,
                rule_id="PY-STUB-001",
                title="Unimplemented Function Stub",
                description=f"Function '{node.name}' consists only of a 'pass' statement without an implementation.",
                severity="Medium",
                confidence=0.95,
                suggestion=f"Implement business logic or raise NotImplementedError('{node.name} not implemented')."
            )

        self.generic_visit(node)

    def visit_ExceptHandler(self, node: ast.ExceptHandler):
        # Bare except: except:
        if node.type is None:
            self.add_issue(
                line=node.lineno,
                col=node.col_offset,
                rule_id="PY-BUG-002",
                title="Bare Except Clause",
                description="Bare 'except:' intercepts KeyboardInterrupt, SystemExit, and MemoryError, masking critical termination signals and silent bugs.",
                severity="High",
                confidence=0.99,
                suggestion="Catch explicit exceptions like 'except Exception as err:' or specific error classes."
            )
        # Empty except handler (swallowed error)
        if len(node.body) == 1 and isinstance(node.body[0], ast.Pass):
            self.add_issue(
                line=node.lineno,
                col=node.col_offset,
                rule_id="PY-BUG-003",
                title="Silently Swallowed Exception",
                description="Exception block silently suppresses failures with 'pass'. This obscures root-cause diagnostics during outages.",
                severity="Critical",
                confidence=0.92,
                suggestion="Log the exception with traceback or re-raise after telemetry logging."
            )
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call):
        # Dangerous calls: eval, exec
        func_name = None
        if isinstance(node.func, ast.Name):
            func_name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            func_name = node.func.attr

        if func_name in ("eval", "exec"):
            self.add_issue(
                line=node.lineno,
                col=node.col_offset,
                rule_id="SEC-DANGEROUS-EXEC",
                title="Arbitrary Code Execution Hazard",
                description=f"Use of built-in '{func_name}' dynamically evaluates unchecked user strings, enabling Remote Code Execution (RCE).",
                severity="Critical",
                confidence=0.99,
                suggestion=f"Replace '{func_name}' with safe AST literal parser or structured JSON serializer."
            )

        # SQL Injection detection in cursor.execute(f"...") or cursor.execute("..." % ...)
        if func_name in ("execute", "raw", "raw_query"):
            if node.args:
                arg0 = node.args[0]
                if isinstance(arg0, ast.JoinedStr) or isinstance(arg0, ast.BinOp):
                    self.add_issue(
                        line=node.lineno,
                        col=node.col_offset,
                        rule_id="SEC-SQLI-001",
                        title="SQL Injection Vulnerability",
                        description=f"Raw SQL query constructed via dynamic string formatting/interpolation instead of parameterized query bindings.",
                        severity="Critical",
                        confidence=0.96,
                        suggestion="Use parameterized placeholders (e.g., cursor.execute('SELECT * FROM users WHERE id = %s', (uid,)))"
                    )

        # subprocess with shell=True
        if func_name in ("Popen", "run", "call", "check_output"):
            for kw in node.keywords:
                if kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
                    self.add_issue(
                        line=node.lineno,
                        col=node.col_offset,
                        rule_id="SEC-SHELL-INJECTION",
                        title="Subprocess Command Injection Risk",
                        description="Spawning subshell with 'shell=True' allows shell metacharacters in arguments to execute arbitrary OS commands.",
                        severity="Critical",
                        confidence=0.97,
                        suggestion="Pass arguments as a list of strings and set shell=False."
                    )

        self.generic_visit(node)


def analyze_python_ast(filepath: str, content: str) -> List[Dict[str, Any]]:
    lines = content.splitlines()
    try:
        tree = ast.parse(content, filename=filepath)
        visitor = CodeBugVisitor(filepath, lines)
        visitor.visit(tree)
        return visitor.issues
    except SyntaxError as err:
        return [{
            "id": f"SYNTAX-ERR-{err.lineno or 1}",
            "ruleId": "SYNTAX-ERR",
            "file": filepath,
            "line": err.lineno or 1,
            "column": err.offset or 1,
            "severity": "Critical",
            "type": "Syntax Error",
            "title": "Syntax Error Encountered",
            "description": f"File failed AST compilation: {err.msg}",
            "confidence": 1.0,
            "snippet": f"{err.lineno}: {err.text.strip() if err.text else ''}",
            "suggestion": "Fix syntax error to allow complete AST parsing."
        }]
    except Exception as err:
        return []


def analyze_js_ts_heuristics(filepath: str, content: str) -> List[Dict[str, Any]]:
    """Heuristic static pattern matching for JavaScript & TypeScript files"""
    issues = []
    lines = content.splitlines()

    patterns = [
        {
            "regex": r"\beval\s*\(",
            "ruleId": "JS-SEC-001",
            "title": "Unsafe Dynamic Eval",
            "description": "Direct invocation of eval() allows arbitrary JavaScript execution and bypasses strict engine sandboxing.",
            "severity": "Critical",
            "confidence": 0.98,
            "suggestion": "Replace with JSON.parse or strict schema validation."
        },
        {
            "regex": r"\.innerHTML\s*=",
            "ruleId": "JS-XSS-001",
            "title": "Cross-Site Scripting (XSS) via innerHTML",
            "description": "Directly assigning unsanitized strings to innerHTML allows stored or reflected DOM XSS.",
            "severity": "High",
            "confidence": 0.94,
            "suggestion": "Use textContent or DOMPurify.sanitize() before HTML injection."
        },
        {
            "regex": r"catch\s*\([^\)]*\)\s*\{\s*\}",
            "ruleId": "JS-BUG-001",
            "title": "Empty Catch Block",
            "description": "Errors are silently swallowed without telemetry or error handling, creating undetectable silent runtime failures.",
            "severity": "High",
            "confidence": 0.95,
            "suggestion": "Log the error to monitoring telemetry or display user-facing error state."
        },
        {
            "regex": r"(?:db|connection|pool|client)\.query\s*\(\s*`[^`]*\$\{[^}]+\}",
            "ruleId": "JS-SQLI-001",
            "title": "SQL Injection via Template Literal",
            "description": "Database query interpolates variables directly in template literal string instead of parameterized parameters ($1, ?).",
            "severity": "Critical",
            "confidence": 0.95,
            "suggestion": "Use parameterized query bindings: db.query('SELECT * FROM users WHERE id = $1', [id])"
        },
        {
            "regex": r"process\.exit\s*\(",
            "ruleId": "JS-NODE-001",
            "title": "Premature Process Termination",
            "description": "Explicit process.exit() terminates the entire Node.js runtime abruptly, dropping active HTTP connections.",
            "severity": "Medium",
            "confidence": 0.88,
            "suggestion": "Handle graceful shutdown via SIGTERM listener or throw domain error."
        },
        {
            "regex": r"==\s*null|!=\s*null",
            "ruleId": "JS-CODE-SMELL-001",
            "title": "Loose Equality Comparison with Null",
            "description": "Loose equality against null matches both null and undefined, often obscuring unintended type coercions.",
            "severity": "Low",
            "confidence": 0.80,
            "suggestion": "Use strict equality (=== null or === undefined) or optional chaining (?.)."
        }
    ]

    for line_idx, line in enumerate(lines, 1):
        for pat in patterns:
            if re.search(pat["regex"], line):
                start = max(1, line_idx - 2)
                end = min(len(lines), line_idx + 2)
                snippet = "\n".join([f"{i}: {lines[i-1]}" for i in range(start, end + 1)])
                issues.append({
                    "id": f"{pat['ruleId']}-{line_idx}",
                    "ruleId": pat["ruleId"],
                    "file": filepath,
                    "line": line_idx,
                    "column": 1,
                    "severity": pat["severity"],
                    "type": "Bug Risk",
                    "title": pat["title"],
                    "description": pat["description"],
                    "confidence": pat["confidence"],
                    "snippet": snippet,
                    "suggestion": pat["suggestion"]
                })

    return issues
