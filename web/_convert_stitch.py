from pathlib import Path
import re

base = Path(__file__).resolve().parent.parent
extract = Path(__file__).resolve().parent / "_stitch_extract"
out_dir = Path(__file__).resolve().parent / "src" / "pages" / "stitch_raw"
out_dir.mkdir(parents=True, exist_ok=True)


def html_to_jsx(html: str) -> str:
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    html = re.sub(r"\bclass=", "className=", html)
    html = re.sub(r"\bfor=", "htmlFor=", html)
    for attr in ["checked", "disabled", "selected", "readonly", "required", "multiple"]:
        html = re.sub(rf"\b{attr}(?=\s|>|/)", f"{attr}={{true}}", html)

    def style_repl(m):
        raw = m.group(1)
        parts = []
        for piece in raw.split(";"):
            piece = piece.strip()
            if not piece or ":" not in piece:
                continue
            k, v = piece.split(":", 1)
            k = k.strip()
            v = v.strip().replace("'", "\\'")
            chunks = k.split("-")
            ck = chunks[0] + "".join(w.capitalize() for w in chunks[1:])
            parts.append(f"{ck}: '{v}'")
        return "style={{" + ", ".join(parts) + "}}"

    html = re.sub(r'style="([^"]*)"', style_repl, html)
    for tag in ["input", "img", "br", "hr", "meta", "link"]:
        html = re.sub(rf"<{tag}([^>]*?)(?<!/)>", rf"<{tag}\1 />", html)
    html = html.replace("//>", "/>")
    html = re.sub(r'\s+onclick="[^"]*"', "", html)
    # keep ids for now — strip later if needed
    return html


pages = {
    "OverviewPage": "eyra_overview_dashboard",
    "WorkspacePage": "eyra_core_debugging_workspace",
    "AnalysisPage": "eyra_analysis_results",
    "HistoryPage": "eyra_investigation_history",
    "MemoryPage": "eyra_memory_knowledge",
    "ConfigPage": "eyra_configuration_projects",
}

for page, folder in pages.items():
    main = (extract / f"{folder}.html").read_text(encoding="utf-8")
    jsx_body = html_to_jsx(main)
    component = f'''export default function {page}Stitch() {{
  return (
    <>
{jsx_body}
    </>
  );
}}
'''
    (out_dir / f"{page}.jsx").write_text(component, encoding="utf-8")
    print(page, "ok", len(component))

print("done")
