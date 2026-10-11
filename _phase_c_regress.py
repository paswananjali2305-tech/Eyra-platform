"""Phase C API regression — honest outcomes for runtime + audit paths."""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BRAIN = "http://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parent
SAMPLE_ZIP = ROOT.parent / "Eyraaaa" / "server" / "samples" / "novapay-express-service.zip"
RESULTS: list[tuple[str, str, str]] = []


def record(name: str, ok: bool, detail: str = ""):
    status = "PASS" if ok else "FAIL"
    RESULTS.append((name, status, detail))
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))


def req(method: str, path: str, body=None, headers=None, timeout=90):
    data = None
    hdrs = dict(headers or {})
    if body is not None and not isinstance(body, (bytes, bytearray)):
        data = json.dumps(body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    elif isinstance(body, (bytes, bytearray)):
        data = body
    url = f"{BRAIN}{path}"
    request = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as res:
            raw = res.read()
            ctype = res.headers.get("Content-Type", "")
            if "json" in ctype:
                return res.status, json.loads(raw.decode("utf-8") or "null")
            return res.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            payload = json.loads(raw.decode("utf-8") or "null")
        except Exception:
            payload = raw.decode("utf-8", errors="replace")
        return e.code, payload
    except Exception as e:
        return 0, str(e)


def multipart_zip(path: Path, field="codebase"):
    boundary = "----EyraBoundary7MA4YWxkTrZu0gW"
    content = path.read_bytes()
    filename = path.name
    parts = [
        f"--{boundary}\r\n".encode(),
        (
            f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
            "Content-Type: application/zip\r\n\r\n"
        ).encode(),
        content,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    body = b"".join(parts)
    return req(
        "POST",
        "/api/audit/upload",
        body=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        timeout=120,
    )


def main():
    # Health
    code, health = req("GET", "/api/health", timeout=5)
    record("brain health", code == 200 and isinstance(health, dict) and health.get("status") == "ok", str(health)[:120])
    code, ahealth = req("GET", "/api/audit/health", timeout=8)
    record(
        "audit health",
        code == 200 and isinstance(ahealth, dict) and ahealth.get("status") in {"ok", "degraded"},
        str(ahealth)[:160],
    )

    # Runtime execute matrix
    cases = [
        ("exec success", "print('hello-eyra')\n", True, None),
        ("exec syntax error", "def (\n", False, "SyntaxError"),
        ("exec runtime exception", "a=1\nb=0\nprint(a/b)\n", False, "ZeroDivisionError"),
        ("exec blocked network", "import socket\nsocket.socket()\n", False, "SandboxPolicyError"),
        (
            "exec timeout",
            "import time\ntime.sleep(10)\n",
            False,
            "TimeoutError",
        ),
    ]
    for name, code_src, expect_ok, expect_err in cases:
        st, data = req(
            "POST",
            "/api/execute",
            {"code": code_src, "language": "python", "file_name": "probe.py"},
            timeout=20,
        )
        ok = st == 200 and isinstance(data, dict)
        if ok:
            if expect_ok:
                ok = bool(data.get("ok")) and data.get("exit_code") == 0
            else:
                ok = (not data.get("ok")) and (
                    expect_err is None
                    or data.get("error_type") == expect_err
                    or expect_err in (data.get("stderr") or "")
                )
        record(name, ok, json.dumps(data)[:180] if isinstance(data, dict) else str(data)[:180])

    # Analyze uses provided buffer (unique marker)
    marker = "EYRA_PHASE_C_MARKER_9911"
    snippet = f"{marker} = 1\na = 10\nb = 0\nprint(a / b)\n"
    st, analysis = req(
        "POST",
        "/api/analyze",
        {
            "file_name": "phase_c_probe.py",
            "language": "python",
            "code_snippet": snippet,
            "terminal_output": "ZeroDivisionError: division by zero",
            "stack_trace": 'File "phase_c_probe.py", line 4\nZeroDivisionError',
            "reasoning_profile": "runtime",
        },
        timeout=90,
    )
    ok = (
        st == 200
        and isinstance(analysis, dict)
        and analysis.get("file_name") == "phase_c_probe.py"
        and marker in (analysis.get("code_snippet") or "")
        and analysis.get("session_id")
    )
    record("analyze active buffer", ok, f"session={analysis.get('session_id') if isinstance(analysis, dict) else analysis}")

    st, hist = req("GET", "/api/history?limit=5", timeout=10)
    record("history list", st == 200 and isinstance(hist, dict) and "items" in hist, f"total={hist.get('total') if isinstance(hist, dict) else hist}")

    st, mem = req("GET", "/api/memory?limit=5", timeout=10)
    record("memory list", st == 200 and isinstance(mem, dict) and "items" in mem)

    st, cfg = req("GET", "/api/config", timeout=10)
    record("config get", st == 200 and isinstance(cfg, dict) and "project_name" in cfg)

    # Audit: invalid extension via multipart txt
    boundary = "----EyraBad"
    bad = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="codebase"; filename="nope.txt"\r\n'
        "Content-Type: text/plain\r\n\r\n"
        "not-a-zip\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    st, bad_res = req(
        "POST",
        "/api/audit/upload",
        body=bad,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        timeout=30,
    )
    record("upload reject non-zip", st >= 400, f"status={st} body={str(bad_res)[:120]}")

    # Malformed zip bytes
    boundary = "----EyraMalformed"
    mal = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="codebase"; filename="bad.zip"\r\n'
        "Content-Type: application/zip\r\n\r\n"
    ).encode() + b"PK\x03\x04not-a-real-zip" + f"\r\n--{boundary}--\r\n".encode()
    st, mal_res = req(
        "POST",
        "/api/audit/upload",
        body=mal,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        timeout=30,
    )
    record("upload malformed zip", st >= 400 or (isinstance(mal_res, dict) and mal_res.get("error")), f"status={st}")

    # Valid sample + start + poll
    st, up = req("POST", "/api/audit/upload", {"sampleId": "novapay"}, timeout=60)
    scan_id = up.get("scanId") if isinstance(up, dict) else None
    record("sample upload scanId", st == 200 and bool(scan_id), str(scan_id))
    if scan_id:
        st, started = req("POST", f"/api/audit/scan/{scan_id}/start", {}, timeout=30)
        record("scan start", st == 200, str(started)[:120])
        final = None
        for _ in range(40):
            time.sleep(1)
            st, g = req("GET", f"/api/audit/scan/{scan_id}", timeout=15)
            if st != 200 or not isinstance(g, dict):
                continue
            scan = g.get("scan") or g
            if scan.get("status") in {"completed", "failed"}:
                final = scan
                break
        ok = bool(final) and final.get("status") == "completed" and isinstance(final.get("issues"), list)
        issues = final.get("issues") if final else []
        fc = (final or {}).get("fileContents") or {}
        # Finding-to-source accuracy: each issue file exists in fileContents or has snippet
        aligned = True
        for iss in issues[:20]:
            path = (iss.get("file") or "").replace("\\", "/")
            if not path:
                aligned = False
                break
            if path not in fc and not iss.get("snippet"):
                aligned = False
                break
            if iss.get("line") is None:
                aligned = False
                break
        record(
            "scan completed + findings",
            ok,
            f"issues={len(issues)} files={len(fc)} progress={final.get('progress') if final else None}",
        )
        record("finding-to-source fields", ok and aligned and len(issues) > 0, f"checked={min(len(issues),20)}")

        st, md = req("GET", f"/api/audit/scan/{scan_id}/report?format=markdown", timeout=20)
        record("report markdown", st == 200 and isinstance(md, (bytes, str)) and len(md) > 100, f"bytes={len(md) if md else 0}")
        st, js = req("GET", f"/api/audit/scan/{scan_id}/report?format=json", timeout=20)
        record("report json", st == 200 and (isinstance(js, dict) or (isinstance(js, bytes) and len(js) > 50)))

        st, scans = req("GET", "/api/audit/scans", timeout=15)
        record("scan list", st == 200 and isinstance(scans, dict) and any(s.get("id") == scan_id for s in scans.get("scans") or []))

        # Stale scan id
        st, missing = req("GET", "/api/audit/scan/00000000-0000-0000-0000-000000000000", timeout=10)
        record("stale scan 404", st == 404, str(missing)[:100])

    # Real zip if present
    if SAMPLE_ZIP.exists():
        st, zip_up = multipart_zip(SAMPLE_ZIP)
        zid = zip_up.get("scanId") if isinstance(zip_up, dict) else None
        record("real zip multipart upload", st == 200 and bool(zid), f"scanId={zid}")
    else:
        record("real zip multipart upload", False, f"missing sample at {SAMPLE_ZIP}")

    # GitHub mock honesty: backend returns success but project from URL name / novapay sample
    st, gh = req("POST", "/api/audit/upload", {"repoUrl": "https://github.com/example/my-unique-repo.git"}, timeout=60)
    record(
        "github mock ingest (not real clone)",
        st == 200 and isinstance(gh, dict) and bool(gh.get("scanId")),
        f"projectName={gh.get('projectName') if isinstance(gh, dict) else gh}",
    )

    failed = [r for r in RESULTS if r[1] == "FAIL"]
    print("\n=== SUMMARY ===")
    print(f"total={len(RESULTS)} pass={len(RESULTS)-len(failed)} fail={len(failed)}")
    for name, status, detail in failed:
        print(f"  FAIL {name}: {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
