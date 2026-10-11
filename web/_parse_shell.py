from pathlib import Path
import re

aside = Path("web/_stitch_extract_v1/aside.html").read_text(encoding="utf-8")
header = Path("web/_stitch_extract_v1/header.html").read_text(encoding="utf-8")

for m in re.finditer(r'data-path="([^"]+)"[^>]*>([\s\S]*?)</a>', aside):
    path = m.group(1)
    text = re.sub(r"<[^>]+>", "", m.group(2))
    text = re.sub(r"\s+", " ", text).strip()
    print("NAV", path, "=>", text)

print("---HEADER---")
print(header)
print("---FOOTER---")
idx = aside.find("border-t")
print(aside[idx : idx + 1500])
