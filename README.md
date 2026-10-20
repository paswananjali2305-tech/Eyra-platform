# EYRA — Intelligent Runtime Debugging Agent

*Understand code. Find bugs. Fix with confidence.*

EYRA is a local-first debugging platform. It reads the file, diagnostics, and terminal output you already have, reasons over that evidence, and returns a structured investigation: **Finding → Root Cause → Evidence → Suggested Fix**. Fixes are applied only after you confirm them, then checked by re-running the code.

| Component | Version |
|---|---|
| VS Code extension (Eyes) | `0.5.55` |
| FastAPI Brain | `0.9.4` |

Longer write-ups: [`synopsis.md`](synopsis.md) (full A–Z) and [`deck.md`](deck.md) (pitch).

## What it does

- **Investigate.** Analyze the current file or selection. Diagnostics are quoted verbatim with `file:line:column`.
- **Fix with review.** Show a diff, apply only after confirmation, then re-run the file or tests. A fix is **Verified** only when that run succeeds.
- **Run.** Execute Python, JavaScript, TypeScript/TSX/JSX, Java, C, C++, and Go when the toolchain is installed. Missing tools are reported as unavailable.
- **Test.** Generate cases for Python and JavaScript/TypeScript. Expected values come from evaluating your code. Ambiguous cases ask for clarification.
- **Measure.** Line coverage (Python tracer, V8 for JS, source maps for TS) and complexity with a labeled basis (`python_ast`, `js_structural`, or `heuristic`).
- **Remember.** Every investigation is a session (`EYRA-XXXX`) in SQLite, scoped to your account.
- **Audit a project.** Upload a ZIP or clone a public GitHub repo. The audit engine runs AST, Ruff, Radon, secret detection, and a dependency check, then an AI semantic pass.

Without `GROQ_API_KEY`, reasoning falls back to a local heuristic and the UI labels it `local_heuristic`. It does not claim an LLM was called.

## Architecture

| Layer | Path | Role |
|---|---|---|
| **Eyes** | `extension/` | VS Code sidebar and chat. Analyze, run, test, history. |
| **Brain** | `backend/` | FastAPI agent, Groq or local reasoner, runtimes, tests, SQLite. `:8000` |
| **Web console** | `web/` | React + Vite + Tailwind. Workspace, analysis, history, memory, config, Code Audit. `:5173` |
| **Code Audit** | `codeaudit/` | Express engine. ZIP and GitHub ingest, static analysis. `:5000`, started by the Brain |

```
VS Code extension ──REST──┐
                          ├── EYRA Brain :8000 ── SQLite
React web console ──REST──┘         │
                                    └── Code Audit :5000
```

The Brain starts the audit engine and proxies `/api/audit/*`. The browser does not call `:5000` directly.

## Prerequisites

- Python 3.11+
- Node.js 18+
- VS Code 1.85+ (extension is optional)
- Windows, macOS, or Linux. `start.bat` is the Windows launcher.

Optional toolchains change what can run: Node (JS/TS), `tsc`/`tsx` (TypeScript coverage and run), `javac`, a C/C++ compiler, Go.

## Quick start

From this folder:

```powershell
.\start.bat
```

That script:

1. Creates `backend/.venv` and installs `backend/requirements.txt` on first run.
2. Starts the Brain at `http://127.0.0.1:8000` (which starts Code Audit on `:5000`).
3. Runs `npm install` in `web/` if needed, then the console at `http://localhost:5173`.

Check liveness: `GET http://127.0.0.1:8000/api/health` returns `{"status":"ok",...}`.

### Manual start

```powershell
# Brain
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Web (separate terminal)
cd web
npm install
npm run dev
```

On macOS/Linux, activate with `source .venv/bin/activate` and copy `.env.example` with `cp`.

Set `GROQ_API_KEY` in `backend/.env` when you want Groq. Leave it unset to stay on the local heuristic. `EYRA_SKIP_AUDIT_ENGINE` skips starting Code Audit.

## VS Code extension

EYRA is not on the Marketplace. Install it locally.

1. **From the web console.** Sign in, then **Open Extension**. The Brain compiles, packages a VSIX, installs it with `code --install-extension`, and opens the editor. If packaging fails, it falls back to an Extension Development Host.
2. **From a VSIX.**

```powershell
cd extension
npm install
npm run package
code --install-extension dist\eyra-runtime-debugger-0.5.55.vsix --force
```

Or download `GET /api/extension/vsix` from a running Brain.

3. **For development.** Open `extension/` and press **F5** (**Run EYRA Extension**). If the workspace path contains a space, prefer F5 over an unquoted `--extensionDevelopmentPath`.

In the editor, open the **EYRA** Activity Bar icon. Workspace and Chat open together. Point `eyra.backendUrl` at the Brain (default `http://127.0.0.1:8000`).

Connect an account with **EYRA: Sign In**, or paste a one-time code from the signed-in web app with **EYRA: Connect from Web**. The token stays in VS Code Secret Storage. The URI handler `vscode://eyra-runtime-debugger.eyra-runtime-debugger/open` only focuses the sidebar. It rejects any token, code, or key in the query string.

| Command | What it does |
|---|---|
| EYRA: Analyze Current File | Sends that file, plus diagnostics and any captured terminal error |
| EYRA: Explain Selected Code | Sends the selection |
| EYRA: Run Current File | Confirms, then executes that buffer |
| EYRA: Generate Tests | Reviews cases before anything runs |
| EYRA: Run Tests | Runs the cases you select, after another confirmation |
| EYRA: Analyze Performance | Complexity estimate with a basis label |
| EYRA: Suggest Optimization | Suggestion only; same review path as a fix |
| EYRA: Show History | Sessions for the signed-in account |
| EYRA: Check Brain Connection | Probes `GET /api/health` |

## API

Base URL `http://127.0.0.1:8000`. Authenticated routes use `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/status` | Brain, Groq, and SQLite counters |
| POST | `/api/auth/register`, `/api/auth/login` | Account → token |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/extension/code` | One-time connect code (web, signed in) |
| POST | `/api/auth/extension/exchange` | Code → extension credential |
| POST | `/api/analyze` | Investigation; saves a session |
| GET | `/api/history`, `/api/history/{session_id}` | List and detail |
| DELETE | `/api/history` | Clear your history |
| GET | `/api/memory` | Keyword search over sessions |
| GET | `/api/runtimes` | Which languages can execute here |
| POST | `/api/execute` | Run a buffer |
| POST | `/api/performance/analyze` | Complexity |
| POST | `/api/performance/optimize` | Optimization suggestion |
| POST | `/api/performance/tests/generate` | Generate cases |
| POST | `/api/performance/tests/run` | Run selected cases and measure coverage |
| GET, PUT | `/api/config` | Non-secret preferences |
| POST | `/api/config/llm-models` | List models for a supplied key |
| GET | `/api/extension/status` | Compile, VSIX, and editor readiness |
| POST | `/api/extension/open` | Package, install, and open the editor |
| GET | `/api/extension/vsix` | Download the VSIX |
| * | `/api/audit/{path}` | User-scoped proxy to Code Audit |

`/api/config` never returns API keys.

## Safety

- Nothing is written to the editor until you confirm. Cancellation changes nothing.
- Apply checks that the document is still the one that was analyzed. Verification re-runs the current buffer of that same file.
- Execution is local, user-initiated, and time-limited. It is a soft sandbox, not a production isolation boundary.
- ZIP ingest rejects path traversal. Audit requests from the Brain are HMAC-signed. The audit server binds to `127.0.0.1`.
- Code stays on this machine except for the Groq request when a key is configured.

If a correction cannot be derived, `corrected_code` is empty and the UI says there is no verified automatic fix. A missing dependency, timeout, or absent toolchain is an **Error**, not a pass. Pass rate and coverage are separate numbers.

## Tests

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest -q

cd ..\extension
npm run compile
node --test tests/*.test.js

cd ..\web
node --test tests/*.test.mjs

cd ..\codeaudit\server
node --test tests/*.mjs
```

Backend skips are expected when a language toolchain is not on `PATH`. Extension tests import compiled `out/` and include a live journey against a running Brain (`phase8`).

## Layout

```
Eyra_runtime_debugger/
├─ start.bat                 # Brain + web (Brain starts Code Audit)
├─ backend/                  # FastAPI Brain, tests, SQLite data/
├─ extension/                # VS Code extension (src, tests, dist/*.vsix)
├─ web/                      # React console
├─ codeaudit/                # Express audit server + Python analyzer
├─ synopsis.md
└─ deck.md
```

## Limits

- Single machine. SQLite and local processes. No shared team memory.
- Local heuristic reasoning is narrower than Groq, and strongest on Python diagnostics.
- Deepest Code Audit coverage is Python. Other languages get inventory and shallower checks.
- Java, C, C++, Go, and TypeScript coverage need the matching tools installed locally.
