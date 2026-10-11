from pathlib import Path
import re

root = Path("src/pages/stitch_raw")
for p in root.glob("*.jsx"):
    t = p.read_text(encoding="utf-8")
    o = t
    t = t.replace("&amp;", "&")
    t = re.sub(r'checked=\{true\}=""', "checked={true}", t)
    t = re.sub(
        r'defaultValue="sk_[^"]+"',
        'defaultValue="••••••••••••••••••••••••••••"',
        t,
    )
    if t != o:
        p.write_text(t, encoding="utf-8")
        print("fixed", p.name)
    else:
        print("ok", p.name)
