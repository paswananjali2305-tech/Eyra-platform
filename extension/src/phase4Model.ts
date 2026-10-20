import { ResponseShapeError } from './parse';

export const INVESTIGATION_TABS = ['chat', 'analysis', 'execution', 'tests', 'history'] as const;

export type InvestigationTab = (typeof INVESTIGATION_TABS)[number];

export type HistoryEntry = {
  sessionId: string;
  fileName: string;
  language: string;
  errorType: string;
  errorSummary: string;
  rootCause: string;
  status: string;
  verificationStatus: string;
  reasoningSource: string;
  projectName: string;
  createdAt: string;
  confidence: number | null;
  sameErrorCount: number | null;
};

export type HistoryList = {
  total: number;
  items: HistoryEntry[];
};

export type WebviewMessage =
  | { type: 'selectTab'; tab: InvestigationTab }
  | { type: 'refreshHistory'; query: string }
  | { type: 'clearHistory' }
  | { type: 'loadMoreHistory' }
  | { type: 'openSession'; sessionId: string }
  | { type: 'navigate'; target: 'origin' }
  | { type: 'navigate'; target: 'evidence'; location: string }
  | { type: 'copyCorrection' }
  | { type: 'requestApply'; then?: 'tests' }
  | { type: 'requestVerify'; method: 'execute' | 'tests' }
  | { type: 'chatAction'; action: 'explain' | 'analyze' | 'optimize' | 'tests' | 'run' }
  | { type: 'chatPrompt'; prompt: string }
  | { type: 'runFile' }
  | { type: 'generateTests' }
  | { type: 'runTests' }
  | { type: 'closePanel' }
  | { type: 'openSettings' }
  | { type: 'cancelRequest' }
  | { type: 'copyText'; text: string };

export type FixDecision =
  | { kind: 'cancelled'; reason: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'replace-all'; newText: string }
  | { kind: 'replace-span'; start: number; end: number; newText: string };

export type WorkflowState =
  | 'none'
  | 'proposed'
  | 'applied'
  | 'verification-pending'
  | 'verified'
  | 'verification-failed'
  | 'stale';

export type WorkflowSnapshot = {
  state: WorkflowState;
  detail: string;
  appliedText: string | null;
  investigationPath: string;
};

export type VerificationEvent =
  | {
    type: 'execution';
    path: string;
    documentText: string;
    ok: boolean;
    exitCode: number;
    timedOut: boolean;
    runtimeAvailable: boolean | null;
    stdout: string;
    stderr: string;
  }
  | {
    type: 'tests';
    path: string;
    documentText: string;
    total: number;
    passed: number;
    failed: number;
    executed: number;
    notRun: number;
  }
  | { type: 'cancelled'; path: string; documentText: string }
  | { type: 'unavailable'; path: string; documentText: string; detail: string };

export type EvidenceDecision =
  | { action: 'open'; relativePath: string; line: number | null; endLine: number | null }
  | { action: 'refuse'; reason: string };

const SESSION_ID = /^[A-Za-z0-9._-]{1,80}$/;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResponseShapeError(`Brain returned an unexpected ${label}.`);
  }
  return value as Record<string, unknown>;
}

function requiredText(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ResponseShapeError(`Brain ${label} is missing ${key}.`);
  }
  return value;
}

export function historyListPath(input: { query: string; offset: number; limit: number }): string {
  const params = new URLSearchParams();
  const limit = Math.min(200, Math.max(1, Math.floor(input.limit) || 50));
  const offset = Math.max(0, Math.floor(input.offset) || 0);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const query = input.query.trim().slice(0, 200);
  if (query) {
    params.set('q', query);
  }
  return `/api/history?${params.toString()}`;
}

export function historyDetailPath(sessionId: string): string | null {
  if (!SESSION_ID.test(sessionId)) {
    return null;
  }
  return `/api/history/${encodeURIComponent(sessionId)}`;
}

export function parseHistoryList(body: unknown): HistoryList {
  const record = asRecord(body, 'history response');
  if (typeof record.total !== 'number' || !Number.isFinite(record.total) || !Array.isArray(record.items)) {
    throw new ResponseShapeError('Brain history response is missing total or items.');
  }
  const items = record.items.map((item) => {
    const row = asRecord(item, 'history item');
    return {
      sessionId: requiredText(row, 'session_id', 'history item'),
      fileName: typeof row.file_name === 'string' ? row.file_name : '',
      language: typeof row.language === 'string' ? row.language : '',
      errorType: typeof row.error_type === 'string' ? row.error_type : '',
      errorSummary: typeof row.error_summary === 'string' ? row.error_summary : '',
      rootCause: typeof row.root_cause === 'string' ? row.root_cause : '',
      status: typeof row.status === 'string' ? row.status : '',
      verificationStatus: typeof row.verification_status === 'string' ? row.verification_status : '',
      reasoningSource: typeof row.reasoning_source === 'string' ? row.reasoning_source : '',
      projectName: typeof row.project_name === 'string' ? row.project_name : '',
      createdAt: typeof row.created_at === 'string' ? row.created_at : '',
      confidence: typeof row.confidence === 'number' ? row.confidence : null,
      sameErrorCount: typeof row.same_error_count === 'number' ? row.same_error_count : null,
    };
  });
  return { total: record.total, items };
}

export function parseWebviewMessage(value: unknown): WebviewMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case 'selectTab':
      if (typeof record.tab !== 'string' || !INVESTIGATION_TABS.includes(record.tab as InvestigationTab)) {
        return null;
      }
      return { type: 'selectTab', tab: record.tab as InvestigationTab };
    case 'refreshHistory': {
      const query = record.query === undefined ? '' : record.query;
      if (typeof query !== 'string' || query.length > 200) {
        return null;
      }
      return { type: 'refreshHistory', query };
    }
    case 'loadMoreHistory':
      return { type: 'loadMoreHistory' };
    case 'clearHistory':
      return { type: 'clearHistory' };
    case 'openSession':
      if (typeof record.sessionId !== 'string' || !historyDetailPath(record.sessionId)) {
        return null;
      }
      return { type: 'openSession', sessionId: record.sessionId };
    case 'navigate':
      if (record.target === 'origin' && record.location === undefined) {
        return { type: 'navigate', target: 'origin' };
      }
      if (record.target === 'evidence' && typeof record.location === 'string' && record.location.length > 0 && record.location.length <= 512) {
        return { type: 'navigate', target: 'evidence', location: record.location };
      }
      return null;
    case 'copyCorrection':
      return { type: 'copyCorrection' };
    case 'requestApply':
      if (record.then === 'tests') {
        return { type: 'requestApply', then: 'tests' };
      }
      if (record.then !== undefined) {
        return null;
      }
      return { type: 'requestApply' };
    case 'requestVerify':
      if (record.method !== 'execute' && record.method !== 'tests') {
        return null;
      }
      return { type: 'requestVerify', method: record.method };
    case 'chatAction': {
      const action = record.action;
      if (
        action !== 'explain'
        && action !== 'analyze'
        && action !== 'optimize'
        && action !== 'tests'
        && action !== 'run'
      ) {
        return null;
      }
      return { type: 'chatAction', action };
    }
    case 'chatPrompt': {
      const prompt = record.prompt;
      if (typeof prompt !== 'string') {
        return null;
      }
      const trimmed = prompt.trim();
      if (!trimmed || trimmed.length > 2000) {
        return null;
      }
      return { type: 'chatPrompt', prompt: trimmed };
    }
    case 'runFile':
      return { type: 'runFile' };
    case 'generateTests':
      return { type: 'generateTests' };
    case 'runTests':
      return { type: 'runTests' };
    case 'closePanel':
      return { type: 'closePanel' };
    case 'openSettings':
      return { type: 'openSettings' };
    case 'cancelRequest':
      return { type: 'cancelRequest' };
    case 'copyText':
      return typeof record.text === 'string' ? { type: 'copyText', text: record.text } : null;
    default:
      return null;
  }
}

function baseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return (normalized.split('/').pop() || '').trim();
}

function readLocation(location: string): { file: string; line: number | null; endLine: number | null } | null {
  const trimmed = location.trim();
  if (!trimmed) {
    return null;
  }
  const ranged = /^(.*):(\d+)-(\d+)$/.exec(trimmed);
  if (ranged) {
    const line = Number(ranged[2]);
    const endLine = Number(ranged[3]);
    if (!ranged[1] || !Number.isInteger(line) || !Number.isInteger(endLine) || line < 1 || endLine < line) {
      return null;
    }
    return { file: ranged[1], line, endLine };
  }
  const single = /^(.*):(\d+)$/.exec(trimmed);
  if (single) {
    const line = Number(single[2]);
    if (!single[1] || !Number.isInteger(line) || line < 1) {
      return null;
    }
    return { file: single[1], line, endLine: line };
  }
  if (trimmed.includes(':')) {
    return null;
  }
  return { file: trimmed, line: null, endLine: null };
}

export function resolveEvidenceLocation(input: {
  location: string | null | undefined;
  knownFileName: string | null;
  knownRelativePath: string | null;
  workspaceBasenames?: string[];
}): EvidenceDecision {
  if (!input.location || !input.location.trim()) {
    return { action: 'refuse', reason: 'No source location was returned.' };
  }
  const parsed = readLocation(input.location);
  if (!parsed) {
    return { action: 'refuse', reason: 'The source location is malformed. No file was opened.' };
  }
  if (!input.knownRelativePath || !input.knownFileName) {
    const matches = input.workspaceBasenames?.length ?? 0;
    const reason = matches === 1
      ? 'EYRA does not open a workspace file from a basename alone.'
      : 'No local editor path is stored, and the file name is missing or ambiguous.';
    return { action: 'refuse', reason };
  }
  const knownRelative = input.knownRelativePath.replace(/\\/g, '/');
  const locFile = parsed.file.replace(/\\/g, '/');
  const bareName = !locFile.includes('/');
  const sameFile = locFile === knownRelative
    || (bareName && baseName(knownRelative) === locFile && locFile === input.knownFileName);
  if (!sameFile) {
    return {
      action: 'refuse',
      reason: 'The evidence names a different file. EYRA will not choose among workspace files.',
    };
  }
  return {
    action: 'open',
    relativePath: knownRelative,
    line: parsed.line,
    endLine: parsed.endLine,
  };
}

export function decideFix(input: {
  confirmed: boolean;
  applyMode: string;
  documentText: string;
  analyzedText: string;
  correctedText: string;
}): FixDecision {
  if (input.applyMode !== 'review_and_copy') {
    return {
      kind: 'refused',
      reason: 'The Brain apply_mode is review_and_copy only. This suggestion was not applied.',
    };
  }
  if (!input.correctedText) {
    return { kind: 'refused', reason: 'The Brain did not return corrected code.' };
  }
  if (!input.analyzedText) {
    return { kind: 'refused', reason: 'The analyzed source is missing, so the suggestion cannot be placed.' };
  }
  if (input.correctedText === input.analyzedText) {
    return { kind: 'refused', reason: 'The suggestion matches the analyzed text. Nothing was changed.' };
  }
  const start = input.documentText.indexOf(input.analyzedText);
  const later = start < 0 ? -1 : input.documentText.indexOf(input.analyzedText, start + 1);
  if (start < 0) {
    return {
      kind: 'refused',
      reason: 'The document changed since this analysis. The file was not changed.',
    };
  }
  if (later !== -1) {
    return {
      kind: 'refused',
      reason: 'The analyzed text appears more than once. The file was not changed.',
    };
  }
  if (!input.confirmed) {
    return { kind: 'cancelled', reason: 'Apply was cancelled. The file was not changed.' };
  }
  if (start === 0 && input.analyzedText.length === input.documentText.length) {
    return { kind: 'replace-all', newText: input.correctedText };
  }
  return {
    kind: 'replace-span',
    start,
    end: start + input.analyzedText.length,
    newText: input.correctedText,
  };
}

export function workflowLabel(state: WorkflowState): string {
  switch (state) {
    case 'none':
      return 'No fix proposed';
    case 'proposed':
      return 'Proposed';
    case 'applied':
      return 'Applied';
    case 'verification-pending':
      return 'Verification pending';
    case 'verified':
      return 'Verified';
    case 'verification-failed':
      return 'Verification failed';
    case 'stale':
      return 'Stale';
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

export function proposalState(analyzed: string, corrected: string, applyMode: string): WorkflowSnapshot {
  if (applyMode !== 'review_and_copy' || !corrected || corrected === analyzed) {
    return {
      state: 'none',
      detail: 'No applicable code change was proposed.',
      appliedText: null,
      investigationPath: '',
    };
  }
  return {
    state: 'proposed',
    detail: 'A suggestion is ready to review. It has not been applied or verified.',
    appliedText: null,
    investigationPath: '',
  };
}

export function suggestionDiff(
  analyzed: string,
  corrected: string,
  brainDiff: string | null | undefined,
): { text: string; source: 'brain' | 'local' } {
  if (typeof brainDiff === 'string' && brainDiff.trim()) {
    return { text: brainDiff, source: 'brain' };
  }
  const before = analyzed.split('\n');
  const after = corrected.split('\n');
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }
  let endBefore = before.length - 1;
  let endAfter = after.length - 1;
  while (endBefore >= start && endAfter >= start && before[endBefore] === after[endAfter]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const lines = ['--- analyzed', '+++ suggestion'];
  for (let index = start; index <= endBefore; index += 1) {
    lines.push(`-${before[index]}`);
  }
  for (let index = start; index <= endAfter; index += 1) {
    lines.push(`+${after[index]}`);
  }
  if (lines.length === 2) {
    lines.push('No line change.');
  }
  return { text: lines.join('\n'), source: 'local' };
}

export function appliedDocument(documentText: string, decision: FixDecision): string | null {
  if (decision.kind === 'replace-all') {
    return decision.newText;
  }
  if (decision.kind === 'replace-span') {
    return documentText.slice(0, decision.start) + decision.newText + documentText.slice(decision.end);
  }
  return null;
}

export function afterConfirmedEdit(editApplied: boolean): Pick<WorkflowSnapshot, 'state' | 'detail'> & { stale: boolean } {
  if (!editApplied) {
    return {
      stale: false,
      state: 'proposed',
      detail: 'The editor did not apply the change. The file was not recorded as updated.',
    };
  }
  return {
    stale: true,
    state: 'applied',
    detail: 'The suggestion was applied. This analysis is stale. Verification has not run.',
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function pathsMatch(left: string, right: string): boolean {
  const a = normalizePath(left);
  const b = normalizePath(right);
  return a.length > 0 && a === b;
}

function canVerify(state: WorkflowState): boolean {
  return state === 'applied' || state === 'verification-pending' || state === 'verification-failed' || state === 'verified';
}

export function startVerification(
  snapshot: WorkflowSnapshot,
  input: { path: string; documentText: string },
): WorkflowSnapshot {
  if (!snapshot.appliedText || !canVerify(snapshot.state)) {
    return snapshot;
  }
  if (!pathsMatch(snapshot.investigationPath, input.path)) {
    return {
      ...snapshot,
      detail: 'This run is a different file, so it does not verify the applied fix.',
    };
  }
  if (input.documentText !== snapshot.appliedText) {
    return {
      ...snapshot,
      state: 'stale',
      detail: 'The document changed after the fix was applied. This run does not verify that fix.',
    };
  }
  return {
    ...snapshot,
    state: 'verification-pending',
    detail: 'Verification is running. No result has been recorded yet.',
  };
}

function sameVerifiedText(snapshot: WorkflowSnapshot, event: VerificationEvent): boolean {
  return pathsMatch(snapshot.investigationPath, event.path)
    && snapshot.appliedText !== null
    && event.documentText === snapshot.appliedText;
}

export function finishVerification(snapshot: WorkflowSnapshot, event: VerificationEvent): WorkflowSnapshot {
  if (snapshot.state !== 'verification-pending') {
    return snapshot;
  }
  if (!sameVerifiedText(snapshot, event)) {
    return {
      ...snapshot,
      state: 'stale',
      detail: 'The file changed before verification finished. The result was not recorded as a pass.',
    };
  }
  switch (event.type) {
    case 'cancelled':
      return {
        ...snapshot,
        state: 'verification-failed',
        detail: 'Verification was cancelled. This is not a pass.',
      };
    case 'unavailable':
      return {
        ...snapshot,
        state: 'verification-failed',
        detail: event.detail || 'Verification did not run. This is not a pass.',
      };
    case 'execution': {
      const passed = event.ok === true
        && event.exitCode === 0
        && event.timedOut !== true
        && event.runtimeAvailable !== false;
      if (!passed) {
        return {
          ...snapshot,
          state: 'verification-failed',
          detail: `Verification failed. exit ${event.exitCode}. stdout and stderr stay on the Execution tab.`,
        };
      }
      return {
        ...snapshot,
        state: 'verified',
        detail: `Verified by running the file. exit ${event.exitCode}.`,
      };
    }
    case 'tests': {
      const passed = event.total > 0
        && event.passed > 0
        && event.passed === event.total
        && event.failed === 0
        && event.executed === 0
        && event.notRun === 0;
      if (!passed) {
        return {
          ...snapshot,
          state: 'verification-failed',
          detail: `Verification failed. passed ${event.passed}, failed ${event.failed}, executed ${event.executed}, not_run ${event.notRun}.`,
        };
      }
      return {
        ...snapshot,
        state: 'verified',
        detail: `Verified by tests. ${event.passed} passed.`,
      };
    }
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export function historyReopenDecision(input: {
  previousSessionId: string | null;
  nextSessionId: string;
  previousFileName: string | null;
  nextFileName: string;
  hadOrigin: boolean;
}): { keepOrigin: boolean } {
  const keepOrigin = input.hadOrigin
    && input.previousSessionId !== null
    && input.previousSessionId === input.nextSessionId
    && input.previousFileName !== null
    && input.previousFileName === input.nextFileName;
  return { keepOrigin };
}
