import * as vscode from 'vscode';
import { openInvestigationTab } from './investigationPanel';
import { parseOpenUri } from './uriOpen';

/** Focus the EYRA Workspace view in the left (Primary) Side Bar. */
export async function revealEyraSidebar(): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.view.extension.eyra');
  } catch {
    try {
      await vscode.commands.executeCommand('eyra.healthView.focus');
    } catch {
      // Host layout may differ; opening the view is best-effort.
    }
  }
}

/** Focus the EYRA Chat view in the right (Secondary) Side Bar, where Copilot Chat lives. */
export async function revealEyraChat(): Promise<void> {
  try {
    await vscode.commands.executeCommand('eyra.chatView.focus');
  } catch {
    try {
      await vscode.commands.executeCommand('workbench.view.extension.eyraChat');
    } catch {
      // Host layout may differ; opening the view is best-effort.
    }
  }
}

/** Focus the EYRA chatbot on the right; the Workspace stays on the left. */
export async function openEyraWorkbench(): Promise<void> {
  await revealEyraChat();
  openInvestigationTab('chat');
}

export async function handleEyraUri(uri: vscode.Uri): Promise<void> {
  const decision = parseOpenUri({ path: uri.path, query: uri.query });
  if (decision.kind === 'reject') {
    void vscode.window.showWarningMessage(decision.reason);
    return;
  }

  await openEyraWorkbench();
}

export function registerEyraUriHandler(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): Thenable<void> | void {
        return handleEyraUri(uri);
      },
    }),
    vscode.commands.registerCommand('eyra.focusSidebar', () => openEyraWorkbench()),
  );
}
