import * as vscode from 'vscode';
import { EYRA_BOT_AVATAR_DATA_URI } from './botAvatarData';
import type { AnalyzeResult } from './parse';
import { parseAnalyzeResult, ResponseShapeError } from './parse';
import { fetchHistory, getHistorySession } from './brainClient';
import { checkBrainHealth } from './healthClient';
import { BrainHttpError } from './http';
import { cancelBrainRequest, endBrainRequest, tryBeginBrainRequest } from './inflight';
import { looksLikeNoIssue, renderInvestigation, resolveSuggestedCode, type ChatTurn, type InvestigationView, type PanelStatus } from './investigationHtml';
import {
  type ExecuteView,
  type GeneratedTestsView,
  type OptimizeView,
  type PerformanceView,
  type TestRunView,
} from './phase3Model';
import { readAccessToken } from './session';
import {
  afterConfirmedEdit,
  appliedDocument,
  decideFix,
  finishVerification,
  historyDetailPath,
  historyListPath,
  historyReopenDecision,
  parseHistoryList,
  parseWebviewMessage,
  proposalState,
  resolveEvidenceLocation,
  startVerification,
  type HistoryEntry,
  type InvestigationTab,
  type VerificationEvent,
  type WorkflowSnapshot,
} from './phase4Model';

export type LocalOrigin = {
  uri: vscode.Uri;
  relativePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  analyzedText: string;
};

type Slot<T> = {
  status: PanelStatus;
  error: string;
  value: T | null;
  localPath: string;
  fileName: string;
};

function emptySlot<T>(): Slot<T> {
  return { status: 'empty', error: '', value: null, localPath: '', fileName: '' };
}

let chatView: vscode.WebviewView | undefined;
let secrets: vscode.SecretStorage | undefined;
let extensionUri: vscode.Uri | undefined;
let brainOnline = false;
let tab: InvestigationTab = 'chat';
let stale = false;
let origin: LocalOrigin | undefined;
let analysis: Slot<AnalyzeResult> = emptySlot();
let execution: Slot<ExecuteView> = emptySlot();
let generated: GeneratedTestsView | null = null;
let testRun: TestRunView | null = null;
let tests: Slot<null> = emptySlot();
let performance: PerformanceView | null = null;
let optimize: OptimizeView | null = null;
let suggestions: Slot<null> = emptySlot();
let historyItems: HistoryEntry[] = [];
let historyTotal: number | null = null;
let historyStatus: PanelStatus = 'empty';
let historyError = '';
let historyQuery = '';
let chatTurns: ChatTurn[] = [];
let pendingUserPrompt = '';
let lastCorrection = '';
let workflow: WorkflowSnapshot = {
  state: 'none',
  detail: 'No investigation is open.',
  appliedText: null,
  investigationPath: '',
};

function nextTurnId(): string {
  return `t${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pushChatTurn(turn: Omit<ChatTurn, 'id' | 'at'> & { id?: string; at?: number }): void {
  chatTurns = [
    ...chatTurns,
    {
      id: turn.id || nextTurnId(),
      role: turn.role,
      text: turn.text,
      at: turn.at || Date.now(),
      showAnalysis: turn.showAnalysis,
      analysisResult: turn.analysisResult,
      analysisLocalPath: turn.analysisLocalPath,
      analysisFileName: turn.analysisFileName,
      analysisStartLine: turn.analysisStartLine,
      analysisEndLine: turn.analysisEndLine,
      tone: turn.tone,
    },
  ].slice(-40);
}

export function appendChatReply(text: string): void {
  pushChatTurn({ role: 'bot', text });
  reveal('chat');
}

/** Local chatbot turns (greetings / help) without a Brain analysis card. */
export function revealChatWithLocalTurns(userText: string, botText: string): void {
  pendingUserPrompt = '';
  pushChatTurn({ role: 'user', text: userText });
  pushChatTurn({ role: 'bot', text: botText });
  reveal('chat');
}

/** True when the Brain reported a real issue (not a clean / no-error result). */
export function analysisHasIssue(result: AnalyzeResult): boolean {
  const errorType = (result.error_type || '').trim();
  const summary = (result.error_summary || '').trim();
  const summaryClean = looksLikeNoIssue(summary);
  const typeClean = !errorType
    || /^(none|null|n\/a|undefined|ok|clean|no[_\s-]?error|-|finding)$/i.test(errorType)
    || looksLikeNoIssue(errorType);
  if (!typeClean) {
    return !summaryClean;
  }
  if (!summary || summaryClean) {
    return false;
  }
  return true;
}

export function botSummaryFromAnalysis(result: AnalyzeResult): string {
  if (!analysisHasIssue(result)) {
    const explanation = (result.explanation || '').trim();
    if (explanation && !/no\s+(error|issue)/i.test(explanation) && explanation.length > 20) {
      return `No error found — the code looks correct.\n\n${explanation}`;
    }
    return 'No error found — the code looks correct.';
  }
  const parts: string[] = [];
  const errorType = (result.error_type || '').trim();
  const errorSummary = (result.error_summary || '').trim();
  const rootCause = (result.root_cause || '').trim();
  const explanation = (result.explanation || '').trim();
  if (errorType && !/^(none|null|n\/a|undefined|-)$/i.test(errorType)) {
    parts.push(`I found a ${errorType}.`);
  }
  if (errorSummary) {
    parts.push(errorSummary);
  }
  if (rootCause) {
    parts.push(rootCause);
  } else if (explanation) {
    parts.push(explanation);
  }
  if (!parts.length) {
    return 'I looked at the active file. Ask a follow-up, or run the file so I can catch a terminal error.';
  }
  return parts.join('\n\n');
}

/** Chat-only bot reply from an analysis payload (no rich analysis card). */
export function botChatReplyFromAnalysis(result: AnalyzeResult): string {
  const explanation = (result.explanation || '').trim();
  const summary = (result.error_summary || '').trim();
  const root = (result.root_cause || '').trim();
  // Prefer a plain explanation for chat / explain mode.
  if (explanation) {
    return explanation;
  }
  if (!analysisHasIssue(result)) {
    return botSummaryFromAnalysis(result);
  }
  if (summary) {
    return summary;
  }
  if (root) {
    return root;
  }
  return botSummaryFromAnalysis(result);
}

export function bindInvestigationHost(storage: vscode.SecretStorage, uri?: vscode.Uri): void {
  secrets = storage;
  if (uri) {
    extensionUri = uri;
  }
}

/** Inline data-URI avatar — reliable in VS Code webviews (no broken resource URLs). */
function botImgUri(): string {
  return EYRA_BOT_AVATAR_DATA_URI;
}

function view(): InvestigationView {
  return {
    tab,
    nonce: `${Date.now()}`,
    stale,
    botImgUri: botImgUri(),
    cspSource: chatView?.webview.cspSource || '',
    brainOnline,
    userInitial: 'K',
    workflow,
    chat: { turns: chatTurns },
    analysis: {
      status: analysis.status,
      error: analysis.error,
      result: analysis.value,
      localPath: analysis.localPath,
      hasOrigin: Boolean(origin),
      startLine: origin?.startLine ?? null,
      endLine: origin?.endLine ?? null,
    },
    execution: {
      status: execution.status,
      error: execution.error,
      view: execution.value,
      localPath: execution.localPath,
      fileName: execution.fileName,
    },
    tests: {
      status: tests.status,
      error: tests.error,
      generated,
      run: testRun,
      localPath: tests.localPath,
      fileName: tests.fileName,
    },
    suggestions: {
      status: suggestions.status,
      error: suggestions.error,
      performance,
      optimize,
      localPath: suggestions.localPath,
    },
    history: {
      status: historyStatus,
      error: historyError,
      total: historyTotal,
      items: historyItems,
      query: historyQuery,
    },
  };
}

function render(): void {
  if (!chatView) {
    return;
  }
  chatView.webview.html = renderInvestigation(view());
}

/** Dedicated EYRA chat hosted in the Secondary (right) Side Bar, where Copilot Chat lives. */
export class EyraChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'eyra.chatView';

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    chatView = webviewView;
    const roots = extensionUri
      ? [extensionUri, vscode.Uri.joinPath(extensionUri, 'media')]
      : [];
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: roots,
    };
    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      void handleMessage(message);
    });
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        render();
      }
    });
    webviewView.onDidDispose(() => {
      if (chatView === webviewView) {
        chatView = undefined;
      }
    });
    render();
    void checkBrainHealth().then((result) => {
      brainOnline = result.ok && result.status.toLowerCase() === 'ok';
      render();
    });
  }
}

function reveal(next: InvestigationTab): void {
  tab = next;
  if (chatView) {
    chatView.show(true);
    render();
    return;
  }
  void vscode.commands.executeCommand('eyra.chatView.focus').then(
    () => render(),
    () => undefined,
  );
}

export function openInvestigationTab(next: InvestigationTab): void {
  if (next === 'history') {
    if (!secrets) {
      reveal('history');
      return;
    }
    void showHistory(secrets);
    return;
  }
  reveal(next);
}

function clearLocalResults(): void {
  execution = emptySlot();
  // Keep generated tests — analysis/chat must not wipe the Test Generation tab.
  performance = null;
  optimize = null;
  suggestions = emptySlot();
}

export function showAnalysisPanel(input: {
  result: AnalyzeResult;
  localPath: string;
  uri: vscode.Uri;
  startLine: number;
  endLine: number;
  analyzedText: string;
  fileName: string;
  userPrompt?: string;
  /** When true, reply in chat text only (no rich analysis card / no auto-run feel). */
  chatOnly?: boolean;
  /** User asked for a different solution than the last suggested fix. */
  alternateFix?: boolean;
}): void {
  origin = {
    uri: input.uri,
    relativePath: input.localPath,
    fileName: input.fileName,
    startLine: input.startLine,
    endLine: input.endLine,
    analyzedText: input.analyzedText,
  };
  const resolvedCode = resolveSuggestedCode(
    input.analyzedText,
    input.result.suggested_correction.corrected_code,
    input.result.explanation || '',
  );
  const result: AnalyzeResult = resolvedCode && resolvedCode !== input.result.suggested_correction.corrected_code
    ? {
      ...input.result,
      suggested_correction: {
        ...input.result.suggested_correction,
        corrected_code: resolvedCode,
        summary: input.result.suggested_correction.summary || 'Review the suggested code changes below.',
      },
    }
    : input.result;
  analysis = {
    status: 'ready',
    error: '',
    value: result,
    localPath: input.localPath,
    fileName: input.fileName,
  };
  clearLocalResults();
  suggestions = { ...suggestions, status: 'ready', localPath: input.localPath };
  workflow = {
    ...proposalState(
      input.analyzedText,
      result.suggested_correction.corrected_code,
      result.suggested_correction.apply_mode,
    ),
    investigationPath: input.localPath,
  };
  stale = false;
  const nextCode = (result.suggested_correction.corrected_code || '').trim();
  if (nextCode) {
    lastCorrection = nextCode;
  }

  const prompt = (input.userPrompt || pendingUserPrompt || '').trim();
  pendingUserPrompt = '';
  const fileLabel = (input.fileName || input.localPath || 'file').replace(/\\/g, '/').split('/').pop() || 'file';
  const userText = prompt
    || (input.result.terminal_output
      ? `Help me with this terminal error in ${fileLabel}`
      : `Analyze ${fileLabel}`);
  const alreadyHasUser = chatTurns.length > 0
    && chatTurns[chatTurns.length - 1]?.role === 'user'
    && chatTurns[chatTurns.length - 1]?.text === userText;
  if (!alreadyHasUser) {
    pushChatTurn({ role: 'user', text: userText });
  }
  const chatOnly = Boolean(input.chatOnly);
  const hasIssue = analysisHasIssue(result);
  const fromTerminal = Boolean((result.terminal_output || '').trim())
    && !/^\s*USER QUESTION:/i.test(result.terminal_output || '');
  const alternate = Boolean(input.alternateFix);
  const botText = alternate && hasIssue
    ? 'Here is a different solution. Review it below, then use Apply Fix if you want it in the file.'
    : chatOnly
      ? botChatReplyFromAnalysis(result)
      : botSummaryFromAnalysis(result);
  // Rich analysis for Analyze / terminal / issue-checks. Keep older cards (do not clear showAnalysis).
  const showCard = !chatOnly || fromTerminal || hasIssue;
  pushChatTurn({
    role: 'bot',
    text: botText,
    showAnalysis: showCard,
    analysisResult: showCard ? result : undefined,
    analysisLocalPath: showCard ? input.localPath : undefined,
    analysisFileName: showCard ? input.fileName : undefined,
    analysisStartLine: showCard ? input.startLine : undefined,
    analysisEndLine: showCard ? input.endLine : undefined,
    tone: hasIssue ? undefined : 'ok',
  });
  reveal('chat');
}

export function notePendingChatPrompt(prompt: string): void {
  pendingUserPrompt = prompt.trim();
}

/** Recent side-chat lines so a follow-up can see what was just said. */
export function recentChatTranscript(limit = 6): string {
  return chatTurns.slice(-limit).map((turn) => {
    const who = turn.role === 'user' ? 'User' : 'EYRA';
    const text = (turn.text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    return text ? `${who}: ${text}` : '';
  }).filter(Boolean).join('\n');
}

/** Last suggested rewrite, kept even after a normal chat reply. */
export function lastSuggestedCode(): string {
  return lastCorrection || analysis.value?.suggested_correction.corrected_code || '';
}

export function beginPanelWork(next: InvestigationTab | 'suggestions', localPath: string, fileName: string): void {
  const tabId: InvestigationTab = next === 'suggestions' ? 'analysis' : next;
  if (next === 'suggestions') {
    suggestions = { ...suggestions, status: 'loading', error: '', localPath };
  } else if (tabId === 'analysis') {
    analysis = { ...analysis, status: 'loading', error: '', localPath, fileName };
    if (pendingUserPrompt) {
      const text = pendingUserPrompt;
      const last = chatTurns[chatTurns.length - 1];
      if (!(last?.role === 'user' && last.text === text)) {
        pushChatTurn({ role: 'user', text });
      }
    }
  } else if (tabId === 'execution') {
    execution = { ...execution, status: 'loading', error: '', localPath, fileName };
  } else if (tabId === 'tests') {
    tests = { ...tests, status: 'loading', error: '', localPath, fileName };
  } else if (tabId === 'history') {
    historyStatus = 'loading';
    historyError = '';
  }
  // Analysis + Run surface in Chat; keep other tabs as-is.
  reveal(tabId === 'analysis' || tabId === 'execution' ? 'chat' : tabId);
}

export function failPanelWork(next: InvestigationTab | 'suggestions', message: string): void {
  const tabId: InvestigationTab = next === 'suggestions' ? 'analysis' : next;
  if (next === 'suggestions') {
    suggestions = { ...suggestions, status: 'error', error: message };
  } else if (tabId === 'analysis') {
    analysis = { ...analysis, status: 'error', error: message };
  } else if (tabId === 'execution') {
    execution = { ...execution, status: 'error', error: message };
  } else if (tabId === 'tests') {
    tests = { ...tests, status: 'error', error: message };
  } else if (tabId === 'history') {
    historyStatus = 'error';
    historyError = message;
  }
  reveal(tabId === 'analysis' || tabId === 'execution' ? 'chat' : tabId);
}

export function showExecutionResult(input: { view: ExecuteView; localPath: string; fileName: string }): void {
  execution = { status: 'ready', error: '', value: input.view, localPath: input.localPath, fileName: input.fileName };
  reveal('chat');
}

export function showGeneratedTests(input: { view: GeneratedTestsView; localPath: string; fileName: string }): void {
  const cases = input.view.cases || [];
  generated = {
    ...input.view,
    cases,
    total: cases.length,
    notRun: cases.length,
    headline: input.view.headline || `Generated ${cases.length} case(s) for review. They have not been run.`,
  };
  tests = { ...tests, status: 'ready', error: '', localPath: input.localPath, fileName: input.fileName };
  reveal('tests');
}

export function showTestRunResult(input: { view: TestRunView; localPath: string; fileName: string }): void {
  testRun = input.view;
  tests = { ...tests, status: 'ready', error: '', localPath: input.localPath, fileName: input.fileName };
  reveal('tests');
}

export function showPerformanceResult(input: { view: PerformanceView; localPath: string }): void {
  performance = input.view;
  suggestions = { ...suggestions, status: 'ready', error: '', localPath: input.localPath };
  reveal('chat');
}

export function showOptimizeResult(input: { view: OptimizeView; localPath: string }): void {
  optimize = input.view;
  suggestions = { ...suggestions, status: 'ready', error: '', localPath: input.localPath };
  reveal('chat');
}

function inWorkspace(uri: vscode.Uri): boolean {
  if (uri.scheme === 'untitled') {
    return true;
  }
  return Boolean(vscode.workspace.getWorkspaceFolder(uri));
}

async function openOrigin(line: number | null, endLine: number | null): Promise<void> {
  if (!origin || !inWorkspace(origin.uri)) {
    void vscode.window.showErrorMessage('No workspace file is stored for this investigation.');
    return;
  }
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(origin.uri);
  } catch {
    void vscode.window.showErrorMessage('The analyzed file could not be opened.');
    return;
  }
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  if (line === null) {
    return;
  }
  if (line > document.lineCount) {
    void vscode.window.showWarningMessage(`Line ${line} is past the end of ${origin.relativePath}. No line was selected.`);
    return;
  }
  const start = new vscode.Position(line - 1, 0);
  const last = Math.min(endLine ?? line, document.lineCount);
  const end = new vscode.Position(last - 1, document.lineAt(last - 1).text.length);
  editor.selection = new vscode.Selection(start, end);
  editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
}

async function navigateEvidence(location: string): Promise<void> {
  const decision = resolveEvidenceLocation({
    location,
    knownFileName: origin?.fileName ?? null,
    knownRelativePath: origin?.relativePath ?? null,
  });
  if (decision.action === 'refuse') {
    void vscode.window.showWarningMessage(decision.reason);
    return;
  }
  await openOrigin(decision.line, decision.endLine);
}

async function copyCorrection(): Promise<void> {
  const text = analysis.value?.suggested_correction.corrected_code ?? '';
  if (!text) {
    void vscode.window.showWarningMessage('No corrected code was returned to copy.');
    return;
  }
  await vscode.env.clipboard.writeText(text);
  void vscode.window.showInformationMessage('Copied the suggestion. The file was not changed.');
}

async function requestApply(thenRunTests = false): Promise<void> {
  if (!analysis.value || !origin) {
    void vscode.window.showWarningMessage('This suggestion has no local file. It was not applied. You can copy it instead.');
    return;
  }
  if (!inWorkspace(origin.uri)) {
    void vscode.window.showWarningMessage('The analyzed file is outside the workspace. It was not changed.');
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    thenRunTests
      ? 'Apply this updated code and run all test cases? This replaces the analyzed code, then runs every generated case.'
      : 'Apply this fix to your file? Review the suggestion first — this replaces the analyzed code in the editor.',
    { modal: true },
    'Apply Fix',
  );
  if (choice !== 'Apply Fix') {
    void vscode.window.showInformationMessage('Apply was cancelled. The file was not changed.');
    return;
  }
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(origin.uri);
  } catch {
    void vscode.window.showErrorMessage('The analyzed file could not be opened. Nothing was changed.');
    return;
  }
  const returned = analysis.value.code_snippet;
  const sent = origin.analyzedText;
  if (returned && sent && returned !== sent) {
    void vscode.window.showWarningMessage('The returned source does not match the text that was analyzed. The file was not changed.');
    return;
  }
  const analyzedText = returned || sent;
  const documentText = document.getText();
  const resolved = resolveSuggestedCode(
    analyzedText,
    analysis.value.suggested_correction.corrected_code,
    `${analysis.value.explanation || ''}\n${analysis.value.root_cause || ''}`,
  );
  const decision = decideFix({
    confirmed: true,
    applyMode: analysis.value.suggested_correction.apply_mode || 'review_and_copy',
    documentText,
    analyzedText,
    correctedText: resolved || analysis.value.suggested_correction.corrected_code,
  });
  const nextText = appliedDocument(documentText, decision);
  const reason = decision.kind === 'refused' || decision.kind === 'cancelled'
    ? decision.reason
    : 'The suggestion could not be placed. The file was not changed.';
  if (decision.kind === 'refused' || decision.kind === 'cancelled' || nextText === null) {
    void vscode.window.showWarningMessage(reason);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  if (decision.kind === 'replace-all') {
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(documentText.length)), decision.newText);
  } else {
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(decision.start), document.positionAt(decision.end)),
      decision.newText,
    );
  }
  let applied = false;
  try {
    applied = await vscode.workspace.applyEdit(edit);
  } catch {
    applied = false;
  }
  const outcome = afterConfirmedEdit(applied);
  if (!applied) {
    workflow = { ...workflow, state: outcome.state, detail: outcome.detail, appliedText: null };
    stale = false;
    reveal(tab);
    void vscode.window.showErrorMessage(outcome.detail);
    return;
  }
  workflow = {
    ...workflow,
    state: outcome.state,
    detail: outcome.detail,
    appliedText: nextText,
    investigationPath: origin.relativePath,
  };
  stale = outcome.stale;
  reveal(thenRunTests ? 'tests' : tab);
  if (thenRunTests) {
    await vscode.commands.executeCommand('eyra.runTests', { all: true, confirmed: true });
    return;
  }
  void vscode.window.showInformationMessage('Fix applied. Re-run the file to verify.');
}

export function beginVerification(input: { path: string; documentText: string }): boolean {
  const next = startVerification(workflow, input);
  const changed = next.state !== workflow.state || next.detail !== workflow.detail;
  workflow = next;
  if (changed) {
    render();
  }
  return next.state === 'verification-pending';
}

export function completeVerification(event: VerificationEvent): void {
  const next = finishVerification(workflow, event);
  workflow = next;
  if (next.state === 'stale') {
    stale = true;
  }
  render();
}

async function loadHistory(query: string, append: boolean): Promise<void> {
  const token = secrets ? await readAccessToken(secrets) : undefined;
  if (!token) {
    historyStatus = 'error';
    historyError = 'Sign in to EYRA before loading history.';
    if (!append) {
      historyItems = [];
      historyTotal = null;
    }
    reveal('history');
    const choice = await vscode.window.showErrorMessage(historyError, 'Sign In');
    if (choice === 'Sign In') {
      await vscode.commands.executeCommand('eyra.signIn');
    }
    return;
  }
  if (!tryBeginBrainRequest()) {
    void vscode.window.showInformationMessage('An EYRA request is already running.');
    return;
  }
  historyQuery = query;
  historyStatus = 'loading';
  reveal('history');
  try {
    const raw = await fetchHistory(token, historyListPath({
      query,
      offset: append ? historyItems.length : 0,
      limit: 50,
    }));
    const list = parseHistoryList(raw);
    const merged = append ? [...historyItems] : [];
    for (const item of list.items) {
      if (!merged.some((existing) => existing.sessionId === item.sessionId)) {
        merged.push(item);
      }
    }
    historyItems = merged;
    historyTotal = list.total;
    historyStatus = 'ready';
    historyError = '';
    reveal('history');
  } catch (err) {
    if (err instanceof BrainHttpError && err.cancelled) {
      historyStatus = 'empty';
      historyError = '';
      reveal('history');
      void vscode.window.showInformationMessage('History load cancelled.');
      return;
    }
    historyStatus = 'error';
    historyError = err instanceof BrainHttpError || err instanceof ResponseShapeError
      ? err.message
      : 'Could not load EYRA history.';
    if (!append) {
      historyItems = [];
      historyTotal = null;
    }
    reveal('history');
    if (err instanceof BrainHttpError && err.unauthorized) {
      const choice = await vscode.window.showErrorMessage('Your EYRA session may have expired. Sign in again.', 'Sign In');
      if (choice === 'Sign In') {
        await vscode.commands.executeCommand('eyra.signIn');
      }
    }
  } finally {
    endBrainRequest();
  }
}

export async function openHistorySession(sessionId: string): Promise<void> {
  await openSession(sessionId);
}

async function openSession(sessionId: string): Promise<void> {
  const path = historyDetailPath(sessionId);
  const token = secrets ? await readAccessToken(secrets) : undefined;
  if (!path || !token) {
    void vscode.window.showErrorMessage(token ? 'That session id cannot be opened.' : 'Sign in to EYRA before opening a session.');
    return;
  }
  if (!tryBeginBrainRequest()) {
    void vscode.window.showInformationMessage('An EYRA request is already running.');
    return;
  }
  analysis = { ...analysis, status: 'loading', error: '' };
  reveal('chat');
  try {
    const raw = await getHistorySession(token, sessionId);
    const result = parseAnalyzeResult(raw);
    const reopen = historyReopenDecision({
      previousSessionId: analysis.value?.session_id ?? null,
      nextSessionId: result.session_id,
      previousFileName: origin?.fileName ?? null,
      nextFileName: result.file_name,
      hadOrigin: Boolean(origin),
    });
    if (!reopen.keepOrigin) {
      origin = undefined;
    }
    clearLocalResults();
    const proposed = proposalState(
      result.code_snippet,
      result.suggested_correction.corrected_code,
      result.suggested_correction.apply_mode,
    );
    workflow = {
      ...proposed,
      investigationPath: reopen.keepOrigin ? (origin?.relativePath ?? '') : '',
      detail: reopen.keepOrigin
        ? proposed.detail
        : 'Opened from history. No local editor path was stored, so the current editor was not used.',
    };
    analysis = {
      status: 'ready',
      error: '',
      value: result,
      localPath: reopen.keepOrigin ? (origin?.relativePath ?? '') : '',
      fileName: result.file_name,
    };
    stale = false;
    reveal('chat');
  } catch (err) {
    if (err instanceof BrainHttpError && err.cancelled) {
      analysis = { ...analysis, status: 'error', error: 'Open cancelled.' };
      reveal('chat');
      void vscode.window.showInformationMessage('Opening investigation cancelled.');
      return;
    }
    analysis = {
      ...analysis,
      status: 'error',
      error: err instanceof BrainHttpError || err instanceof ResponseShapeError ? err.message : 'Could not open that investigation.',
    };
    reveal('chat');
    if (err instanceof BrainHttpError && err.unauthorized) {
      const choice = await vscode.window.showErrorMessage('Your EYRA session may have expired. Sign in again.', 'Sign In');
      if (choice === 'Sign In') {
        await vscode.commands.executeCommand('eyra.signIn');
      }
    }
  } finally {
    endBrainRequest();
  }
}

async function handleMessage(message: unknown): Promise<void> {
  const parsed = parseWebviewMessage(message);
  if (!parsed) {
    return;
  }
  switch (parsed.type) {
    case 'selectTab':
      if (parsed.tab === 'history') {
        await showHistory(secrets);
        return;
      }
      if (parsed.tab === 'analysis' || parsed.tab === 'execution') {
        reveal('chat');
        return;
      }
      reveal(parsed.tab);
      return;
    case 'refreshHistory':
      await loadHistory(parsed.query, false);
      return;
    case 'clearHistory': {
      const choice = await vscode.window.showWarningMessage(
        'Clear investigation history from this panel? This only clears the local list — it does not delete Brain sessions.',
        { modal: true },
        'Clear',
      );
      if (choice !== 'Clear') {
        return;
      }
      historyItems = [];
      historyTotal = 0;
      historyStatus = 'ready';
      historyError = '';
      reveal('history');
      return;
    }
    case 'loadMoreHistory':
      await loadHistory(historyQuery, true);
      return;
    case 'openSession':
      await openSession(parsed.sessionId);
      return;
    case 'navigate':
      if (parsed.target === 'origin') {
        await openOrigin(origin?.startLine ?? null, origin?.endLine ?? null);
        return;
      }
      await navigateEvidence(parsed.location);
      return;
    case 'copyCorrection':
      await copyCorrection();
      return;
    case 'requestApply':
      await requestApply(parsed.then === 'tests');
      return;
    case 'requestVerify':
      await vscode.commands.executeCommand(parsed.method === 'execute' ? 'eyra.runFile' : 'eyra.runTests');
      return;
    case 'chatAction': {
      const command = parsed.action === 'explain'
        ? 'eyra.explainSelection'
        : parsed.action === 'analyze'
          ? 'eyra.analyzeFile'
          : parsed.action === 'optimize'
            ? 'eyra.suggestOptimization'
            : parsed.action === 'tests'
              ? 'eyra.generateTests'
              : 'eyra.runFile';
      await vscode.commands.executeCommand(command);
      return;
    }
    case 'chatPrompt': {
      await vscode.commands.executeCommand('eyra.chatPrompt', parsed.prompt);
      return;
    }
    case 'runFile':
      await vscode.commands.executeCommand('eyra.runFile');
      return;
    case 'generateTests':
      await vscode.commands.executeCommand('eyra.generateTests');
      return;
    case 'runTests':
      await vscode.commands.executeCommand('eyra.runTests');
      return;
    case 'closePanel':
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      return;
    case 'openSettings':
      await vscode.commands.executeCommand('workbench.action.openSettings', 'eyra');
      return;
    case 'copyText':
      await vscode.env.clipboard.writeText(parsed.text);
      void vscode.window.showInformationMessage('Code copied');
      return;
    case 'cancelRequest':
      if (cancelBrainRequest()) {
        void vscode.window.showInformationMessage('Cancelling EYRA request…');
      } else {
        void vscode.window.showInformationMessage('No EYRA request is running.');
      }
      return;
    default: {
      const unreachable: never = parsed;
      void unreachable;
    }
  }
}

export async function showHistory(storage?: vscode.SecretStorage): Promise<void> {
  if (storage) {
    secrets = storage;
  }
  await loadHistory(historyQuery, false);
}
