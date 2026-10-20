import * as vscode from 'vscode';
import { resolveTextEditor } from './activeEditor';
import { analyzeTerminalError } from './commands';
import { openInvestigationTab } from './investigationPanel';

/** Matches Python SyntaxError, Tracebacks, Node errors, etc. */
const ERROR_HINT =
  /Traceback \(most recent call last\)|\b(?:Syntax|Indentation|Name|Type|Value|Attribute|Import|ModuleNotFound|Runtime|ZeroDivision|Key|Index|FileNotFound|OS|Permission|Recursion|Memory|Assertion)?Error\b|\bException\b|panicked at|FATAL ERROR|Error:|error TS\d+/i;

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function extractStackTrace(output: string): string {
  const traceback = /Traceback \(most recent call last\):[\s\S]*?(?=\n[^\s]|$)/i.exec(output);
  if (traceback) {
    return traceback[0].trim();
  }
  // Python SyntaxError block (no Traceback header).
  const syntax = /File\s+[\"'][^\"']+[\"']\s*,\s*line\s+\d+[\s\S]{0,800}?\b\w*Error\b[^\n]*/i.exec(output);
  if (syntax) {
    return syntax[0].trim();
  }
  const lines = output.split(/\r?\n/).filter((line) => /error|exception|failed|traceback/i.test(line));
  return lines.slice(-16).join('\n').trim();
}

function extractFocusLine(output: string, fileName: string): number | null {
  const base = fileName.split(/[/\\]/).pop() || fileName;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const specific = new RegExp(`File\\s+[\"'](?:[^\"']*[\\\\/])?${escaped}[\"']\\s*,\\s*line\\s+(\\d+)`, 'i');
  const match = specific.exec(output) || /File\s+[\"'][^\"']+[\"']\s*,\s*line\s+(\d+)/i.exec(output)
    || /,\s*line\s+(\d+)/i.exec(output) || /:(\d+)(?::\d+)?\b/.exec(output);
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  return n > 0 ? n : null;
}

export function looksLikeRuntimeError(output: string): boolean {
  return ERROR_HINT.test(output);
}

function outputMentionsActiveFile(output: string, fileName: string): boolean {
  if (output.includes(fileName)) {
    return true;
  }
  // Path may use different separators / casing on Windows.
  const lower = output.toLowerCase();
  const base = fileName.toLowerCase();
  return lower.includes(base);
}

/** Suppress automatic terminal→Chat analysis briefly (e.g. while Run Current File handles it). */
let suppressUntil = 0;

export function suppressTerminalErrorWatch(ms = 12_000): void {
  suppressUntil = Date.now() + Math.max(0, ms);
}

async function readExecutionStream(
  execution: { read: () => AsyncIterable<string> | string | Thenable<string> },
): Promise<string> {
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
        if (parts.join('').length > 32_000) {
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

/**
 * When a shell command fails with a runtime / syntax error, open EYRA Chat and analyze.
 * Buffers output from command start so we do not miss SyntaxError text.
 */
export function watchTerminalErrors(
  context: vscode.ExtensionContext,
  secrets: vscode.SecretStorage,
): void {
  const buffers = new WeakMap<object, { parts: string[]; terminal: vscode.Terminal }>();
  let lastKey = '';
  let lastAt = 0;

  const startEvent = vscode.window.onDidStartTerminalShellExecution;
  if (typeof startEvent === 'function') {
    context.subscriptions.push(
      startEvent((event) => {
        const parts: string[] = [];
        buffers.set(event.execution, { parts, terminal: event.terminal });
        // Must start reading immediately or chunks are dropped.
        void (async () => {
          try {
            for await (const chunk of event.execution.read()) {
              parts.push(chunk);
              if (parts.join('').length > 32_000) {
                break;
              }
            }
          } catch {
            // ignore — end handler may still have exit code
          }
        })();
      }),
    );
  }

  context.subscriptions.push(
    vscode.window.onDidEndTerminalShellExecution(async (event) => {
      if (Date.now() < suppressUntil) {
        return;
      }

      const buffered = buffers.get(event.execution);
      buffers.delete(event.execution);

      let output = buffered ? stripAnsi(buffered.parts.join('')).trim() : '';
      if (!output) {
        // Fallback if we missed the start event.
        output = stripAnsi(await readExecutionStream(event.execution)).trim();
      }

      const failed = event.exitCode !== undefined && event.exitCode !== 0;
      const hasErrorText = looksLikeRuntimeError(output);
      // SyntaxError often exits non-zero; if exitCode is missing, still act on clear error text.
      if (!failed && !hasErrorText) {
        return;
      }
      if (!output || !hasErrorText) {
        return;
      }

      const editor = resolveTextEditor();
      if (!editor || editor.document.isUntitled) {
        return;
      }

      const fileName = editor.document.fileName.split(/[/\\]/).pop() || editor.document.fileName;
      const mentionsFile = outputMentionsActiveFile(output, fileName);
      const hasTraceOrSyntax = /Traceback \(most recent call last\)|\bSyntaxError\b|\bIndentationError\b|File\s+[\"'][^\"']+[\"']\s*,\s*line\s+\d+/i.test(output);
      if (!mentionsFile && !hasTraceOrSyntax) {
        return;
      }

      const key = `${fileName}:${event.exitCode ?? 'x'}:${output.slice(-500)}`;
      const now = Date.now();
      if (key === lastKey && now - lastAt < 6000) {
        return;
      }
      lastKey = key;
      lastAt = now;

      openInvestigationTab('chat');
      const stackTrace = extractStackTrace(output);
      const focusLine = extractFocusLine(output, fileName);
      void analyzeTerminalError(secrets, {
        terminalOutput: output.slice(-8000),
        stackTrace,
        focusLine,
      });
    }),
  );
}
