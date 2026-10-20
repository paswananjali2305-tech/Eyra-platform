import * as vscode from 'vscode';
import { resolveTextEditor } from './activeEditor';
import {
  analyzePerformance,
  generateTests,
  runTests,
  suggestOptimization,
} from './brainClient';
import { brainBaseUrl } from './config';
import { collectCurrentFile, type EditorSnapshot } from './editorContext';
import { BrainHttpError } from './http';
import { cancelBrainRequest, endBrainRequest, tryBeginBrainRequest } from './inflight';
import {
  buildPerformanceRequest,
  generateTestsFlow,
  parseOptimize,
  parsePerformance,
  runTestsFlow,
  type GenerateFlowResult,
  type ReviewedTests,
  type TestRunFlowResult,
} from './phase3Model';
import { ResponseShapeError } from './parse';
import { readAccessToken } from './session';
import {
  beginPanelWork,
  beginVerification,
  completeVerification,
  failPanelWork,
  openInvestigationTab,
  showGeneratedTests,
  showOptimizeResult,
  showPerformanceResult,
  showTestRunResult,
} from './investigationPanel';
import { analyzeTerminalError } from './commands';
import { looksLikeRuntimeError, suppressTerminalErrorWatch } from './terminalWatch';
import { runCommandForFile } from './workspaceTree';

let reviewed: ReviewedTests | null = null;

function snapshot(editor: vscode.TextEditor | undefined): EditorSnapshot | undefined {
  if (!editor) {
    return undefined;
  }
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  return {
    text: editor.document.getText(),
    languageId: editor.document.languageId,
    fileName: editor.document.fileName,
    relativePath: vscode.workspace.asRelativePath(editor.document.uri, false),
    isUntitled: editor.document.uri.scheme === 'untitled',
    selectionIsEmpty: editor.selection.isEmpty,
    selectedText: editor.document.getText(editor.selection),
    selectionStartLine: editor.selection.start.line + 1,
    selectionEndLine: editor.selection.end.line + 1,
    workspaceName: folder?.name,
  };
}

function currentFile(missingEditor: string) {
  return collectCurrentFile(snapshot(resolveTextEditor()), {
    missingEditor,
    empty: 'The active file is empty. Nothing was sent to the Brain.',
  });
}

async function offerSignIn(): Promise<void> {
  const choice = await vscode.window.showErrorMessage('Your EYRA session may have expired. Sign in again.', 'Sign In');
  if (choice === 'Sign In') {
    await vscode.commands.executeCommand('eyra.signIn');
  }
}

function reportFailure(result: { unauthorized?: boolean; phase: string; message: string }): void {
  if (result.unauthorized) {
    void offerSignIn();
    return;
  }
  if (result.phase === 'cancelled') {
    void vscode.window.showInformationMessage(result.message);
    return;
  }
  void vscode.window.showErrorMessage(result.message);
}

async function guard<T>(work: () => Promise<T>): Promise<T | undefined> {
  if (!tryBeginBrainRequest()) {
    void vscode.window.showInformationMessage('An EYRA request is already running.');
    return undefined;
  }
  try {
    return await work();
  } catch (err) {
    if (err instanceof BrainHttpError && err.cancelled) {
      void vscode.window.showInformationMessage('EYRA request cancelled.');
      return undefined;
    }
    if (err instanceof BrainHttpError && err.unauthorized) {
      await offerSignIn();
      return undefined;
    }
    const message = err instanceof BrainHttpError || err instanceof ResponseShapeError
      ? err.message
      : 'EYRA request failed.';
    void vscode.window.showErrorMessage(message);
    return undefined;
  } finally {
    endBrainRequest();
  }
}

function cancellableProgress<T>(title: string, work: () => Promise<T>): Thenable<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: true },
    (_progress, cancelToken) => {
      cancelToken.onCancellationRequested(() => {
        cancelBrainRequest();
      });
      return work();
    },
  );
}

function recordTestVerification(
  tracking: boolean,
  result: TestRunFlowResult,
  path: string,
  documentText: string,
): void {
  if (!tracking) {
    return;
  }
  if (result.phase === 'result') {
    completeVerification({
      type: 'tests',
      path,
      documentText,
      total: result.view.counts.total,
      passed: result.view.counts.passed,
      failed: result.view.counts.failed,
      executed: result.view.counts.executed,
      notRun: result.view.counts.not_run,
    });
    return;
  }
  if (result.phase === 'cancelled') {
    completeVerification({ type: 'cancelled', path, documentText });
    return;
  }
  completeVerification({
    type: 'unavailable',
    path,
    documentText,
    detail: result.message || 'Verification did not run. This is not a pass.',
  });
}

function showGenerated(result: GenerateFlowResult, localPath: string, fileName: string): void {
  switch (result.phase) {
    case 'blocked':
    case 'unsupported':
    case 'cancelled':
    case 'http':
    case 'timeout':
    case 'malformed':
      reportFailure(result);
      failPanelWork('tests', result.message);
      return;
    case 'review': {
      const cases = result.view.cases;
      reviewed = {
        code: result.body.code,
        language: result.body.language,
        fileName,
        cases,
      };
      showGeneratedTests({
        view: {
          ...result.view,
          cases,
          total: cases.length,
          notRun: cases.length,
          headline: `Generated ${cases.length} case(s) for review. They have not been run.`,
        },
        localPath,
        fileName,
      });
      return;
    }
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

function showTestRun(result: TestRunFlowResult, localPath: string, fileName: string): void {
  switch (result.phase) {
    case 'blocked':
    case 'unsupported':
    case 'cancelled':
    case 'http':
    case 'timeout':
    case 'malformed':
      reportFailure(result);
      failPanelWork('tests', result.message);
      return;
    case 'result':
      showTestRunResult({ view: result.view, localPath, fileName });
      return;
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

async function confirmExecution(detail: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `${detail} It will run on the Brain machine at ${brainBaseUrl()}. EYRA uses a temp directory, a timeout, and a reduced environment. That is not a secure production sandbox.`,
    { modal: true },
    'Run',
  );
  return choice === 'Run';
}

function eyraTerminal(cwd?: string): vscode.Terminal {
  const existing = vscode.window.terminals.find((t) => t.name === 'EYRA');
  if (existing) {
    return existing;
  }
  return vscode.window.createTerminal({
    name: 'EYRA',
    cwd: cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  });
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

async function readExecutionOutput(execution: {
  read: () => AsyncIterable<string> | string | Thenable<string>;
}): Promise<string> {
  try {
    const raw = execution.read();
    if (typeof raw === 'string') {
      return raw;
    }
    if (raw && typeof (raw as Thenable<string>).then === 'function') {
      return await (raw as Thenable<string>);
    }
    if (raw && Symbol.asyncIterator in Object(raw)) {
      const parts: string[] = [];
      for await (const chunk of raw as AsyncIterable<string>) {
        parts.push(chunk);
        if (parts.join('').length > 24000) {
          break;
        }
      }
      return parts.join('');
    }
  } catch {
    return '';
  }
  return '';
}

function extractStackTrace(output: string): string {
  const traceback = /Traceback \(most recent call last\):[\s\S]*?(?=\n[^\s]|$)/i.exec(output);
  if (traceback) {
    return traceback[0].trim();
  }
  const lines = output.split(/\r?\n/).filter((line) => /error|exception|failed/i.test(line));
  return lines.slice(-12).join('\n').trim();
}

function extractFocusLine(output: string, fileName: string): number | null {
  const base = fileName.split(/[/\\]/).pop() || fileName;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const specific = new RegExp(`File\\s+[\"'](?:[^\"']*[\\\\/])?${escaped}[\"']\\s*,\\s*line\\s+(\\d+)`, 'i');
  const match = specific.exec(output) || /,\s*line\s+(\d+)/i.exec(output) || /:(\d+)(?::\d+)?\b/.exec(output);
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  return n > 0 ? n : null;
}

async function waitForShellIntegration(terminal: vscode.Terminal, timeoutMs = 4000): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration) {
    return terminal.shellIntegration;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve(terminal.shellIntegration);
    }, timeoutMs);
    const sub = vscode.window.onDidChangeTerminalShellIntegration((event) => {
      if (event.terminal === terminal && event.shellIntegration) {
        clearTimeout(timer);
        sub.dispose();
        resolve(event.shellIntegration);
      }
    });
  });
}

async function runCommandCapture(
  terminal: vscode.Terminal,
  cmd: string,
): Promise<{ exitCode: number | undefined; output: string; captured: boolean }> {
  const integration = await waitForShellIntegration(terminal);
  if (!integration) {
    terminal.sendText(cmd);
    return { exitCode: undefined, output: '', captured: false };
  }

  return new Promise((resolve) => {
    let settled = false;
    const parts: string[] = [];
    const finish = (value: { exitCode: number | undefined; output: string; captured: boolean }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      sub.dispose();
      resolve(value);
    };
    const timer = setTimeout(() => {
      finish({
        exitCode: undefined,
        output: stripAnsi(parts.join('')).trim(),
        captured: parts.length > 0,
      });
    }, 120_000);

    const execution = integration.executeCommand(cmd);
    // Start reading immediately — waiting until end drops SyntaxError output.
    void (async () => {
      try {
        for await (const chunk of execution.read()) {
          parts.push(chunk);
          if (parts.join('').length > 32_000) {
            break;
          }
        }
      } catch {
        // end handler still resolves
      }
    })();
    const sub = vscode.window.onDidEndTerminalShellExecution(async (event) => {
      if (event.terminal !== terminal || event.execution !== execution) {
        return;
      }
      let output = stripAnsi(parts.join('')).trim();
      if (!output) {
        output = stripAnsi(await readExecutionOutput(event.execution)).trim();
      }
      finish({ exitCode: event.exitCode, output, captured: true });
    });
  });
}

/** Run the active file in the terminal; on error, open Chat and analyze. */
export async function runCurrentFile(secrets?: vscode.SecretStorage): Promise<void> {
  const editor = resolveTextEditor();
  if (!editor) {
    void vscode.window.showErrorMessage('No active editor. Open a file, then run EYRA: Run Current File.');
    return;
  }
  const doc = editor.document;
  if (doc.isUntitled) {
    void vscode.window.showErrorMessage('Save the file before running it in the terminal.');
    return;
  }
  if (doc.isDirty) {
    await doc.save();
  }
  const filePath = doc.uri.fsPath;
  const cmd = runCommandForFile(filePath, doc.languageId);
  if (!cmd) {
    void vscode.window.showErrorMessage(
      `EYRA does not know how to run ${doc.fileName.split(/[/\\]/).pop() || 'this file'} in the terminal.`,
    );
    return;
  }

  openInvestigationTab('chat');

  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const cwd = folder?.uri.fsPath || vscode.Uri.joinPath(doc.uri, '..').fsPath;
  const terminal = eyraTerminal(cwd);
  terminal.show(true);

  // Avoid double analysis: we handle the captured run here; terminalWatch stays for other terminals.
  suppressTerminalErrorWatch(15_000);
  const { exitCode, output, captured } = await runCommandCapture(terminal, cmd);
  if (!secrets || !captured) {
    // Shell integration unavailable — fall back to sendText already done; terminalWatch may still catch it.
    suppressTerminalErrorWatch(0);
    return;
  }

  const failed = exitCode !== undefined && exitCode !== 0;
  const hasErrorText = looksLikeRuntimeError(output);
  if (!failed && !hasErrorText) {
    return;
  }
  if (!output) {
    return;
  }

  const fileName = doc.fileName.split(/[/\\]/).pop() || doc.fileName;
  void analyzeTerminalError(secrets, {
    terminalOutput: output.slice(-8000),
    stackTrace: extractStackTrace(output),
    focusLine: extractFocusLine(output, fileName),
  });
}

export async function generateCurrentTests(secrets: vscode.SecretStorage): Promise<void> {
  const context = currentFile('No active editor. Open a file, then run EYRA: Generate Tests.');
  if (!context.ok) {
    void vscode.window.showErrorMessage(context.message);
    return;
  }
  const token = await readAccessToken(secrets);
  await guard(async () => {
    beginPanelWork('tests', context.relativePath, context.fileName);
    const result = await cancellableProgress('EYRA is generating test cases', () => generateTestsFlow({
      context,
      generate: (body) => generateTests(token, body),
    }));
    showGenerated(result, context.relativePath, context.fileName);
  });
}

async function pickTestIds(pending: ReviewedTests): Promise<number[] | undefined> {
  const picked = await vscode.window.showQuickPick(
    pending.cases.map((item) => ({
      label: `#${item.id} ${item.description || 'Untitled case'}`,
      description: item.call || 'no call — will not execute',
      id: item.id,
    })),
    {
      title: 'Review test cases to run',
      canPickMany: true,
      ignoreFocusOut: true,
    },
  );
  return picked?.map((item) => item.id);
}

export async function runCurrentTests(
  secrets: vscode.SecretStorage,
  options?: { all?: boolean; confirmed?: boolean },
): Promise<void> {
  const context = currentFile('No active editor. Open a file, then run EYRA: Run Tests.');
  if (!context.ok) {
    void vscode.window.showErrorMessage(context.message);
    return;
  }
  if (options?.all && reviewed) {
    reviewed = {
      ...reviewed,
      code: context.code,
      language: context.language,
      fileName: context.fileName,
    };
  }
  const pending = reviewed;
  if (!pending || pending.cases.length === 0) {
    void vscode.window.showErrorMessage(
      pending ? 'The Brain returned no test cases to run.' : 'Generate tests and review them before running any case.',
    );
    return;
  }
  const selectedIds = options?.all
    ? pending.cases.map((item) => item.id)
    : await pickTestIds(pending);
  if (!selectedIds || selectedIds.length === 0) {
    void vscode.window.showInformationMessage('No test cases were selected. Nothing was sent.');
    return;
  }
  const token = await readAccessToken(secrets);
  await guard(async () => {
    beginPanelWork('tests', context.relativePath, context.fileName);
    const tracking = beginVerification({ path: context.relativePath, documentText: context.code });
    const result = await runTestsFlow({
      context,
      reviewed: pending,
      selectedIds,
      confirm: () => options?.confirmed
        ? Promise.resolve(true)
        : confirmExecution(`Run ${selectedIds.length} selected test case(s) on the EYRA Brain?`),
      run: (body) => cancellableProgress(
        options?.all ? 'EYRA is running all test cases' : 'EYRA is running the selected tests',
        () => runTests(token, body),
      ),
    });
    showTestRun(result, context.relativePath, context.fileName);
    recordTestVerification(tracking, result, context.relativePath, context.code);
  });
}

export async function analyzeCurrentPerformance(secrets: vscode.SecretStorage): Promise<void> {
  const context = currentFile('No active editor. Open a file, then run EYRA: Analyze Performance.');
  if (!context.ok) {
    void vscode.window.showErrorMessage(context.message);
    return;
  }
  const token = await readAccessToken(secrets);
  await guard(async () => {
    beginPanelWork('suggestions', context.relativePath, context.fileName);
    try {
      const body = buildPerformanceRequest(context);
      const raw = await cancellableProgress('EYRA is estimating performance', () => analyzePerformance(token, body));
      showPerformanceResult({ view: parsePerformance(raw), localPath: context.relativePath });
    } catch (err) {
      if (err instanceof BrainHttpError && err.cancelled) {
        failPanelWork('suggestions', 'Request cancelled.');
        throw err;
      }
      const message = err instanceof BrainHttpError || err instanceof ResponseShapeError
        ? err.message
        : 'EYRA request failed.';
      failPanelWork('suggestions', message);
      throw err;
    }
  });
}

export async function suggestCurrentOptimization(secrets: vscode.SecretStorage): Promise<void> {
  const context = currentFile('No active editor. Open a file, then run EYRA: Suggest Optimization.');
  if (!context.ok) {
    void vscode.window.showErrorMessage(context.message);
    return;
  }
  const token = await readAccessToken(secrets);
  await guard(async () => {
    beginPanelWork('suggestions', context.relativePath, context.fileName);
    try {
      const body = buildPerformanceRequest(context);
      const raw = await cancellableProgress(
        'EYRA is requesting an optimization suggestion',
        () => suggestOptimization(token, body),
      );
      showOptimizeResult({ view: parseOptimize(raw), localPath: context.relativePath });
    } catch (err) {
      if (err instanceof BrainHttpError && err.cancelled) {
        failPanelWork('suggestions', 'Request cancelled.');
        throw err;
      }
      const message = err instanceof BrainHttpError || err instanceof ResponseShapeError
        ? err.message
        : 'EYRA request failed.';
      failPanelWork('suggestions', message);
      throw err;
    }
  });
}
