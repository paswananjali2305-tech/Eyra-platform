/**
 * Pure terminal-command selection for "Run Current File".
 *
 * No VS Code imports here so the mapping can be unit-tested. Commands are
 * built from the file extension first, then the VS Code language id
 * (including the React variants `typescriptreact` / `javascriptreact`).
 *
 * Runners:
 * - Python: python / python3
 * - Plain JavaScript (.js/.mjs/.cjs): Node.js
 * - TypeScript and JSX/TSX: `npx tsx` (uses a project-local tsx when the
 *   terminal runs inside the project; downloads on first use otherwise).
 *   Plain Node cannot execute JSX/TS syntax, so it is never used for those.
 * - Java: `java <file>` (single-file source-code launch, JDK 11+)
 * - C / C++: gcc / g++ compile to a sibling binary, then run it
 * - Go: `go run`
 *
 * Returns null when no safe command exists; the caller tells the user the
 * file cannot be run instead of guessing.
 */

export type RunPlatform = 'win32' | 'posix';

export type RunLanguage =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'java'
  | 'c'
  | 'cpp'
  | 'go'
  | 'powershell'
  | 'shell';

const EXT_LANGUAGE: Record<string, RunLanguage> = {
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  go: 'go',
  ps1: 'powershell',
  sh: 'shell',
};

const ID_LANGUAGE: Record<string, RunLanguage> = {
  python: 'python',
  javascript: 'javascript',
  javascriptreact: 'javascript',
  typescript: 'typescript',
  typescriptreact: 'typescript',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  go: 'go',
};

export function detectRunPlatform(): RunPlatform {
  const proc = (globalThis as { process?: { platform?: string } }).process;
  return proc?.platform === 'win32' ? 'win32' : 'posix';
}

function fileExtensionOf(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Extensions that are never standalone-runnable, even with a language id. */
const NON_RUNNABLE_EXT = new Set(['h', 'hpp', 'hh', 'html', 'htm', 'css', 'scss', 'sql']);

export function runLanguageForFile(filePath: string, languageId?: string): RunLanguage | null {
  const ext = fileExtensionOf(filePath);
  if (NON_RUNNABLE_EXT.has(ext)) {
    return null;
  }
  const byExt = EXT_LANGUAGE[ext];
  if (byExt) {
    return byExt;
  }
  return ID_LANGUAGE[(languageId || '').trim().toLowerCase()] ?? null;
}

function quoted(filePath: string): string {
  return `"${filePath.replace(/"/g, '\\"')}"`;
}

function siblingBinary(filePath: string, win: boolean): string {
  const dot = filePath.lastIndexOf('.');
  const stem = dot > 0 ? filePath.slice(0, dot) : filePath;
  return `${stem}${win ? '.exe' : '.out'}`;
}

export function runCommandForFile(
  filePath: string,
  languageId?: string,
  platform: RunPlatform = detectRunPlatform(),
): string | null {
  const lang = runLanguageForFile(filePath, languageId);
  if (!lang) {
    return null;
  }
  const win = platform === 'win32';
  const src = quoted(filePath);
  const ext = fileExtensionOf(filePath);
  const langId = (languageId || '').trim().toLowerCase();
  switch (lang) {
    case 'python':
      return win ? `python ${src}` : `python3 ${src}`;
    case 'javascript':
      // JSX (or a React language id) needs transpilation — tsx handles it;
      // plain Node is only used for plain JavaScript files.
      return ext === 'jsx' || langId === 'javascriptreact'
        ? `npx --yes tsx ${src}`
        : `node ${src}`;
    case 'typescript':
      return `npx --yes tsx ${src}`;
    case 'java':
      return `java ${src}`;
    case 'c':
    case 'cpp': {
      const compiler = lang === 'c' ? 'gcc' : 'g++';
      const bin = quoted(siblingBinary(filePath, win));
      return win
        ? `${compiler} ${src} -o ${bin}; if ($LASTEXITCODE -eq 0) { & ${bin} }`
        : `${compiler} ${src} -o ${bin} && ${bin}`;
    }
    case 'go':
      return `go run ${src}`;
    case 'powershell':
      return win ? `powershell -ExecutionPolicy Bypass -File ${src}` : null;
    case 'shell':
      return win ? null : `bash ${src}`;
    default: {
      const unreachable: never = lang;
      return unreachable;
    }
  }
}
