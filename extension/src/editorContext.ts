export const MAX_CODE_CHARS = 200_000;
export const MAX_FILE_NAME_CHARS = 512;
export const MAX_PROJECT_NAME_CHARS = 128;
export const MAX_LANGUAGE_CHARS = 64;

export type EditorSnapshot = {
  text: string;
  languageId: string;
  fileName: string;
  relativePath: string;
  isUntitled: boolean;
  selectionIsEmpty: boolean;
  selectedText: string;
  selectionStartLine: number;
  selectionEndLine: number;
  workspaceName?: string;
};

export type ContextOk = {
  ok: true;
  fileName: string;
  relativePath: string;
  language: string;
  code: string;
  projectName: string;
  startLine: number;
  endLine: number;
};

export type ContextErr = {
  ok: false;
  message: string;
};

export function baseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return (normalized.split('/').pop() || '').trim();
}

export function projectName(workspaceName: string | undefined): string {
  const name = (workspaceName || '').trim();
  return (name || 'default').slice(0, MAX_PROJECT_NAME_CHARS);
}

function languageOf(languageId: string): ContextErr | string {
  const language = (languageId || 'plaintext').trim() || 'plaintext';
  if (language.length > MAX_LANGUAGE_CHARS) {
    return { ok: false, message: 'This editor language id is longer than the Brain accepts (64 characters).' };
  }
  return language;
}

function checkCode(code: string, emptyMessage: string): ContextErr | null {
  if (code.length < 1) {
    return { ok: false, message: emptyMessage };
  }
  if (code.includes('\0')) {
    return { ok: false, message: 'The Brain rejects source that contains null bytes.' };
  }
  if (code.length > MAX_CODE_CHARS) {
    return {
      ok: false,
      message: `This code is ${code.length} characters. The Brain accepts at most ${MAX_CODE_CHARS}. Analyze a smaller file or selection.`,
    };
  }
  return null;
}

export function collectCurrentFile(
  editor: EditorSnapshot | undefined,
  messages?: { missingEditor?: string; empty?: string },
): ContextOk | ContextErr {
  if (!editor) {
    return {
      ok: false,
      message: messages?.missingEditor ?? 'No active editor. Open a file, then run EYRA: Analyze Current File.',
    };
  }
  const fileName = baseName(editor.fileName);
  if (!fileName || fileName.length > MAX_FILE_NAME_CHARS) {
    return { ok: false, message: 'This editor has no file name the Brain can accept.' };
  }
  const language = languageOf(editor.languageId);
  if (typeof language !== 'string') {
    return language;
  }
  const problem = checkCode(editor.text, messages?.empty ?? 'The active file is empty.');
  if (problem) {
    return problem;
  }
  return {
    ok: true,
    fileName,
    relativePath: editor.relativePath || fileName,
    language,
    code: editor.text,
    projectName: projectName(editor.workspaceName),
    startLine: 1,
    endLine: Math.max(1, editor.text.split(/\r?\n/).length),
  };
}

export function collectSelection(editor: EditorSnapshot | undefined): ContextOk | ContextErr {
  if (!editor) {
    return { ok: false, message: 'No active editor. Open a file and select the code to explain.' };
  }
  if (editor.selectionIsEmpty || editor.selectedText.length < 1) {
    return { ok: false, message: 'No code is selected. Select the lines to explain, then run the command again.' };
  }
  const fileName = baseName(editor.fileName);
  if (!fileName || fileName.length > MAX_FILE_NAME_CHARS) {
    return { ok: false, message: 'This editor has no file name the Brain can accept.' };
  }
  const language = languageOf(editor.languageId);
  if (typeof language !== 'string') {
    return language;
  }
  const problem = checkCode(editor.selectedText, 'The selection is empty.');
  if (problem) {
    return problem;
  }
  return {
    ok: true,
    fileName,
    relativePath: editor.relativePath || fileName,
    language,
    code: editor.selectedText,
    projectName: projectName(editor.workspaceName),
    startLine: editor.selectionStartLine,
    endLine: editor.selectionEndLine,
  };
}
