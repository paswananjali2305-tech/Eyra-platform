import { escapeHtml } from './analysisHtml';
import { eyraHeroBotSvg } from './eyraHero';
import { eyraBaseCss, iconSvg } from './eyraUi';
import { fileTypeLogoSvg } from './fileTypeIcon';
import type { AnalyzeResult } from './parse';
import type { ExecuteView, GeneratedTestsView, OptimizeView, PerformanceView, TestRunView } from './phase3Model';
import type { HistoryEntry, InvestigationTab, WorkflowSnapshot } from './phase4Model';
import { suggestionDiff, workflowLabel } from './phase4Model';

export type PanelStatus = 'empty' | 'loading' | 'error' | 'ready';

export type ChatTurn = {
  id: string;
  role: 'user' | 'bot';
  text: string;
  at: number;
  /** When true, render a rich analysis card under this bot turn. */
  showAnalysis?: boolean;
  /** Snapshot so older turns keep their card after newer messages. */
  analysisResult?: AnalyzeResult;
  analysisLocalPath?: string;
  analysisFileName?: string;
  analysisStartLine?: number | null;
  analysisEndLine?: number | null;
  /** Optional tone for bot text (e.g. green success when no error). */
  tone?: 'ok';
};

export type InvestigationView = {
  tab: InvestigationTab;
  nonce: string;
  stale: boolean;
  botImgUri: string;
  cspSource: string;
  brainOnline: boolean;
  userInitial: string;
  workflow?: WorkflowSnapshot;
  chat: {
    turns: ChatTurn[];
  };
  analysis: {
    status: PanelStatus;
    error: string;
    result: AnalyzeResult | null;
    localPath: string;
    hasOrigin: boolean;
    startLine: number | null;
    endLine: number | null;
  };
  execution: {
    status: PanelStatus;
    error: string;
    view: ExecuteView | null;
    localPath: string;
    fileName: string;
  };
  tests: {
    status: PanelStatus;
    error: string;
    generated: GeneratedTestsView | null;
    run: TestRunView | null;
    localPath: string;
    fileName: string;
  };
  suggestions: {
    status: PanelStatus;
    error: string;
    performance: PerformanceView | null;
    optimize: OptimizeView | null;
    localPath: string;
  };
  history: {
    status: PanelStatus;
    error: string;
    total: number | null;
    items: HistoryEntry[];
    query: string;
  };
};

/** Analysis + Run stay in Chat. Tab bar is hidden — Tests/History open from the sidebar with ← Chat. */
const HIDDEN_TABS = new Set<InvestigationTab>(['analysis', 'execution']);
const TABS: { id: InvestigationTab; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'tests', label: 'Tests', icon: 'tests' },
  { id: 'history', label: 'History', icon: 'history' },
];

function workflowOf(view: InvestigationView): WorkflowSnapshot {
  return view.workflow ?? {
    state: 'none',
    detail: '',
    appliedText: null,
    investigationPath: '',
  };
}

function statusBlock(status: PanelStatus, error: string, empty: string): string {
  if (status === 'loading') {
    return `<div class="banner info loading-banner">
      <span>Loading from the Brain…</span>
      <button type="button" class="btn-cancel" id="cancel-request">Cancel</button>
    </div>`;
  }
  if (status === 'error') {
    return `<div class="banner error">${escapeHtml(error || 'The Brain request failed.')}</div>`;
  }
  if (status === 'empty') {
    return `<p class="empty">${escapeHtml(empty)}</p>`;
  }
  return '';
}

function sourceChip(view: InvestigationView): string {
  const workflow = workflowOf(view);
  const source = view.analysis.hasOrigin && view.analysis.localPath
    ? view.analysis.localPath
    : 'No local editor path is stored';
  const lines = view.analysis.startLine
    ? `Lines ${view.analysis.startLine}–${view.analysis.endLine ?? view.analysis.startLine}`
    : 'No line range is stored';
  const label = workflow.state === 'none' ? 'No fix proposed' : `Fix ${workflowLabel(workflow.state)}`;
  return `<div class="source-chip">
    <span>Source ${escapeHtml(source)}</span>
    <span class="sep">·</span>
    <span>${escapeHtml(lines)}</span>
    <span class="sep">·</span>
    <span>${escapeHtml(label)}</span>
    ${workflow.detail ? `<div class="muted tiny">${escapeHtml(workflow.detail)}</div>` : ''}
  </div>`;
}

/** Only highlight explicit markdown `code` spans — never every English word. */
function highlightInlineCode(text: string): string {
  return renderInlineMarkdown(text);
}

function renderInlineMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
}

function numberedCodeRows(code: string, startLine: number): string {
  const start = startLine > 0 ? startLine : 1;
  return code.replace(/\r\n/g, '\n').split('\n').map((line, index) => {
    return `<div class="ui-ev-row"><span class="ui-ev-ln">${start + index}</span><span class="ui-ev-code">${highlightCodeLineHtml(line)}</span></div>`;
  }).join('');
}

function renderChatCodeCard(code: string, lang: string): string {
  const label = (lang || 'code').trim() || 'code';
  const rows = numberedCodeRows(code.replace(/\s+$/, ''), 1);
  return `<div class="ui-evidence chat-code md-code">
    <div class="ui-ev-bar">
      <span class="ui-ev-file">${escapeHtml(label)}</span>
      <button type="button" class="ui-ev-copy chat-copy" title="Copy">${iconSvg('copy')} Copy</button>
    </div>
    <div class="ui-ev-body">${rows}</div>
  </div>`;
}

function renderChatProse(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      return '';
    }
    if (lines.every((line) => /^\d+\.\s+/.test(line))) {
      const items = lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^\d+\.\s+/, ''))}</li>`).join('');
      return `<ol class="md-list">${items}</ol>`;
    }
    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      const items = lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`).join('');
      return `<ul class="md-list">${items}</ul>`;
    }
    return `<p class="md-p">${lines.map((line) => renderInlineMarkdown(line)).join('<br>')}</p>`;
  }).join('');
}

/** Chat answers: prose stays text, fenced code becomes a code block. */
function renderChatMarkdown(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  const fence = /```([A-Za-z0-9_+-]*)[ \t]*\n?([\s\S]*?)```/g;
  const parts: string[] = [];
  let last = 0;
  for (const match of normalized.matchAll(fence)) {
    const index = match.index ?? 0;
    if (index > last) {
      parts.push(renderChatProse(normalized.slice(last, index)));
    }
    const lang = match[1] || '';
    const body = (match[2] || '').replace(/^\n/, '').replace(/\n$/, '');
    parts.push(renderChatCodeCard(body, lang));
    last = index + match[0].length;
  }
  if (last < normalized.length) {
    parts.push(renderChatProse(normalized.slice(last)));
  }
  return parts.join('');
}

function renderDiff(text: string): string {
  const lines = text.split('\n').map((line) => {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return `<span class="diff-add">${escapeHtml(line)}</span>`;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return `<span class="diff-del">${escapeHtml(line)}</span>`;
    }
    return `<span>${escapeHtml(line)}</span>`;
  });
  return `<pre class="diff">${lines.join('\n')}</pre>`;
}

type DiffRowKind = 'ctx' | 'del' | 'add';
type DiffRow = { kind: DiffRowKind; lineNo: number | null; code: string };

function parseDiffHunks(text: string, startLine: number | null): DiffRow[] {
  const rows: DiffRow[] = [];
  let delNo = startLine && startLine > 0 ? startLine : 1;
  let addNo = startLine && startLine > 0 ? startLine : 1;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('@@')) {
      const match = /@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)/.exec(raw);
      if (match) {
        delNo = Number(match[1]);
        addNo = Number(match[2]);
      }
      continue;
    }
    if (raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('diff ') || raw === 'No line change.') {
      continue;
    }
    if (raw.startsWith('+')) {
      rows.push({ kind: 'add', lineNo: addNo, code: raw.slice(1) });
      addNo += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      rows.push({ kind: 'del', lineNo: delNo, code: raw.slice(1) });
      delNo += 1;
      continue;
    }
    if (raw.startsWith(' ') || (!raw.startsWith('+') && !raw.startsWith('-') && raw.length > 0)) {
      const code = raw.startsWith(' ') ? raw.slice(1) : raw;
      rows.push({ kind: 'ctx', lineNo: addNo, code });
      delNo += 1;
      addNo += 1;
    }
  }
  return rows;
}

function looksLikeCode(text: string): boolean {
  const value = text.trim();
  if (!value) {
    return false;
  }
  // Reject plain English summaries the Brain sometimes puts in corrected_code.
  const proseLead = /^(the\s+(script|code|program|function|issue|error|fix)|this\s+(script|code|program)|here(?:'s| is)|i\s+(found|suggest|recommend)|no\s+(error|issue|change))/i;
  if (proseLead.test(value) && !/^\s*(def|class|import|from|print|async|await|function|const|let|var)\b/m.test(value)) {
    return false;
  }
  const lines = value.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length >= 2) {
    const codeish = lines.filter((line) =>
      /[=(){};\[\]]|^\s*(def|class|import|from|if|for|while|return|print|async|await|try|except|with|function|const|let|var|#)\b/.test(line)
      || /^\s{2,}\S/.test(line)
      || /:\s*$/.test(line),
    ).length;
    return codeish >= Math.ceil(lines.length * 0.4);
  }
  return /[=(){};\[\]]|^\s*(def|class|import|from|if|for|while|return|print|async|await|function|const|let|var)\b/.test(value);
}

const DIFF_CONTEXT_LINES = 2;

type DiffOp =
  | { kind: 'eq'; beforeIdx: number; afterIdx: number; text: string }
  | { kind: 'del'; beforeIdx: number; text: string }
  | { kind: 'add'; afterIdx: number; text: string };

type ChangeHunk = {
  beforeStart: number;
  afterStart: number;
  beforeLines: string[];
  afterLines: string[];
};

/** If corrected is a full file and analyzed is a snippet (or vice versa), align to the overlapping region. */
function alignCodePair(analyzed: string, corrected: string): { before: string[]; after: string[] } {
  const before = analyzed.replace(/\r\n/g, '\n').split('\n');
  const after = corrected.replace(/\r\n/g, '\n').split('\n');
  if (before.join('\n') === after.join('\n') || before.length === after.length) {
    return { before, after };
  }
  if (after.length > before.length + 2) {
    let best = 0;
    let bestScore = -1;
    for (let start = 0; start <= after.length - before.length; start += 1) {
      let score = 0;
      for (let i = 0; i < before.length; i += 1) {
        if (after[start + i] === before[i]) {
          score += 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = start;
      }
    }
    if (bestScore >= Math.max(1, Math.floor(before.length * 0.4))) {
      return { before, after: after.slice(best, best + before.length) };
    }
  }
  if (before.length > after.length + 2) {
    let best = 0;
    let bestScore = -1;
    for (let start = 0; start <= before.length - after.length; start += 1) {
      let score = 0;
      for (let i = 0; i < after.length; i += 1) {
        if (before[start + i] === after[i]) {
          score += 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = start;
      }
    }
    if (bestScore >= Math.max(1, Math.floor(after.length * 0.4))) {
      return { before: before.slice(best, best + after.length), after };
    }
  }
  return { before, after };
}

function sameCodeLine(a: string, b: string): boolean {
  return a.replace(/\s+$/g, '') === b.replace(/\s+$/g, '');
}

/** Line-level LCS ops so edits at line 7 and line 23 stay as separate hunks. */
function lineDiffOps(before: string[], after: string[]): DiffOp[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = sameCodeLine(before[i], after[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sameCodeLine(before[i], after[j])) {
      ops.push({ kind: 'eq', beforeIdx: i, afterIdx: j, text: before[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: 'del', beforeIdx: i, text: before[i] });
      i += 1;
    } else {
      ops.push({ kind: 'add', afterIdx: j, text: after[j] });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ kind: 'del', beforeIdx: i, text: before[i] });
    i += 1;
  }
  while (j < m) {
    ops.push({ kind: 'add', afterIdx: j, text: after[j] });
    j += 1;
  }
  return ops;
}

function collectChangeHunks(before: string[], after: string[]): ChangeHunk[] {
  const ops = lineDiffOps(before, after);
  const hunks: ChangeHunk[] = [];
  let cur: ChangeHunk | null = null;
  let eqStreak = 0;
  const flush = () => {
    if (cur && (cur.beforeLines.length || cur.afterLines.length)) {
      hunks.push(cur);
    }
    cur = null;
  };
  for (const op of ops) {
    if (op.kind === 'eq') {
      eqStreak += 1;
      if (cur && eqStreak > DIFF_CONTEXT_LINES) {
        flush();
      }
      continue;
    }
    if (!cur) {
      cur = {
        beforeStart: op.kind === 'del' ? op.beforeIdx : 0,
        afterStart: op.kind === 'add' ? op.afterIdx : 0,
        beforeLines: [],
        afterLines: [],
      };
      if (op.kind === 'del') {
        cur.beforeStart = op.beforeIdx;
        cur.afterStart = 0;
      } else {
        cur.afterStart = op.afterIdx;
        cur.beforeStart = 0;
      }
    }
    if (op.kind === 'del' && cur.beforeLines.length === 0 && cur.afterLines.length === 0) {
      cur.beforeStart = op.beforeIdx;
    }
    if (op.kind === 'add' && cur.beforeLines.length === 0 && cur.afterLines.length === 0) {
      cur.afterStart = op.afterIdx;
    }
    if (op.kind === 'del' && cur.beforeLines.length === 0) {
      cur.beforeStart = op.beforeIdx;
    }
    if (op.kind === 'add' && cur.afterLines.length === 0) {
      cur.afterStart = op.afterIdx;
    }
    eqStreak = 0;
    if (op.kind === 'del') {
      cur.beforeLines.push(op.text);
    } else {
      cur.afterLines.push(op.text);
    }
  }
  flush();
  return hunks;
}

/**
 * Multi-hunk inline diff: only changed lines in red/green (plus a little context).
 * Prefer LCS over prefix/suffix "local" diffs — those paint whole blocks red then green.
 */
function buildInlineDiffRows(
  analyzed: string,
  corrected: string,
  diffText: string | null,
  startLine: number | null,
): DiffRow[] {
  // Only trust Brain unified diffs that include real @@ hunks (not local prefix/suffix blobs).
  if (diffText && /@@\s+-/.test(diffText)) {
    const fromDiff = parseDiffHunks(diffText, startLine);
    const changeCount = fromDiff.filter((row) => row.kind === 'del' || row.kind === 'add').length;
    const total = Math.max(analyzed.split('\n').length, 1);
    if (changeCount > 0 && changeCount <= total * 0.6) {
      return fromDiff;
    }
  }

  const { before, after } = alignCodePair(analyzed, corrected);
  if (before.join('\n') === after.join('\n')) {
    return [];
  }

  const ops = lineDiffOps(before, after);
  const base = startLine && startLine > 0 ? startLine : 1;
  const rows: DiffRow[] = [];
  let pendingEq: DiffOp[] = [];

  const pushEqContext = (list: DiffOp[], fromEnd: boolean, limit: number) => {
    const slice = fromEnd ? list.slice(-limit) : list.slice(0, limit);
    for (const op of slice) {
      if (op.kind === 'eq') {
        rows.push({ kind: 'ctx', lineNo: base + op.beforeIdx, code: op.text });
      }
    }
  };

  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === 'eq') {
      pendingEq.push(ops[i]);
      i += 1;
      continue;
    }
    pushEqContext(pendingEq, true, DIFF_CONTEXT_LINES);
    pendingEq = [];
    while (i < ops.length && ops[i].kind !== 'eq') {
      const op = ops[i];
      if (op.kind === 'del') {
        rows.push({ kind: 'del', lineNo: base + op.beforeIdx, code: op.text });
      } else if (op.kind === 'add') {
        rows.push({ kind: 'add', lineNo: base + op.afterIdx, code: op.text });
      }
      i += 1;
    }
    const trail: DiffOp[] = [];
    let k = i;
    while (k < ops.length && ops[k].kind === 'eq' && trail.length < DIFF_CONTEXT_LINES) {
      trail.push(ops[k]);
      k += 1;
    }
    pushEqContext(trail, false, DIFF_CONTEXT_LINES);
    pendingEq = [];
    while (i < ops.length && ops[i].kind === 'eq') {
      pendingEq.push(ops[i]);
      i += 1;
    }
    if (pendingEq.length > DIFF_CONTEXT_LINES * 2 && i < ops.length) {
      pendingEq = pendingEq.slice(-DIFF_CONTEXT_LINES);
    }
  }

  return rows;
}

/** Evidence card: only the problematic line(s), highlighted red. */
function problematicEvidenceHtml(opts: {
  code: string;
  errorLines: number[];
  startLine: number | null;
  fileLabel: string;
}): string {
  const lines = opts.code.replace(/\r\n/g, '\n').split('\n');
  if (!lines.length || (lines.length === 1 && !lines[0])) {
    return '<p class="muted">No code snippet was returned.</p>';
  }
  const base = opts.startLine && opts.startLine > 0 ? opts.startLine : 1;
  const targets = opts.errorLines.length
    ? opts.errorLines
    : [base];
  const rows = targets
    .filter((n) => n >= base && n < base + lines.length)
    .map((n) => {
      const text = lines[n - base] ?? '';
      return `<div class="sfx-row del">
        <span class="sfx-ln">${n}</span>
        <span class="sfx-mark">−</span>
        <span class="sfx-code">${highlightCodeLineHtml(text)}</span>
      </div>`;
    });
  if (!rows.length) {
    const n = targets[0] || base;
    const text = lines[Math.max(0, n - base)] ?? lines[0] ?? '';
    rows.push(`<div class="sfx-row del">
      <span class="sfx-ln">${base}</span>
      <span class="sfx-mark">−</span>
      <span class="sfx-code">${highlightCodeLineHtml(text)}</span>
    </div>`);
  }
  return `<div class="ax-problem">
    <div class="ax-problem-head">
      <span class="ax-sev-pill high">${iconSvg('warn')} Problematic Code</span>
      <span class="muted">${escapeHtml(opts.fileLabel)} · Line ${targets.join(', ')}</span>
    </div>
    <div class="sfx-diff-body crc-body">${rows.join('')}</div>
  </div>`;
}

function evidenceWindowHtml(opts: {
  code: string;
  errorLines: number[];
  startLine: number | null;
  fileLabel: string;
}): string {
  const lines = opts.code.replace(/\r\n/g, '\n').split('\n');
  if (!lines.length || (lines.length === 1 && !lines[0])) {
    return '<p class="muted">No code snippet was returned.</p>';
  }
  const base = opts.startLine && opts.startLine > 0 ? opts.startLine : 1;
  const focus = opts.errorLines[0] || base;
  const from = Math.max(base, focus - 2);
  const to = Math.min(base + lines.length - 1, Math.max(focus + 2, from));
  const rows: string[] = [];
  for (let n = from; n <= to; n += 1) {
    const text = lines[n - base] ?? '';
    const hot = opts.errorLines.includes(n);
    rows.push(`<div class="ui-ev-row${hot ? ' hot' : ''}">
      <span class="ui-ev-ln">${n}</span>
      <span class="ui-ev-code">${highlightCodeLineHtml(text)}</span>
    </div>`);
  }
  const range = from === to ? `Line ${from}` : `Lines ${from}–${to}`;
  return `<div class="ui-evidence chat-code">
    <div class="ui-ev-bar">
      <span class="ui-ev-file">${fileTypeLogoSvg(opts.fileLabel, 14) || iconSvg('code-brace')}<span>${escapeHtml(opts.fileLabel)}</span></span>
      <span class="ui-ev-range">${range}</span>
      <button type="button" class="ui-ev-copy chat-copy" data-copy="${escapeHtml(opts.code)}" title="Copy">${iconSvg('copy')} Copy</button>
    </div>
    <div class="ui-ev-body">${rows.join('')}</div>
  </div>`;
}

function collectCodeChangeHunks(analyzed: string, corrected: string): ChangeHunk[] {
  const { before, after } = alignCodePair(analyzed, corrected);
  if (before.join('\n') === after.join('\n')) {
    return [];
  }
  return collectChangeHunks(before, after);
}

function extractMentionedLineNumbers(...texts: string[]): number[] {
  const lines = new Set<number>();
  for (const text of texts) {
    if (!text) {
      continue;
    }
    for (const match of text.matchAll(/\blines?\s+(\d+)(?:\s*[-–—]\s*(\d+))?/gi)) {
      const a = Number(match[1]);
      const b = match[2] ? Number(match[2]) : a;
      if (a > 0) {
        // Only expand short ranges (e.g. lines 4–5), never whole-file spans.
        if (b >= a && b - a <= 3) {
          for (let n = a; n <= b; n += 1) {
            lines.add(n);
          }
        } else {
          lines.add(a);
        }
      }
    }
    for (const match of text.matchAll(/:(\d+)(?::\d+)?/g)) {
      const n = Number(match[1]);
      if (n > 0 && n < 100000) {
        lines.add(n);
      }
    }
  }
  return [...lines];
}

/** Precise error lines only — never paint the whole analyzed range red. */
function errorLineNumbersFromAnalysis(opts: {
  startLine: number | null;
  evidence: { location?: string | null; detail?: string; kind?: string }[];
  analyzed: string;
  corrected: string;
  errorSummary: string;
  rootCause: string;
  explanation: string;
}): number[] {
  const base = opts.startLine && opts.startLine > 0 ? opts.startLine : 1;
  const lines = new Set<number>();

  for (const item of opts.evidence) {
    for (const n of extractMentionedLineNumbers(item.location || '', item.detail || '', item.kind || '')) {
      lines.add(n);
    }
  }
  for (const n of extractMentionedLineNumbers(opts.errorSummary, opts.rootCause, opts.explanation)) {
    lines.add(n);
  }

  // Changed lines from the suggestion — only true deletions (the broken lines).
  // Cap so a full-file rewrite does not paint every line red.
  if (opts.corrected.trim()) {
    const fromDiff: number[] = [];
    const { before, after } = alignCodePair(opts.analyzed, opts.corrected);
    for (const op of lineDiffOps(before, after)) {
      if (op.kind === 'del') {
        fromDiff.push(base + op.beforeIdx);
      }
    }
    if (fromDiff.length > 0 && fromDiff.length <= 8) {
      fromDiff.forEach((n) => lines.add(n));
    } else if (!lines.size && fromDiff.length > 8 && opts.startLine && opts.startLine > 0) {
      lines.add(opts.startLine);
    }
  }

  // Fallback: single primary caret line from the analysis origin.
  if (!lines.size && opts.startLine && opts.startLine > 0) {
    lines.add(opts.startLine);
  }

  return [...lines].filter((n) => n > 0).sort((a, b) => a - b);
}

/** Red error line(s) + green corrected line(s) with line numbers for one hunk. */
function renderHunkRedGreenHtml(hunk: ChangeHunk, baseLine: number, copyId?: string): string {
  const rows: string[] = [];
  hunk.beforeLines.forEach((line, i) => {
    const n = baseLine + hunk.beforeStart + i;
    rows.push(`<div class="sfx-row del">
      <span class="sfx-ln">${n}</span>
      <span class="sfx-mark">−</span>
      <span class="sfx-code">${highlightCodeLineHtml(line)}</span>
    </div>`);
  });
  hunk.afterLines.forEach((line, i) => {
    const n = baseLine + hunk.afterStart + i;
    rows.push(`<div class="sfx-row add">
      <span class="sfx-ln">${n}</span>
      <span class="sfx-mark">+</span>
      <span class="sfx-code">${highlightCodeLineHtml(line)}</span>
    </div>`);
  });
  if (!rows.length) {
    return '';
  }
  return `<div class="ax-rec-diff">
    ${copyId ? `<button type="button" class="chat-copy" id="${escapeHtml(copyId)}" title="Copy">${iconSvg('copy')}</button>` : `<button type="button" class="chat-copy" title="Copy">${iconSvg('copy')}</button>`}
    <div class="sfx-diff-body crc-body">${rows.join('')}</div>
  </div>`;
}

/** Highlight the changed span inside the corrected line (recommendation code preview). */
function highlightChangedSpanHtml(beforeLine: string, afterLine: string): string {
  if (!afterLine) {
    return highlightCodeLineHtml(afterLine);
  }
  if (beforeLine === afterLine) {
    return highlightCodeLineHtml(afterLine);
  }
  let start = 0;
  while (start < beforeLine.length && start < afterLine.length && beforeLine[start] === afterLine[start]) {
    start += 1;
  }
  let endBefore = beforeLine.length - 1;
  let endAfter = afterLine.length - 1;
  while (endBefore >= start && endAfter >= start && beforeLine[endBefore] === afterLine[endAfter]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const prefix = afterLine.slice(0, start);
  const changed = afterLine.slice(start, endAfter + 1);
  const suffix = afterLine.slice(endAfter + 1);
  return `${highlightCodeLineHtml(prefix)}<mark class="ax-rec-hl">${escapeHtml(changed || ' ')}</mark>${highlightCodeLineHtml(suffix)}`;
}

function renderRichDiffViewer(opts: {
  fileName: string;
  rows: DiffRow[];
  startLine: number | null;
  endLine: number | null;
}): string {
  const rows = opts.rows;
  if (!rows.length) {
    return '';
  }
  const brand = fileTypeLogoSvg(opts.fileName, 14);
  const body = rows.map((row) => {
    const ln = row.lineNo == null ? '' : String(row.lineNo);
    const mark = row.kind === 'del' ? '−' : row.kind === 'add' ? '+' : '';
    return `<div class="sfx-row ${row.kind}">
      <span class="sfx-ln">${ln}</span>
      <span class="sfx-mark">${mark}</span>
      <span class="sfx-code">${highlightCodeLineHtml(row.code)}</span>
    </div>`;
  }).join('');
  return `<div class="sfx-diff">
    <div class="sfx-diff-bar">
      <span class="sfx-file">${brand || iconSvg('doc')}<span>${escapeHtml(opts.fileName)}</span></span>
      <span class="sfx-diff-right">
        <button type="button" class="ui-ev-copy chat-copy" title="Copy">${iconSvg('copy')} Copy</button>
      </span>
    </div>
    <div class="sfx-diff-body crc-body">${body}</div>
  </div>`;
}

function meaningfulCodeChange(analyzed: string, corrected: string, summary: string): boolean {
  const a = analyzed.replace(/\r\n/g, '\n').trim();
  const c = corrected.replace(/\r\n/g, '\n').trim();
  if (!c || !looksLikeCode(c)) {
    return false;
  }
  if (a === c) {
    return false;
  }
  if (/no\s+changes?\s+needed|no\s+correction|nothing\s+to\s+(change|fix|apply)|code\s+is\s+(already\s+)?correct|no\s+fix\s+needed/i.test(summary)) {
    return false;
  }
  if (/no\s+changes?\s+needed|no\s+correction|nothing\s+to\s+(change|fix)/i.test(c) && c.length < 120) {
    return false;
  }
  return true;
}

function lineSimilarity(left: string, right: string): number {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < a.length - prefix
    && suffix < b.length - prefix
    && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return (prefix + suffix) / Math.max(a.length, b.length);
}

/** A one-line model fix becomes a full-file edit so the card can show red/green lines. */
function expandPartialFix(analyzed: string, corrected: string): string {
  const before = analyzed.replace(/\r\n/g, '\n').split('\n');
  const after = corrected.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim());
  if (!after.length || after.length >= before.filter((line) => line.trim()).length * 0.6) {
    return corrected;
  }
  const used = new Set<number>();
  const replacements: { index: number; text: string }[] = [];
  for (const line of after) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < before.length; i += 1) {
      if (used.has(i) || !before[i].trim()) {
        continue;
      }
      const score = lineSimilarity(before[i], line);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0 || bestScore < 0.55) {
      return corrected;
    }
    used.add(best);
    if (before[best].trim() !== line.trim()) {
      const indent = before[best].match(/^\s*/)?.[0] ?? '';
      const text = /^\s/.test(line) ? line : `${indent}${line.trimStart()}`;
      replacements.push({ index: best, text });
    }
  }
  if (!replacements.length) {
    return corrected;
  }
  const next = before.slice();
  for (const rep of replacements) {
    next[rep.index] = rep.text;
  }
  return next.join('\n');
}

function codeFences(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/```[A-Za-z0-9_+-]*[ \t]*\n?([\s\S]*?)```/g)) {
    const body = (match[1] || '').replace(/^\n/, '').replace(/\n$/, '').trim();
    if (body) {
      found.push(body);
    }
  }
  return found;
}

/** Prefer a real source change: full snippet, a spliced one-line fix, or a code fence in the explanation. */
export function resolveSuggestedCode(snippet: string, corrected: string, explanation: string): string {
  const analyzed = snippet.replace(/\r\n/g, '\n');
  const accept = (candidate: string): string => {
    const raw = candidate.replace(/\r\n/g, '\n').trim();
    if (!meaningfulCodeChange(analyzed, raw, '')) {
      return '';
    }
    const expanded = expandPartialFix(analyzed, raw);
    if (expanded !== raw && meaningfulCodeChange(analyzed, expanded, '')) {
      return expanded;
    }
    const snippetLines = analyzed.split('\n').filter((line) => line.trim()).length;
    const candidateLines = raw.split('\n').filter((line) => line.trim()).length;
    if (candidateLines >= Math.max(1, Math.floor(snippetLines * 0.6))) {
      return raw;
    }
    return '';
  };
  const direct = accept(corrected);
  if (direct) {
    return direct;
  }
  for (const fence of codeFences(explanation).reverse()) {
    const fromFence = accept(fence);
    if (fromFence) {
      return fromFence;
    }
  }
  return '';
}

function suggestedFixCard(opts: {
  analyzedCode: string;
  correctedCode: string;
  summary: string;
  explanation: string;
  fileName: string;
  language: string;
  diffText: string | null;
  diffSource: 'brain' | 'local' | null;
  startLine: number | null;
  endLine: number | null;
  applyMode: string;
  verifyHtml: string;
  /** When false, show the diff but hide Apply (older chat turns). */
  allowApply?: boolean;
  /** True once this fix has been written to the editor (awaiting or failing verification). */
  fixApplied?: boolean;
}): string {
  const corrected = opts.correctedCode.trim();
  const analyzed = opts.analyzedCode.trim();
  const summary = opts.summary.trim();
  const codeFix = Boolean(corrected) && looksLikeCode(corrected);
  const changed = meaningfulCodeChange(analyzed, corrected, summary);
  // No real fix → do not render a Suggested Fix card at all.
  if (!changed) {
    return '';
  }
  const rows = buildInlineDiffRows(analyzed, corrected, opts.diffText, opts.startLine);
  const rich = renderRichDiffViewer({
    fileName: opts.fileName,
    rows,
    startLine: opts.startLine,
    endLine: opts.endLine,
  });
  const subtitle = summary && summary.length <= 140
    ? summary
    : 'Review the suggested code changes below.';
  const allowApply = opts.allowApply !== false;

  // Always include sfx-mark so the 3-column grid never squeezes code into 18px (vertical glyphs).
  const mainBlock = rich
    || (codeFix
      ? `<div class="sfx-diff">
          <div class="sfx-diff-bar">
            <span class="sfx-file">${fileTypeLogoSvg(opts.fileName, 14) || iconSvg('doc')}<span>${escapeHtml(opts.fileName)}</span></span>
          </div>
          <div class="sfx-diff-body crc-body">${corrected.replace(/\r\n/g, '\n').split('\n').map((line, index) => {
            const n = (opts.startLine && opts.startLine > 0 ? opts.startLine : 1) + index;
            return `<div class="sfx-row add"><span class="sfx-ln">${n}</span><span class="sfx-mark">+</span><span class="sfx-code">${highlightCodeLineHtml(line)}</span></div>`;
          }).join('')}</div>
        </div>`
      : '');

  if (!mainBlock) {
    return '';
  }

  return `<section class="ui-card" id="suggested-fix">
    <div class="ui-card-head">
      <span class="ui-card-ico">${iconSvg('wrench')}</span>
      <strong>Suggested Fix</strong>
      ${opts.fixApplied ? '<span class="fix-applied-pill">Fix Applied</span>' : ''}
      </div>
    <p class="ui-card-sub">${escapeHtml(subtitle)}</p>
    ${mainBlock}
    ${allowApply ? `<div class="ui-fix-actions">
      <button type="button" class="btn-apply" id="apply-fix">${iconSvg('doc')}<span>Apply to Editor</span></button>
      <button type="button" class="ui-ghost-btn" id="explain-further">${iconSvg('doc')}<span>Explain Further</span></button>
    </div>
    ${opts.verifyHtml}` : ''}
  </section>`;
}

const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
  'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);
const PY_BUILTINS = new Set([
  'int', 'float', 'str', 'bool', 'list', 'dict', 'set', 'tuple', 'len', 'range', 'print', 'type',
  'Exception', 'ValueError', 'TypeError', 'ZeroDivisionError',
]);

function highlightCodeLineHtml(line: string): string {
  if (!line) {
    return '&nbsp;';
  }
  let i = 0;
  let out = '';
  const push = (text: string, color: string) => {
    if (!text) {
      return;
    }
    out += `<span style="color:${color}">${escapeHtml(text)}</span>`;
  };
  while (i < line.length) {
    if (line[i] === '#') {
      push(line.slice(i), '#8B949E');
      break;
    }
    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i];
      if (line.slice(i, i + 3) === quote + quote + quote) {
        const end = line.indexOf(quote + quote + quote, i + 3);
        if (end === -1) {
          push(line.slice(i), '#E3B341');
          break;
        }
        push(line.slice(i, end + 3), '#E3B341');
        i = end + 3;
        continue;
      }
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      push(line.slice(i, j), '#E3B341');
      i = j;
      continue;
    }
    if (/[0-9]/.test(line[i]) && (i === 0 || /[\s([{=,:+\-*/%]/.test(line[i - 1] || ' '))) {
      let j = i;
      while (j < line.length && /[0-9._]/.test(line[j])) {
        j += 1;
      }
      push(line.slice(i, j), '#F0883E');
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) {
        j += 1;
      }
      const word = line.slice(i, j);
      const nextNonSpace = line.slice(j).match(/^\s*/)?.[0]?.length ?? 0;
      const after = line[j + nextNonSpace];
      if (PY_KEYWORDS.has(word)) {
        push(word, '#FF7B72');
      } else if (PY_BUILTINS.has(word)) {
        push(word, '#79C0FF');
      } else if (after === '(') {
        push(word, '#D2A8FF');
      } else {
        push(word, '#79C0FF');
      }
      i = j;
      continue;
    }
    if (/[+\-*/%=<>!&|^~]/.test(line[i])) {
      push(line[i], '#FF7B72');
      i += 1;
      continue;
    }
    push(line[i], '#C9D1D9');
    i += 1;
  }
  return out || '&nbsp;';
}

function codeSnippetBlock(result: AnalyzeResult, startLine: number | null, endLine: number | null): string {
  const lines = (result.code_snippet || '').split('\n');
  if (!lines.length || (lines.length === 1 && !lines[0])) {
    return '';
  }
  const start = startLine ?? 1;
  const hotStart = startLine ?? -1;
  const hotEnd = endLine ?? hotStart;
  const shown = lines.slice(0, 12);
  return `<div class="code-panel">${shown.map((line, index) => {
    const n = start + index;
    const hot = n >= hotStart && n <= hotEnd;
    return `<div class="code-row${hot ? ' hot' : ''}"><span class="ln">${n}</span><code>${escapeHtml(line || ' ')}</code></div>`;
  }).join('')}</div>`;
}

function botAvatar(view: InvestigationView, size: number): string {
  if (view.botImgUri) {
    // Empty alt so a failed load never spills "EYRA" text into the avatar box.
    return `<img class="bot-face" src="${escapeHtml(view.botImgUri)}" alt="" width="${size}" height="${size}" decoding="async" />`;
  }
  return iconSvg(size > 40 ? 'brain' : 'brain-sm');
}

const LANGUAGE_DISPLAY: Record<string, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  go: 'Go',
  rust: 'Rust',
  php: 'PHP',
  ruby: 'Ruby',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  shell: 'Shell',
  json: 'JSON',
};

const EXT_LANGUAGE: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  go: 'go',
  rs: 'rust',
  php: 'php',
  rb: 'ruby',
  html: 'html',
  css: 'css',
  sql: 'sql',
  sh: 'shell',
};

export function languageFromFileName(fileName: string): string {
  const base = (fileName || '').replace(/\\/g, '/').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot < 0) {
    return '';
  }
  return EXT_LANGUAGE[base.slice(dot + 1).toLowerCase()] || '';
}

/** Human language label for a token/file — never guesses Python. */
export function languageDisplayName(token: string, fileName = ''): string {
  let value = (token || '').trim().toLowerCase();
  if (value === 'typescriptreact') value = 'typescript';
  if (value === 'javascriptreact') value = 'javascript';
  if (value === 'py') value = 'python';
  if (!value) {
    value = languageFromFileName(fileName);
  }
  if (!value) {
    return 'Code';
  }
  return LANGUAGE_DISPLAY[value] || value.charAt(0).toUpperCase() + value.slice(1);
}

function codeResultCard(opts: {
  title: string;
  language: string;
  code: string;
  highlightLine: number | null;
  startLine?: number | null;
  borderTone: 'red' | 'green' | 'blue';
}): string {
  const lines = opts.code.split('\n').slice(0, 40);
  if (!lines.length || (lines.length === 1 && !lines[0])) {
    return '';
  }
  const start = opts.startLine && opts.startLine > 0 ? opts.startLine : 1;
  const langLabel = languageDisplayName(opts.language || '');
  const rows = lines.map((line, i) => {
    const n = start + i;
    const hot = opts.highlightLine != null && n === opts.highlightLine;
    return `<div class="crc-row${hot ? ' hot' : ''}"><span class="crc-ln">${n}</span><span class="crc-code">${highlightCodeLineHtml(line)}</span></div>`;
  }).join('');
  return `<div class="crc tone-${opts.borderTone}">
    <div class="crc-head">
      <div class="crc-titles"><span class="crc-title">${escapeHtml(opts.title || 'Code')}</span><span class="crc-lang">${escapeHtml(langLabel)}</span></div>
      <button type="button" class="crc-copy" data-copy="1" title="Copy">${iconSvg('copy')} Copy</button>
    </div>
    <pre class="crc-body">${rows}</pre>
  </div>`;
}

/** True when the model is saying the file is fine, including "No runtime error detected". */
export function looksLikeNoIssue(text: string): boolean {
  const value = text.replace(/\s+/g, ' ').trim();
  if (!value) {
    return false;
  }
  return /no\s+(?:[\w-]+\s+){0,3}(?:errors?|issues?|problems?|bugs?)\b|looks\s+correct|code\s+(?:is\s+)?correct|code\s+correctly|all\s+good|nothing\s+(?:is\s+)?wrong|works\s+as\s+expected/i.test(value);
}

function chatComposer(): string {
  return `<form class="composer-card composer-compact" id="chat-form">
    <input type="text" id="chat-input" maxlength="2000" placeholder="Ask EYRA about this file, error, or test result…" autocomplete="off" />
    <button type="submit" class="send" title="Send" aria-label="Send">${iconSvg('send')}</button>
  </form>`;
}

function chatLead(text: string, showAnalysis: boolean): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  if (!showAnalysis) {
    return trimmed;
  }
  const line = trimmed.split(/\n+/)[0]?.trim() || trimmed;
  if (/^I found a /i.test(line) && !/let's fix it/i.test(line)) {
    return `${line.replace(/[.!\s]+$/, '')}. Let's fix it.`;
  }
  return line;
}

function formatStamp(at: number): string {
  try {
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function analysisBotCard(
  view: InvestigationView,
  turn?: ChatTurn,
  allowApply = true,
): string {
  const result = turn?.analysisResult || view.analysis.result;
  if (!result) {
    return '';
  }
  const localPath = turn?.analysisLocalPath || view.analysis.localPath;
  const startLine = turn?.analysisStartLine ?? view.analysis.startLine;
  const endLine = turn?.analysisEndLine ?? view.analysis.endLine;
  const file = result.file_name || turn?.analysisFileName || 'snippet.py';
  const fileLabel = (localPath || result.file_name || file).replace(/\\/g, '/').split('/').pop() || file;
  const correction = result.suggested_correction;
  const correctedForFix = resolveSuggestedCode(
    result.code_snippet || '',
    correction?.corrected_code || '',
    result.explanation || '',
  );
  const rawErrorType = (result.error_type || '').trim();
  const errorType = /^(none|null|n\/a|undefined|ok|clean|no[_\s-]?error|-|finding)$/i.test(rawErrorType) || looksLikeNoIssue(rawErrorType)
    ? ''
    : rawErrorType;
  const errorDetail = (result.error_summary || '').trim();
  const rootCause = (result.root_cause || '').trim();
  const cleanSummary = looksLikeNoIssue(errorDetail) || looksLikeNoIssue(rawErrorType);
  const foundIssue = Boolean(errorType && !cleanSummary) || Boolean(errorDetail && !cleanSummary);
  const findingTitle = errorType || (errorDetail ? 'Finding' : 'Analysis complete');
  const findingSub = errorDetail
    || (errorType ? 'No error summary was returned.' : 'The Brain returned analysis without a named error type.');
  const rootCauseHtml = (rootCause || result.explanation || '').trim()
    ? highlightInlineCode(rootCause || result.explanation)
    : '<span class="muted">No root cause was returned.</span>';
  const fixSummary = (correction?.summary || '').trim();
  const hasCodeFix = meaningfulCodeChange(result.code_snippet || '', correctedForFix, fixSummary);
  const storedCode = (correction?.corrected_code || '').trim();
  const diff = hasCodeFix && storedCode === correctedForFix.trim()
    ? suggestionDiff(result.code_snippet || '', correctedForFix, correction?.diff_unified)
    : null;
  const errorLines = errorLineNumbersFromAnalysis({
    startLine,
    evidence: result.evidence,
    analyzed: result.code_snippet || '',
    corrected: hasCodeFix ? correctedForFix : '',
    errorSummary: errorDetail,
    rootCause,
    explanation: [
      (result.explanation || '').trim(),
      result.stack_trace || '',
      result.terminal_output || '',
    ].join('\n'),
  });
  const evidenceStart = startLine && startLine > 0 ? startLine : 1;
  const verify = allowApply && (workflowOf(view).state === 'applied' || workflowOf(view).state === 'verification-failed')
    ? `<div class="row-gap">
         <button type="button" id="verify-run">Run file to verify</button>
         <button type="button" id="verify-tests">Run tests to verify</button>
       </div>`
    : '';
  const fixSection = foundIssue
    ? suggestedFixCard({
      analyzedCode: result.code_snippet || '',
      correctedCode: correctedForFix,
      summary: fixSummary,
      explanation: (result.explanation || rootCause || '').trim(),
      fileName: fileLabel,
      language: result.language || 'python',
      diffText: diff?.source === 'brain' ? (diff.text ?? null) : null,
      diffSource: diff?.source ?? null,
      startLine,
      endLine,
      applyMode: correction?.apply_mode || 'review_and_copy',
      verifyHtml: verify,
      allowApply,
      fixApplied: workflowOf(view).state === 'applied' || workflowOf(view).state === 'verification-failed',
    })
    : '';

  if (/^alternative$/i.test(rawErrorType)) {
    return `${sourceChip(view)}
    <div class="bot-lead">Here is another solution.</div>
    ${fixSection}
    ${(result.explanation || '').trim()
      ? `<p class="finding-body">${highlightInlineCode((result.explanation || '').trim())}</p>`
      : ''}`;
  }

  if (!foundIssue) {
    const about = [result.explanation, errorDetail, rootCause]
      .map((item) => (item || '').trim())
      .find((item) => item && !/^(n\/a|na|none|null|undefined|-)$/i.test(item) && !looksLikeNoIssue(item))
      || (result.explanation || errorDetail || '').trim();
    const aboutHtml = about && !/^(n\/a|na|none|null|undefined|-)$/i.test(about)
      ? `<p class="finding-body ok-note">${highlightInlineCode(about)}</p>`
      : '';
    return `${sourceChip(view)}
    <div class="chat-ok-card">
      <span class="chat-ok-ico">${iconSvg('check')}</span>
      <div>
        <div class="finding-title">No error found</div>
        <div class="finding-sub">No potential issues in ${escapeHtml(fileLabel)}. Code looks correct.</div>
      </div>
    </div>
    ${aboutHtml}`;
  }

  const primaryLine = errorLines[0] || evidenceStart;
  const severity = /syntax|type|name|import|indent/i.test(errorType) ? 'High' : 'Medium';
  const explanation = (result.explanation || '').trim();
  const leadHtml = errorType
    ? `I found a <strong>${escapeHtml(errorType)}</strong> in <strong>${escapeHtml(fileLabel)}</strong>. Let's fix it.`
    : `I found an issue in <strong>${escapeHtml(fileLabel)}</strong>. Let's fix it.`;
  const blurb = (errorDetail || findingSub).trim();
  const sentenceCut = blurb.search(/[.!](?:\s+|$)/);
  const errorTitle = sentenceCut > 0 && sentenceCut < 110 ? blurb.slice(0, sentenceCut + 1).trim() : blurb;
  const errorRest = sentenceCut > 0 && sentenceCut < 110 ? blurb.slice(sentenceCut + 1).trim() : '';
  const explainSentence = explanation.split(/(?<=[.!?])\s+/)[0]?.trim() || '';
  const errorDesc = errorRest
    || (explainSentence && explainSentence !== errorTitle && explainSentence.length < 220 ? explainSentence : '');
  const workflow = workflowOf(view);
  const originNote = view.analysis.hasOrigin
    ? ''
    : `<p class="muted tiny">No local editor path is stored${workflow.detail ? `. ${escapeHtml(workflow.detail)}` : ''}</p>`;
  return `<p class="finding-body">${leadHtml}</p>
    <div class="ui-card ui-error">
      <div class="ui-error-top">
        <span class="ui-bang">${iconSvg('warn')}</span>
        <span class="ui-error-name">${escapeHtml(errorType || findingTitle)}</span>
        <span class="ui-sev ${severity === 'High' ? 'high' : 'med'}">${severity}</span>
        <span class="ui-error-meta">
          <span class="ui-filechip">${iconSvg('doc')}<span>${escapeHtml(fileLabel)}</span></span>
          <span class="ui-linechip">Line ${primaryLine}</span>
        </span>
      </div>
      <div class="ui-error-title">${escapeHtml(errorTitle)}</div>
      ${errorDesc ? `<p class="ui-error-desc">${renderInlineMarkdown(errorDesc)}</p>` : ''}
    </div>
    <div class="ui-card">
      <div class="ui-card-head"><span class="ui-card-ico">${iconSvg('lightbulb')}</span><strong>Root Cause</strong></div>
      <p class="ui-card-body">${rootCauseHtml}</p>
    </div>
    <div class="ui-card">
      <div class="ui-card-head"><span class="ui-card-ico">${iconSvg('code-brace')}</span><strong>Evidence</strong></div>
      ${evidenceWindowHtml({
      code: result.code_snippet || '',
      errorLines,
      startLine: evidenceStart,
      fileLabel,
    })}
    </div>
    ${fixSection}
    ${explanation
      ? `<div class="ui-card">
          <div class="ui-card-head"><span class="ui-card-ico">${iconSvg('doc')}</span><strong>Explanation</strong></div>
          <div class="ui-card-body md-block">${renderChatMarkdown(explanation)}</div>
        </div>`
      : ''}
    ${originNote}`;
}

function chatCodeBlock(opts: {
  code: string;
  highlightLine: number | null;
  highlightLines?: number[];
  startLine: number | null;
}): string {
  const lines = opts.code.split('\n').slice(0, 80);
  if (!lines.length || (lines.length === 1 && !lines[0])) {
    return '';
  }
  const start = opts.startLine && opts.startLine > 0 ? opts.startLine : 1;
  const hotSet = new Set<number>(opts.highlightLines || []);
  if (opts.highlightLine != null && opts.highlightLine > 0) {
    hotSet.add(opts.highlightLine);
  }
  const rows = lines.map((line, i) => {
    const n = start + i;
    const hot = hotSet.has(n);
    return `<div class="chat-code-row${hot ? ' err' : ''}"><span class="chat-ln">${n}</span><span class="chat-src">${highlightCodeLineHtml(line)}</span></div>`;
  }).join('');
  return `<div class="chat-code">
    <button type="button" class="chat-copy crc-copy" title="Copy">${iconSvg('copy')}</button>
    <pre class="chat-code-body crc-body">${rows}</pre>
  </div>`;
}

function chatPanel(view: InvestigationView): string {
  const loading = view.analysis.status === 'loading';
  const composer = chatComposer();
  const result = view.analysis.result;
  let turns = view.chat.turns;
  if (!turns.length && result) {
    const fileLabel = (view.analysis.localPath || result.file_name || 'file').replace(/\\/g, '/').split('/').pop() || 'file';
    turns = [
      { id: 'implicit-user', role: 'user', text: `Analyze ${fileLabel}`, at: Date.now() },
      { id: 'implicit-bot', role: 'bot', text: '', showAnalysis: true, at: Date.now() },
    ];
  }
  const hasThread = turns.length > 0 || loading || view.analysis.status === 'error';

  if (!hasThread) {
    return `<div class="chat-scroll hero-scroll">
      <section class="hero" aria-label="Welcome to EYRA">
        <div class="hero-bot">${eyraHeroBotSvg()}</div>
        <h1 class="hero-name">EYRA</h1>
        <div class="hero-platform">AI Debugging Platform</div>
        <p class="hero-tagline">Understand code. Find bugs. Fix with confidence.</p>
        <div class="hero-rule" aria-hidden="true"></div>
        <p class="hero-hint">Ask me anything about the active file, or run it in the terminal — when it errors, I'll analyze that output here.</p>
      </section>
    </div>
    ${composer}`;
  }

  const latestAnalysisId = [...turns].reverse().find((t) => t.role === 'bot' && t.showAnalysis)?.id;
  const messages = turns.map((turn) => {
    const stamp = escapeHtml(formatStamp(turn.at));
    if (turn.role === 'user') {
      return `<div class="msg user">
        <div class="msg-col">
          <div class="msg-bubble">${escapeHtml(turn.text)}</div>
          <div class="msg-time">${stamp}</div>
          </div>
        <div class="msg-avatar user-av">${iconSvg('user')}</div>
      </div>`;
    }
    const allowApply = Boolean(turn.showAnalysis && turn.id === latestAnalysisId);
    const rich = turn.showAnalysis ? analysisBotCard(view, turn, allowApply) : '';
    const okClass = turn.tone === 'ok' ? ' finding-ok' : '';
    const skipText = turn.showAnalysis && turn.tone === 'ok' && /no error found/i.test(turn.text || '');
    const lead = skipText ? '' : chatLead(turn.text || '', Boolean(turn.showAnalysis));
    const cardOwnsLead = Boolean(turn.showAnalysis) && /^I found a /i.test(lead);
    const body = lead && !cardOwnsLead
      ? `<div class="md-block${okClass}">${renderChatMarkdown(lead)}</div>`
      : '';
    return `<div class="msg bot">
      <div class="msg-avatar bot-av">${botAvatar(view, 28)}</div>
      <div class="msg-col">
        <div class="msg-meta"><strong>EYRA</strong><span class="msg-time">${stamp}</span></div>
        ${body}
        ${rich}
      </div>
    </div>`;
  }).join('');

  return `<div class="chat-scroll">
    <div class="thread">
      ${messages}
    </div>
    ${view.analysis.status === 'error' ? `<div class="banner error">${escapeHtml(view.analysis.error)}</div>` : ''}
    ${loading ? `<div class="msg bot eyra-thinking">
      <div class="msg-avatar bot-av">${botAvatar(view, 28)}</div>
      <div class="msg-col">
        <div class="msg-meta"><strong>EYRA</strong></div>
        <div class="typing" aria-label="EYRA is thinking"><span></span><span></span><span></span></div>
      </div>
    </div>` : ''}
  </div>
  ${composer}`;
}

function analysisAccordion(
  opts: { icon: string; title: string; preview?: string; badge?: string; open?: boolean; body: string },
): string {
  const preview = opts.preview
    ? `<span class="ax-preview">${escapeHtml(opts.preview)}</span>`
    : '';
  const badge = opts.badge
    ? `<span class="ax-badge">${escapeHtml(opts.badge)}</span>`
    : '';
  // Keep flex off <summary> — WebKit/webview collapses details content when summary is display:flex.
  return `<details class="ax-fold"${opts.open ? ' open' : ''}>
    <summary class="ax-summary">
      <div class="ax-summary-inner">
        <span class="ax-ico">${iconSvg(opts.icon)}</span>
        <span class="ax-text">
          <span class="ax-title">${escapeHtml(opts.title)}</span>
          ${preview}
        </span>
        ${badge}
        <span class="ax-chev">${iconSvg('chevron-right')}</span>
      </div>
    </summary>
    <div class="ax-body">${opts.body}</div>
  </details>`;
}

function analysisRichSection(opts: {
  icon: string;
  title: string;
  subtitle: string;
  badgeHtml: string;
  open?: boolean;
  body: string;
}): string {
  return `<details class="ax-rich"${opts.open === false ? '' : ' open'}>
    <summary class="ax-rich-summary">
      <div class="ax-rich-summary-inner">
        <span class="ax-ico">${iconSvg(opts.icon)}</span>
        <span class="ax-text">
          <span class="ax-title">${escapeHtml(opts.title)}</span>
          <span class="ax-preview">${escapeHtml(opts.subtitle)}</span>
        </span>
        ${opts.badgeHtml}
        <span class="ax-chev">${iconSvg('chevron-right')}</span>
      </div>
    </summary>
    <div class="ax-rich-body">${opts.body}</div>
  </details>`;
}

type RelatedFinding = {
  title: string;
  location: string;
  severity: 'High' | 'Medium' | 'Low';
  sessionId?: string;
  evidenceLocation?: string;
};

function describeFixFromDiff(beforeLine: string, afterLine: string, summary: string): { title: string; detail: string } {
  if (summary.trim() && summary.trim().length <= 90) {
    const detail = beforeLine !== afterLine
      ? `Update this line to: ${afterLine.trim() || '(empty)'}`
      : '';
    return { title: summary.trim().replace(/\.$/, ''), detail };
  }
  if (!beforeLine && afterLine) {
    return { title: 'Add the missing code', detail: `Insert: ${afterLine.trim()}` };
  }
  if (beforeLine && !afterLine) {
    return { title: 'Remove the incorrect code', detail: `Remove: ${beforeLine.trim()}` };
  }
  if (afterLine.length > beforeLine.length && afterLine.startsWith(beforeLine.slice(0, Math.min(beforeLine.length, afterLine.length)))) {
    const added = afterLine.slice(beforeLine.length) || afterLine.replace(beforeLine, '');
    if (added.trim() === ')' || afterLine.includes(')') && !beforeLine.includes(')', beforeLine.lastIndexOf('('))) {
      return { title: 'Add the missing closing parenthesis', detail: 'Close the statement with a ).' };
    }
  }
  if (beforeLine.includes('(') && !beforeLine.trim().endsWith(')') && afterLine.trim().endsWith(')')) {
    return { title: 'Add the missing closing parenthesis', detail: 'Close the statement with a ).' };
  }
  return {
    title: summary.trim() || 'Apply the suggested code change',
    detail: beforeLine !== afterLine ? 'Replace the highlighted code with the corrected version.' : '',
  };
}

function impactSectionHtml(opts: {
  errorType: string;
  errorSummary: string;
  impactDetail: string;
  explanation: string;
  rootCause: string;
  fileLabel: string;
  otherFiles: string[];
}): string {
  const kind = opts.errorType.toLowerCase().replace(/_/g, ' ');
  const high = Boolean(opts.errorType);
  let execution = (opts.impactDetail || '').trim();
  if (!execution) {
    if (/syntax/.test(kind) || /syntax/.test(opts.errorSummary.toLowerCase())) {
      execution = 'Code cannot run due to a syntax error.';
    } else if (/type/.test(kind)) {
      execution = opts.errorSummary || 'Code raises a type error at runtime.';
    } else if (/name|undefined|not defined/.test(kind) || /not defined/.test(opts.errorSummary.toLowerCase())) {
      execution = opts.errorSummary || 'Code fails because a name is not defined.';
    } else if (opts.errorSummary) {
      execution = opts.errorSummary;
    } else if (opts.errorType) {
      execution = `Code fails with ${opts.errorType.replace(/_/g, ' ')}.`;
    }
  }
  let userImpact = '';
  const expl = opts.explanation.trim();
  const root = opts.rootCause.trim();
  if (expl && expl !== execution && expl !== opts.errorSummary) {
    userImpact = expl.length > 160 ? `${expl.slice(0, 157)}…` : expl;
  } else if (/syntax/.test(kind) || /syntax/.test(execution.toLowerCase())) {
    userImpact = 'Program stops and expected output is not generated.';
  } else if (root && root !== execution) {
    userImpact = root.length > 160 ? `${root.slice(0, 157)}…` : root;
  } else if (opts.errorSummary && opts.errorSummary !== execution) {
    userImpact = opts.errorSummary;
  }
  const others = opts.otherFiles.filter((name) => name && name !== opts.fileLabel);
  const scope = others.length
    ? `Affects ${opts.fileLabel} and related files (${others.slice(0, 3).join(', ')}${others.length > 3 ? '…' : ''}).`
    : `Affects the current file (${opts.fileLabel}).`;
  const badge = high
    ? `<span class="ax-sev-pill high">${iconSvg('warn')} High</span>`
    : `<span class="ax-sev-pill muted-pill">None</span>`;
  const rows = [
    execution
      ? `<div class="ax-impact-row">
          <span class="ax-impact-ico bad">${iconSvg('x')}</span>
          <div><strong>Execution Impact</strong><p>${escapeHtml(execution)}</p></div>
        </div>`
      : '',
    userImpact
      ? `<div class="ax-impact-row">
          <span class="ax-impact-ico soft">${iconSvg('user')}</span>
          <div><strong>User Impact</strong><p>${escapeHtml(userImpact)}</p></div>
        </div>`
      : '',
    `<div class="ax-impact-row">
      <span class="ax-impact-ico soft">${iconSvg('cube')}</span>
      <div><strong>Scope</strong><p>${escapeHtml(scope)}</p></div>
    </div>`,
  ].filter(Boolean).join('');
  return analysisRichSection({
    icon: 'chart',
    title: 'Impact',
    subtitle: 'Effect of this issue on your code, users, and system.',
    badgeHtml: badge,
    open: true,
    body: rows || '<p class="muted">No impact detail was returned.</p>',
  });
}

function recommendationsSectionHtml(opts: {
  summary: string;
  explanation: string;
  analyzedCode: string;
  correctedCode: string;
  hasCodeFix: boolean;
  startLine: number | null;
  errorLines: number[];
}): string {
  const base = opts.startLine && opts.startLine > 0 ? opts.startLine : 1;
  const hunks = opts.hasCodeFix ? collectCodeChangeHunks(opts.analyzedCode, opts.correctedCode) : [];
  const list: { title: string; detail: string; codeHtml?: string }[] = [];
  const analyzedLines = opts.analyzedCode.replace(/\r\n/g, '\n').split('\n');

  hunks.forEach((hunk, index) => {
    const beforeLine = hunk.beforeLines[0] || '';
    const afterLine = hunk.afterLines[0] || beforeLine;
    const lineNo = base + hunk.beforeStart;
    const described = describeFixFromDiff(
      beforeLine,
      afterLine,
      index === 0 ? opts.summary : '',
    );
    const title = hunks.length > 1
      ? `${described.title} (line ${lineNo})`
      : described.title;
    list.push({
      title,
      detail: described.detail || `Fix the issue at line ${lineNo}.`,
      codeHtml: renderHunkRedGreenHtml(hunk, base, index === 0 ? 'copy-fix' : undefined),
    });
  });

  // If no code fix hunks, still show the error line(s) in red so the user sees where the problem is.
  if (!list.length && opts.errorLines.length) {
    opts.errorLines.slice(0, 5).forEach((lineNo, index) => {
      const idx = lineNo - base;
      const code = idx >= 0 && idx < analyzedLines.length ? analyzedLines[idx] : '';
      const hunk: ChangeHunk = {
        beforeStart: Math.max(0, idx),
        afterStart: Math.max(0, idx),
        beforeLines: code ? [code] : [`(line ${lineNo})`],
        afterLines: [],
      };
      list.push({
        title: index === 0 && opts.summary.trim()
          ? opts.summary.trim().replace(/\.$/, '')
          : `Fix error at line ${lineNo}`,
        detail: opts.explanation.trim() || `Review line ${lineNo}.`,
        codeHtml: renderHunkRedGreenHtml(hunk, base, index === 0 ? 'copy-fix' : undefined),
      });
    });
  }

  if (!list.length && opts.summary.trim()) {
    list.push({
      title: opts.summary.trim().replace(/\.$/, ''),
      detail: opts.explanation.trim() && opts.explanation.trim() !== opts.summary.trim()
        ? opts.explanation.trim()
        : '',
    });
  }

  if (opts.hasCodeFix && list.length) {
    list.push({
      title: 'Run the file again',
      detail: 'Save the file and run it to verify the errors are resolved.',
    });
  }

  if (!list.length) {
    return analysisRichSection({
      icon: 'lightbulb',
      title: 'Recommendations',
      subtitle: 'Simple steps to resolve this issue.',
      badgeHtml: '<span class="ax-sev-pill muted-pill">0 Steps</span>',
      open: true,
      body: '<p class="muted">No recommendations were returned.</p>',
    });
  }

  const body = list.map((step, index) => `<div class="ax-rec-step">
      <span class="ax-rec-num">${index + 1}</span>
      <div class="ax-rec-copy">
        <strong>${escapeHtml(step.title)}</strong>
        ${step.detail ? `<p>${escapeHtml(step.detail)}</p>` : ''}
        ${step.codeHtml || ''}
      </div>
    </div>`).join('');
  return analysisRichSection({
    icon: 'lightbulb',
    title: 'Recommendations',
    subtitle: 'Simple steps to resolve this issue.',
    badgeHtml: `<span class="ax-sev-pill ok">${iconSvg('check')} ${list.length} Step${list.length === 1 ? '' : 's'}</span>`,
    open: true,
    body,
  });
}

/** Secondary issues found in the analyzed snippet itself (not the primary Brain error). */
function scanLocalRelatedIssues(
  code: string,
  fileName: string,
  startLine: number | null,
  primaryError: string,
): RelatedFinding[] {
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  if (!lines.length || (lines.length === 1 && !lines[0])) {
    return [];
  }
  const base = startLine && startLine > 0 ? startLine : 1;
  const primary = primaryError.toLowerCase();
  const findings: RelatedFinding[] = [];
  const assigned = new Map<string, number>();
  const importNames = new Map<string, number>();

  lines.forEach((raw, index) => {
    const line = raw;
    const lineNo = base + index;
    const importMatch = /^\s*(?:from\s+\S+\s+)?import\s+(.+)$/.exec(line);
    if (importMatch) {
      importMatch[1].split(',').forEach((part) => {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim().split('.')[0];
        if (name && /^[A-Za-z_][\w]*$/.test(name)) {
          importNames.set(name, lineNo);
        }
      });
    }
    const assign = /^\s*([A-Za-z_][\w]*)\s*=\s*(.+)$/.exec(line);
    if (assign && !/^(if|for|while|def|class|return|import|from)\b/.test(assign[1])) {
      assigned.set(assign[1], lineNo);
    }
    const concat = /(["'])(?:\\.|(?!\1).)*\1\s*\+\s*\d|\d\s*\+\s*(["'])(?:\\.|(?!\2).)*\2/.test(line);
    if (concat && !/syntax/.test(primary)) {
      findings.push({
        title: 'String concatenation type issue',
        location: `${fileName} • Line ${lineNo}`,
        severity: 'Low',
      });
    }
  });

  const full = lines.join('\n');
  assigned.forEach((lineNo, name) => {
    const re = new RegExp(`\\b${name}\\b`, 'g');
    const matches = full.match(re) || [];
    if (matches.length <= 1 && !/syntax|unused/.test(primary)) {
      findings.push({
        title: 'Unused variable',
        location: `${fileName} • Line ${lineNo}`,
        severity: 'Low',
      });
    }
  });
  importNames.forEach((lineNo, name) => {
    const re = new RegExp(`\\b${name}\\b`, 'g');
    const matches = full.match(re) || [];
    if (matches.length <= 1) {
      findings.push({
        title: 'Unused import',
        location: `${fileName} • Line ${lineNo}`,
        severity: 'Low',
      });
    }
  });

  return findings.slice(0, 5);
}

function buildRelatedFindings(opts: {
  result: AnalyzeResult;
  history: HistoryEntry[];
  fileLabel: string;
  sessionId: string;
  startLine: number | null;
}): RelatedFinding[] {
  const out: RelatedFinding[] = [];
  const seen = new Set<string>();
  const push = (item: RelatedFinding) => {
    const key = `${item.title}|${item.location}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(item);
  };

  const primary = `${opts.result.error_type} ${opts.result.error_summary} ${opts.result.root_cause}`.toLowerCase();

  for (const item of opts.result.evidence) {
    const title = (item.kind || item.detail || '').trim();
    if (!title) {
      continue;
    }
    const kind = (item.kind || '').toLowerCase();
    if (kind && primary.includes(kind.replace(/_/g, ' '))) {
      continue;
    }
    const loc = (item.location || '').trim();
    const fileFromLoc = loc.includes(':') ? loc.split(':')[0] : (loc || opts.fileLabel);
    const linePart = /:(\d+)/.exec(loc);
    const location = linePart
      ? `${fileFromLoc.split(/[/\\]/).pop()} • Line ${linePart[1]}`
      : (fileFromLoc.split(/[/\\]/).pop() || opts.fileLabel);
    push({
      title: (item.kind || 'Evidence').replace(/_/g, ' '),
      location,
      severity: /error|syntax|critical/i.test(item.kind || item.detail) ? 'High' : 'Medium',
      evidenceLocation: loc || undefined,
    });
  }

  for (const local of scanLocalRelatedIssues(
    opts.result.code_snippet || '',
    opts.fileLabel,
    opts.startLine,
    primary,
  )) {
    push(local);
  }

  // Other history findings in different files (same project when known) — skip bare session ids.
  for (const entry of opts.history) {
    if (entry.sessionId === opts.sessionId) {
      continue;
    }
    if (opts.result.project_name && entry.projectName && entry.projectName !== opts.result.project_name) {
      continue;
    }
    const entryFile = (entry.fileName || '').split(/[/\\]/).pop() || entry.fileName;
    if (!entryFile || entryFile === opts.fileLabel) {
      continue;
    }
    const title = (entry.errorType || entry.errorSummary || '').trim();
    if (!title) {
      continue;
    }
    push({
      title: title.replace(/_/g, ' '),
      location: entry.errorType && entry.errorSummary
        ? `${entryFile} • ${entry.errorSummary}`
        : entryFile,
      severity: entry.errorType ? 'Medium' : 'Low',
      sessionId: entry.sessionId,
    });
    if (out.length >= 8) {
      break;
    }
  }

  return out.slice(0, 8);
}

function relatedIssuesSectionHtml(findings: RelatedFinding[]): string {
  const count = findings.length;
  const badge = `<span class="ax-sev-pill muted-pill">${count} found</span>`;
  if (!count) {
    return analysisRichSection({
      icon: 'link',
      title: 'Related Issues',
      subtitle: 'Other issues in your codebase that may be related.',
      badgeHtml: badge,
      open: false,
      body: '<p class="muted">No related issues were found in this analysis or history.</p>',
    });
  }
  const body = findings.map((item) => {
    const sevClass = item.severity === 'High' ? 'high' : item.severity === 'Medium' ? 'medium' : 'low';
    const ico = item.severity === 'Low' ? 'help' : 'warn';
    const action = item.sessionId
      ? `<button type="button" class="ax-related-go" data-session="${escapeHtml(item.sessionId)}" title="Open">${iconSvg('chevron-right')}</button>`
      : item.evidenceLocation
        ? `<button type="button" class="ax-related-go" data-location="${escapeHtml(item.evidenceLocation)}" title="Open">${iconSvg('chevron-right')}</button>`
        : `<span class="ax-related-go muted">${iconSvg('chevron-right')}</span>`;
    return `<div class="ax-related-row">
      <span class="ax-related-ico ${sevClass}">${iconSvg(ico)}</span>
      <div class="ax-related-copy">
        <strong>${escapeHtml(item.title)}</strong>
        <p class="muted">${escapeHtml(item.location)}</p>
      </div>
      <span class="ax-sev-pill ${sevClass}">${escapeHtml(item.severity)}</span>
      ${action}
    </div>`;
  }).join('');
  return analysisRichSection({
    icon: 'link',
    title: 'Related Issues',
    subtitle: 'Other issues in your codebase that may be related.',
    badgeHtml: badge,
    open: true,
    body,
  });
}

function analysisMetaBar(view: InvestigationView, result: AnalyzeResult): string {
  const workflow = workflowOf(view);
  const rawName = (view.analysis.localPath || result.file_name || 'file').replace(/\\/g, '/');
  const fileName = rawName.split('/').pop() || rawName;
  const lines = view.analysis.startLine
    ? `Lines ${view.analysis.startLine}–${view.analysis.endLine ?? view.analysis.startLine}`
    : 'No line range';
  const fixLabel = workflow.state === 'none'
    ? 'No fix proposed'
    : workflow.state === 'proposed'
      ? 'Fix Proposed'
      : `Fix ${workflowLabel(workflow.state)}`;
  const fixClass = workflow.state === 'none' ? 'muted' : 'ok';
  const langLabel = languageDisplayName((result.language || '').trim(), fileName);
  const brand = fileTypeLogoSvg(fileName, 14);
  return `<div class="ax-meta">
    <span class="ax-pill file">${iconSvg('doc')}<span>${escapeHtml(fileName)}</span></span>
    <span class="ax-meta-text">${escapeHtml(lines)}</span>
    <span class="ax-pill ${fixClass}">${escapeHtml(fixLabel)}</span>
    <span class="ax-pill lang">${brand || iconSvg('code')}<span>${escapeHtml(langLabel)}</span></span>
  </div>`;
}

function analysisPanel(view: InvestigationView): string {
  const intro = statusBlock(
    view.analysis.status,
    view.analysis.error,
    'No analysis yet. Use Analyze Current File or Find Bugs.',
  );
  const result = view.analysis.result;
  const head = `<div class="content-head">
      <div class="title-with-icon">${iconSvg('analysis-doc')}
        <div>
          <h2>Code Analysis</h2>
          <p class="sub">AI-powered static and runtime analysis.</p>
        </div>
      </div>
    </div>`;

  if (view.analysis.status !== 'ready' || !result) {
    return `${head}${intro}`;
  }

  const correction = result.suggested_correction;
  const correctedCode = (correction?.corrected_code || '').trim();
  const diff = correctedCode && looksLikeCode(correctedCode)
    ? suggestionDiff(result.code_snippet || '', correction.corrected_code, correction.diff_unified)
    : null;
  const verify = workflowOf(view).state === 'applied' || workflowOf(view).state === 'verification-failed'
    ? `<div class="row-gap">
         <button type="button" id="verify-run">Run file to verify</button>
         <button type="button" id="verify-tests">Run tests to verify</button>
       </div>`
    : '';

  const suggestionsIntro = view.suggestions.status === 'loading' || view.suggestions.status === 'error'
    ? statusBlock(view.suggestions.status, view.suggestions.error, '')
    : '';

  const rawErrorType = (result.error_type || '').trim();
  const errorType = /^(none|null|n\/a|undefined|ok|clean|no[_\s-]?error|-)$/i.test(rawErrorType) ? '' : rawErrorType;
  const errorSummary = (result.error_summary || '').trim();
  const rootCause = (result.root_cause || '').trim();
  const impactDetail = (result.verification?.detail || '').trim();
  const recommendation = (correction?.summary || result.explanation || '').trim();
  const fileLabel = (view.analysis.localPath || result.file_name || 'file').replace(/\\/g, '/').split('/').pop() || 'file';
  const cleanSummary = looksLikeNoIssue(errorSummary) || looksLikeNoIssue(rawErrorType);
  const namedIssue = Boolean(errorType && !cleanSummary) || Boolean(errorSummary && !cleanSummary);

  const findingHead = namedIssue
    ? `<div class="ax-error-card">
        <div class="ax-error-top">
          <span class="ax-warn-ico">${iconSvg('warn')}</span>
          <span class="ax-sev">High Severity</span>
        </div>
        <h3>${escapeHtml(errorType || 'Finding')}</h3>
        <p>${escapeHtml(errorSummary || 'No error summary was returned.')}</p>
        <p class="muted">${escapeHtml(fileLabel)}${result.session_id ? ` · ${escapeHtml(result.session_id)}` : ''}</p>
      </div>`
    : `<div class="ax-neutral-card ax-ok-card">
        <span class="badge-ok">No error found</span>
        <h3>Code looks correct</h3>
        <p class="muted">${escapeHtml(cleanSummary ? errorSummary : 'No issues were reported for this file.')}</p>
        <p class="muted">${escapeHtml(fileLabel)}${result.session_id ? ` · ${escapeHtml(result.session_id)}` : ''}</p>
      </div>`;

  const fixExplanation = (result.explanation || rootCause || '').trim();
  const correctedForFix = correction?.corrected_code || '';
  const hasCodeFix = Boolean(correctedForFix.trim())
    && looksLikeCode(correctedForFix)
    && correctedForFix.trim() !== (result.code_snippet || '').trim();
  const errorLines = errorLineNumbersFromAnalysis({
    startLine: view.analysis.startLine,
    evidence: result.evidence,
    analyzed: result.code_snippet || '',
    corrected: hasCodeFix ? correctedForFix : '',
    errorSummary,
    rootCause,
    explanation: (result.explanation || '').trim(),
  });
  const evidenceStart = view.analysis.startLine && view.analysis.startLine > 0
    ? view.analysis.startLine
    : 1;
  const evidenceBody = problematicEvidenceHtml({
    code: result.code_snippet || '',
    errorLines,
    startLine: evidenceStart,
    fileLabel,
  });
  const fixSection = suggestedFixCard({
    analyzedCode: result.code_snippet || '',
    correctedCode: correctedForFix,
    summary: (correction?.summary || '').trim(),
    explanation: fixExplanation,
    fileName: fileLabel,
    language: result.language || 'python',
    // Prefer LCS line hunks; only pass Brain unified diffs with @@ (handled inside).
    diffText: diff?.source === 'brain' ? (diff.text ?? null) : null,
    diffSource: diff?.source ?? null,
    startLine: view.analysis.startLine,
    endLine: view.analysis.endLine,
    applyMode: correction?.apply_mode || 'review_and_copy',
    verifyHtml: verify,
    fixApplied: workflowOf(view).state === 'applied' || workflowOf(view).state === 'verification-failed',
  });

  return `${head}
    ${analysisMetaBar(view, result)}
    ${view.stale || workflowOf(view).state === 'stale'
      ? '<div class="banner warn">This analysis describes code from before the latest edit.</div>'
      : ''}
    ${suggestionsIntro}
    ${findingHead}

    <section class="ax-root-cause">
      <div class="ax-root-head">
        <span class="ax-ico">${iconSvg('gear')}</span>
        <span class="ax-title">Root Cause</span>
      </div>
      <p>${rootCause ? escapeHtml(rootCause) : '<span class="muted">No root cause was returned.</span>'}</p>
    </section>
    ${analysisAccordion({
      icon: 'code-brace',
      title: 'Evidence',
      open: true,
      body: evidenceBody,
    })}
    ${impactSectionHtml({
      errorType,
      errorSummary,
      impactDetail,
      explanation: (result.explanation || '').trim(),
      rootCause,
      fileLabel,
      otherFiles: [],
    })}
    ${recommendationsSectionHtml({
      summary: recommendation,
      explanation: fixExplanation,
      analyzedCode: result.code_snippet || '',
      correctedCode: correctedForFix,
      hasCodeFix,
      startLine: view.analysis.startLine,
      errorLines,
    })}

    ${fixSection}
    ${view.suggestions.performance
      ? `<div class="note-card"><strong>Estimated complexity</strong><p class="muted">Estimate only — not a measured speedup.${view.suggestions.performance.basisLabel ? ` Basis: ${escapeHtml(view.suggestions.performance.basisLabel)}.` : ''}</p><p>Time ${escapeHtml(view.suggestions.performance.time)} ${escapeHtml(view.suggestions.performance.timeLabel)} · space ${escapeHtml(view.suggestions.performance.space)} ${escapeHtml(view.suggestions.performance.spaceLabel)}</p></div>`
      : ''}
    ${view.suggestions.optimize
      ? `<div class="note-card"><strong>Optimization note</strong><p class="muted">Estimate only — not a measured speedup.</p><p>${escapeHtml(view.suggestions.optimize.currentTime)} → ${escapeHtml(view.suggestions.optimize.optimizedTime)}</p></div>`
      : ''}`;
}

function executionPanel(view: InvestigationView): string {
  const intro = statusBlock(view.execution.status, view.execution.error, 'No execution yet. Run the current file from here or the command palette.');
  const result = view.execution.view;
  const duration = result?.durationMs != null ? `${(result.durationMs / 1000).toFixed(2)}s` : '';
  const runtime = (view.analysis.result?.language || 'python').toLowerCase();
  return `<div class="content-head row">
      <div class="title-with-icon">${iconSvg('run')}
        <div>
          <h2>Run Current File</h2>
          <p class="sub">Execute the active file and see the output.</p>
        </div>
      </div>
      <div class="run-controls">
        <button type="button" class="icon-btn play" id="run-file" title="Run File">${iconSvg('run')}</button>
        <span class="runtime-chip">${escapeHtml(runtime)}</span>
        <button type="button" class="btn-primary" id="run-file-cta">Run File</button>
      </div>
    </div>
    ${sourceChip(view)}
    ${intro}
    ${result && view.execution.status === 'ready' ? `
      <div class="run-result ${result.success ? 'ok' : 'fail'}">
        <div class="run-top">
          <span class="badge-${result.success ? 'ok' : 'error'}">${result.success ? 'Passed' : 'Failed'}</span>
          ${duration ? `<span class="muted">${escapeHtml(duration)}</span>` : ''}
          <span class="muted">exit ${result.exitCode}</span>
        </div>
        <p>${escapeHtml(result.headline)}</p>
        <div class="label">Terminal Output</div>
        <pre class="terminal">${escapeHtml(
          [result.stderr, result.stdout].filter(Boolean).join('\n') || result.headline,
        )}</pre>
      </div>
      <div class="note-card">
        <strong>Next Steps</strong>
        <ul>
          <li>Review the suggested fix on the Analysis tab.</li>
          <li>Add a guard for invalid inputs if the Brain recommended one.</li>
          <li>Re-run after Apply — Verified only when the run actually succeeds.</li>
        </ul>
      </div>` : ''}`;
}

function testCaseName(item: { id?: number; description: string; call: string | null }): string {
  const fallback = `test_case_${item.id ?? 0}`;
  const raw = (item.description || item.call || fallback).trim();
  if (/^test_[A-Za-z0-9_]+$/.test(raw)) {
    return raw.slice(0, 64);
  }
  let slug = raw
    .toLowerCase()
    .replace(/\(\s*\)/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) {
    return fallback;
  }
  if (!slug.startsWith('test_')) {
    slug = `test_${slug}`;
  }
  return slug.slice(0, 64);
}

function rawText(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(', ');
  }
  return '';
}

function caseModeLabel(item: { call: string | null; raw: Record<string, unknown> }): string {
  const mode = rawText(item.raw, 'mode').toLowerCase();
  if (mode === 'script') {
    return 'Script mode';
  }
  if (mode === 'function') {
    const target = rawText(item.raw, 'target') || rawText(item.raw, 'function_name');
    return target ? `Function mode · ${target}` : 'Function mode';
  }
  if (mode === 'clarification') {
    return 'Needs clarification';
  }
  return item.call ? 'Function mode' : 'Script mode';
}

function caseExpectedText(item: { raw: Record<string, unknown> }): string {
  const direct = rawText(item.raw, 'expected_result');
  if (direct) {
    return direct;
  }
  const exception = rawText(item.raw, 'expected_exception');
  if (exception) {
    return `Raises ${exception}`;
  }
  const stdout = item.raw.expected_stdout_contains;
  if (Array.isArray(stdout) && stdout.length) {
    return `Exit 0; stdout contains ${stdout.map((value) => JSON.stringify(String(value))).join(', ')}`;
  }
  const expected = item.raw.expected;
  if (expected !== undefined && expected !== null && expected !== '') {
    return `Returns ${typeof expected === 'string' ? expected : JSON.stringify(expected)}`;
  }
  return '';
}

function caseActualText(item: { raw: Record<string, unknown> }): string {
  return rawText(item.raw, 'actual_result') || rawText(item.raw, 'actual') || rawText(item.raw, 'stdout');
}

function statusLabel(status: string): string {
  const value = status.toLowerCase();
  switch (value) {
    case 'passed':
      return 'Passed';
    case 'failed':
      return 'Failed';
    case 'error':
      return 'Error';
    case 'skipped':
      return 'Skipped';
    case 'not_run':
      return 'Not Run';
    default: {
      const unreachable: string = value;
      return unreachable ? unreachable.replace(/_/g, ' ') : 'Not Run';
    }
  }
}

function testCaseBlurb(item: { description: string; call: string | null; status: string }): string {
  const desc = (item.description || '').trim();
  const call = (item.call || '').trim();
  const name = testCaseName(item);
  if (desc && desc !== name && !/^test_/.test(desc)) {
    return desc;
  }
  if (call && call !== name) {
    return call;
  }
  if (desc && desc !== name) {
    return desc;
  }
  return item.status && item.status !== 'not_run' ? item.status : 'Generated test case';
}

function coverageRing(percent: number): string {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const r = 34;
  const c = 2 * Math.PI * r;
  const offset = c - (p / 100) * c;
  return `<svg class="cov-ring" viewBox="0 0 80 80" aria-hidden="true">
    <circle class="cov-track" cx="40" cy="40" r="${r}" />
    <circle class="cov-fill" cx="40" cy="40" r="${r}"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" />
    <text x="40" y="44" text-anchor="middle" class="cov-pct">${p}%</text>
  </svg>`;
}

function caseFailed(status: string): boolean {
  const st = status.toLowerCase();
  return st.includes('fail') || st.includes('error');
}

function rawField(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === 'string' ? value.trim() : '';
}

function failedTestSuggestion(view: InvestigationView, run: TestRunView): string {
  if (!run.cases.some((item) => caseFailed(item.status || '') || rawText(item.raw, 'generation_defect'))) {
    return '';
  }
  const failed = run.cases.filter((item) => caseFailed(item.status || ''));
  const defectCases = failed.filter((item) => rawText(item.raw, 'generation_defect'));
  const userFailed = failed.filter((item) => !rawText(item.raw, 'generation_defect'));
  if (failed.length && !userFailed.length) {
    const lines = defectCases.slice(0, 8).map((item) => {
      const target = rawText(item.raw, 'target') || rawText(item.raw, 'function_name');
      return `<li><code>${escapeHtml(testCaseName(item))}</code><span>Generation defect${target ? `: target \`${escapeHtml(target)}\` does not exist in this source` : ''}. Regenerate tests from the actual source; this is not a bug in your code.</span></li>`;
    }).join('');
    return `<div class="tg-section tg-suggest">
      <h3>Generation defect</h3>
      <p class="tg-suggest-lead">The generated test selected a target that is not present in the analyzed source. No update to your code is suggested for this result.</p>
      <ul class="tg-fail-list">${lines}</ul>
    </div>`;
  }
  const failureLines = userFailed.slice(0, 8).map((item) => {
    const detail = rawField(item.raw, 'failure_reason') || rawField(item.raw, 'stderr') || rawField(item.raw, 'actual_result') || rawField(item.raw, 'actual');
    return `<li><code>${escapeHtml(testCaseName(item))}</code>${
      detail ? `<span>${escapeHtml(detail.slice(0, 240))}</span>` : ''
    }</li>`;
  }).join('');
  const result = view.analysis.result;
  const analyzed = result?.code_snippet || '';
  const summary = (result?.suggested_correction.summary || '').trim();
  const explanation = [result?.explanation || '', result?.root_cause || ''].filter(Boolean).join('\n\n');
  const corrected = resolveSuggestedCode(
    analyzed,
    result?.suggested_correction.corrected_code || '',
    explanation,
  );
  const hasFix = meaningfulCodeChange(analyzed, corrected, summary);
  const startLine = view.analysis.startLine && view.analysis.startLine > 0 ? view.analysis.startLine : 1;
  const fileLabel = (view.analysis.localPath || result?.file_name || 'the file').replace(/\\/g, '/').split('/').pop() || 'the file';
  const explain = hasFix
    ? (summary || 'Write this updated code so the failing cases pass.')
    : 'These cases failed. Analyze the file to get an updated version you can apply.';
  const codeBlock = hasFix
    ? `<div class="tg-suggest-code">${corrected.split('\n').map((line, index) => {
      const n = startLine + index;
      return `<div class="sfx-row add"><span class="sfx-ln">${n}</span><span class="sfx-mark">+</span><span class="sfx-code">${highlightCodeLineHtml(line)}</span></div>`;
    }).join('')}</div>
      <p class="tg-suggest-note">Apply Fix writes this code into ${escapeHtml(fileLabel)}, then runs all test cases.</p>
      <button type="button" class="btn-apply" id="apply-fix-tests">${iconSvg('wrench')}<span>Apply Fix</span></button>`
    : '';
  return `<div class="tg-section tg-suggest">
    <h3>Suggested update</h3>
    <p class="tg-suggest-lead">${escapeHtml(explain)}</p>
    ${failureLines ? `<ul class="tg-fail-list">${failureLines}</ul>` : ''}
    ${codeBlock}
  </div>`;
}

function testsPanel(view: InvestigationView): string {
  const banner = view.tests.status === 'loading' || view.tests.status === 'error'
    ? statusBlock(view.tests.status, view.tests.error, '')
    : '';
  const generated = view.tests.generated;
  const run = view.tests.run;
  const fileLabel = (view.tests.fileName || view.tests.localPath || view.analysis.localPath || 'file')
    .replace(/\\/g, '/')
    .split('/')
    .pop() || 'file';
  const langToken = (generated?.language || run?.language || languageFromFileName(fileLabel) || (view.analysis.result?.language || '').trim());
  const langLabel = languageDisplayName(langToken, fileLabel);
  const langLogo = fileTypeLogoSvg(fileLabel, 14);
  const lines = view.analysis.startLine
    ? `Lines ${view.analysis.startLine}–${view.analysis.endLine ?? view.analysis.startLine}`
    : 'Active file';

  const meta = `<div class="tg-meta">
    <span class="tg-pill">${iconSvg('doc')}<span>${escapeHtml(fileLabel)}</span></span>
    <span class="tg-sep" aria-hidden="true"></span>
    <span class="tg-pill lang">${langLogo || iconSvg('code')}<span>${escapeHtml(langLabel)}</span></span>
    <span class="tg-sep" aria-hidden="true"></span>
    <span class="tg-pill muted">${escapeHtml(lines)}</span>
    ${generated ? `<span class="tg-sep" aria-hidden="true"></span><span class="tg-pill muted">${escapeHtml(generated.mode === 'script' ? 'Script mode' : generated.mode === 'function' ? 'Function mode' : generated.mode === 'unsupported' ? 'Not supported' : 'Needs clarification')}${generated.target ? ` · ${escapeHtml(generated.target)}` : ''}</span>` : ''}
  </div>`;

  const displayCases = generated?.cases ?? [];
  const caseCount = displayCases.length;
  const caseList = caseCount
    ? `<ul class="tg-cases">${displayCases.map((item) => {
      const name = testCaseName({
        id: item.id,
        description: typeof item.raw.name === 'string' ? item.raw.name : item.description,
        call: item.call,
      });
      const blurb = testCaseBlurb(item);
      const expected = caseExpectedText(item);
      const defect = rawText(item.raw, 'generation_defect');
      const defectTarget = rawText(item.raw, 'target') || rawText(item.raw, 'function_name');
      return `<li class="tg-case">
        <label class="tg-check">
          <input type="checkbox" checked disabled aria-hidden="true" />
          <span class="tg-check-box">${iconSvg('check')}</span>
        </label>
        <div class="tg-case-copy">
          <code class="tg-case-name">${escapeHtml(name)}</code>
          <span class="tg-case-desc">${escapeHtml(blurb)}</span>
          <span class="tg-case-meta">${escapeHtml(caseModeLabel(item))} · ${escapeHtml(statusLabel(item.status))}</span>
          ${expected ? `<span class="tg-case-meta">Expected: ${escapeHtml(expected)}</span>` : ''}
          ${defect ? `<span class="tg-case-defect">Generation defect: ${escapeHtml(defect)}${defectTarget ? ` — target \`${escapeHtml(defectTarget)}\` does not exist in this source` : ''}. This is not a bug in your code.</span>` : ''}
        </div>
        <div class="tg-case-actions">
          <button type="button" class="tg-ico" data-run-tests="1" title="Run tests">${iconSvg('run')}</button>
          <span class="tg-ico muted" aria-hidden="true">${iconSvg('more')}</span>
        </div>
      </li>`;
    }).join('')}</ul>`
    : `<p class="tg-empty">${generated?.notice ? escapeHtml(generated.notice) : 'No generated cases yet. Click Generate Tests to analyze the source and create code-specific cases.'}</p>`;

  let resultsBlock = '';
  if (run) {
    const failed = run.counts.failed;
    const passed = run.counts.passed;
    const durationHint = run.log && /(\d+(?:\.\d+)?)\s*s\b/i.exec(run.log);
    const duration = durationHint ? `${durationHint[1]}s` : '';
    const rows = (run.cases.length ? run.cases : generated?.cases || []).map((item) => {
      const st = (item.status || 'not_run').toLowerCase();
      const isPass = st === 'passed';
      const isFail = st === 'failed';
      const isError = st === 'error';
      const ico = isFail || isError
        ? `<span class="tg-result-ico fail">${iconSvg('x')}</span>`
        : isPass
          ? `<span class="tg-result-ico ok">${iconSvg('check')}</span>`
          : `<span class="tg-result-ico pending">•</span>`;
      const expected = caseExpectedText(item);
      const actual = caseActualText(item);
      const reason = rawText(item.raw, 'failure_reason');
      const defect = rawText(item.raw, 'generation_defect');
      const target = rawText(item.raw, 'target') || rawText(item.raw, 'function_name');
      const durationMs = typeof item.raw.duration_ms === 'number' ? item.raw.duration_ms : null;
      const time = durationMs !== null ? `${durationMs} ms` : '';
      return `<li class="tg-result">
        ${ico}
        <div class="tg-result-main">
          <div class="tg-result-top">
        <code>${escapeHtml(testCaseName(item))}</code>
            <span class="tg-result-status ${isPass ? 'pass' : isFail || isError ? 'fail' : 'muted'}">${escapeHtml(statusLabel(st))}</span>
            ${time ? `<span class="tg-result-time">${escapeHtml(time)}</span>` : ''}
          </div>
          <span class="tg-result-meta">${escapeHtml(caseModeLabel(item))}</span>
          ${expected ? `<span class="tg-result-meta">Expected: ${escapeHtml(expected)}</span>` : ''}
          ${actual ? `<span class="tg-result-meta">Actual: ${escapeHtml(actual.slice(0, 240))}</span>` : ''}
          ${reason ? `<span class="tg-result-reason">${escapeHtml(reason.slice(0, 240))}</span>` : ''}
          ${defect ? `<span class="tg-case-defect">Generation defect${target ? `: target \`${escapeHtml(target)}\` does not exist in this source` : ''}. This is not a bug in your code.</span>` : ''}
        </div>
      </li>`;
    }).join('');
    resultsBlock = `<div class="tg-section">
      <div class="tg-section-head">
        <h3>Test Results</h3>
        <div class="tg-result-badges">
          <span class="tg-badge fail">${failed} Failed</span>
          <span class="tg-badge fail">${run.counts.error ?? 0} Error</span>
          <span class="tg-badge pass">${passed} Passed</span>
          <span class="tg-badge muted">${run.counts.skipped ?? 0} Skipped</span>
          <span class="tg-badge muted">${run.counts.not_run} Not Run</span>
          ${duration ? `<span class="tg-duration">${iconSvg('clock')}<span>${escapeHtml(duration)}</span></span>` : ''}
        </div>
      </div>
      <ul class="tg-results">${rows}</ul>
    </div>`;
  }

  let coverageBlock = '';
  if (run && run.counts.total > 0) {
    const evaluated = run.counts.passed + run.counts.failed;
    const passRate = run.passRatePercent !== null
      ? Math.round(run.passRatePercent)
      : evaluated > 0
        ? Math.round((run.counts.passed / evaluated) * 100)
        : 0;
    const coverage = run.coverage || { status: 'unavailable', measured: false, percent: null, reason: 'Coverage instrumentation was not reported by the runner.', coveredLines: null, totalLines: null };
    const measured = coverage.measured && coverage.percent !== null;
    const allPassed = run.counts.total > 0 && run.counts.passed === run.counts.total;
    const lineSummary = measured && coverage.coveredLines !== null && coverage.totalLines !== null
      ? `<div class="tg-coverage-sub">Covered lines: ${coverage.coveredLines} of ${coverage.totalLines} executable lines${allPassed ? ' · all tests passed' : ''}.</div>`
      : '';
    coverageBlock = `<div class="tg-section">
      <h3>Coverage${allPassed && measured ? ' · 100% tests passed' : ''}</h3>
      <div class="tg-coverage">
        ${measured ? coverageRing(coverage.percent as number) : ''}
        <div class="tg-coverage-copy">
          <div class="tg-coverage-title">${measured ? `Line Coverage ${Math.round(coverage.percent as number)}%` : 'Coverage unavailable'}</div>
          <div class="tg-coverage-sub">${measured ? escapeHtml(coverage.reason || 'Measured by coverage instrumentation.') : escapeHtml(coverage.reason)}</div>
          ${lineSummary}
          <div class="tg-coverage-sub">Test pass rate: ${passRate}% (${run.counts.passed} passed, ${run.counts.failed} failed, ${run.counts.error ?? 0} error, ${run.counts.skipped ?? 0} skipped). Pass rate is not line coverage.</div>
          ${measured ? `<div class="tg-coverage-bar" role="img" aria-label="Line coverage ${Math.round(coverage.percent as number)} percent"><span style="width:${Math.round(coverage.percent as number)}%"></span></div>` : ''}
        </div>
      </div>
    </div>`;
  }

  return `<div class="tg-scroll">
    <div class="tg-head">
      <span class="tg-head-ico">${iconSvg('grid')}</span>
      <div>
        <h2>Test Generation</h2>
        <p class="sub">Generate and run unit tests for this file.</p>
      </div>
    </div>
    ${meta}
    <button type="button" class="tg-primary" data-gen-tests="1">${iconSvg('tests')} Generate Tests</button>
    ${banner}
    <div class="tg-section">
      <h3>Generated Tests${caseCount ? ` (${caseCount})` : ''}</h3>
      <div class="tg-card">${caseList}</div>
    </div>
    ${resultsBlock}
    ${run && (run.counts.failed > 0 || run.counts.error > 0 || run.cases.some((item) => rawText(item.raw, 'generation_defect'))) ? failedTestSuggestion(view, run) : ''}
    ${coverageBlock}
  </div>`;
}

function historySeverity(item: HistoryEntry): 'err' | 'warn' | 'ok' | 'fatal' {
  const type = (item.errorType || '').toLowerCase();
  const blob = `${item.errorType} ${item.status} ${item.verificationStatus} ${item.errorSummary}`.toLowerCase();
  if (
    blob.includes('pass')
    || blob.includes('success')
    || blob.includes('verified')
    || blob.includes('optim')
    || blob.includes('test generation')
    || type.includes('ok')
  ) {
    return 'ok';
  }
  if (type.includes('syntax') || type.includes('typeerror') || type === 'type error' || type.includes('type error')) {
    return 'fatal';
  }
  if (
    blob.includes('warn')
    || blob.includes('stale')
    || blob.includes('hypothesis')
    || type.includes('index')
    || type.includes('import')
    || type.includes('attribute')
  ) {
    return 'warn';
  }
  return 'err';
}

function formatHistoryWhen(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return 'time not returned';
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    return trimmed;
  }
  try {
    return new Date(ms).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).replace(',', '');
  } catch {
    return trimmed;
  }
}

function historyPanel(view: InvestigationView): string {
  const history = view.history;
  const more = history.total !== null && history.items.length < history.total
    ? '<button type="button" class="tg-secondary" id="history-more">Load more</button>'
    : '';
  const rows = history.items.length
    ? `<ul class="history-list">${history.items.map((item) => {
      const sev = historySeverity(item);
      const ico = sev === 'ok'
        ? iconSvg('check')
        : sev === 'fatal'
          ? iconSvg('x')
          : iconSvg('warn');
      const title = (item.errorType || '').trim() || 'Investigation';
      const when = formatHistoryWhen(item.createdAt);
      const summary = (item.errorSummary || item.rootCause || '').trim();
      return `<li>
        <button type="button" class="history-row" data-session="${escapeHtml(item.sessionId)}">
          <span class="hist-status ${sev}">${ico}</span>
          <span class="hist-body">
            <span class="hist-title-row">
              <strong>${escapeHtml(title)}</strong>
              <span class="hist-when">${escapeHtml(when)}</span>
            </span>
            <span class="hist-file">${escapeHtml(item.fileName || 'file')}</span>
            ${summary ? `<span class="hist-sum">${escapeHtml(summary)}</span>` : ''}
          </span>
          <span class="hist-more" aria-hidden="true">${iconSvg('more')}</span>
        </button>
      </li>`;
    }).join('')}</ul>`
    : '';
  const empty = history.status === 'ready' && history.items.length === 0
    ? '<p class="hist-empty">The Brain returned no investigations.</p>'
    : '';
  const state = history.status === 'loading' || history.status === 'error'
    ? statusBlock(history.status, history.error, '')
    : history.status === 'empty'
      ? '<p class="hist-empty">Sign in and refresh to load investigations.</p>'
      : '';

  return `<div class="hist-scroll">
    <div class="hist-head">
      <span class="hist-head-ico">${iconSvg('settings')}</span>
      <div>
        <h2>Investigation History</h2>
        <p class="sub">Your recent analysis and debugging sessions.</p>
      </div>
    </div>
    <div class="history-toolbar">
      <div class="search-bar">
        ${iconSvg('search')}
        <input id="history-query" type="text" maxlength="200" placeholder="Search history..." value="${escapeHtml(history.query)}" />
      </div>
      <button type="button" class="hist-filter" id="history-refresh" title="Refresh">${iconSvg('filter')}</button>
    </div>
    ${state}${empty}${rows}
    ${history.total === null ? '' : `<p class="hist-count">${history.items.length} of ${history.total}</p>`}
    ${more}
    <div class="history-footer">
      <button type="button" id="history-clear">${iconSvg('trash')} Clear History</button>
    </div>
  </div>`;
}

function panelCss(): string {
  return `
    html, body {
      width: 100%; max-width: 100%; height: 100%; margin: 0; padding: 0;
      overflow: hidden; background: var(--bg); color: var(--text);
      font-family: var(--font); font-size: 13px;
    }
    .shell {
      width: 100%; max-width: 100%; height: 100%; min-width: 0; min-height: 0;
      display: flex; flex-direction: column; overflow: hidden; background: var(--bg);
    }
    .chrome {
      flex-shrink: 0; width: 100%; max-width: 100%; min-width: 0; overflow: hidden;
      background: var(--bg); border-bottom: 1px solid var(--border);
    }
    .titlebar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px 0; min-width: 0;
    }
    .titlebar-left { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--muted); }
    .titlebar-history {
      border: none; background: transparent; color: var(--muted);
      font-size: 12px; font-weight: 650; letter-spacing: 0.01em;
      padding: 4px 2px; cursor: pointer; white-space: nowrap;
    }
    .titlebar-history:hover { color: var(--text); }
    .titlebar-name {
      font-size: 13px; font-weight: 700; letter-spacing: 0.02em; color: var(--text);
    }
    .titlebar-actions { display: flex; align-items: center; gap: 2px; }
    .chrome-row {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px 8px; width: 100%; min-width: 0;
    }
    .product { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
    .product-logo { display: grid; place-items: center; flex-shrink: 0; }
    .product-logo svg { width: 32px; height: 32px; display: block; }
    .product-copy { min-width: 0; overflow: hidden; }
    .product-title {
      font-size: 18px; font-weight: 800; letter-spacing: -0.03em;
      color: var(--text); line-height: 1.1; white-space: nowrap;
    }
    .product-sub {
      margin-top: 2px; font-size: 11px; color: var(--muted); font-weight: 500;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .online-pill {
      display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
      padding: 4px 10px; border-radius: 999px;
      background: var(--card); border: 1px solid var(--border);
      font-size: 11px; font-weight: 650; color: var(--green); white-space: nowrap;
    }
    .online-pill.off { color: var(--red); }
    .online-dot {
      width: 7px; height: 7px; border-radius: 50%; background: var(--green);
      box-shadow: 0 0 8px rgba(34, 197, 94, 0.65);
    }
    .online-pill.off .online-dot { background: var(--red); box-shadow: none; }
    .icon-btn {
      width: 28px; height: 28px; display: grid; place-items: center; flex-shrink: 0;
      background: transparent; border: none; color: var(--muted);
      cursor: pointer; border-radius: 6px;
    }
    .icon-btn:hover { color: var(--text); background: var(--hover); }
    [role="tablist"] {
      display: none;
    }
    [role="tab"] {
      min-width: 0; width: 100%; border: none; border-radius: 0;
      background: transparent; color: var(--muted);
      padding: 8px 2px 10px; cursor: pointer; font-size: 10.5px; font-weight: 600;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
      overflow: hidden; position: relative;
    }
    [role="tab"] .tab-ico { display: grid; place-items: center; width: 16px; height: 16px; flex-shrink: 0; }
    [role="tab"] .tab-ico svg { width: 15px; height: 15px; }
    [role="tab"] .tab-label {
      min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    [role="tab"][aria-selected="true"] {
      background: transparent; color: var(--text);
    }
    [role="tab"][aria-selected="true"]::after {
      content: ''; position: absolute; left: 18%; right: 18%; bottom: 0; height: 2px;
      background: #FFFFFF; border-radius: 2px 2px 0 0;
    }
    .main-body {
      flex: 1; min-height: 0; min-width: 0; width: 100%; max-width: 100%;
      display: flex; flex-direction: column; overflow: hidden; background: var(--bg);
    }
    .main-body.tab-other {
      padding: 0; overflow: hidden; overflow-x: hidden;
    }
    .chat-scroll { flex: 1; min-height: 0; overflow: auto; padding: 14px 14px 8px; }
    .content-head { margin: 0 0 14px; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .content-head.row { align-items: center; }
    .title-with-icon { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
    .title-with-icon > svg { color: var(--text); margin-top: 2px; width: 18px; height: 18px; flex-shrink: 0; }
    .title-with-icon.warn > svg { color: var(--orange); }
    h2 { margin: 0; font-size: 18px; font-weight: 800; letter-spacing: -0.02em; color: var(--text); }
    h3 { margin: 0 0 8px; font-size: 14px; font-weight: 700; color: var(--text); }
    .sub { margin: 4px 0 0; color: var(--muted); font-size: 12.5px; }
    .muted { color: var(--muted); }
    .tiny { font-size: 11px; margin-top: 4px; }
    .empty, .empty-card {
      color: var(--muted); border: 1px dashed var(--border-strong); border-radius: var(--radius);
      padding: 14px; background: var(--card);
    }
    .empty-card strong { color: var(--text); display: block; margin-bottom: 4px; }
    .hero-scroll {
      display: flex; flex-direction: column; padding: 10px 18px 4px;
    }
    .hero {
      flex: 1; min-height: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; text-align: center;
      padding: 8px 4px 14px;
    }
    .hero-bot {
      width: min(78vw, 302px); max-width: 100%; line-height: 0;
      animation: heroFloat 5.2s ease-in-out infinite;
      filter: drop-shadow(0 14px 30px rgba(59, 130, 246, 0.28));
    }
    .hero-bot-svg { width: 100%; height: auto; display: block; }
    @keyframes heroFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-7px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .hero-bot { animation: none; }
    }
    .hero-name {
      margin: 14px 0 0; font-size: 42px; line-height: 1; font-weight: 850;
      letter-spacing: 0.015em;
      background: linear-gradient(92deg, #22D3EE 0%, #38BDF8 38%, #818CF8 68%, #C084FC 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: transparent;
    }
    .hero-platform {
      margin-top: 7px; font-size: 19px; line-height: 1.2; font-weight: 750; color: var(--text);
    }
    .hero-tagline {
      margin: 8px 0 0; font-size: 12.5px; line-height: 1.45; color: var(--muted);
    }
    .hero-rule {
      width: 56px; height: 3px; border-radius: 999px; margin-top: 16px;
      background: linear-gradient(90deg, #22D3EE, #818CF8, #C084FC);
    }
    .hero-hint {
      margin: 14px 0 0; max-width: 320px; font-size: 11.5px; line-height: 1.5; color: var(--muted-dim);
    }
    .banner {
      border-radius: var(--radius); padding: 10px 12px; margin: 10px 0;
      border: 1px solid var(--border); background: var(--card); color: var(--muted);
    }
    .banner.error { background: var(--red-soft); border-color: rgba(239,68,68,0.4); color: #ffb4ab; }
    .banner.warn { background: var(--orange-soft); border-color: rgba(245,165,36,0.4); color: #ffd89a; }
    .banner.info { background: var(--card); color: var(--muted); }
    .loading-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .btn-cancel {
      border: 1px solid rgba(239,68,68,0.55); background: transparent; color: var(--red);
      border-radius: 8px; padding: 6px 12px; cursor: pointer; font-weight: 700; font-size: 12px;
    }
    .source-chip {
      background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 10px 12px; margin-bottom: 12px; font-size: 12px; color: var(--muted);
    }
    .source-chip .sep { margin: 0 6px; opacity: 0.5; }
    .badge-error, .badge-ok {
      display: inline-flex; align-items: center; border-radius: 999px;
      padding: 2px 10px; font-size: 11px; font-weight: 700;
    }
    .badge-error { background: var(--red-soft); color: var(--red); }
    .badge-ok { background: var(--green-soft); color: var(--green); }
    .error-hero, .error-embed, .fix-box, .panel-card, .run-result, .note-card, .finding-card {
      background: var(--card); border: 1px solid var(--border); border-radius: 10px;
      padding: 14px; margin: 12px 0; max-width: 100%; min-width: 0;
    }
    .error-hero, .error-embed, .run-result.fail {
      background: var(--red-soft); border-color: rgba(239,68,68,0.45);
    }
    .run-result.ok { background: var(--green-soft); border-color: rgba(34,197,94,0.4); }
    .error-hero h3 { font-size: 18px; margin: 8px 0; }
    .fold {
      background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 8px 12px; margin: 8px 0;
    }
    .fold summary {
      cursor: pointer; font-weight: 650; list-style: none; display: flex; align-items: center; gap: 8px; color: var(--text);
    }
    .fold summary::-webkit-details-marker { display: none; }
    .fold summary::before {
      content: ''; width: 0; height: 0;
      border-left: 5px solid var(--muted); border-top: 4px solid transparent; border-bottom: 4px solid transparent;
    }
    details[open].fold summary::before {
      border-left: 4px solid transparent; border-right: 4px solid transparent;
      border-top: 5px solid var(--muted); border-bottom: none;
    }
    .count {
      background: var(--hover); color: var(--muted); border-radius: 999px;
      padding: 0 7px; font-size: 11px;
    }
    .code-panel, .code-pre, .diff, .terminal {
      background: var(--code); border: 1px solid var(--border); border-radius: 8px;
      padding: 10px; font-family: var(--mono); font-size: 12px;
      white-space: pre-wrap; word-break: break-word; max-width: 100%; overflow-x: auto;
    }
    .diff-add { display: block; color: #3fb950; background: rgba(63,185,80,0.12); margin: 0 -10px; padding: 0 10px; }
    .diff-del { display: block; color: #ff7b72; background: rgba(248,81,73,0.14); margin: 0 -10px; padding: 0 10px; }
    .terminal { background: var(--terminal); color: #ff7b72; }
    .code-row { display: grid; grid-template-columns: 36px 1fr; gap: 0; }
    .code-row .ln { color: var(--muted); padding: 2px 8px; text-align: right; user-select: none; opacity: 0.7; }
    .code-row code { display: block; padding: 2px 10px; white-space: pre; }
    .code-row.hot { background: rgba(239,68,68,0.16); }
    .code-row.hot .ln { color: var(--red); }
    .btn-primary, .btn-purple, .btn-ghost, button.mini, #copy-fix, #verify-run, #verify-tests, #history-refresh, #history-more, #history-clear {
      border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 12.5px;
    }
    .btn-primary, .btn-purple {
      border: 1px solid var(--border-strong); background: var(--hover); color: var(--text); padding: 9px 14px;
    }
    .btn-primary:hover, .btn-purple:hover { background: #2F2F2F; }
    .btn-primary.wide { width: 100%; margin-top: 8px; padding: 12px 16px; }
    .btn-ghost, button.mini, #copy-fix, #verify-run, #verify-tests, #history-refresh, #history-more {
      border: 1px solid var(--border); background: var(--card); color: var(--text); padding: 8px 12px;
    }
    .btn-ghost.compact { white-space: nowrap; flex-shrink: 0; }
    .row-gap { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .run-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .runtime-chip {
      border: 1px solid var(--border); background: var(--card); color: var(--muted);
      border-radius: 8px; padding: 7px 10px; font-size: 12px; font-weight: 600;
    }
    .icon-btn.play {
      width: 34px; height: 34px; border: 1px solid var(--border); background: var(--card); color: var(--text);
    }
    .text-link {
      background: none; border: none; color: var(--muted); cursor: pointer;
      padding: 0; margin-top: 8px; font-weight: 650; text-decoration: underline;
    }
    .thread { display: flex; flex-direction: column; gap: 16px; margin: 0 0 8px; }
    .msg { display: flex; gap: 10px; width: 100%; max-width: 100%; align-items: flex-start; }
    .msg.user { justify-content: flex-end; }
    .msg.bot { align-self: stretch; }
    .msg.user .msg-col { flex: 0 1 auto; max-width: 82%; display: flex; flex-direction: column; align-items: flex-end; }
    .msg.user .msg-bubble { background: #1E1E1E; border-radius: 14px 14px 4px 14px; }
    .msg.user .msg-time { margin-top: 4px; }
    .msg-avatar {
      width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
      display: grid; place-items: center; background: #1c1c1c; color: var(--muted);
      border: 1px solid var(--border);
      overflow: hidden;
    }
    .msg-avatar.user-av svg { width: 14px; height: 14px; }
    .msg-avatar.bot-av {
      background: #0c1924; overflow: hidden; padding: 0; border: 1px solid #1e3a4c;
    }
    .msg-avatar.bot-av img, .msg-avatar.bot-av svg {
      width: 32px; height: 32px; border-radius: 50%;
      object-fit: cover; object-position: center; display: block;
    }
    .msg-bubble {
      padding: 10px 12px; border-radius: 12px;
      background: var(--card); border: 1px solid var(--border);
    }
    .msg.user .msg-bubble { background: #1E1E1E; }
    .msg-col { flex: 1; min-width: 0; }
    .msg-meta { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
    .msg-meta strong { font-size: 13px; font-weight: 700; color: var(--text); }
    .msg-time { color: var(--muted); font-size: 11px; }
    .bot-lead { font-weight: 650; color: var(--text); margin: 2px 0 10px; font-size: 13px; }
    .chat-error-card {
      display: flex; gap: 10px; align-items: flex-start;
      padding: 12px; border-radius: 10px; margin-bottom: 12px;
      background: var(--red-soft); border: 1px solid rgba(239,68,68,0.4);
    }
    .chat-error-ico {
      width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
      background: var(--red); color: #fff; display: grid; place-items: center;
    }
    .chat-error-ico svg { width: 12px; height: 12px; }
    .chat-section-head {
      display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px;
      color: var(--text); margin: 4px 0 8px;
    }
    .chat-section-head svg { width: 14px; height: 14px; color: var(--muted); }
    .ok-mark {
      width: 22px; height: 22px; border-radius: 50%; background: var(--green); color: #04140a;
      display: grid; place-items: center; flex-shrink: 0;
    }
    .ok-mark svg { width: 12px; height: 12px; }
    .finding-title { font-weight: 700; font-size: 14px; color: var(--text); }
    .finding-sub { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
    .finding-body { margin: 0 0 10px; line-height: 1.55; color: var(--text); font-size: 12.5px; }
    .inline-code {
      display: inline; padding: 1px 6px; border-radius: 5px;
      background: var(--hover); color: #9CDCFE; font-family: var(--mono); font-size: 12px;
    }
    .chat-code {
      position: relative; margin: 0 0 12px; border-radius: 10px; overflow: hidden;
      background: #0A0A0A; border: 1px solid var(--border);
    }
    .chat-copy {
      position: absolute; top: 8px; right: 8px; z-index: 2;
      width: 28px; height: 28px; border: none; border-radius: 6px; cursor: pointer;
      background: transparent; color: var(--muted); display: grid; place-items: center;
    }
    .chat-copy:hover { color: var(--text); background: var(--hover); }
    .chat-code-body { margin: 0; padding: 10px 8px; font-family: var(--mono); font-size: 12px; max-height: 180px; overflow: auto; }
    .chat-code-row { display: flex; min-height: 20px; align-items: flex-start; }
    .chat-code-row.hot, .chat-code-row.err {
      background: rgba(248, 81, 73, 0.22); box-shadow: inset 3px 0 0 #F85149;
    }
    .chat-ln {
      width: 28px; flex-shrink: 0; text-align: right; padding-right: 10px;
      color: var(--muted-dim); user-select: none; font-variant-numeric: tabular-nums;
    }
    .chat-code-row.hot .chat-ln, .chat-code-row.err .chat-ln { color: #F85149; }
    .chat-src { flex: 1; padding-right: 36px; white-space: pre-wrap; word-break: break-word; color: #E6EDF3; }
    .chat-fix-card {
      margin-top: 4px; padding: 12px; border-radius: 10px;
      background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.35);
    }
    .fix-head { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 10px; }
    .chat-diff-wrap { position: relative; margin-bottom: 10px; }
    .chat-diff-wrap .diff {
      margin: 0; padding: 10px 12px; padding-top: 36px; border-radius: 8px;
      background: #0A0A0A; border: 1px solid var(--border);
    }
    .fix-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .btn-apply {
      border: none; border-radius: 9px; padding: 10px 12px; cursor: pointer;
      background: #E8E8E8; color: #111111; font-weight: 700; font-size: 13px;
    }
    .btn-view {
      border: 1px solid var(--border); border-radius: 9px; padding: 10px 12px; cursor: pointer;
      background: var(--card); color: var(--text); font-weight: 650; font-size: 13px;
    }
    .qa-block { flex-shrink: 0; padding: 4px 14px 8px; }
    .qa-title { font-size: 12px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
    .qa-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .qa-btn {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      border: 1px solid var(--border); background: var(--card); color: var(--text);
      border-radius: 10px; padding: 12px 10px; cursor: pointer; font-weight: 600; font-size: 12.5px;
    }
    .qa-btn:hover { background: var(--hover); }
    .qa-btn svg { width: 15px; height: 15px; color: var(--muted); flex-shrink: 0; }
    .composer-card, .composer-compact {
      margin: 0 12px 10px; padding: 6px 6px 6px 10px; border-radius: 14px;
      border: 1px solid var(--border); background: #161616; flex-shrink: 0;
      display: flex; align-items: center; gap: 4px;
      min-height: 46px; box-sizing: border-box;
    }
    .composer-ico {
      width: 28px; height: 28px; display: grid; place-items: center; flex-shrink: 0;
      border: none; background: transparent; color: var(--muted); border-radius: 8px; padding: 0;
    }
    button.composer-ico { cursor: pointer; }
    button.composer-ico:hover { color: var(--text); background: var(--hover); }
    .composer-ico svg { width: 16px; height: 16px; }
    .composer-card input, .composer-compact input {
      flex: 1; min-width: 0; border: none; background: transparent; color: var(--text);
      font-size: 12.5px; outline: none; padding: 4px 0; line-height: 1.25; height: 28px;
    }
    .composer-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .composer-bar-send { justify-content: flex-end; }
    .composer-left { display: flex; align-items: center; gap: 2px; min-width: 0; flex-wrap: wrap; }
    .scope-pill {
      display: inline-flex; align-items: center; gap: 4px; border-radius: 999px;
      border: 1px solid var(--border); background: var(--bg); color: var(--muted);
      padding: 4px 10px; cursor: pointer; font-size: 11.5px; font-weight: 600; margin-left: 4px;
    }
    .scope-pill svg { width: 12px; height: 12px; }
    .send {
      width: 32px; height: 32px; border: none; border-radius: 10px;
      background: #FFFFFF; color: #111111; display: grid; place-items: center; cursor: pointer; flex-shrink: 0;
    }
    .send svg { width: 13px; height: 13px; }
    .finding-ok { color: var(--green) !important; font-weight: 600; }
    .chat-ok-card {
      display: flex; align-items: flex-start; gap: 10px; margin: 8px 0 10px;
      padding: 12px 14px; border-radius: 10px;
      background: var(--green-soft); border: 1px solid rgba(34,197,94,0.45);
    }
    .chat-ok-ico {
      width: 28px; height: 28px; border-radius: 999px; flex-shrink: 0;
      display: grid; place-items: center; background: rgba(34,197,94,0.2); color: var(--green);
    }
    .chat-ok-ico svg { width: 14px; height: 14px; }
    .chat-ok-card .finding-title { color: var(--green); font-weight: 800; font-size: 14px; }
    .chat-ok-card .finding-sub { color: var(--text); font-size: 12.5px; margin-top: 2px; }
    .ok-note { margin-top: 8px; }
    .bot-face {
      border-radius: 8px; object-fit: contain; object-position: center; flex-shrink: 0;
      display: block; background: #0a0a0a;
      box-shadow: none; border: none;
    }
    .eyra-thinking .bot-face { width: 28px; height: 28px; }
    .typing { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 2px; }
    .md-block { margin: 0 0 8px; }
    .md-p { margin: 0 0 8px; line-height: 1.55; color: var(--text); font-size: 13px; }
    .md-list { margin: 0 0 10px; padding-left: 18px; color: var(--text); }
    .md-list li { margin: 4px 0; line-height: 1.45; }
    .md-code .ui-ev-ln { color: var(--muted-dim); border-right: 1px solid rgba(255,255,255,0.06); }
    .typing span {
      width: 7px; height: 7px; border-radius: 50%; background: #3B82F6;
      animation: eyra-dot 1.1s infinite ease-in-out;
    }
    .typing span:nth-child(2) { animation-delay: 0.15s; }
    .typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes eyra-dot {
      0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-2px); }
    }
    .ui-card {
      background: #141414; border: 1px solid var(--border); border-radius: 12px;
      padding: 12px; margin: 0 0 10px; min-width: 0;
    }
    .ui-card-head { display: flex; align-items: center; gap: 8px; color: var(--text); font-size: 13px; }
    .fix-applied-pill {
      margin-left: auto; color: var(--green); background: var(--green-soft);
      border: 1px solid rgba(34, 197, 94, 0.45); border-radius: 999px;
      padding: 2px 9px; font-size: 11px; font-weight: 700; white-space: nowrap;
    }
    .ui-card-ico {
      width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center;
      background: var(--hover); color: var(--muted); flex-shrink: 0;
    }
    .ui-card-ico svg { width: 13px; height: 13px; }
    .ui-card-sub, .ui-card-body { margin: 8px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
    .ui-card-body { color: var(--text); }
    .ui-error {
      background: linear-gradient(180deg, rgba(127, 29, 29, 0.55), rgba(69, 10, 10, 0.72));
      border-color: rgba(239, 68, 68, 0.45);
    }
    .ui-error-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ui-bang {
      width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
      background: #E11D48; color: #fff; display: grid; place-items: center;
    }
    .ui-bang svg { width: 13px; height: 13px; }
    .ui-error-name { font-weight: 800; color: #FB7185; font-size: 14px; }
    .ui-sev {
      border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 700;
      background: rgba(80, 10, 20, 0.55); color: #FECACA; border: 1px solid rgba(254, 202, 202, 0.25);
    }
    .ui-sev.med { color: #FDE68A; }
    .ui-error-meta { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
    .ui-filechip, .ui-linechip {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 11px; color: #FECACA; background: rgba(0,0,0,0.28);
      border-radius: 999px; padding: 3px 8px;
    }
    .ui-filechip svg { width: 12px; height: 12px; }
    .ui-error-title {
      margin-top: 10px; font-size: 14px; font-weight: 750; color: #fff; line-height: 1.4;
      overflow-wrap: break-word;
    }
    .ui-error-desc { margin: 6px 0 0; color: #FECDD3; font-size: 12.5px; line-height: 1.45; }
    .ui-evidence { margin: 10px 0 0; }
    .ui-ev-bar {
      display: flex; align-items: center; gap: 8px; padding: 8px 10px;
      background: #101010; border-bottom: 1px solid var(--border); font-size: 12px;
    }
    .ui-ev-file { display: inline-flex; align-items: center; gap: 6px; color: var(--text); min-width: 0; }
    .ui-ev-file svg { width: 14px; height: 14px; flex-shrink: 0; }
    .ui-ev-range { color: var(--muted); font-size: 11px; margin-left: auto; white-space: nowrap; }
    .ui-ev-copy.chat-copy {
      position: static; width: auto; height: auto; display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 6px; font-size: 11px; font-weight: 650;
    }
    .ui-ev-body { padding: 6px 0; max-height: 220px; overflow: auto; font-family: var(--mono); font-size: 12px; }
    .ui-ev-row { display: grid; grid-template-columns: 36px 1fr; min-height: 22px; }
    .ui-ev-row.hot { background: rgba(248, 81, 73, 0.28); box-shadow: inset 3px 0 0 #F85149; }
    .ui-ev-ln { text-align: right; padding: 2px 8px 2px 0; color: var(--muted); user-select: none; }
    .ui-ev-row.hot .ui-ev-ln { color: #F85149; }
    .ui-ev-code { padding: 2px 10px 2px 0; white-space: pre-wrap; word-break: break-word; }
    .ui-fix-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
    .ui-fix-actions .btn-apply {
      display: inline-flex; align-items: center; gap: 6px; border-radius: 10px; padding: 8px 12px;
    }
    .ui-fix-actions .btn-apply svg { width: 14px; height: 14px; }
    .ui-ghost-btn {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1px solid var(--border); background: #1A1A1A; color: var(--text);
      border-radius: 10px; padding: 8px 12px; cursor: pointer; font-weight: 650; font-size: 12.5px;
    }
    .ui-ghost-btn svg { width: 14px; height: 14px; }
    .ui-ghost-btn:hover { background: var(--hover); }
    .ui-full-diff { margin-top: 10px; }
    .ui-full-diff:not([open]) { display: none; }
    .ui-full-pre {
      margin: 0; max-height: 240px; overflow: auto;
      background: #0A0A0A; border: 1px solid var(--border); border-radius: 8px;
      padding: 6px 0; font-family: var(--mono); font-size: 12px;
    }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0,0,0,0); border: 0;
    }
    /* —— Test Generation (reference) —— */
    .tg-scroll, .hist-scroll {
      flex: 1; min-height: 0; overflow: auto; padding: 16px 14px 20px;
      display: flex; flex-direction: column; gap: 14px;
    }
    .tg-head, .hist-head {
      display: flex; align-items: flex-start; gap: 12px; margin-bottom: 2px;
    }
    .tg-head h2, .hist-head h2 {
      margin: 0; font-size: 18px; font-weight: 800; letter-spacing: -0.02em; color: var(--text);
    }
    .tg-head .sub, .hist-head .sub {
      margin: 4px 0 0; font-size: 12px; color: var(--muted); font-weight: 500;
    }
    .tg-head-ico, .hist-head-ico {
      width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
      display: grid; place-items: center;
      background: var(--card); border: 1px solid var(--border); color: var(--text);
    }
    .tg-head-ico svg, .hist-head-ico svg { width: 18px; height: 18px; }
    .tg-meta {
      display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
      padding: 10px 14px; border-radius: 10px;
      background: var(--card); border: 1px solid var(--border);
    }
    .tg-sep {
      width: 1px; height: 14px; background: var(--border-strong); flex-shrink: 0;
    }
    .tg-pill {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 600; color: var(--text);
    }
    .tg-pill svg { width: 14px; height: 14px; color: var(--muted); }
    .tg-pill.muted { color: var(--muted); font-weight: 500; }
    .tg-pill.lang svg, .tg-pill.lang img { width: 14px; height: 14px; }
    .tg-primary {
      width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;
      border: none; border-radius: 10px; padding: 13px 16px; cursor: pointer;
      background: #F0F0F0; color: #111111; font-size: 14px; font-weight: 750;
    }
    .tg-primary:hover { background: #FFFFFF; }
    .tg-primary svg { width: 18px; height: 18px; }
    .tg-secondary {
      width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
      border: 1px solid var(--border-strong); border-radius: 10px; padding: 11px 14px; cursor: pointer;
      background: transparent; color: var(--text); font-weight: 700; font-size: 13px;
    }
    .tg-secondary:hover { background: var(--hover); }
    .tg-suggest-lead { margin: 0; font-size: 12.5px; color: var(--text); line-height: 1.45; }
    .tg-fail-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .tg-fail-list li { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--muted); }
    .tg-fail-list code { color: #FCA5A5; font-family: var(--mono); font-size: 12px; }
    .tg-suggest-code {
      max-height: 280px; overflow: auto; border-radius: 10px;
      background: #0A0A0A; border: 1px solid rgba(34, 197, 94, 0.35);
    }
    .tg-suggest-note { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.4; }
    .tg-suggest .btn-apply {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
    }
    .tg-suggest .btn-apply svg { width: 14px; height: 14px; }
    .tg-section { display: flex; flex-direction: column; gap: 10px; }
    .tg-section h3 {
      margin: 0; font-size: 13px; font-weight: 750; color: var(--text); letter-spacing: 0.01em;
    }
    .tg-section-head {
      display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
    }
    .tg-headline { margin: 0; font-size: 12px; color: var(--muted); }
    .tg-card {
      background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden;
    }
    .tg-cases { list-style: none; margin: 0; padding: 0; }
    .tg-case {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 12px 12px; border-bottom: 1px solid var(--border);
    }
    .tg-case:last-child { border-bottom: none; }
    .tg-check { position: relative; width: 18px; height: 18px; flex-shrink: 0; margin-top: 2px; }
    .tg-check input { position: absolute; opacity: 0; pointer-events: none; }
    .tg-check-box {
      width: 18px; height: 18px; border-radius: 4px; display: grid; place-items: center;
      background: #FFFFFF; color: #111111; border: 1px solid #FFFFFF;
    }
    .tg-check-box svg { width: 12px; height: 12px; }
    .tg-case-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .tg-case-name {
      font-family: var(--mono); font-size: 12.5px; font-weight: 700; color: var(--text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .tg-case-desc { font-size: 12px; color: var(--muted); line-height: 1.35; }
    .tg-case-meta { font-size: 11.5px; color: var(--muted); line-height: 1.35; overflow-wrap: anywhere; }
    .tg-case-defect { font-size: 11.5px; color: #FCA5A5; line-height: 1.35; overflow-wrap: anywhere; }
    .tg-case-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
    .tg-ico {
      width: 28px; height: 28px; display: grid; place-items: center;
      border: none; background: transparent; color: var(--muted); border-radius: 6px; cursor: pointer;
    }
    .tg-ico:hover { color: var(--text); background: var(--hover); }
    .tg-ico.muted { cursor: default; }
    .tg-ico svg { width: 15px; height: 15px; }
    .tg-empty { margin: 0; padding: 16px; color: var(--muted); font-size: 12.5px; }
    .tg-result-badges { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .tg-badge {
      display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 700;
    }
    .tg-badge.fail {
      color: #FCA5A5; background: rgba(239, 68, 68, 0.18); border: 1px solid rgba(239, 68, 68, 0.35);
    }
    .tg-badge.pass {
      color: #86EFAC; background: rgba(34, 197, 94, 0.16); border: 1px solid rgba(34, 197, 94, 0.35);
    }
    .tg-badge.muted {
      color: var(--muted); background: var(--hover); border: 1px solid var(--border);
    }
    .tg-duration {
      display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12px;
    }
    .tg-duration svg { width: 13px; height: 13px; }
    .tg-results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .tg-result {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border-radius: 10px;
      background: var(--card); border: 1px solid var(--border);
    }
    .tg-result code {
      flex: 1; min-width: 0; font-family: var(--mono); font-size: 12.5px; color: var(--text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .tg-result-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .tg-result-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .tg-result-status { font-size: 11px; font-weight: 750; flex-shrink: 0; }
    .tg-result-status.pass { color: #86EFAC; }
    .tg-result-status.fail { color: #FCA5A5; }
    .tg-result-status.muted { color: var(--muted); }
    .tg-result-meta { font-size: 11.5px; color: var(--muted); line-height: 1.35; overflow-wrap: anywhere; }
    .tg-result-reason { font-size: 11.5px; color: #FCA5A5; line-height: 1.35; overflow-wrap: anywhere; }
    .tg-result-time { color: var(--muted); font-size: 12px; flex-shrink: 0; }
    .tg-result-ico {
      width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0; color: #fff;
    }
    .tg-result-ico svg { width: 12px; height: 12px; }
    .tg-result-ico.ok { background: var(--green); }
    .tg-result-ico.fail { background: var(--red); }
    .tg-result-ico.pending { background: var(--border-strong); color: var(--muted); font-size: 12px; }
    .tg-coverage {
      display: flex; align-items: center; gap: 16px;
      padding: 14px; border-radius: 12px;
      background: var(--card); border: 1px solid var(--border);
    }
    .cov-ring { width: 72px; height: 72px; flex-shrink: 0; transform: rotate(-90deg); }
    .cov-track { fill: none; stroke: var(--border); stroke-width: 7; }
    .cov-fill { fill: none; stroke: #FFFFFF; stroke-width: 7; stroke-linecap: round; }
    .cov-pct {
      fill: var(--text); font-size: 14px; font-weight: 800;
      transform: rotate(90deg); transform-origin: 40px 40px;
      font-family: var(--font);
    }
    .tg-coverage-copy { flex: 1; min-width: 0; }
    .tg-coverage-title { font-size: 13px; font-weight: 750; color: var(--text); }
    .tg-coverage-sub { margin-top: 4px; font-size: 12px; color: var(--muted); }
    .tg-coverage-bar {
      margin-top: 10px; height: 6px; border-radius: 999px; background: var(--border); overflow: hidden;
    }
    .tg-coverage-bar > span {
      display: block; height: 100%; border-radius: 999px; background: #FFFFFF;
    }
    .tg-more {
      padding: 14px; border-radius: 12px;
      background: var(--card); border: 1px solid var(--border);
      display: flex; flex-direction: column; gap: 12px;
    }
    .tg-more-top { display: flex; gap: 12px; align-items: flex-start; }
    .tg-more-ico {
      width: 28px; height: 28px; display: grid; place-items: center; flex-shrink: 0; color: var(--text);
    }
    .tg-more-ico svg { width: 18px; height: 18px; }
    .tg-more strong { display: block; font-size: 13.5px; font-weight: 750; color: var(--text); }
    .tg-more p { margin: 4px 0 0; font-size: 12px; color: var(--muted); line-height: 1.4; }
    .tg-more-btn {
      width: 100%; border: 1px solid var(--border-strong); background: transparent;
      color: var(--text); border-radius: 10px; padding: 11px 14px; cursor: pointer;
      font-weight: 700; font-size: 13px;
    }
    .tg-more-btn:hover { background: var(--hover); }
    .tg-run-row { margin-top: 2px; }

    /* —— Investigation History (reference) —— */
    .history-toolbar {
      display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0;
    }
    .search-bar {
      display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;
      background: var(--card); border: 1px solid var(--border); border-radius: 10px;
      padding: 10px 12px; color: var(--muted);
    }
    .search-bar svg { width: 15px; height: 15px; flex-shrink: 0; }
    .search-bar input {
      flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--text); font-size: 13px;
    }
    .hist-filter {
      width: 40px; height: 40px; flex-shrink: 0; display: grid; place-items: center;
      border-radius: 10px; border: 1px solid var(--border); background: var(--card);
      color: var(--muted); cursor: pointer;
    }
    .hist-filter:hover { color: var(--text); background: var(--hover); }
    .hist-filter svg { width: 16px; height: 16px; }
    .history-list { display: flex; flex-direction: column; gap: 10px; list-style: none; margin: 0; padding: 0; }
    .history-list > li { list-style: none; }
    .history-row {
      width: 100%; display: flex; gap: 12px; text-align: left;
      background: var(--card); border: 1px solid var(--border); border-radius: 12px;
      color: inherit; padding: 14px 12px; cursor: pointer; align-items: flex-start;
    }
    .history-row:hover { background: var(--hover); border-color: var(--border-strong); }
    .hist-status {
      width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
      display: grid; place-items: center; color: #fff;
    }
    .hist-status svg { width: 16px; height: 16px; }
    .hist-status.err { background: #EF4444; }
    .hist-status.warn { background: #F5A524; }
    .hist-status.ok { background: #22C55E; }
    .hist-status.fatal { background: #EF4444; }
    .hist-body { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
    .hist-title-row {
      display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    }
    .hist-body strong { color: var(--text); font-size: 13.5px; font-weight: 750; }
    .hist-when { color: var(--muted); font-size: 11.5px; white-space: nowrap; flex-shrink: 0; }
    .hist-file { color: var(--muted); font-size: 12px; }
    .hist-sum { color: var(--muted-dim); font-size: 12px; line-height: 1.4; }
    .hist-more { color: var(--muted); display: grid; place-items: center; padding-top: 2px; flex-shrink: 0; }
    .hist-more svg { width: 16px; height: 16px; }
    .hist-empty { margin: 8px 0; color: var(--muted); font-size: 12.5px; }
    .hist-count { margin: 0; color: var(--muted-dim); font-size: 11.5px; }
    .history-footer { margin-top: auto; padding-top: 8px; }
    #history-clear {
      width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
      border: 1px solid var(--border-strong); background: transparent; color: var(--text);
      border-radius: 10px; padding: 12px 14px; cursor: pointer; font-weight: 700; font-size: 13px;
    }
    #history-clear:hover { background: var(--hover); }
    #history-clear svg { width: 15px; height: 15px; }
    .evidence-item { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0; align-items: center; }
    .run-top { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
    .note-card ul { margin: 8px 0 0; padding-left: 18px; color: var(--muted); }
    .copy-ico { color: var(--muted); }
    .crc {
      margin-top: 10px; overflow: hidden; border-radius: 10px; background: var(--code);
      border: 1px solid var(--border);
    }
    .crc-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 8px 10px; border-bottom: 1px solid var(--border); color: var(--muted); font-size: 11px;
    }
    .crc-body { margin: 0; max-height: 200px; overflow: auto; padding: 8px 0; font-family: var(--mono); font-size: 12px; }
    .crc-row { display: flex; min-height: 20px; }
    .crc-row.hot { background: rgba(239,68,68,0.14); box-shadow: inset 3px 0 0 var(--red); }
    .crc-ln {
      width: 34px; flex-shrink: 0; text-align: right; padding-right: 10px;
      color: var(--muted-dim); user-select: none;
    }
    .crc-code { flex: 1; padding-right: 12px; white-space: pre-wrap; word-break: break-word; }

    /* —— Analysis tab (reference) —— */
    .ax-meta {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
      margin: 0 0 14px; padding: 10px 12px; border-radius: 10px;
      background: var(--card); border: 1px solid var(--border);
    }
    .ax-pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 650;
      background: var(--hover); border: 1px solid var(--border); color: var(--text);
    }
    .ax-pill svg { width: 13px; height: 13px; flex-shrink: 0; color: var(--muted); }
    .ax-pill.ok { color: var(--green); background: var(--green-soft); border-color: rgba(34,197,94,0.35); }
    .ax-pill.muted { color: var(--muted); }
    .ax-pill.lang svg, .ax-pill.lang img { width: 14px; height: 14px; }
    .ax-meta-text { color: var(--muted); font-size: 12px; }
    .ax-error-card {
      position: relative; padding: 16px 14px 14px; margin: 0 0 12px;
      border-radius: 12px; background: var(--red-soft); border: 1px solid rgba(239,68,68,0.45);
    }
    .ax-error-top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .ax-warn-ico { color: var(--red); display: grid; place-items: center; }
    .ax-warn-ico svg { width: 22px; height: 22px; }
    .ax-sev {
      display: inline-flex; padding: 2px 10px; border-radius: 999px;
      background: rgba(239,68,68,0.35); color: #ffb4ab; font-size: 11px; font-weight: 700;
    }
    .ax-error-card h3 { margin: 0 0 6px; font-size: 20px; font-weight: 800; }
    .ax-error-card p { margin: 0 0 4px; }
    .ax-neutral-card {
      padding: 14px; margin: 0 0 12px; border-radius: 12px;
      background: var(--card); border: 1px solid var(--border);
    }
    .ax-neutral-card h3 { margin: 8px 0 6px; }
    .ax-root-cause {
      display: block; background: var(--card); border: 1px solid var(--border); border-radius: 10px;
      margin: 0 0 10px; padding: 12px 14px;
    }
    .ax-root-head {
      display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
    }
    .ax-root-cause > p {
      margin: 0; padding-left: 38px; color: var(--text);
      font-size: 12.5px; line-height: 1.5;
    }
    .ax-rich {
      display: block; background: var(--card); border: 1px solid var(--border); border-radius: 12px;
      margin: 0 0 10px; overflow: visible;
    }
    .ax-rich-summary { display: block; list-style: none; cursor: pointer; color: var(--text); padding: 0; margin: 0; }
    .ax-rich-summary::-webkit-details-marker { display: none; }
    .ax-rich-summary-inner {
      display: flex; align-items: center; gap: 10px; padding: 14px; min-height: 56px; box-sizing: border-box;
    }
    details[open].ax-rich > .ax-rich-summary .ax-chev { transform: rotate(90deg); }
    .ax-rich-body { display: block; padding: 0 14px 14px 14px; }
    .ax-sev-pill {
      display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
      padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700;
      border: 1px solid var(--border); color: var(--muted); background: var(--hover);
    }
    .ax-sev-pill svg { width: 12px; height: 12px; }
    .ax-sev-pill.high {
      color: #F87171; background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.45);
    }
    .ax-sev-pill.ok {
      color: var(--green); background: var(--green-soft); border-color: rgba(34,197,94,0.4);
    }
    .ax-sev-pill.low {
      color: #60A5FA; background: rgba(59,130,246,0.12); border-color: rgba(59,130,246,0.4);
    }
    .ax-sev-pill.medium {
      color: #FBBF24; background: rgba(251,191,36,0.12); border-color: rgba(251,191,36,0.45);
    }
    .ax-sev-pill.muted-pill { color: var(--muted); }
    .ax-rec-hl {
      background: rgba(240, 136, 62, 0.45); color: #FFE8CC; border-radius: 3px;
      padding: 0 1px; font-weight: 700;
    }
    .ax-impact-row {
      display: flex; align-items: flex-start; gap: 12px; padding: 10px 0;
      border-top: 1px solid var(--border);
    }
    .ax-impact-row:first-child { border-top: none; padding-top: 0; }
    .ax-impact-ico {
      width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
      display: grid; place-items: center; border: 1px solid var(--border);
    }
    .ax-impact-ico svg { width: 14px; height: 14px; }
    .ax-impact-ico.bad { color: #F87171; background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.35); }
    .ax-impact-ico.soft { color: var(--muted); background: var(--hover); }
    .ax-impact-row strong { display: block; font-size: 12.5px; margin-bottom: 2px; }
    .ax-impact-row p { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.45; }
    .ax-rec-step {
      display: flex; align-items: flex-start; gap: 12px; padding: 10px 0;
      border-top: 1px solid var(--border);
    }
    .ax-rec-step:first-child { border-top: none; padding-top: 0; }
    .ax-rec-num {
      width: 24px; height: 24px; border-radius: 999px; flex-shrink: 0;
      display: grid; place-items: center; font-size: 12px; font-weight: 800;
      color: var(--green); background: rgba(34,197,94,0.14); border: 1px solid rgba(34,197,94,0.4);
    }
    .ax-rec-copy { flex: 1; min-width: 0; }
    .ax-rec-copy strong { display: block; font-size: 13px; margin-bottom: 2px; }
    .ax-rec-copy p { margin: 0 0 8px; color: var(--muted); font-size: 12.5px; line-height: 1.45; }
    .ax-rec-code, .ax-rec-diff {
      position: relative; margin-top: 8px; border-radius: 8px; overflow: hidden;
      border: 1px solid var(--border); background: #0A0A0A;
    }
    .ax-rec-code .chat-copy, .ax-rec-diff .chat-copy {
      position: absolute; top: 6px; right: 6px; width: 26px; height: 26px; z-index: 1;
    }
    .ax-rec-diff .sfx-diff-body { max-height: 220px; padding: 4px 0 4px 0; }
    .ax-problem {
      margin: 8px 0 12px; border-radius: 10px; overflow: hidden;
      border: 1px solid rgba(248,81,73,0.45); background: #0A0A0A;
    }
    .ax-problem-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
      padding: 8px 10px; border-bottom: 1px solid rgba(248,81,73,0.35);
      background: rgba(248,81,73,0.12);
    }
    .ax-problem .sfx-diff-body { max-height: 200px; }
    .ax-rec-pre {
      margin: 0; padding: 10px 40px 10px 10px; font-family: var(--mono); font-size: 12px;
      white-space: pre-wrap; word-break: break-word; line-height: 1.55;
    }
    .ax-rec-ln {
      display: inline-block; min-width: 28px; margin-right: 10px; color: var(--muted-dim);
      user-select: none; font-variant-numeric: tabular-nums;
    }
    .ax-related-row {
      display: flex; align-items: center; gap: 10px; padding: 10px 0;
      border-top: 1px solid var(--border);
    }
    .ax-related-row:first-child { border-top: none; padding-top: 0; }
    .ax-related-ico {
      width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
      display: grid; place-items: center; border: 1px solid var(--border); background: var(--hover);
    }
    .ax-related-ico svg { width: 14px; height: 14px; }
    .ax-related-ico.high { color: #FBBF24; background: rgba(251,191,36,0.12); border-color: rgba(251,191,36,0.4); }
    .ax-related-ico.medium { color: #FBBF24; background: rgba(251,191,36,0.12); border-color: rgba(251,191,36,0.4); }
    .ax-related-ico.low { color: #60A5FA; background: rgba(59,130,246,0.12); border-color: rgba(59,130,246,0.4); }
    .ax-related-copy { flex: 1; min-width: 0; }
    .ax-related-copy strong { display: block; font-size: 12.5px; text-transform: capitalize; }
    .ax-related-copy p { margin: 2px 0 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ax-related-go {
      width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
      display: grid; place-items: center; border: 1px solid var(--border);
      background: transparent; color: var(--muted); cursor: pointer; padding: 0;
    }
    .ax-related-go svg { width: 14px; height: 14px; }
    .ax-related-go.muted { cursor: default; opacity: 0.5; }
    .ax-fold {
      display: block; background: var(--card); border: 1px solid var(--border); border-radius: 10px;
      margin: 0 0 10px; overflow: visible;
    }
    .ax-summary {
      display: block; list-style: none; cursor: pointer; color: var(--text);
      padding: 0; margin: 0;
    }
    .ax-summary::-webkit-details-marker { display: none; }
    .ax-summary-inner {
      display: flex; align-items: center; gap: 10px; padding: 12px; min-height: 48px;
      box-sizing: border-box;
    }
    .ax-ico {
      width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
      display: grid; place-items: center; background: var(--hover); color: var(--muted);
      border: 1px solid var(--border);
    }
    .ax-ico svg { width: 14px; height: 14px; }
    .ax-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .ax-title { font-weight: 700; font-size: 13px; color: var(--text); }
    .ax-preview {
      color: var(--muted); font-size: 12px; font-weight: 500;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .ax-badge {
      flex-shrink: 0; min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--hover); color: var(--muted); font-size: 11px; font-weight: 700;
      border: 1px solid var(--border);
    }
    .ax-chev {
      color: var(--muted); display: grid; place-items: center; flex-shrink: 0;
      transition: transform 0.12s ease;
    }
    .ax-chev svg { width: 14px; height: 14px; }
    details[open].ax-fold > .ax-summary .ax-chev { transform: rotate(90deg); }
    .ax-body {
      display: block; padding: 0 12px 14px 50px; color: var(--text);
      font-size: 12.5px; line-height: 1.5;
    }
    .ax-body .chat-code { margin-top: 8px; }
    .ax-body p { margin: 0 0 8px; }
    .ax-fix-actions {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px;
    }
    .ax-fix-actions .btn-apply, .ax-fix-actions .btn-view, .ax-fix-actions .btn-ghost {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      width: 100%; min-height: 36px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer;
    }
    .ax-fix-actions .btn-apply {
      border: none; background: #FFFFFF; color: #111111;
    }
    .ax-fix-actions .btn-ghost {
      border: 1px solid var(--border); background: var(--card); color: var(--text);
    }
    .ax-fix-actions .btn-apply svg, .ax-fix-actions .btn-view svg, .ax-fix-actions .btn-ghost svg {
      width: 14px; height: 14px;
    }

    .sfx-card {
      margin: 0 0 12px; padding: 14px; border-radius: 12px;
      background: var(--card); border: 1px solid var(--border);
    }
    .sfx-head {
      display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px;
    }
    .sfx-wrench {
      width: 34px; height: 34px; border-radius: 8px; flex-shrink: 0;
      display: grid; place-items: center; background: var(--hover);
      border: 1px solid var(--border); color: var(--text);
    }
    .sfx-wrench svg { width: 16px; height: 16px; }
    .sfx-titles { flex: 1; min-width: 0; }
    .sfx-title { font-size: 15px; font-weight: 800; color: var(--text); }
    .sfx-sub { margin-top: 3px; font-size: 12.5px; color: var(--muted); line-height: 1.4; }
    .sfx-ready {
      display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
      padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700;
      color: var(--green); background: var(--green-soft); border: 1px solid rgba(34,197,94,0.4);
    }
    .sfx-ready svg { width: 12px; height: 12px; }
    .sfx-ready.muted-pill {
      color: var(--muted); background: var(--hover); border-color: var(--border); font-weight: 600;
    }
    .sfx-review-note { margin: 10px 0 0; font-size: 12px; line-height: 1.4; }
    .sfx-ready.muted-pill {
      color: var(--muted); background: var(--hover); border-color: var(--border);
    }
    .sfx-fallback-code {
      margin: 0; border: none; border-radius: 0; max-height: 280px; overflow: auto;
    }
    .sfx-diff {
      margin: 10px 0; border-radius: 10px; overflow: hidden;
      border: 1px solid var(--border); background: #0A0A0A;
    }
    .sfx-diff-bar {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 8px 10px; border-bottom: 1px solid var(--border); background: #121212;
    }
    .sfx-file { display: inline-flex; align-items: center; gap: 6px; color: var(--text); font-size: 12.5px; font-weight: 650; }
    .sfx-file svg, .sfx-file img { width: 14px; height: 14px; }
    .sfx-diff-right { display: inline-flex; align-items: center; gap: 8px; }
    .sfx-diff-right .chat-copy { position: static; width: 26px; height: 26px; }
    .sfx-diff-body { margin: 0; max-height: 360px; overflow: auto; padding: 0; font-family: var(--mono); font-size: 12px; line-height: 1.55; }
    .sfx-row { display: grid; grid-template-columns: 40px 18px 1fr; gap: 0; min-height: 20px; align-items: flex-start; }
    .sfx-row.ctx { background: transparent; }
    .sfx-row.del { background: rgba(248, 81, 73, 0.22); }
    .sfx-row.add { background: rgba(46, 160, 67, 0.22); }
    .sfx-mark { text-align: center; font-weight: 700; user-select: none; }
    .sfx-row.del .sfx-mark { color: #F85149; }
    .sfx-row.add .sfx-mark { color: #3FB950; }
    .sfx-row.ctx .sfx-mark { color: transparent; }
    .sfx-ln {
      text-align: right; padding: 1px 10px 1px 6px; color: var(--muted-dim);
      user-select: none; font-variant-numeric: tabular-nums; border-right: 1px solid rgba(255,255,255,0.06);
    }
    .sfx-row.del .sfx-ln { color: var(--muted-dim); }
    .sfx-code { padding: 1px 12px 1px 12px; white-space: pre-wrap; word-break: break-word; color: #E6EDF3; }
    .sfx-explain {
      margin-top: 10px; padding: 12px; border-radius: 10px;
      border: 1px solid var(--border); background: #141414;
    }
    .sfx-explain-head {
      display: flex; align-items: center; gap: 8px; margin-bottom: 6px; color: var(--text);
    }
    .sfx-explain-head svg { width: 14px; height: 14px; color: var(--muted); }
    .sfx-explain p { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
    .ax-pill.ok {
      color: var(--green); background: rgba(34,197,94,0.1);
      border: 1px solid rgba(34,197,94,0.45);
    }
  `;
}


export function renderInvestigation(view: InvestigationView): string {
  // Analysis / Run land in Chat; Chat / Tests / History are selectable.
  const activeTab: InvestigationTab = HIDDEN_TABS.has(view.tab) ? 'chat' : view.tab;
  const tabs = TABS.map((tab) => `<button type="button" role="tab" data-tab="${tab.id}" aria-selected="${activeTab === tab.id ? 'true' : 'false'}">
      <span class="tab-ico">${iconSvg(tab.icon)}</span>
      <span class="tab-label">${tab.label}</span>
    </button>`).join('');
  let body = '';
  switch (activeTab) {
    case 'chat':
      body = chatPanel(view);
      break;
    case 'analysis':
      body = chatPanel(view);
      break;
    case 'execution':
      body = chatPanel(view);
      break;
    case 'tests':
      body = testsPanel(view);
      break;
    case 'history':
      body = historyPanel(view);
      break;
    default: {
      const unreachable: never = activeTab;
      body = unreachable;
    }
  }
  const online = view.brainOnline;
  const mainClass = activeTab === 'chat' ? 'main-body' : 'main-body tab-other';
  const showBack = activeTab === 'history' || activeTab === 'tests';
  const backTitle = activeTab === 'history' ? 'Investigation History' : 'Test Generation';
  const titlebar = showBack
    ? `<div class="titlebar">
        <div class="titlebar-left">
          <button type="button" class="titlebar-history" data-tab="chat" title="Back to chat">← Chat</button>
          <div class="titlebar-name">${escapeHtml(backTitle)}</div>
        </div>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escapeHtml(view.cspSource)} data: https: blob:; style-src 'unsafe-inline'; script-src 'nonce-${view.nonce}';" />
  <title>EYRA</title>
  <style>
    ${eyraBaseCss()}
    ${panelCss()}
  </style>
</head>
<body>
  <div class="shell">
    <div class="chrome">
      ${titlebar}
      <div class="chrome-row">
        <div class="product">
          <span class="product-logo">${iconSvg('brain')}</span>
          <div class="product-copy">
            <div class="product-title">EYRA</div>
            <div class="product-sub">AI Debugger &amp; Dev Assistant</div>
          </div>
        </div>
        <span class="online-pill${online ? '' : ' off'}"><span class="online-dot"></span>${online ? 'Online' : 'Offline'}</span>
      </div>
      <div role="tablist" aria-label="EYRA panels" hidden>${tabs}</div>
    </div>
    <div class="${mainClass}" role="tabpanel">${body}</div>
  </div>
  <script nonce="${view.nonce}">
    const vscode = acquireVsCodeApi();
    document.body.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const hit = (sel) => target && target.closest(sel);
      if (hit('#close-panel')) { vscode.postMessage({ type: 'closePanel' }); return; }
      if (hit('#cancel-request')) { vscode.postMessage({ type: 'cancelRequest' }); return; }
      if (hit('.crc-copy') || hit('.chat-copy')) {
        const card = hit('.crc') || hit('.chat-code') || hit('.chat-diff-wrap') || hit('.sfx-diff');
        const code = card && (card.querySelector('.ui-ev-body') || card.querySelector('.crc-body') || card.querySelector('.chat-code-body') || card.querySelector('.sfx-diff-body') || card.querySelector('.diff') || card.querySelector('.code-pre'));
        if (code) {
          const parts = code.querySelectorAll('.ui-ev-code, .crc-code, .chat-src, .sfx-code, .diff-add, .diff-del');
          const text = parts.length
            ? Array.from(parts).map((el) => el.textContent || '').join('\\n')
            : (code.textContent || '');
          vscode.postMessage({ type: 'copyText', text });
        }
        return;
      }
      const openDetails = hit('[data-open-details]');
      if (openDetails) {
        const id = openDetails.getAttribute('data-open-details');
        const el = id && document.getElementById(id);
        if (el && 'open' in el) {
          el.open = true;
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        return;
      }
      const scroll = hit('[data-scroll]');
      if (scroll) {
        const id = scroll.getAttribute('data-scroll');
        const el = id && document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const tab = hit('[data-tab]');
      if (tab) { vscode.postMessage({ type: 'selectTab', tab: tab.getAttribute('data-tab') }); return; }
      const session = hit('[data-session]');
      if (session) { vscode.postMessage({ type: 'openSession', sessionId: session.getAttribute('data-session') }); return; }
      const location = hit('[data-location]');
      if (location) { vscode.postMessage({ type: 'navigate', target: 'evidence', location: location.getAttribute('data-location') }); return; }
      if (hit('[data-origin]')) { vscode.postMessage({ type: 'navigate', target: 'origin' }); return; }
      const action = hit('[data-action]');
      if (action) { vscode.postMessage({ type: 'chatAction', action: action.getAttribute('data-action') }); return; }
      if (hit('#history-refresh')) {
        const query = document.getElementById('history-query');
        vscode.postMessage({ type: 'refreshHistory', query: query && 'value' in query ? query.value : '' });
        return;
      }
      if (hit('#history-clear')) { vscode.postMessage({ type: 'clearHistory' }); return; }
      if (hit('#history-more')) { vscode.postMessage({ type: 'loadMoreHistory' }); return; }
      if (hit('#explain-further')) {
        vscode.postMessage({ type: 'chatPrompt', prompt: 'Explain this error further.' });
        return;
      }
      if (hit('#copy-fix')) { vscode.postMessage({ type: 'copyCorrection' }); return; }
      if (hit('#apply-fix')) { vscode.postMessage({ type: 'requestApply' }); return; }
      if (hit('#apply-fix-tests')) { vscode.postMessage({ type: 'requestApply', then: 'tests' }); return; }
      if (hit('#verify-run')) { vscode.postMessage({ type: 'requestVerify', method: 'execute' }); return; }
      if (hit('#verify-tests')) { vscode.postMessage({ type: 'requestVerify', method: 'tests' }); return; }
      if (hit('#run-file') || hit('#run-file-cta')) { vscode.postMessage({ type: 'runFile' }); return; }
      if (hit('#gen-tests') || hit('[data-gen-tests]')) { vscode.postMessage({ type: 'generateTests' }); return; }
      if (hit('#run-tests') || hit('[data-run-tests]')) { vscode.postMessage({ type: 'runTests' }); }
    });
    const form = document.getElementById('chat-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('chat-input');
        const text = input && 'value' in input ? String(input.value || '').trim() : '';
        if (!text) return;
        if (input && 'value' in input) input.value = '';
        vscode.postMessage({ type: 'chatPrompt', prompt: text });
      });
    }
    const historyQuery = document.getElementById('history-query');
    if (historyQuery) {
      historyQuery.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        vscode.postMessage({
          type: 'refreshHistory',
          query: historyQuery && 'value' in historyQuery ? historyQuery.value : '',
        });
      });
    }
  </script>
</body>
</html>`;
}
