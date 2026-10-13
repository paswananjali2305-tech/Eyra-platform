# EYRA — Intelligent Runtime Debugging Agent

Integrated application built from Google Stitch screen exports plus a real FastAPI Brain, SQLite memory, React web console, and a minimal VS Code Eyes extension.

Stitch HTML/PNG mockups under `eyra_*` and design tokens in `obsidian_telemetry/` remain the visual reference. They are **not** the runnable app.

## Architecture

| Layer | Path | Role |
|---|---|---|
| **Web (console)** | `web/` | React + Vite + Tailwind — six routed screens |
| **Brain** | `backend/` | FastAPI + agent + Groq/local heuristic + SQLite |
| **Eyes** | `extension/` | Minimal VS Code client → `POST /api/analyze` |
| **Design refs** | `eyra_*/code.html`, `obsidian_telemetry/DESIGN.md` | Stitch exports (read-only reference) |

Related workspace folders (not part of this runtime product):

- `../Eyraaaa` — CodeAudit AI static analysis (separate product)
- `../dashhboard` — ScopeBot client-side playground (separate)

## Quick start

### Backend

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

`requirements.txt` includes **ruff** and **radon** so CodeAudit Python analysis tools are available after one `pip install`. For Eyraaaa alone you can also run `pip install -r ../Eyraaaa/analyzer-python/requirements.txt` against the same Python that is on your PATH.

Optional: set `GROQ_API_KEY` in `.env`. Without it, EYRA uses an **explicitly labeled** local heuristic (`reasoning_source: local_heuristic`). It never pretends Groq was called.

### Frontend

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173`.

### VS Code Eyes (optional)

In VS Code: **Extensions → Install from VSIX…** is not required for folder load.

- Open `extension/` as a workspace folder, or use **Developer: Install Extension from Location**
- Run command **EYRA: Analyze Active Editor Context**
- Configure `eyra.backendUrl` (default `http://127.0.0.1:8000`)

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/status` | Brain / Groq / SQLite counters |
| POST | `/api/analyze` | Run investigation |
| GET | `/api/history` | List sessions (`q`, `status`, `language`, `limit`, `offset`) |
| GET | `/api/history/{session_id}` | Session detail |
| GET | `/api/memory` | Memory listing (SQLite keyword search) |
| GET/PUT | `/api/config` | Non-secret preferences |

## Safety

- Suggest → review → developer applies (copy workflow only)
- No automatic source edits, shell execution, or file deletion
- Secrets stay in backend `.env`; `/api/config` never returns API keys
- Absolute paths are stripped to file basenames on ingest

## Tests

```bash
cd backend
pytest -q
```
