from pathlib import Path
import re
import json

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "src" / "pages" / "stitch_raw"
OUT.mkdir(parents=True, exist_ok=True)

SOURCES = {
    "OverviewPage": ROOT / "eyra_engineering_intelligence_overview" / "code.html",
    "WorkspacePage": ROOT / "eyra_debugging_workspace_agentscope" / "code.html",
    "AnalysisPage": ROOT / "eyra_analysis_results_runtime_audit" / "code.html",
    "HistoryPage": ROOT / "eyra_investigation_history_runtime_audit" / "code.html",
    "MemoryPage": ROOT / "eyra_memory_knowledge" / "code.html",
    "ConfigPage": ROOT / "eyra_configuration_projects" / "code.html",
}


def extract_main(html: str) -> str:
    m = re.search(r"<main[^>]*>([\s\S]*)</main>", html, re.I)
    return m.group(1).strip() if m else ""


def clean_main(html: str) -> str:
    html = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.I)
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    # Mask fake secrets in static mock
    html = re.sub(
        r'(value|placeholder)="sk_[^"]+"',
        r'\1="••••••••••••••••••••••••••••"',
        html,
    )
    return html.strip()


for page, path in SOURCES.items():
    raw = path.read_text(encoding="utf-8")
    main = clean_main(extract_main(raw))
    # JSON-encode as JS string for safe embedding
    literal = json.dumps(main)
    component = f"""export default function {page}Stitch() {{
  return (
    <div
      className="stitch-screen"
      dangerouslySetInnerHTML={{{{ __html: {literal} }}}}
    />
  );
}}
"""
    (OUT / f"{page}.jsx").write_text(component, encoding="utf-8")
    print(page, "ok", len(main))

print("done")
