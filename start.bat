@echo off
set ROOT=%~dp0
start "EYRA Brain" cmd /k "cd /d "%ROOT%backend" && (if exist .venv\Scripts\activate.bat (call .venv\Scripts\activate.bat) else (python -m venv .venv && call .venv\Scripts\activate.bat && pip install -r requirements.txt)) && uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
start "EYRA Web" cmd /k "cd /d "%ROOT%web" && if not exist node_modules npm install && npm run dev"
echo EYRA Brain → http://127.0.0.1:8000  (also starts Code Audit on :5000)
echo EYRA Web   → http://localhost:5173
