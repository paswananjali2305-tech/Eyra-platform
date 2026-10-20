import * as vscode from 'vscode';
import {
  buildAnalyzeDiagnostics,
  type AnalyzeDiagnostic,
  type DiagnosticCollectScope,
  type RawDiagnosticInput,
} from './diagnosticsModel';

export {
  MAX_DIAGNOSTICS,
  MAX_DIAGNOSTICS_JSON_CHARS,
  MAX_DIAGNOSTIC_MESSAGE_CHARS,
  MAX_DIAGNOSTIC_SOURCE_CHARS,
  MAX_DIAGNOSTIC_CODE_CHARS,
  buildAnalyzeDiagnostics,
} from './diagnosticsModel';
export type {
  AnalyzeDiagnostic,
  DiagnosticSeverityLabel,
  RawDiagnosticInput,
  DiagnosticCollectScope,
} from './diagnosticsModel';

/**
 * Collect VS Code Problems for analyze. File scope by default; workspace only when requested.
 * Pass `documentUri` for the active document so untitled / non-file schemes resolve correctly.
 */
export function collectDiagnosticsFromVsCode(
  scope: DiagnosticCollectScope,
  documentUri?: vscode.Uri,
): AnalyzeDiagnostic[] {
  const raw: RawDiagnosticInput[] = [];

  if (scope.kind === 'file') {
    const uri = documentUri ?? vscode.Uri.file(scope.matchPath);
    const diags = vscode.languages.getDiagnostics(uri);
    const path = uri.fsPath || uri.toString();
    for (const d of diags) {
      raw.push({
        message: d.message,
        severity: d.severity,
        filePath: path,
        line: d.range.start.line,
        character: d.range.start.character,
        endLine: d.range.end.line,
        endCharacter: d.range.end.character,
        source: d.source,
        code: d.code as string | number | { value: string | number } | null | undefined,
      });
    }
  } else {
    for (const [uri, diags] of vscode.languages.getDiagnostics()) {
      const path = uri.fsPath || uri.toString();
      for (const d of diags) {
        raw.push({
          message: d.message,
          severity: d.severity,
          filePath: path,
          line: d.range.start.line,
          character: d.range.start.character,
          endLine: d.range.end.line,
          endCharacter: d.range.end.character,
          source: d.source,
          code: d.code as string | number | { value: string | number } | null | undefined,
        });
      }
    }
  }

  return buildAnalyzeDiagnostics(raw, scope);
}

/** File-scoped diagnostics for Analyze Current File. */
export function collectFileDiagnostics(
  documentUri: vscode.Uri,
  fileName: string,
): AnalyzeDiagnostic[] {
  const matchPath = documentUri.fsPath || documentUri.toString();
  return collectDiagnosticsFromVsCode(
    { kind: 'file', matchPath, fileName },
    documentUri,
  );
}

/**
 * Selection-scoped diagnostics (lines overlapping the selection).
 * `startLine1` / `endLine1` are 1-based editor lines from editorContext.
 */
export function collectSelectionDiagnostics(
  documentUri: vscode.Uri,
  fileName: string,
  startLine1: number,
  endLine1: number,
): AnalyzeDiagnostic[] {
  const startLine0 = Math.max(0, startLine1 - 1);
  const endLine0 = Math.max(0, endLine1 - 1);
  const matchPath = documentUri.fsPath || documentUri.toString();
  return collectDiagnosticsFromVsCode(
    {
      kind: 'file',
      matchPath,
      fileName,
      startLine0,
      endLine0,
    },
    documentUri,
  );
}

/** Workspace-wide Problems — only for an explicitly requested workspace investigation. */
export function collectWorkspaceDiagnostics(): AnalyzeDiagnostic[] {
  return collectDiagnosticsFromVsCode({ kind: 'workspace' });
}
