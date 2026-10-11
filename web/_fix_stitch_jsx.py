from pathlib import Path
import re

raw = Path(__file__).resolve().parent / "src" / "pages" / "stitch_raw"

replacements = [
    (r"stroke-width=", "strokeWidth="),
    (r"stroke-linecap=", "strokeLinecap="),
    (r"stroke-linejoin=", "strokeLinejoin="),
    (r"fill-rule=", "fillRule="),
    (r"clip-rule=", "clipRule="),
    (r"clip-path=", "clipPath="),
    (r"tabindex=", "tabIndex="),
    (r"aria-selected=", "aria-selected="),  # keep
    (r'checked=\{true\}=""', "checked={true}"),
    (r"&amp;", "&"),
]

for path in raw.glob("*.jsx"):
    text = path.read_text(encoding="utf-8")
    for a, b in replacements:
        text = re.sub(a, b, text)
    # fix accidental & in JSX text nodes that should stay as &amp; in HTML entities inside strings — keep &
    # void tags that became <input ... /> already ok
    path.write_text(text, encoding="utf-8")
    print("fixed", path.name)
