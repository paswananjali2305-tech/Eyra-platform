from pathlib import Path
import re

# Re-run conversion then escape braces for JSX text safety
from _convert_v1 import SOURCES, extract_main, html_to_jsx, OUT

root = Path("src/pages/stitch_raw")


def escape_jsx_braces(jsx: str) -> str:
    placeholders: list[str] = []

    def protect(m):
        placeholders.append(m.group(0))
        return f"@@PH{len(placeholders) - 1}@@"

    # Protect intentional JSX expressions we generate
    jsx = re.sub(r"style=\{\{[^{}]*\}\}", protect, jsx)
    jsx = re.sub(r"\{(true|false)\}", protect, jsx)
    jsx = re.sub(r"\{'[^{}']*'\}", protect, jsx)
    jsx = re.sub(r"\{\d+\}", protect, jsx)

    jsx = jsx.replace("{", "{'{'}")
    jsx = jsx.replace("}", "{'}'}")

    for i, val in enumerate(placeholders):
        jsx = jsx.replace(f"@@PH{i}@@", val)
    return jsx


for page, path in SOURCES.items():
    html = path.read_text(encoding="utf-8")
    main = extract_main(html)
    body = html_to_jsx(main)
    body = escape_jsx_braces(body)
    body = body.replace("&amp;", "&")
    body = re.sub(
        r'defaultValue="sk_[^"]+"',
        'defaultValue="••••••••••••••••••••••••••••"',
        body,
    )
    component = f"""export default function {page}Stitch() {{
  return (
    <>
{body}
    </>
  );
}}
"""
    (OUT / f"{page}.jsx").write_text(component, encoding="utf-8")
    print("rewrote", page)
