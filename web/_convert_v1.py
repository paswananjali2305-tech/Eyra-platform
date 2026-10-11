from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
STITCH = ROOT / "stitch_eyra_runtime_debugger"
WEB = STITCH / "web"
EXTRACT = WEB / "_stitch_extract_v1"
OUT = WEB / "src" / "pages" / "stitch_raw"
EXTRACT.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

# Prefer root for memory/config (newer v1.0), stitch for the rest (same content)
SOURCES = {
    "OverviewPage": ROOT / "eyra_engineering_intelligence_overview" / "code.html",
    "WorkspacePage": ROOT / "eyra_debugging_workspace_agentscope" / "code.html",
    "AnalysisPage": ROOT / "eyra_analysis_results_runtime_audit" / "code.html",
    "HistoryPage": ROOT / "eyra_investigation_history_runtime_audit" / "code.html",
    "MemoryPage": ROOT / "eyra_memory_knowledge" / "code.html",
    "ConfigPage": ROOT / "eyra_configuration_projects" / "code.html",
}


def html_to_jsx(html: str) -> str:
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    html = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.I)
    html = re.sub(r"\bclass=", "className=", html)
    html = re.sub(r"\bfor=", "htmlFor=", html)
    for attr in ["checked", "disabled", "selected", "required", "multiple"]:
        html = re.sub(rf"\b{attr}(?=\s|>|/)", f"{attr}={{true}}", html)
    html = re.sub(r'\breadonly(?=\s|>|/)', "readOnly={true}", html)

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
    for tag in ["input", "img", "br", "hr", "meta", "link", "col"]:
        html = re.sub(rf"<{tag}([^>]*?)(?<!/)>", rf"<{tag}\1 />", html)
    html = html.replace("//>", "/>")
    html = re.sub(r'\s+onclick="[^"]*"', "", html)
    html = re.sub(r"stroke-width=", "strokeWidth=", html)
    html = re.sub(r"stroke-linecap=", "strokeLinecap=", html)
    html = re.sub(r"stroke-linejoin=", "strokeLinejoin=", html)
    html = re.sub(r"fill-rule=", "fillRule=", html)
    html = re.sub(r"clip-rule=", "clipRule=", html)
    html = re.sub(r"clip-path=", "clipPath=", html)
    html = re.sub(r"tabindex=", "tabIndex=", html)
    html = re.sub(r'&amp;', "&", html)
    # uncontrolled static inputs
    html = re.sub(r"(<input\b[^>]*?)\bvalue=\"([^\"]*)\"", r'\1defaultValue="\2"', html)
    html = html.replace("py- space-sm", "py-space-sm")
    return html


def extract_main(html: str) -> str:
    m = re.search(r"<main[^>]*>([\s\S]*)</main>", html, re.I)
    return m.group(1) if m else ""


def extract_tag(html: str, tag: str) -> str:
    m = re.search(rf"(<{tag}[\s\S]*?</{tag}>)", html, re.I)
    return m.group(1) if m else ""


# Extract shell pieces from overview
overview_html = SOURCES["OverviewPage"].read_text(encoding="utf-8")
(EXTRACT / "aside.html").write_text(extract_tag(overview_html, "aside"), encoding="utf-8")
(EXTRACT / "header.html").write_text(extract_tag(overview_html, "header"), encoding="utf-8")

# Pull tailwind color block for theme sync
cfg = re.search(r'"colors"\s*:\s*(\{[\s\S]*?\})\s*,\s*"borderRadius"', overview_html)
if cfg:
    (EXTRACT / "colors.json.txt").write_text(cfg.group(1), encoding="utf-8")

for page, path in SOURCES.items():
    html = path.read_text(encoding="utf-8")
    main = extract_main(html)
    (EXTRACT / f"{page}.html").write_text(main, encoding="utf-8")
    body = html_to_jsx(main)
    component = f"""export default function {page}Stitch() {{
  return (
    <>
{body}
    </>
  );
}}
"""
    (OUT / f"{page}.jsx").write_text(component, encoding="utf-8")
    print(f"{page}: {len(component)} chars from {path}")

print("done")
