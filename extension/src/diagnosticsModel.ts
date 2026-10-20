import { baseName } from './editorContext';

/** Max Problems entries included in one analyze request. */
export const MAX_DIAGNOSTICS = 50;
/** Soft cap on serialized diagnostics JSON size (characters). */
export const MAX_DIAGNOSTICS_JSON_CHARS = 40_000;
export const MAX_DIAGNOSTIC_MESSAGE_CHARS = 2_000;
export const MAX_DIAGNOSTIC_SOURCE_CHARS = 128;
export const MAX_DIAGNOSTIC_CODE_CHARS = 128;

export type DiagnosticSeverityLabel = 'error' | 'warning' | 'info' | 'hint';

/** Shape sent to Brain `/api/analyze` (optional field). */
export type AnalyzeDiagnostic = {
  message: string;
  severity: DiagnosticSeverityLabel;
  file_name: string;
  /** Zero-based start line. */
  line: number;
  /** Zero-based start column. */
  character: number;
  end_line?: number;
  end_character?: number;
  source?: string;
  code?: string;
};

/** Raw diagnostic before normalize/cap (testable without VS Code). */
export type RawDiagnosticInput = {
  message: string;
  severity: DiagnosticSeverityLabel | number;
  filePath: string;
  /** Zero-based. */
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
  source?: string | null;
  code?: string | number | { value: string | number } | null;
};

/** Directory segments whose diagnostics never count as workspace issues. */
export const GENERATED_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  'node_modules',
  'out',
  'dist',
  'build',
  '.git',
  '.venv',
  '__pycache__',
  'coverage',
  '.next',
  'target',
]);

export type IssueCountEntry = {
  filePath: string;
  severity: DiagnosticSeverityLabel | number;
  line: number;
  character: number;
  message: string;
  source?: string | null;
  code?: string | number | { value: string | number } | null;
};

export function isGeneratedPath(filePath: string): boolean {
  const segments = normalizePathKey(filePath).split('/').filter(Boolean);
  return segments.some((segment) => GENERATED_PATH_SEGMENTS.has(segment));
}

function isUnderRoot(filePath: string, roots: string[]): boolean {
  if (!roots.length) {
    return true;
  }
  const path = normalizePathKey(filePath);
  return roots.some((root) => {
    const base = normalizePathKey(root).replace(/\/+$/, '');
    return path === base || path.startsWith(`${base}/`);
  });
}

/**
 * Count Error/Warning diagnostics that belong to the user's workspace.
 *
 * VS Code's `getDiagnostics()` reports every known URI — including compiled
 * output under `out/`/`dist/` that mirrors `src/`, `node_modules`, and files
 * outside the workspace. Summing that raw list inflates the count each time
 * a build or language server adds another mirrored entry (e.g. 6 real
 * problems ballooning to dozens). This counter scopes to workspace roots,
 * drops generated/dependency directories, and dedupes identical entries,
 * so repeated recomputation over the same state returns the same number.
 * Pure — unit-testable without VS Code.
 */
export function countWorkspaceIssues(entries: IssueCountEntry[], workspaceRoots: string[]): number {
  const seen = new Set<string>();
  let count = 0;
  for (const entry of entries) {
    const severity = severityLabel(entry.severity);
    if (severity !== 'error' && severity !== 'warning') {
      continue;
    }
    if (!entry.filePath || isGeneratedPath(entry.filePath)) {
      continue;
    }
    if (!isUnderRoot(entry.filePath, workspaceRoots)) {
      continue;
    }
    const key = [
      normalizePathKey(entry.filePath),
      severity,
      Math.floor(entry.line) || 0,
      Math.floor(entry.character) || 0,
      (entry.message || '').trim(),
      codeToString(entry.code) || '',
      (entry.source || '').trim(),
    ].join('\0');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    count += 1;
  }
  return count;
}

export type DiagnosticCollectScope =
  | {
      kind: 'file';
      /** Absolute / fs path used only for matching; never sent to Brain. */
      matchPath: string;
      fileName: string;
      /** Inclusive 0-based line range; omit for whole file. */
      startLine0?: number;
      endLine0?: number;
    }
  | { kind: 'workspace' };

function severityLabel(value: DiagnosticSeverityLabel | number): DiagnosticSeverityLabel | null {
  if (typeof value === 'string') {
    if (value === 'error' || value === 'warning' || value === 'info' || value === 'hint') {
      return value;
    }
    return null;
  }
  if (value === 0) return 'error';
  if (value === 1) return 'warning';
  if (value === 2) return 'info';
  if (value === 3) return 'hint';
  return null;
}

function codeToString(
  code: string | number | { value: string | number } | null | undefined,
): string | undefined {
  if (code === null || code === undefined) {
    return undefined;
  }
  if (typeof code === 'string' || typeof code === 'number') {
    const text = String(code).trim();
    return text ? text.slice(0, MAX_DIAGNOSTIC_CODE_CHARS) : undefined;
  }
  if (typeof code === 'object' && 'value' in code) {
    const text = String(code.value).trim();
    return text ? text.slice(0, MAX_DIAGNOSTIC_CODE_CHARS) : undefined;
  }
  return undefined;
}

function normalizePathKey(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase();
}

function pathsMatch(a: string, b: string): boolean {
  const left = normalizePathKey(a);
  const right = normalizePathKey(b);
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function dedupeKey(item: AnalyzeDiagnostic): string {
  return [
    item.file_name,
    item.severity,
    item.line,
    item.character,
    item.message,
    item.code || '',
    item.source || '',
  ].join('\0');
}

/**
 * Normalize, filter by scope, dedupe, and cap diagnostics for an analyze payload.
 * Pure — suitable for unit tests without VS Code.
 */
export function buildAnalyzeDiagnostics(
  raw: RawDiagnosticInput[],
  scope: DiagnosticCollectScope,
): AnalyzeDiagnostic[] {
  const out: AnalyzeDiagnostic[] = [];
  const seen = new Set<string>();
  let jsonBudget = MAX_DIAGNOSTICS_JSON_CHARS;

  for (const entry of raw) {
    if (out.length >= MAX_DIAGNOSTICS) {
      break;
    }
    const message = (entry.message || '').replace(/\0/g, '').trim();
    if (!message) {
      continue;
    }
    const severity = severityLabel(entry.severity);
    if (!severity) {
      continue;
    }
    if (!Number.isFinite(entry.line) || entry.line < 0) {
      continue;
    }
    if (!Number.isFinite(entry.character) || entry.character < 0) {
      continue;
    }

    if (scope.kind === 'file') {
      if (!pathsMatch(entry.filePath, scope.matchPath) && baseName(entry.filePath) !== scope.fileName) {
        continue;
      }
      if (scope.startLine0 !== undefined && scope.endLine0 !== undefined) {
        const start = Math.min(scope.startLine0, scope.endLine0);
        const end = Math.max(scope.startLine0, scope.endLine0);
        if (entry.line < start || entry.line > end) {
          continue;
        }
      }
    }

    const fileName = scope.kind === 'file'
      ? scope.fileName
      : baseName(entry.filePath);
    if (!fileName) {
      continue;
    }

    const item: AnalyzeDiagnostic = {
      message: message.slice(0, MAX_DIAGNOSTIC_MESSAGE_CHARS),
      severity,
      file_name: fileName.slice(0, 512),
      line: Math.floor(entry.line),
      character: Math.floor(entry.character),
    };
    if (entry.endLine !== undefined && Number.isFinite(entry.endLine) && entry.endLine >= 0) {
      item.end_line = Math.floor(entry.endLine);
    }
    if (entry.endCharacter !== undefined && Number.isFinite(entry.endCharacter) && entry.endCharacter >= 0) {
      item.end_character = Math.floor(entry.endCharacter);
    }
    const source = (entry.source || '').replace(/\0/g, '').trim();
    if (source) {
      item.source = source.slice(0, MAX_DIAGNOSTIC_SOURCE_CHARS);
    }
    const code = codeToString(entry.code);
    if (code) {
      item.code = code;
    }

    const key = dedupeKey(item);
    if (seen.has(key)) {
      continue;
    }
    const encoded = JSON.stringify(item).length + 1;
    if (encoded > jsonBudget) {
      break;
    }
    seen.add(key);
    jsonBudget -= encoded;
    out.push(item);
  }

  return out;
}
