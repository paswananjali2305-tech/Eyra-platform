# EYRA Runtime Debugger (VS Code)

Extension id: `eyra-runtime-debugger.eyra-runtime-debugger`

Open the folder that contains `stitch_eyra_runtime_debugger` (and optionally `dashhboard`). That folder is the VS Code workspace. Do not open `dashhboard` as the extension.

## Install and compile

From `extension/`:

```bash
npm install
npm run compile
```

`npm run watch` recompiles while you edit.

## Launch

1. Open the project folder that contains `stitch_eyra_runtime_debugger` as the workspace (not the dashboard).
2. Press F5 and select **Run EYRA Extension**.
3. That configuration sets `--extensionDevelopmentPath` to `stitch_eyra_runtime_debugger/extension` and runs the task **compile EYRA extension** first.
4. In the Extension Development Host, open the **EYRA** Activity Bar icon.

If you launch Code from a shell and the workspace path contains a space, do not pass an unquoted `--extensionDevelopmentPath=...Antigravity project...` string. Chromium truncates at the space and the extension never loads. Prefer F5, or run `powershell -File scripts/launch-edh.ps1`, which uses an 8.3 short path and opens `fixtures/phase8` (disposable samples only).

The sidebar calls `GET {eyra.backendUrl}/api/health`. The setting defaults to `http://127.0.0.1:8000`.

## Open from the web dashboard

EYRA is **not** published on the Marketplace. Opening `vscode://eyra-runtime-debugger.eyra-runtime-debugger/...` alone makes the editor try to install from the Marketplace and fail with “extension … cannot be installed because it was not found.”

**Open Extension** on the web dashboard targets **VS Code** via the Brain:

1. `POST /api/extension/open` packages the local `extension/` folder as a VSIX
2. Installs it with `code --install-extension <vsix> --force` and verifies `--list-extensions`
3. Opens VS Code (no `vscode://…` deep link — those hit the Marketplace and fail with “extension not found”)
4. Falls back to Extension Development Host if packaging/install fails

Manual package/install:

```bash
cd extension
npm run package
code --install-extension dist/eyra-runtime-debugger-0.5.1.vsix --force
```

Or download `GET /api/extension/vsix` from a running Brain.

URI handler (`onUri` + `registerUriHandler`), after a local install:

```text
vscode://eyra-runtime-debugger.eyra-runtime-debugger/open
```

The handler only focuses the EYRA Activity Bar — it does **not** prompt for login. Sign-in / **Connect from Web** stay optional actions inside the sidebar when you need Brain APIs.

Commands:

- **EYRA: Check Brain Connection**
- **EYRA: Sign In** — existing account, or create one on this Brain
- **EYRA: Connect from Web** — paste a one-time code from the signed-in web app
- **EYRA: Sign Out**
- **EYRA: Analyze Current File** — sends that file only
- **EYRA: Explain Selected Code** — sends the selection only
- **EYRA: Run Current File** — asks first, then `POST /api/execute` for that file only
- **EYRA: Generate Tests** — reviews cases from `POST /api/performance/tests/generate`
- **EYRA: Run Tests** — runs the cases you select, after another confirmation
- **EYRA: Analyze Performance** — shows the Brain's complexity estimate
- **EYRA: Suggest Optimization** — shows a suggestion, not a measured speedup
- **EYRA: Show History** — loads `GET /api/history` for the signed-in account

Results open in one EYRA investigation panel with Analysis, Execution, Tests, Suggestions, and History. History entries come from the Brain. Execution and test runs stay in that panel only; they are not written into history. A suggestion uses `apply_mode: review_and_copy`. You can copy it, or apply it to the analyzed text after a confirmation dialog. Applying it does not verify the change.

The access token is stored in VS Code Secret Storage. Analysis opens a result panel. Suggested code is not written into the editor.

## Execution limits

Run sends the active file to the Brain process. The Brain writes it to a temporary directory and starts the host interpreter or compiler with an argument list, a timeout (30 seconds unless the server setting changes), and a reduced environment. Python also rejects a short list of module names with a regular expression. That is a soft sandbox, not a secure production sandbox. HTML, CSS, and SQL are not executed. Nothing runs on save, on activation, or as part of analysis.

Test generation builds cases for Python only. Other languages come back as a review note without invented inputs. A case that only ran, with no expected result, is counted as `executed`, not `passed`. Zero executed tests are not a passing suite.

Performance figures are AST or pattern estimates. An optimization response is a suggestion. `optimized_time` is not a measured speedup, and the suggestion is not applied to the file.

## Brain

Start the existing backend from `backend/` before expecting a connected state:

```bash
.venv\Scripts\activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

If that process is not running, the sidebar shows a disconnected error. That is not an extension compile failure.
