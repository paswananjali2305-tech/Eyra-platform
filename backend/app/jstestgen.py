"""JavaScript/TypeScript test-candidate generation from source structure.

Uses a lightweight scanner (regex + brace matching) to discover real
functions and top-level script behavior, plus a bounded static evaluator
for a safe expression/statement subset. It never executes the code to
invent an expected result, and it never assumes a function, framework,
or React component exists. When behavior cannot be derived safely the
case is marked as requiring clarification instead of asserting a guess.
"""

from __future__ import annotations

import re
from typing import Any

from app.testgen import _case, _review, _slug

MAX_CASES = 5


class _Unknown(Exception):
    """The static evaluator cannot safely derive this behavior."""


class _Return(Exception):
    def __init__(self, value: Any):
        self.value = value


class _JsRaise(Exception):
    def __init__(self, name: str):
        self.name = name


# ---------------------------------------------------------------------------
# Source scanning
# ---------------------------------------------------------------------------

def _skip_string(src: str, i: int) -> int:
    quote = src[i]
    i += 1
    while i < len(src):
        if src[i] == "\\":
            i += 2
            continue
        if src[i] == quote:
            return i + 1
        i += 1
    return i


def _match_delim(src: str, open_idx: int, open_ch: str = "{", close_ch: str = "}") -> int:
    depth = 0
    i = open_idx
    while i < len(src):
        ch = src[i]
        if ch in "'\"`":
            i = _skip_string(src, i)
            continue
        if src.startswith("//", i):
            nl = src.find("\n", i)
            i = len(src) if nl < 0 else nl + 1
            continue
        if src.startswith("/*", i):
            end = src.find("*/", i + 2)
            i = len(src) if end < 0 else end + 2
            continue
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


_FUNC_PATTERNS = [
    re.compile(r"(?:export\s+)?(?:default\s+)?(?P<is_async>async\s+)?function\s*\*?\s*(?P<fname>[A-Za-z_$][\w$]*)\s*\((?P<params>[^()]*)\)\s*(?::\s*[^{]*?)?\{"),
    re.compile(r"(?:export\s+)?(?:const|let|var)\s+(?P<fname>[A-Za-z_$][\w$]*)\s*=\s*(?P<is_async>async\s+)?\((?P<params>[^()]*)\)\s*(?::\s*[^=]*?)?=>\s*"),
    re.compile(r"(?:export\s+)?(?:const|let|var)\s+(?P<fname>[A-Za-z_$][\w$]*)\s*=\s*(?P<is_async>async\s+)?(?P<single>[A-Za-z_$][\w$]*)\s*=>\s*"),
    re.compile(r"(?:export\s+)?(?:const|let|var)\s+(?P<fname>[A-Za-z_$][\w$]*)\s*=\s*(?P<is_async>async\s+)?function\s*\((?P<params>[^()]*)\)\s*\{"),
]


def _split_top_level(text: str, sep: str = ",") -> list[str]:
    parts: list[str] = []
    depth = 0
    current = ""
    for ch in text:
        if ch in "([<{":
            depth += 1
        elif ch in ")]>}":
            depth -= 1
        if ch == sep and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += ch
    if current.strip():
        parts.append(current)
    return parts


def _parse_params(raw: str) -> list[dict[str, Any]] | None:
    raw = raw.strip()
    if not raw:
        return []
    params: list[dict[str, Any]] = []
    for part in _split_top_level(raw):
        piece = part.strip()
        if not piece:
            continue
        if piece.startswith("...") or piece.startswith("{") or piece.startswith("["):
            return None
        default_expr = None
        annotation = None
        if "=" in piece:
            piece, default_expr = piece.split("=", 1)
            default_expr = default_expr.strip()
        if ":" in piece:
            piece, annotation = piece.split(":", 1)
            annotation = annotation.strip()
        name = re.sub(r"^(?:public|private|protected|readonly)\s+", "", piece.strip()).strip()
        if not re.fullmatch(r"[A-Za-z_$][\w$]*", name):
            return None
        params.append({"name": name, "annotation": annotation, "default": default_expr})
    return params


def discover_js_functions(code: str) -> list[dict[str, Any]]:
    """Find top-level function declarations and arrow/function assignments."""
    found: list[dict[str, Any]] = []
    seen_spans: list[tuple[int, int]] = []
    for pattern in _FUNC_PATTERNS:
        for match in pattern.finditer(code):
            named = match.groupdict()
            is_async = bool(named.get("is_async"))
            name = named.get("fname")
            single = named.get("single")
            params_raw = f"{single}" if single else (named.get("params") or "")
            start = match.start()
            if any(s <= start < e for s, e in seen_spans):
                continue
            params = _parse_params(params_raw)
            if params is None:
                continue
            tail = code[match.end():]
            if match.re is _FUNC_PATTERNS[1] or match.re is _FUNC_PATTERNS[2]:
                # Arrow function: block body or expression body.
                if tail.lstrip().startswith("{"):
                    open_idx = match.end() + (len(tail) - len(tail.lstrip()))
                    close_idx = _match_delim(code, open_idx)
                    if close_idx < 0:
                        continue
                    body = code[open_idx + 1:close_idx]
                    span = (start, close_idx + 1)
                else:
                    end = tail.find(";")
                    newline = tail.find("\n")
                    cut = min([x for x in (end, newline) if x >= 0], default=len(tail))
                    body = f"return {tail[:cut].strip()};"
                    span = (start, match.end() + cut)
            else:
                open_idx = match.end() - 1
                close_idx = _match_delim(code, open_idx)
                if close_idx < 0:
                    continue
                body = code[open_idx + 1:close_idx]
                span = (start, close_idx + 1)
            seen_spans.append(span)
            found.append({
                "name": name,
                "params": params,
                "body": body,
                "async": is_async,
                "span": span,
            })
    found.sort(key=lambda item: item["span"][0])
    return found


def analyze_js_structure(code: str) -> dict[str, Any]:
    functions = discover_js_functions(code)
    classes = []
    for match in re.finditer(r"\bclass\s+([A-Za-z_$][\w$]*)", code):
        classes.append({"name": match.group(1), "methods": []})
    imports: list[str] = []
    for match in re.finditer(r"(?:from\s+|require\(\s*)['\"]([^'\"]+)['\"]", code):
        imports.append(match.group(1))
    spans = sorted(fn["span"] for fn in functions)
    top_level_parts: list[str] = []
    cursor = 0
    for start, end in spans:
        top_level_parts.append(code[cursor:start])
        cursor = max(cursor, end)
    top_level_parts.append(code[cursor:])
    top_level = "\n".join(top_level_parts)
    executable_lines = [
        line.strip() for line in top_level.splitlines()
        if line.strip()
        and not line.strip().startswith(("import ", "export ", "//", "/*", "*"))
        and line.strip() not in {"}", "};", ");"}
    ]
    return {
        "parse_error": None,
        "functions": [fn["name"] for fn in functions],
        "function_details": functions,
        "classes": [item["name"] for item in classes],
        "class_details": classes,
        "imports": sorted(set(imports)),
        "assertions": len(re.findall(r"\bassert\s*\(", code)),
        "top_level_executable": bool(executable_lines),
        "top_level_code": top_level,
        "uses_input": False,
    }


# ---------------------------------------------------------------------------
# Bounded static evaluator for a safe JS/TS subset
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(
    r"(?P<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)"
    r"|(?P<str>'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\")"
    r"|(?P<template>`(?:\\.|[^`\\])*`)"
    r"|(?P<name>[A-Za-z_$][\w$]*)"
    r"|(?P<op>\*\*|===|!==|==|!=|<=|>=|&&|\|\||=>|[-+*/%<>=!?:,.\(\)\[\]\{\};])"
    r"|(?P<ws>\s+)"
    r"|(?P<other>.)",
    re.S,
)


def _tokenize(src: str) -> list[tuple[str, str]]:
    tokens: list[tuple[str, str]] = []
    for match in _TOKEN_RE.finditer(src):
        kind = match.lastgroup
        if kind in {"ws", "other"}:
            continue
        tokens.append((kind or "op", match.group()))
    return tokens


def _js_truthy(value: Any) -> bool:
    if value is None or value is False:
        return False
    if isinstance(value, (int, float)) and value == 0:
        return False
    if isinstance(value, str) and value == "":
        return False
    return True


def _js_str(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, list):
        return ",".join(_js_str(item) for item in value)
    return str(value)


def _strict_eq(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return float(left) == float(right)
    if type(left) is not type(right):
        return False
    return bool(left == right)


class _Evaluator:
    def __init__(self, functions: dict[str, dict[str, Any]]):
        self.functions = functions
        self.depth = 0

    # -- expression parser -------------------------------------------------
    def eval_expr(self, src: str, env: dict[str, Any]) -> Any:
        tokens = _tokenize(src)
        if not tokens:
            raise _Unknown()
        self._tokens = tokens
        self._pos = 0
        value = self._ternary(env)
        if self._pos != len(tokens):
            raise _Unknown()
        return value

    def _peek(self) -> str | None:
        return self._tokens[self._pos][1] if self._pos < len(self._tokens) else None

    def _next(self) -> str:
        value = self._tokens[self._pos][1]
        self._pos += 1
        return value

    def _expect(self, symbol: str) -> None:
        if self._next() != symbol:
            raise _Unknown()

    def _ternary(self, env: dict[str, Any]) -> Any:
        value = self._or(env)
        if self._peek() == "?":
            self._next()
            when_true = self._ternary(env)
            self._expect(":")
            when_false = self._ternary(env)
            return when_true if _js_truthy(value) else when_false
        return value

    def _or(self, env: dict[str, Any]) -> Any:
        value = self._and(env)
        while self._peek() == "||":
            self._next()
            right = self._and(env)
            value = value if _js_truthy(value) else right
        return value

    def _and(self, env: dict[str, Any]) -> Any:
        value = self._equality(env)
        while self._peek() == "&&":
            self._next()
            right = self._equality(env)
            value = right if _js_truthy(value) else value
        return value

    def _binary_level(self, env: dict[str, Any], ops: set[str], sub) -> Any:
        value = sub(env)
        while self._peek() in ops:
            op = self._next()
            right = sub(env)
            value = self._apply_binary(op, value, right)
        return value

    def _equality(self, env: dict[str, Any]) -> Any:
        return self._binary_level(env, {"===", "!==", "==", "!="}, self._comparison)

    def _comparison(self, env: dict[str, Any]) -> Any:
        return self._binary_level(env, {"<", "<=", ">", ">="}, self._additive)

    def _additive(self, env: dict[str, Any]) -> Any:
        return self._binary_level(env, {"+", "-"}, self._multiplicative)

    def _multiplicative(self, env: dict[str, Any]) -> Any:
        return self._binary_level(env, {"*", "/", "%", "**"}, self._unary)

    def _apply_binary(self, op: str, left: Any, right: Any) -> Any:
        if op == "+":
            if isinstance(left, str) or isinstance(right, str):
                return _js_str(left) + _js_str(right)
            if isinstance(left, (int, float)) and isinstance(right, (int, float)):
                return left + right
            raise _Unknown()
        if op in {"-", "*", "/", "%", "**"}:
            if not (isinstance(left, (int, float)) and isinstance(right, (int, float))):
                raise _Unknown()
            if op == "-":
                return left - right
            if op == "*":
                return left * right
            if op == "/":
                if right == 0:
                    raise _Unknown()
                return left / right
            if op == "%":
                if right == 0:
                    raise _Unknown()
                return left % right
            return left ** right
        if op in {"===", "=="}:
            return _strict_eq(left, right)
        if op in {"!==", "!="}:
            return not _strict_eq(left, right)
        if op in {"<", "<=", ">", ">="}:
            if isinstance(left, (int, float)) and isinstance(right, (int, float)):
                return {"<": left < right, "<=": left <= right, ">": left > right, ">=": left >= right}[op]
            if isinstance(left, str) and isinstance(right, str):
                return {"<": left < right, "<=": left <= right, ">": left > right, ">=": left >= right}[op]
            raise _Unknown()
        raise _Unknown()

    def _unary(self, env: dict[str, Any]) -> Any:
        token = self._peek()
        if token == "-":
            self._next()
            value = self._unary(env)
            if not isinstance(value, (int, float)):
                raise _Unknown()
            return -value
        if token == "!":
            self._next()
            return not _js_truthy(self._unary(env))
        if token == "+":
            self._next()
            return self._unary(env)
        return self._postfix(env)

    def _postfix(self, env: dict[str, Any]) -> Any:
        value = self._primary(env)
        while True:
            token = self._peek()
            if token == ".":
                self._next()
                name = self._next()
                if self._peek() == "(":
                    self._next()
                    args = self._args(env)
                    value = self._call_method(value, name, args, env)
                else:
                    value = self._member(value, name)
            elif token == "[":
                self._next()
                index = self._ternary(env)
                self._expect("]")
                value = self._index(value, index)
            elif token == "(":
                self._next()
                args = self._args(env)
                value = self._call_value(value, args, env)
            else:
                return value

    def _args(self, env: dict[str, Any]) -> list[Any]:
        args: list[Any] = []
        if self._peek() == ")":
            self._next()
            return args
        while True:
            args.append(self._ternary(env))
            if self._peek() == ",":
                self._next()
                continue
            self._expect(")")
            return args

    def _member(self, value: Any, name: str) -> Any:
        if name == "length" and isinstance(value, (str, list)):
            return len(value)
        if isinstance(value, dict) and name in value:
            return value[name]
        raise _Unknown()

    def _index(self, value: Any, index: Any) -> Any:
        if isinstance(value, (list, str)) and isinstance(index, (int, float)):
            idx = int(index)
            if 0 <= idx < len(value):
                return value[idx]
            raise _Unknown()
        if isinstance(value, dict) and isinstance(index, str) and index in value:
            return value[index]
        raise _Unknown()

    def _call_method(self, value: Any, name: str, args: list[Any], env: dict[str, Any]) -> Any:
        if isinstance(value, dict) and value.get("__eyra_math__"):
            import math

            fn = {
                "floor": math.floor, "ceil": math.ceil, "round": round,
                "abs": abs, "max": max, "min": min, "pow": pow, "sqrt": math.sqrt,
            }.get(name)
            if fn is None or not all(isinstance(a, (int, float)) for a in args):
                raise _Unknown()
            return fn(*args)
        if isinstance(value, str):
            if name == "toUpperCase" and not args:
                return value.upper()
            if name == "toLowerCase" and not args:
                return value.lower()
            if name == "trim" and not args:
                return value.strip()
            if name == "repeat" and len(args) == 1 and isinstance(args[0], (int, float)):
                return value * int(args[0])
        if isinstance(value, list) and name == "join" and len(args) == 1:
            return str(args[0]).join(_js_str(item) for item in value)
        raise _Unknown()

    def _call_value(self, value: Any, args: list[Any], env: dict[str, Any]) -> Any:
        if isinstance(value, dict) and "__eyra_fn__" in value:
            return self.call_function(value["__eyra_fn__"], args)
        raise _Unknown()

    def call_function(self, fn: dict[str, Any], args: list[Any]) -> Any:
        if self.depth > 24:
            raise _Unknown()
        self.depth += 1
        try:
            env: dict[str, Any] = {"Math": {"__eyra_math__": True}, "undefined": None}
            for name, fn_detail in self.functions.items():
                env[name] = {"__eyra_fn__": fn_detail}
            params = fn["params"]
            for index, param in enumerate(params):
                if index < len(args):
                    env[param["name"]] = args[index]
                elif param["default"]:
                    env[param["name"]] = self.eval_expr(param["default"], env)
                else:
                    env[param["name"]] = None
            try:
                self.exec_block(fn["body"], env)
            except _Return as ret:
                return ret.value
            return None
        finally:
            self.depth -= 1

    # -- statement executor --------------------------------------------------
    def exec_block(self, src: str, env: dict[str, Any]) -> None:
        tokens = _tokenize(src)
        self._exec_tokens(tokens, env)

    def _exec_tokens(self, tokens: list[tuple[str, str]], env: dict[str, Any]) -> None:
        # Split into simple statements at top-level semicolons / blocks.
        i = 0
        while i < len(tokens):
            kind, text = tokens[i]
            if text == ";":
                i += 1
                continue
            if text == "return":
                expr_tokens = self._collect_until_semicolon(tokens, i + 1)
                src = " ".join(t[1] for t in expr_tokens)
                raise _Return(self.eval_expr(src, env) if src.strip() else None)
            if text == "throw":
                rest = " ".join(t[1] for t in tokens[i + 1:])
                match = re.search(r"new\s+([A-Za-z_$][\w$]*)", rest)
                raise _JsRaise(match.group(1) if match else "Error")
            if text == "if":
                i = self._exec_if(tokens, i, env)
                continue
            if text in {"for", "while", "do", "switch", "try"}:
                raise _Unknown()
            if text in {"const", "let", "var"}:
                stmt = self._collect_until_semicolon(tokens, i)
                self._exec_declaration(" ".join(t[1] for t in stmt), env)
                i += len(stmt) + 1
                continue
            stmt = self._collect_until_semicolon(tokens, i)
            if not stmt:
                i += 1
                continue
            src = " ".join(t[1] for t in stmt)
            assign = re.match(r"^([A-Za-z_$][\w$]*)\s*(\+?=)\s*(.+)$", src, re.S)
            if assign and not re.match(r"^[A-Za-z_$][\w$]*\s*===", src):
                name, op, expr = assign.groups()
                value = self.eval_expr(expr, env)
                env[name] = (env.get(name, 0) + value) if op == "+=" and isinstance(env.get(name), (int, float)) else value
            else:
                self.eval_expr(src, env)
            i += len(stmt) + 1

    def _collect_until_semicolon(self, tokens: list[tuple[str, str]], start: int) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        depth = 0
        i = start
        while i < len(tokens):
            text = tokens[i][1]
            if text in {"(", "[", "{"}:
                depth += 1
            elif text in {")", "]", "}"}:
                if depth == 0:
                    break
                depth -= 1
            if text == ";" and depth == 0:
                break
            out.append(tokens[i])
            i += 1
        return out

    def _exec_if(self, tokens: list[tuple[str, str]], start: int, env: dict[str, Any]) -> int:
        # tokens[start] == 'if'; condition in parens, then block or statement.
        pos = start + 1
        if pos >= len(tokens) or tokens[pos][1] != "(":
            raise _Unknown()
        depth = 0
        cond_tokens: list[tuple[str, str]] = []
        while pos < len(tokens):
            text = tokens[pos][1]
            if text == "(":
                depth += 1
                if depth == 1:
                    pos += 1
                    continue
            if text == ")":
                depth -= 1
                if depth == 0:
                    pos += 1
                    break
            cond_tokens.append(tokens[pos])
            pos += 1
        condition = self.eval_expr(" ".join(t[1] for t in cond_tokens), env)
        then_tokens, pos = self._collect_branch(tokens, pos)
        else_tokens: list[tuple[str, str]] = []
        if pos < len(tokens) and tokens[pos][1] == "else":
            else_tokens, pos = self._collect_branch(tokens, pos + 1)
        self._exec_tokens(then_tokens if _js_truthy(condition) else else_tokens, env)
        return pos

    def _collect_branch(self, tokens: list[tuple[str, str]], start: int) -> tuple[list[tuple[str, str]], int]:
        if start < len(tokens) and tokens[start][1] == "{":
            depth = 0
            out: list[tuple[str, str]] = []
            pos = start
            while pos < len(tokens):
                text = tokens[pos][1]
                if text == "{":
                    depth += 1
                    if depth == 1:
                        pos += 1
                        continue
                elif text == "}":
                    depth -= 1
                    if depth == 0:
                        return out, pos + 1
                out.append(tokens[pos])
                pos += 1
            raise _Unknown()
        stmt = self._collect_until_semicolon(tokens, start)
        return stmt, start + len(stmt) + 1

    def _exec_declaration(self, src: str, env: dict[str, Any]) -> None:
        body = re.sub(r"^(const|let|var)\s+", "", src.strip())
        for part in _split_top_level(body):
            match = re.match(r"^([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?\s*=\s*(.+)$", part.strip(), re.S)
            if match:
                env[match.group(1)] = self.eval_expr(match.group(2), env)
            elif re.fullmatch(r"[A-Za-z_$][\w$]*", part.strip()):
                env[part.strip()] = None
            else:
                raise _Unknown()

    def _primary(self, env: dict[str, Any]) -> Any:
        kind, text = self._tokens[self._pos]
        self._pos += 1
        if kind == "num":
            return float(text) if ("." in text or "e" in text.lower()) else int(text)
        if kind == "str":
            return bytes(text[1:-1], "utf-8").decode("unicode_escape")
        if kind == "template":
            return self._template(text[1:-1], env)
        if text == "(":
            value = self._ternary(env)
            self._expect(")")
            return value
        if text == "[":
            items: list[Any] = []
            if self._peek() == "]":
                self._next()
                return items
            while True:
                items.append(self._ternary(env))
                if self._peek() == ",":
                    self._next()
                    continue
                self._expect("]")
                return items
        if text == "{":
            obj: dict[str, Any] = {}
            if self._peek() == "}":
                self._next()
                return obj
            while True:
                key_kind, key_text = self._tokens[self._pos]
                self._pos += 1
                key = key_text.strip("'\"") if key_kind == "str" else key_text
                self._expect(":")
                obj[key] = self._ternary(env)
                if self._peek() == ",":
                    self._next()
                    continue
                self._expect("}")
                return obj
        if kind == "name":
            if text == "true":
                return True
            if text == "false":
                return False
            if text in {"null", "undefined"}:
                return None
            if text == "new":
                raise _Unknown()
            if text in env:
                return env[text]
            raise _Unknown()
        raise _Unknown()

    def _template(self, raw: str, env: dict[str, Any]) -> str:
        out: list[str] = []
        i = 0
        while i < len(raw):
            if raw.startswith("${", i):
                end = raw.find("}", i + 2)
                if end < 0:
                    raise _Unknown()
                out.append(_js_str(self.eval_expr(raw[i + 2:end], env)))
                i = end + 1
            else:
                out.append(raw[i])
                i += 1
        return "".join(out)


def _static_call(fn: dict[str, Any], args: list[Any], functions: dict[str, dict[str, Any]]) -> tuple[str, Any]:
    evaluator = _Evaluator(functions)
    try:
        return "return", evaluator.call_function(fn, args)
    except _JsRaise as raised:
        return "exception", raised.name
    except Exception:
        return "unknown", None


# ---------------------------------------------------------------------------
# Case generation
# ---------------------------------------------------------------------------

def _js_literal(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        escaped = value.replace("\\", "\\\\").replace("'", "\\'")
        return f"'{escaped}'"
    if isinstance(value, list):
        return "[" + ", ".join(_js_literal(item) for item in value) + "]"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _param_kind(param: dict[str, Any], fn: dict[str, Any]) -> str | None:
    annotation = (param.get("annotation") or "").lower()
    if annotation in {"number", "string", "boolean", "bool"}:
        return "boolean" if annotation == "bool" else annotation
    if annotation.endswith("[]") or annotation.startswith(("array", "list")):
        return "array"
    if param.get("default"):
        try:
            value = _Evaluator({}).eval_expr(param["default"], {})
        except Exception:
            value = None
        if isinstance(value, bool):
            return "boolean"
        if isinstance(value, (int, float)):
            return "number"
        if isinstance(value, str):
            return "string"
        if isinstance(value, list):
            return "array"
    name = param["name"].lower()
    if name in {"n", "count", "index", "i", "x", "y", "num", "value", "age", "price", "total"} or name.endswith(("_count", "_index", "_id")):
        return "number"
    if name in {"text", "name", "title", "label", "message", "input", "word"}:
        return "string"
    if name.startswith(("is", "has", "can", "should")) or name in {"flag", "enabled", "active"}:
        return "boolean"
    if name in {"items", "list", "arr", "values", "numbers", "args"}:
        return "array"
    body = fn["body"]
    name_re = re.escape(param["name"])
    # Body-usage evidence: arithmetic or numeric comparison implies numeric
    # inputs. Expectations are still derived by evaluating the real body.
    if re.search(rf"\b{name_re}\s*[-*/%]|[-*/%]\s*{name_re}\b", body):
        return "number"
    if re.search(rf"\b{name_re}\s*(?:<=?|>=?|===?|!==?)\s*-?\d", body):
        return "number"
    if re.search(rf"\b{name_re}\s*\+\s*(?:\d|[A-Za-z_$])|(?:\d|[A-Za-z_$][\w$]*)\s*\+\s*{name_re}\b", body):
        return "number"
    if re.search(rf"Math\.\w+\([^)]*\b{name_re}\b", body):
        return "number"
    return None


_VALUES: dict[str, list[Any]] = {
    "number": [0, 1, 2],
    "string": ["", "ab"],
    "boolean": [False, True],
    "array": [[], [1, 2]],
}


def _function_cases(fn: dict[str, Any], functions: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    if fn["async"]:
        return [_review(f"{fn['name']} is async. Supply a call manually; it was not executed.", fn=fn["name"], mode="function")]
    params = fn["params"]
    if not params:
        kind, value = _static_call(fn, [], functions)
        if kind == "return":
            return [_case(1, f"{fn['name']}() with no arguments", f"{fn['name']}()", expected=value, assert_expected=True, fn=fn["name"], name=f"test_{_slug(fn['name'])}_no_arguments")]
        if kind == "exception":
            return [_case(1, f"{fn['name']}() expected error", f"{fn['name']}()", expected_exception=value, assert_expected=True, fn=fn["name"], name=f"test_{_slug(fn['name'])}_expected_error")]
        return [_review(f"The result of {fn['name']}() could not be derived safely. Clarify the expected behavior.", fn=fn["name"], mode="function")]

    kinds: dict[str, str] = {}
    for param in params:
        kind = _param_kind(param, fn)
        if kind is None:
            if param.get("default"):
                kinds[param["name"]] = "default"
                continue
            return [_review(f"Could not infer inputs for {fn['name']} parameter(s): {param['name']}. Supply an input before running.", fn=fn["name"], mode="function")]
        kinds[param["name"]] = kind

    def values_for(param: dict[str, Any]) -> list[Any]:
        kind = kinds[param["name"]]
        if kind == "default":
            try:
                return [_Evaluator({}).eval_expr(param["default"], {})]
            except Exception:
                return [None]
        return _VALUES[kind]

    cases: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(description: str, chosen: dict[str, Any], *, omit: set[str] | None = None) -> None:
        if len(cases) >= MAX_CASES:
            return
        omit = omit or set()
        args: list[Any] = []
        call_parts: list[str] = []
        for param in params:
            if param["name"] in omit:
                continue
            value = chosen.get(param["name"])
            args.append(value)
            call_parts.append(_js_literal(value))
        full_args: list[Any] = []
        for param in params:
            if param["name"] in chosen:
                full_args.append(chosen[param["name"]])
            elif param.get("default"):
                try:
                    full_args.append(_Evaluator(functions).eval_expr(param["default"], {}))
                except Exception:
                    return
            else:
                full_args.append(None)
        kind, value = _static_call(fn, full_args, functions)
        if kind == "unknown":
            return
        call = f"{fn['name']}({', '.join(call_parts)})"
        key = f"{call}|{value!r}|{kind}"
        if key in seen:
            return
        seen.add(key)
        if kind == "exception":
            cases.append(_case(len(cases) + 1, description, call, expected_exception=value, assert_expected=True, fn=fn["name"]))
        else:
            cases.append(_case(len(cases) + 1, description, call, expected=value, assert_expected=True, fn=fn["name"]))

    minimal = {p["name"]: values_for(p)[0] for p in params}
    normal = {p["name"]: values_for(p)[min(1, len(values_for(p)) - 1)] for p in params}
    add(f"{fn['name']} minimal input", minimal)
    if normal != minimal:
        add(f"{fn['name']} representative input", normal)
    for param in params:
        extra = values_for(param)[2:]
        if extra:
            chosen = dict(normal)
            chosen[param["name"]] = extra[0]
            add(f"{fn['name']} boundary for {param['name']}", chosen)
            break
    omit = {p["name"] for p in params if p.get("default")}
    if omit and omit != {p["name"] for p in params}:
        add(f"{fn['name']} using default arguments", {p["name"]: values_for(p)[0] for p in params if p["name"] not in omit}, omit=omit)
    elif omit and len(params) == len(omit):
        add(f"{fn['name']} using default arguments", {}, omit=omit)

    # Wrong-type case only when the source statically raises for it.
    mismatches: dict[str, Any] = {"number": "invalid", "string": None, "array": None, "boolean": "invalid"}
    for param in params:
        kind = kinds[param["name"]]
        if kind not in mismatches or len(cases) >= MAX_CASES:
            continue
        chosen = dict(normal)
        chosen[param["name"]] = mismatches[kind]
        before = len(cases)
        add(f"{fn['name']} invalid input for {param['name']}", chosen)
        if len(cases) > before and cases[-1].get("expected_exception"):
            break
        if len(cases) > before:
            cases.pop()

    for index, case in enumerate(cases, start=1):
        case["id"] = index
    return cases or [_review(f"The expected behavior of {fn['name']} could not be derived safely. Clarify an example input and result.", fn=fn["name"], mode="function")]


def _script_cases(structure: dict[str, Any], functions: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    evaluator = _Evaluator(functions)
    env: dict[str, Any] = {"Math": {"__eyra_math__": True}, "undefined": None}
    for name, fn_detail in functions.items():
        env[name] = {"__eyra_fn__": fn_detail}
    top_level = structure["top_level_code"]
    # Remove import/export/require-only lines the evaluator cannot run.
    cleaned_lines = []
    for line in top_level.splitlines():
        stripped = line.strip()
        if stripped.startswith(("import ", "export ")) or "require(" in stripped:
            continue
        cleaned_lines.append(line)
    cleaned = "\n".join(cleaned_lines)
    outputs: list[str] = []
    # Evaluate sequentially; capture console.log arguments when derivable.
    log_calls = [m for m in re.finditer(r"console\.log\s*\(", cleaned)]
    if not log_calls:
        return [_review("No printed output or assertion could be derived safely from this script.", mode="script")]
    try:
        prefix = cleaned[:log_calls[0].start()]
        prefix = re.sub(r"console\.log\s*\([^;]*\);?", "", prefix)
        evaluator.exec_block(prefix, env)
        for match in log_calls:
            open_idx = match.end() - 1
            close_idx = _match_delim(cleaned, open_idx, "(", ")")
            if close_idx < 0:
                raise _Unknown()
            arg_src = cleaned[open_idx + 1:close_idx]
            parts = _split_top_level(arg_src)
            values = [evaluator.eval_expr(part, env) for part in parts if part.strip()]
            outputs.append(" ".join(_js_str(value) for value in values))
    except Exception:
        return [_review("No printed output or assertion could be derived safely from this script.", mode="script")]

    stdout = [line for line in outputs if line != ""]
    cases: list[dict[str, Any]] = []

    def add_case(description: str, name: str, facet: str, expected_stdout: list[str], expected_result: str) -> None:
        case = _case(
            len(cases) + 1,
            description,
            None,
            mode="script",
            name=name,
            expected_stdout_contains=expected_stdout,
            expected_exit_code=0,
            strategy={
                "kind": "script_run",
                "facet": facet,
                "expected_stdout_contains": expected_stdout,
                "expected_exit_code": 0,
                "assertions": int(structure["assertions"]),
            },
        )
        case["expected_result"] = expected_result
        cases.append(case)

    if stdout:
        add_case(
            "Run the script and check its printed output",
            "test_script_output",
            "stdout",
            stdout,
            "exit code 0; stdout contains " + ", ".join(repr(item) for item in stdout),
        )
    if len(cases) < 2:
        add_case(
            "Run the script and check it completes successfully",
            "test_script_runs_successfully",
            "exit_code",
            [],
            "exit code 0",
        )
    for index, case in enumerate(cases, start=1):
        case["id"] = index
    return cases


def generate_js_cases(code: str, *, function_name: str | None = None, language: str = "javascript") -> list[dict[str, Any]]:
    structure = analyze_js_structure(code)
    functions = {fn["name"]: fn for fn in structure["function_details"]}

    if function_name:
        requested = function_name.strip()
        fn = functions.get(requested)
        if fn is None:
            case = _review(
                f"Target function '{requested}' was not found. No test was generated for a different function.",
                fn=requested,
                mode="function",
                defect="target_not_found",
            )
            case["name"] = "test_missing_target"
            return [case]
        return _function_cases(fn, functions)

    reviews: list[dict[str, Any]] = []
    for fn in structure["function_details"]:
        if fn["name"] == "main":
            continue
        cases = _function_cases(fn, functions)
        if any(case.get("call") and not case.get("needs_review") for case in cases):
            return cases
        reviews.extend(cases)

    if structure["top_level_executable"]:
        return _script_cases(structure, functions)
    if reviews:
        first = dict(reviews[0])
        first["id"] = 1
        return [first]
    if structure["classes"]:
        names = ", ".join(structure["classes"])
        return [_review(f"Found class(es) {names}, but no safely testable function or script behavior. Clarify how to construct and call one.", mode="clarification")]
    return [_review("No safely testable behavior was found. Add a function call, printed output, or assertion to clarify what should be tested.", mode="clarification")]
