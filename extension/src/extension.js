const vscode = require('vscode');

/**
 * Minimal Eyes client: collects editor context and POSTs to EYRA Brain.
 * Does not modify files or run shell commands.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const disposable = vscode.commands.registerCommand('eyra.analyzeActiveEditor', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('EYRA Eyes: no active editor.');
      return;
    }

    const doc = editor.document;
    const cfg = vscode.workspace.getConfiguration('eyra');
    const baseUrl = String(cfg.get('backendUrl') || 'http://127.0.0.1:8000').replace(/\/$/, '');

    const payload = {
      file_name: doc.fileName.split(/[/\\]/).pop(),
      language: doc.languageId || 'plaintext',
      code_snippet: doc.getText(),
      terminal_output: '',
      stack_trace: '',
      project_name: vscode.workspace.name || 'default',
    };

    try {
      const res = await fetch(`${baseUrl}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text || `HTTP ${res.status}`);
      }
      if (!res.ok) {
        throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data));
      }

      const panel = vscode.window.createWebviewPanel(
        'eyraResult',
        `EYRA ${data.session_id}`,
        vscode.ViewColumn.Beside,
        {},
      );
      panel.webview.html = renderResult(data);
      vscode.window.showInformationMessage(
        `EYRA: ${data.error_type} — ${data.root_cause} (${data.reasoning_source})`,
      );
    } catch (err) {
      vscode.window.showErrorMessage(`EYRA Eyes failed: ${err.message || err}`);
    }
  });

  context.subscriptions.push(disposable);
}

function renderResult(data) {
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0e131e;color:#dee2f2;padding:16px">
    <h2>EYRA Investigation</h2>
    <p><b>${esc(data.session_id)}</b> · ${esc(data.reasoning_source)}</p>
    <p><b>Error:</b> ${esc(data.error_summary)}</p>
    <p><b>Root cause:</b> ${esc(data.root_cause)}</p>
    <p><b>Verification:</b> ${esc(data.verification?.status)} — ${esc(data.verification?.detail)}</p>
    <h3>Suggested correction (review & copy)</h3>
    <pre style="background:#090e19;padding:12px;overflow:auto">${esc(data.suggested_correction?.corrected_code)}</pre>
    <p style="color:#859397;font-size:12px">EYRA never auto-applies fixes.</p>
  </body></html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };
