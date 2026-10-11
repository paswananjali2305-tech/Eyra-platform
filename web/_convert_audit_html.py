from pathlib import Path
import re
import json

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "src" / "pages" / "stitch_raw" / "audit"
OUT.mkdir(parents=True, exist_ok=True)

SOURCES = {
    "AuditOverviewPage": ROOT / "eyra_codebase_intelligence_overview" / "code.html",
    "AuditIngestPage": ROOT / "eyra_ingest_codebase_configure_audit" / "code.html",
    "AuditProgressPage": ROOT / "eyra_live_codebase_audit_progress" / "code.html",
}


def extract_main(html: str) -> str:
    m = re.search(r"<main[^>]*>([\s\S]*)</main>", html, re.I)
    return m.group(1).strip() if m else ""


def clean_main(html: str) -> str:
    html = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.I)
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    html = re.sub(
        r'(value|placeholder)="sk_[^"]+"',
        r'\1="••••••••••••••••••••••••••••"',
        html,
    )
    return html.strip()


for page, path in SOURCES.items():
    if not path.exists():
        raise SystemExit(f"missing {path}")
    raw = path.read_text(encoding="utf-8")
    main = clean_main(extract_main(raw))
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
