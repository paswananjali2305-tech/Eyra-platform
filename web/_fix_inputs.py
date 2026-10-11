from pathlib import Path
import re

p = Path("web/src/pages/stitch_raw/ConfigPage.jsx")
t = p.read_text(encoding="utf-8")
t = t.replace('py- space-sm', 'py-space-sm')
t = t.replace('readonly=""', 'readOnly={true}')
# Only rewrite value= on input tags
t = re.sub(
    r'(<input\b[^>]*?)\bvalue="([^"]*)"',
    r'\1defaultValue="\2"',
    t,
)
# Do not ship a fake API key string in source
t = t.replace(
    'defaultValue="sk_groq_99a8182b819f727c98e104f"',
    'defaultValue="••••••••••••••••••••••••••••"',
)
p.write_text(t, encoding="utf-8")
print("config fixed")

for path in Path("web/src/pages/stitch_raw").glob("*.jsx"):
    text = path.read_text(encoding="utf-8")
    text2 = text.replace('readonly=""', 'readOnly={true}')
    text2 = re.sub(r'\bchecked=\{true\}=""', 'checked={true}', text2)
    if text2 != text:
        path.write_text(text2, encoding="utf-8")
        print("patched", path.name)
