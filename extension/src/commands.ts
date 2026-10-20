import * as vscode from 'vscode';
import { resolveTextEditor } from './activeEditor';
import { analyzeCode, disconnectExtension, exchangeExtensionCode, login, registerAccount, type AnalyzeRequestBody } from './brainClient';
import {
  collectFileDiagnostics,
  collectSelectionDiagnostics,
} from './diagnosticsContext';
import type { AnalyzeDiagnostic } from './diagnosticsModel';
import { collectCurrentFile, collectSelection, type EditorSnapshot } from './editorContext';
import { BrainHttpError } from './http';
import { cancelBrainRequest, endBrainRequest, tryBeginBrainRequest } from './inflight';
import {
  beginPanelWork,
  failPanelWork,
  lastSuggestedCode,
  notePendingChatPrompt,
  recentChatTranscript,
  revealChatWithLocalTurns,
  showAnalysisPanel,
} from './investigationPanel';
import { clearAccessToken, readAccessToken, signOutPlan, storeAccessToken } from './session';

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

async function prompt(title: string, options: vscode.InputBoxOptions): Promise<string | undefined> {
  return vscode.window.showInputBox({ ignoreFocusOut: true, title, ...options });
}

function validEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  return email.length >= 3 && email.length <= 254 && email.includes('@') && email.split('@')[1]?.includes('.');
}

function validUsername(value: string): boolean {
  const name = value.trim();
  return name.length >= 2 && name.length <= 64 && /^[A-Za-z0-9._-]+$/.test(name);
}

export async function signIn(secrets: vscode.SecretStorage): Promise<void> {
  const mode = await vscode.window.showQuickPick(
    [
      { label: 'Sign in', description: 'Existing EYRA account', id: 'login' },
      { label: 'Create account', description: 'Register on this Brain', id: 'register' },
    ],
    { title: 'EYRA Brain account', ignoreFocusOut: true },
  );
  if (!mode) {
    return;
  }
  try {
    const session = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Contacting EYRA Brain' },
      async () => {
        if (mode.id === 'register') {
          const email = await prompt('Email', { prompt: 'Email for the new EYRA account' });
          if (!email) return undefined;
          if (!validEmail(email)) {
            void vscode.window.showErrorMessage('Enter a valid email address.');
            return undefined;
          }
          const username = await prompt('Username', { prompt: 'Letters, numbers, dot, underscore, or hyphen' });
          if (!username) return undefined;
          if (!validUsername(username)) {
            void vscode.window.showErrorMessage('Username must be 2–64 characters and use only letters, numbers, ., _, or -.');
            return undefined;
          }
          const password = await prompt('Password', { prompt: 'At least 6 characters', password: true });
          if (!password) return undefined;
          if (password.length < 6 || password.length > 128) {
            void vscode.window.showErrorMessage('Password must be 6–128 characters.');
            return undefined;
          }
          const displayName = await prompt('Display name', { prompt: 'Optional', placeHolder: 'Leave empty to use the username' });
          return registerAccount({
            email: email.trim(),
            username: username.trim(),
            password,
            displayName: displayName?.trim() || undefined,
          });
        }
        const loginId = await prompt('Email or username', { prompt: 'Account on this EYRA Brain' });
        if (!loginId?.trim()) return undefined;
        const password = await prompt('Password', { password: true });
        if (!password) return undefined;
        return login(loginId.trim(), password);
      },
    );
    if (!session) {
      return;
    }
    await storeAccessToken(secrets, session.accessToken);
    void vscode.window.showInformationMessage(`Signed in to EYRA as ${session.user.username}.`);
  } catch (err) {
    const message = err instanceof BrainHttpError ? err.message : 'Could not sign in to the EYRA Brain.';
    void vscode.window.showErrorMessage(message);
  }
}

export async function connectFromWeb(secrets: vscode.SecretStorage): Promise<void> {
  const code = await vscode.window.showInputBox({
    title: 'EYRA: Connect from Web',
    prompt: 'Paste the one-time code from the EYRA web app.',
    password: true,
    ignoreFocusOut: true,
  });
  const trimmed = code?.trim();
  if (!trimmed) {
    return;
  }
  try {
    const session = await exchangeExtensionCode(trimmed);
    await storeAccessToken(secrets, session.accessToken);
    void vscode.window.showInformationMessage(`Connected to EYRA as ${session.user.username}.`);
  } catch (error: unknown) {
    const message = error instanceof BrainHttpError ? error.message : 'Could not connect EYRA.';
    void vscode.window.showErrorMessage(message);
  }
}

export async function signOut(secrets: vscode.SecretStorage): Promise<void> {
  const existing = await readAccessToken(secrets);
  const plan = signOutPlan(existing);
  if (plan === 'revoke-extension' && existing) {
    try {
      await disconnectExtension(existing);
    } catch {
      await clearAccessToken(secrets);
      void vscode.window.showWarningMessage(
        'Signed out of the EYRA extension. The server credential could not be revoked and remains until it expires. The web app stays signed in.',
      );
      return;
    }
  }
  await clearAccessToken(secrets);
  void vscode.window.showInformationMessage(
    plan === 'already-out'
      ? 'You are not signed in to EYRA.'
      : 'Signed out of the EYRA extension. The web app stays signed in.',
  );
}

async function offerSignIn(): Promise<void> {
  const choice = await vscode.window.showErrorMessage(
    'Your EYRA session may have expired. Sign in again.',
    'Sign In',
  );
  if (choice === 'Sign In') {
    await vscode.commands.executeCommand('eyra.signIn');
  }
}

const EXPLAIN_PROMPT = [
  'Explain the selected / provided code simply for a learner.',
  'Walk through what each part does in plain language (for example: what an f-string is for, what a loop does, what a function returns).',
  'Do NOT hunt for bugs, list errors, or suggest fixes unless the user explicitly asks.',
  'Keep the answer short and conversational.',
].join(' ');

async function runAnalysis(
  secrets: vscode.SecretStorage,
  mode: 'file' | 'selection',
  runtime?: {
    terminalOutput: string;
    stackTrace: string;
    focusLine?: number | null;
    userPrompt?: string;
    chatOnly?: boolean;
    /** Simple teach-mode explanation — not bug analysis. */
    explainMode?: boolean;
    /** Ask for a different suggested fix than the last one. */
    alternateFix?: boolean;
    /** Find Bugs: look for potential issues, not only a crash that already happened. */
    bugHunt?: boolean;
  },
): Promise<void> {
  const editor = resolveTextEditor();
  const collected = mode === 'file'
    ? collectCurrentFile(snapshot(editor))
    : collectSelection(snapshot(editor));
  if (!collected.ok) {
    const open = await vscode.window.showErrorMessage(collected.message, 'Open File…');
    if (open === 'Open File…') {
      await vscode.commands.executeCommand('workbench.action.files.openFile');
    }
    return;
  }
  const token = await readAccessToken(secrets);
  if (!token) {
    const choice = await vscode.window.showErrorMessage('Sign in to EYRA before analyzing code.', 'Sign In');
    if (choice === 'Sign In') {
      await vscode.commands.executeCommand('eyra.signIn');
    }
    return;
  }
  if (!tryBeginBrainRequest()) {
    void vscode.window.showInformationMessage('An EYRA request is already running.');
    return;
  }
  const capturedEditor = editor;
  if (!capturedEditor) {
    endBrainRequest();
    return;
  }
  const explainMode = Boolean(runtime?.explainMode);
  const alternateFix = Boolean(runtime?.alternateFix);
  const bugHunt = Boolean(runtime?.bugHunt);
  const chatOnly = Boolean(runtime?.chatOnly) || explainMode || alternateFix;
  const userPrompt = (runtime?.userPrompt || '').trim()
    || (explainMode ? 'Explain this code simply.' : '');
  const history = recentChatTranscript();
  const guidedPrompt = bugHunt
    ? ''
    : alternateFix
    ? [
      'The user wants a different solution from the last suggested fix. Do not repeat it.',
      lastSuggestedCode()
        ? `PREVIOUS SUGGESTION (do not repeat):\n${lastSuggestedCode().slice(0, 6000)}`
        : 'No previous suggestion is stored. Propose one solid approach for the open file.',
      history ? `RECENT CHAT:\n${history}` : '',
      `USER MESSAGE:\n${userPrompt}`,
    ].filter(Boolean).join('\n\n')
    : explainMode
      ? `${EXPLAIN_PROMPT}\n\nUSER REQUEST:\n${userPrompt}`
      : chatOnly && userPrompt
        ? [
          'Answer as a coding copilot. Reply completely, in plain language.',
          'Normal questions get a direct answer, even when they are not about a bug or the open file.',
          'If the question is about the open file, use that code. Otherwise answer the question anyway.',
          'Do not invent an error or a fix unless they asked for code or a fix.',
          history ? `RECENT CHAT:\n${history}` : '',
          `USER MESSAGE:\n${userPrompt}`,
        ].filter(Boolean).join('\n\n')
        : userPrompt;
  const terminalFromPrompt = guidedPrompt
    ? `USER QUESTION:\n${guidedPrompt}`
    : '';
  const includeDiagnostics = explainMode
    || Boolean(runtime?.terminalOutput)
    || Boolean(runtime?.stackTrace)
    || !chatOnly;
  let diagnostics: AnalyzeDiagnostic[] | undefined;
  if (includeDiagnostics) {
    try {
      diagnostics = mode === 'selection'
        ? collectSelectionDiagnostics(
          capturedEditor.document.uri,
          collected.fileName,
          collected.startLine,
          collected.endLine,
        )
        : collectFileDiagnostics(capturedEditor.document.uri, collected.fileName);
      if (diagnostics.length < 1) {
        diagnostics = undefined;
      }
    } catch {
      diagnostics = undefined;
    }
  }
  const payload: AnalyzeRequestBody = {
    file_name: collected.fileName,
    language: collected.language,
    code_snippet: collected.code,
    terminal_output: runtime?.terminalOutput || (bugHunt
      ? [
        'Find bugs and potential issues in this file.',
        'Look for logic errors, crashes on normal or edge inputs, wrong operators, bad indexing, off-by-one mistakes, and unhandled exceptions.',
        'Use vscode_diagnostics only when they were provided.',
        'If the code is correct, set error_type to None and error_summary to "No issues found". Do not invent a runtime error.',
        'If you find a real potential bug, name it in error_type and put the full corrected file in corrected_code.',
      ].join(' ')
      : terminalFromPrompt),
    stack_trace: runtime?.stackTrace || (
      bugHunt
        ? 'Mode: find-bugs'
        : alternateFix
          ? 'Mode: alternate-fix'
          : explainMode
            ? 'Mode: explain-only (no bug hunt).'
            : chatOnly && userPrompt
              ? `Chat prompt: ${userPrompt}`
              : ''
    ),
    project_name: collected.projectName,
    reasoning_profile: explainMode || chatOnly ? 'runtime' : 'runtime',
    ...(diagnostics ? { diagnostics } : {}),
  };
  const focus = runtime?.focusLine && runtime.focusLine > 0 ? runtime.focusLine : null;
  const captured = {
    uri: capturedEditor.document.uri,
    localPath: collected.relativePath,
    fileName: collected.fileName,
    startLine: focus ?? collected.startLine,
    endLine: focus ?? collected.endLine,
    analyzedText: collected.code,
  };
  if (userPrompt) {
    notePendingChatPrompt(userPrompt);
  } else if (runtime?.terminalOutput) {
    notePendingChatPrompt(`Help me with this terminal error in ${collected.fileName}`);
  }
  beginPanelWork('analysis', collected.relativePath, collected.fileName);
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: runtime?.terminalOutput
          ? 'EYRA is analyzing the terminal error'
          : explainMode
            ? 'EYRA is explaining the code'
            : bugHunt
              ? 'EYRA is looking for potential issues'
              : userPrompt
              ? 'EYRA is answering your question'
              : mode === 'file'
                ? 'EYRA is analyzing the current file'
                : 'EYRA is explaining the selection',
        cancellable: true,
      },
      (_progress, cancelToken) => {
        cancelToken.onCancellationRequested(() => {
          cancelBrainRequest();
        });
        return analyzeCode(token, payload);
      },
    );
    showAnalysisPanel({
      result,
      localPath: captured.localPath,
      uri: captured.uri,
      startLine: captured.startLine,
      endLine: captured.endLine,
      analyzedText: captured.analyzedText,
      fileName: captured.fileName,
      userPrompt: userPrompt || undefined,
      chatOnly,
      alternateFix,
    });
  } catch (err) {
    if (err instanceof BrainHttpError && err.cancelled) {
      failPanelWork('analysis', 'Analysis cancelled.');
      void vscode.window.showInformationMessage('EYRA analysis cancelled.');
      return;
    }
    if (err instanceof BrainHttpError && err.unauthorized) {
      failPanelWork('analysis', err.message);
      await offerSignIn();
      return;
    }
    const message = err instanceof BrainHttpError ? err.message : 'EYRA analysis failed.';
    failPanelWork('analysis', message);
    void vscode.window.showErrorMessage(message);
  } finally {
    endBrainRequest();
  }
}

export function analyzeCurrentFile(secrets: vscode.SecretStorage): Promise<void> {
  return runAnalysis(secrets, 'file', {
    terminalOutput: '',
    stackTrace: '',
    userPrompt: 'Find bugs in this file',
    bugHunt: true,
  });
}

export function explainSelection(secrets: vscode.SecretStorage): Promise<void> {
  return runAnalysis(secrets, 'selection', {
    terminalOutput: '',
    stackTrace: '',
    userPrompt: 'Explain this selected code simply.',
    chatOnly: true,
    explainMode: true,
  });
}

/** Called when a terminal run fails — jumps to Chat with runtime context. */
export function analyzeTerminalError(
  secrets: vscode.SecretStorage,
  input: { terminalOutput: string; stackTrace: string; focusLine?: number | null },
): Promise<void> {
  return runAnalysis(secrets, 'file', input);
}

function localChatReply(prompt: string): string | null {
  const text = prompt.trim();
  // Greetings: hi / hii / hello / hey / …
  if (/^(hi+|h+e+l+o+|hey+|yo+|hola|sup|hiya)\b[!?.,\s]*$/i.test(text) && text.length <= 48) {
    return "Hi! I'm EYRA. Ask me anything about your code, or say \"analyze\" / \"find bugs\" when you want a full check. Run the file anytime — I'll jump in if it errors.";
  }
  if (/^(thanks|thank you|thx|ty)\b/i.test(text) && text.length <= 40) {
    return "You're welcome. Send another question anytime.";
  }
  if (/^(ok|okay|cool|great|nice|got it)\.?$/i.test(text)) {
    return 'Sounds good. What would you like to look at next?';
  }
  if (/^(bye|goodbye|see you)\b/i.test(text) && text.length <= 40) {
    return 'Bye! Open me again whenever you need a hand.';
  }
  if (/how are you\b/i.test(text) && text.length <= 60) {
    return "I'm good and ready to help. Ask a question about the open file, or say \"analyze\" to scan it for issues.";
  }
  if (/who are you|what('?s| is) eyra\b/i.test(text) && text.length <= 80) {
    return "I'm EYRA — your runtime debugging assistant. I can chat about your code, explain selections, find bugs, generate tests, and catch terminal errors.";
  }
  if (/^(help|what can you do)\??$/i.test(text)) {
    return 'Chat normally about the open file. Say "analyze" or "find bugs" for a full review, "explain" for a simple walkthrough, "generate tests" for code-specific cases, or "run the file" to execute it.';
  }
  return null;
}

function wantsRun(text: string): boolean {
  return /^\s*(run(\s+the)?\s+file|execute(\s+file)?)\b/i.test(text)
    || /\b(run|execute)\s+(this|the|my)\s+(file|code|script)\b/i.test(text);
}

function wantsTests(text: string): boolean {
  return /^\s*(generat(e)?\s+tests|write tests|create tests)\b/i.test(text)
    || /\b(generat(e|ing)?|write|create)\s+(unit\s+)?tests?\b/i.test(text);
}

function wantsOptimize(text: string): boolean {
  return /^\s*(optimiz|suggest optim)/i.test(text)
    || /\b(optimiz(e|ation)|make\s+(it\s+)?faster)\b/i.test(text);
}

function wantsAnotherFix(text: string): boolean {
  return /\b(another|different|alternate|alternative|second|new)\s+(solution|fix|approach|way|suggestion|implementation|version)\b/i.test(text)
    || /\banother\s+suggested\s+fix\b/i.test(text)
    || /\b(other|another)\s+way\s+to\s+(fix|solve|write|do|implement)\b/i.test(text);
}

function wantsFullAnalysis(text: string): boolean {
  return /\b(analy[sz]e|find\s+bugs?|debug|what'?s?\s+wrong|any\s+(bugs?|errors?|issues?)|is\s+there\s+(any\s+)?(bug|error|issue)|check\s+(if\s+)?(there\s+is\s+)?(any\s+)?(bug|error|issue)|check\s+(this|my|the)\s+code|review\s+(this|my|the)\s+code|inspect\s+(this|my|the)|look\s+for\s+(bugs?|errors?|issues?)|scan\s+(this|my|the)\s+file|fix\s+(this|my|the|bug|error|it|code)|solve\s+(this|it|the\s+(bug|error|problem|issue))|test\s+cases?\s+(are\s+)?not\s+pass)\b/i.test(text);
}

function wantsExplain(text: string): boolean {
  return /^\s*explain\b/i.test(text)
    || /\bexplain\s+(this|the|my|how|what|why|code|selection|block)\b/i.test(text)
    || /\bwhat\s+does\s+(this|the|an?\s+f-?string|this\s+line|this\s+code)\b/i.test(text);
}

/** Freeform chat box → normal chatbot by default; analyze/run only on clear intent. */
export async function answerChatPrompt(secrets: vscode.SecretStorage, prompt: string): Promise<void> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return;
  }
  const local = localChatReply(trimmed);
  if (local) {
    revealChatWithLocalTurns(trimmed, local);
    return;
  }
  if (wantsAnotherFix(trimmed)) {
    return runAnalysis(secrets, 'file', {
      terminalOutput: '',
      stackTrace: '',
      userPrompt: trimmed,
      alternateFix: true,
    });
  }
  if (wantsOptimize(trimmed)) {
    revealChatWithLocalTurns(trimmed, 'On it — suggesting an optimization for the active file.');
    await vscode.commands.executeCommand('eyra.suggestOptimization');
    return;
  }
  if (wantsTests(trimmed)) {
    revealChatWithLocalTurns(trimmed, 'Generating code-specific test cases for the active file.');
    await vscode.commands.executeCommand('eyra.generateTests');
    return;
  }
  if (wantsRun(trimmed)) {
    revealChatWithLocalTurns(trimmed, 'Running the active file.');
    await vscode.commands.executeCommand('eyra.runFile');
    return;
  }
  if (wantsFullAnalysis(trimmed)) {
    return runAnalysis(secrets, 'file', { terminalOutput: '', stackTrace: '', userPrompt: trimmed });
  }
  if (wantsExplain(trimmed)) {
    return runAnalysis(secrets, 'selection', {
      terminalOutput: '',
      stackTrace: '',
      userPrompt: trimmed,
      chatOnly: true,
      explainMode: true,
    });
  }
  // Normal chatbot: answer the question without forcing a full analyze/run UI.
  return runAnalysis(secrets, 'file', {
    terminalOutput: '',
    stackTrace: '',
    userPrompt: trimmed,
    chatOnly: true,
  });
}
