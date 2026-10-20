const assert = require('node:assert/strict');
const test = require('node:test');
const { collectCurrentFile, collectSelection } = require('../out/editorContext');
const { ACCESS_TOKEN_SECRET, clearAccessToken, readAccessToken, storeAccessToken } = require('../out/session');
const { BrainHttpError, requestJson } = require('../out/http');
const { renderAnalysisHtml } = require('../out/analysisHtml');
const { parseAnalyzeResult } = require('../out/parse');

function editor(overrides = {}) {
  return {
    text: 'print(1)\n',
    languageId: 'python',
    fileName: 'C:/Users/secret/project/app.py',
    relativePath: 'project/app.py',
    isUntitled: false,
    selectionIsEmpty: true,
    selectedText: '',
    selectionStartLine: 1,
    selectionEndLine: 1,
    workspaceName: 'project',
    ...overrides,
  };
}

test('missing editor does not produce a request payload', () => {
  const file = collectCurrentFile(undefined);
  const selection = collectSelection(undefined);
  assert.equal(file.ok, false);
  assert.equal(selection.ok, false);
  assert.match(file.message, /No active editor/);
});

test('empty selection does not produce a request payload', () => {
  const selection = collectSelection(editor());
  assert.equal(selection.ok, false);
  assert.match(selection.message, /No code is selected/);
});

test('current file sends the basename and full buffer only', () => {
  const file = collectCurrentFile(editor());
  assert.equal(file.ok, true);
  assert.equal(file.fileName, 'app.py');
  assert.equal(file.code, 'print(1)\n');
  assert.equal(file.relativePath, 'project/app.py');
  assert.equal(file.language, 'python');
  assert.equal(file.projectName, 'project');
});

test('selection sends only the selected text', () => {
  const selection = collectSelection(editor({
    selectionIsEmpty: false,
    selectedText: 'print(1)',
    selectionStartLine: 4,
    selectionEndLine: 4,
  }));
  assert.equal(selection.ok, true);
  assert.equal(selection.code, 'print(1)');
  assert.equal(selection.startLine, 4);
  assert.notEqual(selection.code, 'print(1)\n');
});

test('secret storage keeps and clears the access token', async () => {
  const data = new Map();
  const secrets = {
    get: async (key) => data.get(key),
    store: async (key, value) => { data.set(key, value); },
    delete: async (key) => { data.delete(key); },
  };
  await storeAccessToken(secrets, 'secret-token');
  assert.equal(data.get(ACCESS_TOKEN_SECRET), 'secret-token');
  assert.equal(await readAccessToken(secrets), 'secret-token');
  await clearAccessToken(secrets);
  assert.equal(await readAccessToken(secrets), undefined);
  assert.equal(data.has(ACCESS_TOKEN_SECRET), false);
});

test('protected analysis sends one bearer request and does not retry 401', async () => {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ detail: 'Not authenticated' }),
    };
  };
  try {
    await assert.rejects(
      () => requestJson({
        baseUrl: 'http://127.0.0.1:8000',
        path: '/api/analyze',
        method: 'POST',
        token: 'secret-token',
        body: { file_name: 'app.py', code_snippet: 'print(1)\n' },
      }),
      (err) => err instanceof BrainHttpError && err.unauthorized === true && err.status === 401,
    );
  } finally {
    global.fetch = original;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8000/api/analyze');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token');
  assert.doesNotMatch(JSON.stringify(calls[0].init.body), /workspace/);
});

test('analysis html escapes response text and states the proposal was not applied', () => {
  const result = parseAnalyzeResult({
    session_id: 'EYRA-1',
    status: 'hypothesis',
    error_type: 'SyntaxError',
    error_summary: '<script>alert(1)</script>',
    root_cause: 'quote',
    explanation: 'explain',
    evidence: [{ kind: 'source', detail: 'line', location: 'app.py:1' }],
    execution_timeline: [{ step: 'Reason', detail: 'done', status: 'done' }],
    suggested_correction: {
      summary: 'Review only',
      corrected_code: 'print(1)\n',
      apply_mode: 'review_and_copy',
    },
    verification: { status: 'not_run', method: 'none', detail: 'not checked', is_hypothesis_only: true },
    reasoning_source: 'local_heuristic',
    reasoning_note: 'note',
    file_name: 'app.py',
    language: 'python',
    project_name: 'project',
    confidence: 0.4,
  });
  const html = renderAnalysisHtml({
    result,
    localPath: 'project/app.py',
    startLine: 1,
    endLine: 1,
    nonce: 'n',
  });
  assert.match(html, /EYRA-1/);
  assert.match(html, /not applied/i);
  assert.match(html, /review_and_copy/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
});
