"""Python test-candidate generation from source structure.

Does not execute the function to invent an expected result.
"""

from __future__ import annotations

import ast
import re
from typing import Any


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug[:54] or "case"


def _review(
    description: str,
    *,
    fn: str | None = None,
    mode: str = "clarification",
    defect: str | None = None,
) -> dict[str, Any]:
    return {
        "id": 1,
        "name": "test_needs_clarification",
        "description": description,
        "input": "",
        "expected": None,
        "expected_result": "Clarification required before this case can run.",
        "actual": None,
        "actual_result": None,
        "status": "not_run",
        "call": None,
        "mode": mode,
        "target": fn,
        "strategy": {"kind": "clarification"},
        "assert_expected": False,
        "needs_review": True,
        "function_name": fn,
        "reason": defect or "needs_review",
        "generation_defect": defect,
        "failure_reason": None,
    }


def _unparse(node: ast.AST | None) -> str | None:
    if node is None:
        return None
    try:
        return ast.unparse(node)
    except Exception:
        return None


def _literal(node: ast.AST | None) -> tuple[bool, Any]:
    if node is None:
        return False, None
    if isinstance(node, ast.Constant):
        return True, node.value
    try:
        return True, ast.literal_eval(node)
    except Exception:
        return False, _unparse(node)


def _annotation_kind(ann: str | None) -> str | None:
    if not ann:
        return None
    low = ann.lower().replace(" ", "")
    if low in {"int", "float", "builtins.int", "builtins.float"}:
        return "number"
    if low in {"str", "builtins.str"}:
        return "string"
    if low.startswith("list") or low.startswith("sequence") or low.startswith("tuple"):
        return "list"
    if low.startswith("dict") or low.startswith("mapping"):
        return "dict"
    if low in {"bool", "builtins.bool"}:
        return "bool"
    if low in {"none", "nonetype"}:
        return "none"
    return None


def _name_kind(name: str) -> str | None:
    low = name.lower()
    if low in {"n", "i", "j", "k", "x", "y", "num", "count", "index", "size", "length"}:
        return "number"
    if low in {"s", "text", "name", "word", "msg", "message", "label"}:
        return "string"
    if low in {"items", "xs", "arr", "vals", "values", "nums", "data", "seq"}:
        return "list"
    if low in {"flag", "enabled", "ok"}:
        return "bool"
    return None


def _body_kind(fn: ast.AST, name: str) -> str | None:
    for node in ast.walk(fn):
        if isinstance(node, ast.Compare) and isinstance(node.left, ast.Name) and node.left.id == name:
            if any(isinstance(c, ast.Constant) and isinstance(c.value, (int, float)) for c in node.comparators):
                return "number"
            if any(isinstance(c, ast.Constant) and c.value is None for c in node.comparators):
                return "optional"
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "len":
            if node.args and isinstance(node.args[0], ast.Name) and node.args[0].id == name:
                return "list"
        if isinstance(node, ast.For) and isinstance(node.iter, ast.Name) and node.iter.id == name:
            return "list"
        if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id == name:
            return "string_or_list"
    return None


def _boundaries(fn: ast.AST, name: str) -> list[Any]:
    found: list[Any] = []
    for node in ast.walk(fn):
        if not isinstance(node, ast.Compare):
            continue
        if not (isinstance(node.left, ast.Name) and node.left.id == name):
            continue
        for op, comp in zip(node.ops, node.comparators):
            if isinstance(comp, ast.Constant) and isinstance(comp.value, (int, float)):
                n = comp.value
                if isinstance(op, (ast.LtE, ast.GtE, ast.Eq)):
                    found.extend([n, n - 1 if isinstance(n, int) else n, n + 1 if isinstance(n, int) else n])
                elif isinstance(op, ast.Lt):
                    found.extend([n - 1 if isinstance(n, int) else n, n])
                elif isinstance(op, ast.Gt):
                    found.extend([n, n + 1 if isinstance(n, int) else n])
            if isinstance(comp, ast.Constant) and comp.value is None and isinstance(op, (ast.Is, ast.Eq)):
                found.append(None)
    # unique, keep order
    out: list[Any] = []
    for item in found:
        if item not in out:
            out.append(item)
    return out[:4]


def _signature(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> dict[str, Any]:
    if isinstance(fn, ast.AsyncFunctionDef):
        return {
            "unsupported": True,
            "reason": f"{fn.name} is async. Supply a call manually; it was not executed.",
            "name": fn.name,
            "params": [],
        }
    args = fn.args
    if args.vararg or args.kwarg:
        return {
            "unsupported": True,
            "reason": f"{fn.name} uses *args or **kwargs. Supply inputs manually.",
            "name": fn.name,
            "params": [],
        }
    params: list[dict[str, Any]] = []
    pos = list(args.posonlyargs) + list(args.args)
    defaults = list(args.defaults)
    offset = len(pos) - len(defaults)
    for i, param in enumerate(pos):
        has_default = i >= offset
        known, value = (False, None)
        if has_default:
            known, value = _literal(defaults[i - offset])
        params.append(
            {
                "name": param.arg,
                "kind": "positional",
                "annotation": _unparse(param.annotation),
                "has_default": has_default,
                "default_known": known,
                "default": value,
            }
        )
    for param, default in zip(args.kwonlyargs, args.kw_defaults):
        known, value = _literal(default) if default is not None else (False, None)
        params.append(
            {
                "name": param.arg,
                "kind": "keyword",
                "annotation": _unparse(param.annotation),
                "has_default": default is not None,
                "default_known": known,
                "default": value,
            }
        )
    return {
        "unsupported": False,
        "name": fn.name,
        "params": params,
        "returns": _unparse(fn.returns),
    }


def _collect_functions(tree: ast.AST) -> list[ast.FunctionDef | ast.AsyncFunctionDef]:
    found: list[ast.FunctionDef | ast.AsyncFunctionDef] = []
    for node in getattr(tree, "body", []):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            found.append(node)
            for child in node.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    found.append(child)
    return found


class _StaticUnknown(Exception):
    pass


class _StaticReturn(Exception):
    def __init__(self, value: Any):
        self.value = value


class _StaticRaise(Exception):
    def __init__(self, name: str):
        self.name = name


class _StaticBreak(Exception):
    pass


class _StaticContinue(Exception):
    pass


class _StaticEvaluator:
    """Small pure-Python evaluator used only to derive expectations from source."""

    def __init__(self, functions: dict[str, ast.FunctionDef] | None = None):
        self.functions = functions or {}
        self.output: list[str] = []
        self.depth = 0

    def eval(self, node: ast.AST, env: dict[str, Any]) -> Any:
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            if node.id in env:
                return env[node.id]
            if node.id in {"True", "False", "None"}:
                return {"True": True, "False": False, "None": None}[node.id]
            raise _StaticUnknown(node.id)
        if isinstance(node, ast.BinOp):
            left = self.eval(node.left, env)
            right = self.eval(node.right, env)
            if isinstance(node.op, ast.Pow) and isinstance(right, (int, float)) and abs(right) > 12:
                raise _StaticUnknown("large power")
            ops = {
                ast.Add: lambda: left + right,
                ast.Sub: lambda: left - right,
                ast.Mult: lambda: left * right,
                ast.Div: lambda: left / right,
                ast.FloorDiv: lambda: left // right,
                ast.Mod: lambda: left % right,
                ast.Pow: lambda: left**right,
                ast.BitAnd: lambda: left & right,
                ast.BitOr: lambda: left | right,
            }
            if type(node.op) not in ops:
                raise _StaticUnknown("operator")
            value = ops[type(node.op)]()
            if isinstance(value, (str, list, tuple)) and len(value) > 5000:
                raise _StaticUnknown("large value")
            return value
        if isinstance(node, ast.UnaryOp):
            value = self.eval(node.operand, env)
            if isinstance(node.op, ast.Not):
                return not value
            if isinstance(node.op, ast.USub):
                return -value
            if isinstance(node.op, ast.UAdd):
                return +value
            raise _StaticUnknown("unary")
        if isinstance(node, ast.BoolOp):
            result = self.eval(node.values[0], env)
            for child in node.values[1:]:
                if isinstance(node.op, ast.And) and not result:
                    return result
                if isinstance(node.op, ast.Or) and result:
                    return result
                result = self.eval(child, env)
            return result
        if isinstance(node, ast.Compare):
            left = self.eval(node.left, env)
            for op, comparator in zip(node.ops, node.comparators):
                right = self.eval(comparator, env)
                if isinstance(op, ast.Eq):
                    matched = left == right
                elif isinstance(op, ast.NotEq):
                    matched = left != right
                elif isinstance(op, ast.Lt):
                    matched = left < right
                elif isinstance(op, ast.LtE):
                    matched = left <= right
                elif isinstance(op, ast.Gt):
                    matched = left > right
                elif isinstance(op, ast.GtE):
                    matched = left >= right
                elif isinstance(op, ast.In):
                    matched = left in right
                elif isinstance(op, ast.NotIn):
                    matched = left not in right
                elif isinstance(op, ast.Is):
                    matched = left is right
                elif isinstance(op, ast.IsNot):
                    matched = left is not right
                else:
                    raise _StaticUnknown("comparison")
                if not matched:
                    return False
                left = right
            return True
        if isinstance(node, ast.IfExp):
            return self.eval(node.body if self.eval(node.test, env) else node.orelse, env)
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            values = [self.eval(item, env) for item in node.elts]
            return values if isinstance(node, ast.List) else tuple(values) if isinstance(node, ast.Tuple) else set(values)
        if isinstance(node, ast.Dict):
            return {
                self.eval(key, env): self.eval(value, env)
                for key, value in zip(node.keys, node.values)
                if key is not None
            }
        if isinstance(node, ast.Subscript):
            value = self.eval(node.value, env)
            return value[self.eval(node.slice, env)]
        if isinstance(node, ast.Slice):
            return slice(
                self.eval(node.lower, env) if node.lower else None,
                self.eval(node.upper, env) if node.upper else None,
                self.eval(node.step, env) if node.step else None,
            )
        if isinstance(node, ast.JoinedStr):
            parts = []
            for item in node.values:
                if isinstance(item, ast.Constant):
                    parts.append(str(item.value))
                elif isinstance(item, ast.FormattedValue):
                    parts.append(str(self.eval(item.value, env)))
                else:
                    raise _StaticUnknown("f-string")
            return "".join(parts)
        if isinstance(node, ast.Starred):
            raise _StaticUnknown("starred")
        if isinstance(node, ast.Call):
            return self.call(node, env)
        if isinstance(node, ast.Attribute):
            # Only exception names and enum-like constants are needed statically.
            raise _StaticUnknown(node.attr)
        raise _StaticUnknown(type(node).__name__)

    def call(self, node: ast.Call, env: dict[str, Any]) -> Any:
        args = [self.eval(arg, env) for arg in node.args]
        kwargs = {kw.arg: self.eval(kw.value, env) for kw in node.keywords if kw.arg}
        if isinstance(node.func, ast.Name):
            name = node.func.id
            if name == "print":
                self.output.append(" ".join(str(arg) for arg in args))
                return None
            if name in self.functions:
                return self.call_function(self.functions[name], args, kwargs)
            builtins = {
                "len": len,
                "abs": abs,
                "min": min,
                "max": max,
                "sum": sum,
                "round": round,
                "int": int,
                "float": float,
                "str": str,
                "bool": bool,
                "list": list,
                "tuple": tuple,
                "set": set,
                "dict": dict,
                "sorted": sorted,
                "reversed": lambda value: list(reversed(value)),
                "range": lambda *a: list(range(*a)),
                "enumerate": lambda value: list(enumerate(value)),
                "zip": lambda *a: list(zip(*a)),
            }
            if name in builtins:
                return builtins[name](*args, **kwargs)
            raise _StaticUnknown(name)
        if isinstance(node.func, ast.Attribute):
            obj = self.eval(node.func.value, env)
            method = node.func.attr
            if method in {"upper", "lower", "title", "capitalize", "strip", "lstrip", "rstrip", "split", "join", "replace", "get", "keys", "values", "items"}:
                value = getattr(obj, method)(*args, **kwargs)
                return list(value) if method in {"keys", "values"} else value
            if method == "append":
                obj.append(*args)
                return None
            if method == "extend":
                obj.extend(*args)
                return None
            raise _StaticUnknown(method)
        raise _StaticUnknown("call")

    def assign(self, target: ast.AST, value: Any, env: dict[str, Any]) -> None:
        if isinstance(target, ast.Name):
            env[target.id] = value
            return
        if isinstance(target, (ast.Tuple, ast.List)):
            values = list(value)
            if len(values) != len(target.elts):
                raise _StaticUnknown("unpack")
            for child, item in zip(target.elts, values):
                self.assign(child, item, env)
            return
        if isinstance(target, ast.Subscript):
            obj = self.eval(target.value, env)
            obj[self.eval(target.slice, env)] = value
            return
        raise _StaticUnknown("assign")

    def exec_block(self, statements: list[ast.stmt], env: dict[str, Any]) -> None:
        for statement in statements:
            self.exec_stmt(statement, env)

    def exec_stmt(self, node: ast.stmt, env: dict[str, Any]) -> None:
        if isinstance(node, ast.Return):
            raise _StaticReturn(self.eval(node.value, env) if node.value else None)
        if isinstance(node, ast.Assign):
            value = self.eval(node.value, env)
            for target in node.targets:
                self.assign(target, value, env)
            return
        if isinstance(node, ast.AnnAssign):
            if node.value:
                self.assign(node.target, self.eval(node.value, env), env)
            return
        if isinstance(node, ast.AugAssign):
            current = self.eval(node.target, env)
            value = self.eval(node.value, env)
            fake = ast.BinOp(left=ast.Constant(value=current), op=node.op, right=ast.Constant(value=value))
            self.assign(node.target, self.eval(fake, env), env)
            return
        if isinstance(node, ast.Expr):
            self.eval(node.value, env)
            return
        if isinstance(node, ast.If):
            self.exec_block(node.body if self.eval(node.test, env) else node.orelse, env)
            return
        if isinstance(node, ast.For):
            iterable = self.eval(node.iter, env)
            count = 0
            for item in iterable:
                count += 1
                if count > 1000:
                    raise _StaticUnknown("loop limit")
                self.assign(node.target, item, env)
                try:
                    self.exec_block(node.body, env)
                except _StaticBreak:
                    break
                except _StaticContinue:
                    continue
            else:
                self.exec_block(node.orelse, env)
            return
        if isinstance(node, ast.While):
            count = 0
            while self.eval(node.test, env):
                count += 1
                if count > 1000:
                    raise _StaticUnknown("loop limit")
                try:
                    self.exec_block(node.body, env)
                except _StaticBreak:
                    break
                except _StaticContinue:
                    continue
            return
        if isinstance(node, ast.Break):
            raise _StaticBreak()
        if isinstance(node, ast.Continue):
            raise _StaticContinue()
        if isinstance(node, ast.Raise):
            exc = node.exc
            if isinstance(exc, ast.Call):
                exc = exc.func
            if isinstance(exc, ast.Name):
                raise _StaticRaise(exc.id)
            if isinstance(exc, ast.Attribute):
                raise _StaticRaise(exc.attr)
            raise _StaticRaise("Exception")
        if isinstance(node, ast.Assert):
            if not self.eval(node.test, env):
                raise _StaticRaise("AssertionError")
            return
        if isinstance(node, ast.Try):
            try:
                self.exec_block(node.body, env)
            except _StaticRaise as raised:
                for handler in node.handlers:
                    name = None
                    if isinstance(handler.type, ast.Name):
                        name = handler.type.id
                    if name is None or name in {raised.name, "Exception", "BaseException"}:
                        self.exec_block(handler.body, env)
                        break
                else:
                    raise
            else:
                self.exec_block(node.orelse, env)
            self.exec_block(node.finalbody, env)
            return
        if isinstance(node, ast.Pass):
            return
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom)):
            return
        raise _StaticUnknown(type(node).__name__)

    def call_function(self, fn: ast.FunctionDef, args: list[Any], kwargs: dict[str, Any]) -> Any:
        if self.depth >= 20:
            raise _StaticUnknown("recursion limit")
        params = list(fn.args.posonlyargs) + list(fn.args.args)
        env: dict[str, Any] = {}
        defaults = list(fn.args.defaults)
        offset = len(params) - len(defaults)
        for index, param in enumerate(params):
            if index < len(args):
                env[param.arg] = args[index]
            elif param.arg in kwargs:
                env[param.arg] = kwargs[param.arg]
            elif index >= offset:
                env[param.arg] = self.eval(defaults[index - offset], {})
            else:
                raise _StaticUnknown("missing argument")
        for param, default in zip(fn.args.kwonlyargs, fn.args.kw_defaults):
            if param.arg in kwargs:
                env[param.arg] = kwargs[param.arg]
            elif default is not None:
                env[param.arg] = self.eval(default, {})
        self.depth += 1
        try:
            self.exec_block(fn.body, env)
        except _StaticReturn as ret:
            return ret.value
        finally:
            self.depth -= 1
        return None


def _static_call(fn: ast.FunctionDef, values: dict[str, Any], functions: dict[str, ast.FunctionDef]) -> tuple[str, Any]:
    evaluator = _StaticEvaluator(functions)
    try:
        params = list(fn.args.posonlyargs) + list(fn.args.args) + list(fn.args.kwonlyargs)
        args = []
        kwargs = {}
        for param in params:
            if param.arg not in values:
                continue
            if param in fn.args.kwonlyargs:
                kwargs[param.arg] = values[param.arg]
            else:
                args.append(values[param.arg])
        return "return", evaluator.call_function(fn, args, kwargs)
    except _StaticRaise as raised:
        return "exception", raised.name
    except Exception:
        return "unknown", None


def _is_main_guard(node: ast.If) -> bool:
    test = node.test
    return (
        isinstance(test, ast.Compare)
        and isinstance(test.left, ast.Name)
        and test.left.id == "__name__"
        and len(test.comparators) == 1
        and isinstance(test.comparators[0], ast.Constant)
        and test.comparators[0].value == "__main__"
    )


def analyze_python_structure(code: str) -> dict[str, Any]:
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return {
            "parse_error": f"Syntax error at line {exc.lineno}: {exc.msg}",
            "functions": [],
            "classes": [],
            "imports": [],
            "assertions": 0,
            "top_level_executable": False,
            "uses_input": False,
        }
    functions = []
    classes = []
    imports = []
    executable = False
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.append(node.name)
        elif isinstance(node, ast.ClassDef):
            classes.append({
                "name": node.name,
                "methods": [item.name for item in node.body if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))],
            })
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in getattr(node, "names", []):
                imports.append(alias.name)
            if isinstance(node, ast.ImportFrom) and node.module:
                imports.append(node.module)
        elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            continue
        else:
            executable = True
    return {
        "parse_error": None,
        "tree": tree,
        "functions": functions,
        "classes": classes,
        "imports": sorted(set(imports)),
        "assertions": sum(isinstance(node, ast.Assert) for node in ast.walk(tree)),
        "top_level_executable": executable,
        "uses_input": any(
            isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "input"
            for node in ast.walk(tree)
        ),
    }


def _script_expected_output(tree: ast.Module, functions: dict[str, ast.FunctionDef]) -> list[str] | None:
    evaluator = _StaticEvaluator(functions)
    env: dict[str, Any] = {"__name__": "__main__"}
    try:
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom)):
                continue
            if isinstance(node, ast.If) and _is_main_guard(node):
                evaluator.exec_block(node.body, env)
            else:
                evaluator.exec_stmt(node, env)
    except Exception:
        return None
    return evaluator.output


def _script_cases(code: str, tree: ast.Module, structure: dict[str, Any]) -> list[dict[str, Any]]:
    if structure["uses_input"]:
        return [_review("The script reads input with input(). Supply the input values before running it.", mode="script")]
    functions = {
        node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)
    }
    expected_output = _script_expected_output(tree, functions)
    assertions = int(structure["assertions"])
    if expected_output is None and assertions == 0:
        return [_review("No printed output or assertion could be derived safely from this script.", mode="script")]
    stdout = [line for line in (expected_output or []) if line != ""]
    if not stdout and assertions == 0:
        return [_review("No printed output or assertion could be derived safely from this script.", mode="script")]
    # Split the observable script behavior into facet cases so a standalone
    # script gets 2-3 real cases (output / assertions / clean exit) instead of
    # one combined case — without inventing any behavior.
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
                "assertions": assertions,
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
    if assertions:
        add_case(
            "Run the script and check its source assertions pass",
            "test_script_assertions",
            "assertions",
            [],
            f"exit code 0; {assertions} source assertion(s) pass",
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


def _pick(functions, function_name: str | None):
    if function_name:
        for fn in functions:
            if fn.name == function_name:
                return fn
    for fn in functions:
        if fn.name != "main" and isinstance(fn, ast.FunctionDef):
            return fn
    return functions[0] if functions else None


def _py_literal(value: Any) -> str:
    return repr(value)


def _kind_for(param: dict[str, Any], fn: ast.AST) -> str | None:
    ann = _annotation_kind(param.get("annotation"))
    if ann:
        return ann
    body = _body_kind(fn, param["name"])
    if body == "optional":
        return "optional"
    if body == "string_or_list":
        return _name_kind(param["name"]) or None
    if body:
        return body
    return _name_kind(param["name"])


def _values_for(kind: str | None, param: dict[str, Any], fn: ast.AST) -> list[Any] | None:
    name = param["name"]
    bounds = _boundaries(fn, name)
    if kind == "number":
        vals = [0, 1]
        for b in bounds:
            if isinstance(b, (int, float)) and b not in vals:
                vals.append(b)
        return vals[:4]
    if kind == "string":
        return ["", "ab"]
    if kind == "list":
        vals: list[Any] = [[], [1]]
        if None in bounds:
            vals.insert(0, None)
        return vals
    if kind == "dict":
        return [{}, {"a": 1}]
    if kind == "bool":
        return [False, True]
    if kind == "optional":
        return [None, []]
    if kind == "none":
        return [None]
    return None


def _is_fib(fn: ast.FunctionDef) -> bool:
    if re.search(r"fib", fn.name, re.I):
        return True
    src = ast.unparse(fn)
    return "fibonacci" in src


def _call(name: str, params: list[dict[str, Any]], values: dict[str, Any], *, omit: set[str] | None = None) -> str:
    omit = omit or set()
    parts = []
    for param in params:
        if param["name"] in omit:
            continue
        rendered = _py_literal(values[param["name"]])
        if param["kind"] == "keyword":
            parts.append(f"{param['name']}={rendered}")
        else:
            parts.append(rendered)
    return f"{name}({', '.join(parts)})"


def _case(
    i: int,
    description: str,
    call: str | None,
    *,
    expected=None,
    assert_expected=False,
    needs_review=False,
    fn=None,
    mode: str = "function",
    name: str | None = None,
    strategy: dict[str, Any] | None = None,
    expected_stdout_contains: list[str] | None = None,
    expected_exit_code: int | None = None,
    expected_exception: str | None = None,
    defect: str | None = None,
) -> dict[str, Any]:
    payload = dict(strategy or {})
    if call and "call" not in payload:
        payload["call"] = call
    if expected_exception:
        payload.setdefault("kind", "call_exception")
    elif mode == "script":
        payload.setdefault("kind", "script_run")
    elif call:
        payload.setdefault("kind", "call_return")
    expected_result = None
    if expected_exception:
        expected_result = f"Raises {expected_exception}"
    elif mode == "script":
        bits = [f"exit code {expected_exit_code if expected_exit_code is not None else 0}"]
        if expected_stdout_contains:
            bits.append("stdout contains " + ", ".join(repr(item) for item in expected_stdout_contains))
        expected_result = "; ".join(bits)
    elif assert_expected:
        expected_result = f"Returns {expected!r}"
    return {
        "id": i,
        "name": name or f"test_{_slug(description)}",
        "description": description,
        "input": call or "",
        "expected": expected,
        "expected_result": expected_result,
        "expected_stdout_contains": expected_stdout_contains or [],
        "expected_exit_code": expected_exit_code,
        "expected_exception": expected_exception,
        "actual": None,
        "actual_result": None,
        "stdout": None,
        "stderr": None,
        "exit_code": None,
        "status": "not_run",
        "call": call,
        "mode": mode,
        "target": fn,
        "strategy": payload,
        "assert_expected": assert_expected,
        "needs_review": needs_review,
        "function_name": fn,
        "generation_defect": defect,
        "failure_reason": None,
    }


def _function_cases(fn: ast.FunctionDef, tree: ast.Module) -> list[dict[str, Any]]:
    sig = _signature(fn)
    if sig["unsupported"]:
        return [_review(sig["reason"], fn=sig["name"], mode="function")]

    functions = {
        node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)
    }
    params = sig["params"]
    if not params:
        kind, value = _static_call(fn, {}, functions)
        if kind == "return":
            return [_case(1, f"{fn.name}() with no arguments", f"{fn.name}()", expected=value, assert_expected=True, fn=fn.name, name=f"test_{_slug(fn.name)}_no_arguments")]
        if kind == "exception":
            return [_case(1, f"{fn.name}() expected error", f"{fn.name}()", expected_exception=value, fn=fn.name, name=f"test_{_slug(fn.name)}_expected_error")]
        return [_review(f"The result of {fn.name}() could not be derived safely. Clarify the expected behavior.", fn=fn.name, mode="function")]

    kinds = {p["name"]: _kind_for(p, fn) for p in params}
    required_unknown = []
    for param in params:
        if kinds[param["name"]] is None and not (param["has_default"] and param["default_known"]):
            required_unknown.append(param["name"])
    if required_unknown:
        names = ", ".join(required_unknown)
        return [
            _review(
                f"Could not infer inputs for {fn.name} parameter(s): {names}. Supply an input before running.",
                fn=fn.name,
                mode="function",
            )
        ]

    value_sets = {}
    for param in params:
        kind = kinds[param["name"]]
        if kind is None and param["has_default"] and param["default_known"]:
            value_sets[param["name"]] = [param["default"]]
        else:
            vals = _values_for(kind, param, fn)
            if not vals:
                return [_review(f"Could not infer inputs for {param['name']}.", fn=fn.name, mode="function")]
            value_sets[param["name"]] = vals

    fib = _is_fib(fn) and len(params) == 1 and kinds[params[0]["name"]] == "number"
    cases: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(
        description: str,
        chosen: dict[str, Any],
        *,
        omit: set[str] | None = None,
        expected=None,
        assert_expected=False,
        expected_exception: str | None = None,
    ):
        call = _call(fn.name, params, chosen, omit=omit)
        full = {}
        for param in params:
            if param["name"] in chosen:
                full[param["name"]] = chosen[param["name"]]
            elif param["has_default"] and param["default_known"]:
                full[param["name"]] = param["default"]
        if expected_exception is None and not assert_expected:
            kind, value = _static_call(fn, full, functions)
            if kind == "return":
                expected = value
                assert_expected = True
            elif kind == "exception":
                expected_exception = value
            else:
                return
        key = f"{call}|{expected!r}|{expected_exception or ''}"
        if key in seen:
            return
        seen.add(key)
        cases.append(
            _case(
                len(cases) + 1,
                description,
                call,
                expected=expected,
                assert_expected=assert_expected,
                expected_exception=expected_exception,
                fn=fn.name,
            )
        )

    minimal = {name: vals[0] for name, vals in value_sets.items()}
    normal = {name: vals[min(1, len(vals) - 1)] for name, vals in value_sets.items()}

    if fib:
        known = {0: 0, 1: 1, 2: 1, 5: 5}
        pname = params[0]["name"]
        for n, exp in known.items():
            add(f"{fn.name}({n}) known Fibonacci value", {pname: n}, expected=exp, assert_expected=True)
        return cases

    add(f"{fn.name} minimal input", minimal)
    if normal != minimal:
        add(f"{fn.name} representative input", normal)

    for param in params:
        extra = value_sets[param["name"]][2:]
        if not extra:
            continue
        chosen = dict(normal)
        chosen[param["name"]] = extra[0]
        add(f"{fn.name} boundary for {param['name']}", chosen)
        break

    omit = {p["name"] for p in params if p["has_default"]}
    if omit and omit != set(p["name"] for p in params):
        chosen = {p["name"]: value_sets[p["name"]][0] for p in params if p["name"] not in omit}
        if chosen or not omit:
            add(f"{fn.name} using default arguments", chosen or minimal, omit=omit)
    elif omit and len(params) == len(omit):
        add(f"{fn.name} using default arguments", {}, omit=omit)

    keyword = [p for p in params if p["kind"] == "keyword"]
    if keyword:
        chosen = dict(normal)
        add(f"{fn.name} keyword argument", chosen)

    # Add a wrong-type case only when the source behavior statically raises for it.
    mismatches: dict[str, Any] = {"number": "invalid", "string": None, "list": None, "dict": None, "bool": "invalid", "optional": "invalid"}
    for param in params:
        kind = kinds[param["name"]]
        if kind not in mismatches:
            continue
        chosen = dict(normal)
        chosen[param["name"]] = mismatches[kind]
        before = len(cases)
        add(f"{fn.name} invalid input for {param['name']}", chosen)
        if len(cases) > before and cases[-1].get("expected_exception"):
            break

    trimmed = cases[:5]
    for i, case in enumerate(trimmed, start=1):
        case["id"] = i
    return trimmed or [
        _review(
            f"The expected behavior of {fn.name} could not be derived safely. Clarify an example input and result.",
            fn=fn.name,
            mode="function",
        )
    ]


def generate_python_cases(code: str, function_name: str | None = None) -> list[dict[str, Any]]:
    structure = analyze_python_structure(code)
    if structure["parse_error"]:
        return [_review(structure["parse_error"], defect="syntax_error")]
    tree: ast.Module = structure["tree"]
    top_functions = [
        node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]

    if function_name:
        requested = function_name.strip()
        if "." in requested:
            class_name, method_name = requested.split(".", 1)
            known_method = any(
                item["name"] == class_name and method_name in item["methods"]
                for item in structure["classes"]
            )
            if known_method:
                return [
                    _review(
                        f"{requested} is a method. Clarify how to construct {class_name} before generating a call.",
                        fn=requested,
                        mode="function",
                        defect="target_needs_setup",
                    )
                ]
        fn = next((item for item in top_functions if item.name == requested), None)
        if fn is None:
            case = _review(
                f"Target function '{requested}' was not found. No test was generated for a different function.",
                fn=requested,
                mode="function",
                defect="target_not_found",
            )
            case["name"] = "test_missing_target"
            return [case]
        if isinstance(fn, ast.AsyncFunctionDef):
            return [_review(f"{requested} is async. Supply a call manually; it was not executed.", fn=requested, mode="function")]
        return _function_cases(fn, tree)

    reviews: list[dict[str, Any]] = []
    candidates = sorted(
        (node for node in top_functions if isinstance(node, ast.FunctionDef)),
        key=lambda node: node.name == "main",
    )
    for fn in candidates:
        cases = _function_cases(fn, tree)
        if any(case.get("call") and not case.get("needs_review") for case in cases):
            return cases
        reviews.extend(cases)

    if structure["top_level_executable"]:
        return _script_cases(code, tree, structure)
    if reviews:
        first = dict(reviews[0])
        first["id"] = 1
        return [first]
    if structure["classes"]:
        names = ", ".join(item["name"] for item in structure["classes"])
        return [_review(f"Found class(es) {names}, but no safely testable function or script behavior. Clarify how to construct and call one.", mode="clarification")]
    return [_review("No safely testable behavior was found. Add a function call, printed output, or assertion to clarify what should be tested.", mode="clarification")]


def generate_cases_for_code(code: str, *, language: str = "python", function_name: str | None = None) -> list[dict[str, Any]]:
    lang = (language or "python").lower()
    lang = {"typescriptreact": "typescript", "javascriptreact": "javascript"}.get(lang, lang)
    if lang not in {"python", "py"}:
        # Automatic test generation is Python-only. Return no cases at all
        # instead of a fake "clarification" case that looks like a test.
        return []
    return generate_python_cases(code, function_name)
