import * as vscode from 'vscode';

/** Last focused text editor. Sidebar/panel webviews clear activeTextEditor on click. */
let lastEditor: vscode.TextEditor | undefined;

export function trackActiveEditors(context: vscode.ExtensionContext): void {
  lastEditor = vscode.window.activeTextEditor;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        lastEditor = editor;
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (lastEditor && lastEditor.document.uri.toString() === doc.uri.toString()) {
        lastEditor = vscode.window.visibleTextEditors.find(
          (item) => item.document.uri.toString() !== doc.uri.toString(),
        );
      }
    }),
  );
}

/**
 * Prefer the real active editor; if focus is in a webview, reuse the last text editor
 * that is still open, then any visible editor.
 */
export function resolveTextEditor(): vscode.TextEditor | undefined {
  const active = vscode.window.activeTextEditor;
  if (active) {
    lastEditor = active;
    return active;
  }
  if (lastEditor) {
    try {
      if (!lastEditor.document.isClosed) {
        return lastEditor;
      }
    } catch {
      lastEditor = undefined;
    }
  }
  return vscode.window.visibleTextEditors[0];
}
