import * as vscode from 'vscode';
import { trackActiveEditors } from './activeEditor';
import { analyzeCurrentFile, answerChatPrompt, connectFromWeb, explainSelection, signIn, signOut } from './commands';
import { HealthViewProvider } from './healthView';
import { bindInvestigationHost, EyraChatViewProvider, showHistory } from './investigationPanel';
import {
  analyzeCurrentPerformance,
  generateCurrentTests,
  runCurrentFile,
  runCurrentTests,
  suggestCurrentOptimization,
} from './runCommands';
import { watchTerminalErrors } from './terminalWatch';
import { registerEyraUriHandler } from './uriHandler';

export function activate(context: vscode.ExtensionContext): void {
  trackActiveEditors(context);
  const provider = new HealthViewProvider(context.extensionUri);
  const chatProvider = new EyraChatViewProvider();
  const secrets = context.secrets;
  provider.bindSecrets(secrets);
  bindInvestigationHost(secrets, context.extensionUri);
  registerEyraUriHandler(context);
  watchTerminalErrors(context, secrets);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(HealthViewProvider.viewId, provider),
    vscode.window.registerWebviewViewProvider(EyraChatViewProvider.viewId, chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('eyra.checkBrain', () => provider.refresh(true)),
    vscode.commands.registerCommand('eyra.signIn', () => signIn(secrets)),
    vscode.commands.registerCommand('eyra.signOut', () => signOut(secrets)),
    vscode.commands.registerCommand('eyra.connectWeb', () => connectFromWeb(secrets)),
    vscode.commands.registerCommand('eyra.analyzeFile', () => analyzeCurrentFile(secrets)),
    vscode.commands.registerCommand('eyra.explainSelection', () => explainSelection(secrets)),
    vscode.commands.registerCommand('eyra.runFile', () => runCurrentFile(secrets)),
    vscode.commands.registerCommand('eyra.generateTests', () => generateCurrentTests(secrets)),
    vscode.commands.registerCommand('eyra.runTests', (arg?: unknown) => {
      const options = arg && typeof arg === 'object'
        ? {
          all: (arg as { all?: unknown }).all === true,
          confirmed: (arg as { confirmed?: unknown }).confirmed === true,
        }
        : undefined;
      return runCurrentTests(secrets, options?.all || options?.confirmed ? options : undefined);
    }),
    vscode.commands.registerCommand('eyra.analyzePerformance', () => analyzeCurrentPerformance(secrets)),
    vscode.commands.registerCommand('eyra.suggestOptimization', () => suggestCurrentOptimization(secrets)),
    vscode.commands.registerCommand('eyra.showHistory', () => showHistory(secrets)),
    vscode.commands.registerCommand('eyra.chatPrompt', (prompt: string) => answerChatPrompt(secrets, typeof prompt === 'string' ? prompt : '')),
    // eyra.focusSidebar is registered with the URI handler (focuses the sidebar chat).
  );
}

export function deactivate(): void {}
