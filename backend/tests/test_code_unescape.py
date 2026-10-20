"""Escaped model snippets must not become fake quote fixes."""

from app.agent.groq_reasoner import _draft_from_parsed, unescape_model_code
from app.schemas import AnalyzeRequest

SCRATCH = """# Scratch file - edit freely, then Save (Ctrl+S)

def main():
    \"\"\"Entry point.\"\"\"
    print("hello from EYRA")

if __name__ == "__main__":
    main()
"""


def _escape(source: str) -> str:
    return source.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def test_multiline_escape_becomes_real_lines():
    decoded = unescape_model_code(_escape(SCRATCH))
    assert 'print("hello from EYRA")' in decoded
    assert "\\n" not in decoded
    assert decoded.count("\n") >= 4


def test_real_newline_source_keeps_printf_escape():
    source = '#include <stdio.h>\nint main() {\n  printf("hello\\n");\n  return 0;\n}\n'
    assert unescape_model_code(source) == source


def test_single_printf_escape_is_not_rewritten():
    source = 'printf("hello\\n");'
    assert unescape_model_code(source) == source


def test_escaped_scratch_is_not_a_quote_fix():
    req = AnalyzeRequest(file_name="untitled-1.py", language="python", code_snippet=SCRATCH)
    draft = _draft_from_parsed(
        req,
        {
            "error_type": "SyntaxError",
            "error_summary": "Add a closing double quote to the string in the print statement.",
            "root_cause": "The print string is not closed.",
            "explanation": "Add a closing double quote.",
            "suggested_summary": "Add a closing double quote to the string in the print statement.",
            "corrected_code": _escape(SCRATCH),
            "verification_status": "verified",
            "confidence": 0.4,
        },
    )
    assert draft.suggested_correction.corrected_code == ""
    assert "already parses" in draft.suggested_correction.summary
    assert draft.error_type == "None"
    assert draft.verification.status == "not_run"


def test_real_different_fix_is_kept():
    source = "a = 10\nb = 0\nprint(a / b)\n"
    fixed = "a = 10\nb = 0\nif b != 0:\n    print(a / b)\n"
    req = AnalyzeRequest(
        file_name="div.py",
        language="python",
        code_snippet=source,
        terminal_output="ZeroDivisionError: division by zero",
    )
    draft = _draft_from_parsed(
        req,
        {
            "error_type": "ZeroDivisionError",
            "error_summary": "division by zero",
            "root_cause": "b is zero",
            "explanation": "Guard the divisor.",
            "suggested_summary": "Check the divisor before dividing.",
            "corrected_code": _escape(fixed),
            "verification_status": "unverified",
            "confidence": 0.8,
        },
    )
    assert "if b != 0:" in draft.suggested_correction.corrected_code
    assert draft.error_type == "ZeroDivisionError"
