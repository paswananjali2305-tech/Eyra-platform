const assert = require('node:assert/strict');
const test = require('node:test');
const {
  decideFix,
  historyDetailPath,
  historyListPath,
  parseHistoryList,
  parseWebviewMessage,
  resolveEvidenceLocation,
} = require('../out/phase4Model');
const { renderInvestigation } = require('../out/investigationHtml');

function view(history) {
  return {
    tab: 'history',
    nonce: 'n',
    stale: false,
    botImgUri: '',
    cspSource: '',
    brainOnline: true,
    userInitial: 'K',
    chat: { turns: [] },
    analysis: { status: 'empty', error: '', result: null, localPath: '', hasOrigin: false, startLine: null, endLine: null },
    execution: { status: 'empty', error: '', view: null, localPath: '', fileName: '' },
    tests: { status: 'empty', error: '', generated: null, run: null, localPath: '', fileName: '' },
    suggestions: { status: 'empty', error: '', performance: null, optimize: null, localPath: '' },
    history,
  };
}

const known = { knownFileName: 'app.py', knownRelativePath: 'src/app.py' };

test('history success, empty state, and failure', () => {
  const list = parseHistoryList({
    total: 1,
    items: [{
      session_id: 'EYRA-1',
      file_name: 'app.py',
      language: 'python',
      error_type: 'SyntaxError',
      error_summary: '<script>alert(1)</script>',
      root_cause: 'quote',
      status: 'hypothesis',
      verification_status: 'not_run',
      reasoning_source: 'local_heuristic',
      project_name: 'demo',
      created_at: '2026-10-18T10:00:00',
      confidence: 0.4,
      same_error_count: 2,
    }],
  });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].sessionId, 'EYRA-1');
  assert.equal(list.items[0].status, 'hypothesis');
  assert.equal(list.items[0].errorSummary, '<script>alert(1)</script>');
  assert.throws(() => parseHistoryList({ total: 1 }), /missing total or items/);

  const chatHtml = renderInvestigation(view({
    status: 'ready',
    error: '',
    total: 1,
    items: list.items,
    query: '',
  }));
  assert.match(chatHtml, /Investigation History|role="tablist"/);
  assert.match(chatHtml, /AI Debugger/);
  assert.match(chatHtml, /EYRA-1/);
});

test('selecting a history item uses that session id', () => {
  assert.equal(historyDetailPath('EYRA-ABC123'), '/api/history/EYRA-ABC123');
  assert.equal(historyDetailPath('EYRA-OTHER'), '/api/history/EYRA-OTHER');
  assert.equal(historyDetailPath('../secret'), null);
  assert.match(historyListPath({ query: 'syntax', offset: 50, limit: 50 }), /\/api\/history\?/);
  assert.match(historyListPath({ query: 'syntax', offset: 50, limit: 50 }), /offset=50/);
  assert.match(historyListPath({ query: 'syntax', offset: 50, limit: 50 }), /q=syntax/);
  const message = parseWebviewMessage({ type: 'openSession', sessionId: 'EYRA-ABC123' });
  assert.deepEqual(message, { type: 'openSession', sessionId: 'EYRA-ABC123' });
});

test('missing or ambiguous locations do not choose a file', () => {
  assert.equal(resolveEvidenceLocation({ location: '', ...known }).action, 'refuse');
  assert.equal(resolveEvidenceLocation({
    location: 'app.py:4',
    knownFileName: null,
    knownRelativePath: null,
    workspaceBasenames: ['app.py', 'nested/app.py'],
  }).action, 'refuse');
  assert.match(resolveEvidenceLocation({
    location: 'app.py:4',
    knownFileName: null,
    knownRelativePath: null,
    workspaceBasenames: ['app.py'],
  }).reason, /basename alone/);
  assert.equal(resolveEvidenceLocation({ location: 'other.py:9', ...known }).action, 'refuse');
  assert.equal(resolveEvidenceLocation({ location: 'app.py:0', ...known }).action, 'refuse');
  const opened = resolveEvidenceLocation({ location: 'app.py:4-6', ...known });
  assert.deepEqual(opened, { action: 'open', relativePath: 'src/app.py', line: 4, endLine: 6 });
  const noLine = resolveEvidenceLocation({ location: 'app.py', ...known });
  assert.equal(noLine.line, null);
});

test('malformed webview messages are rejected', () => {
  assert.equal(parseWebviewMessage(null), null);
  assert.equal(parseWebviewMessage('refresh'), null);
  assert.equal(parseWebviewMessage({ type: 'dropTable' }), null);
  assert.equal(parseWebviewMessage({ type: 'selectTab', tab: 'files' }), null);
  assert.equal(parseWebviewMessage({ type: 'openSession', sessionId: 'a/b' }), null);
  assert.equal(parseWebviewMessage({ type: 'navigate', location: 'app.py' }), null);
  const apply = parseWebviewMessage({ type: 'requestApply', confirmed: true });
  assert.deepEqual(apply, { type: 'requestApply' });
  assert.equal(Object.hasOwn(apply, 'confirmed'), false);
  assert.deepEqual(parseWebviewMessage({ type: 'requestApply', then: 'tests' }), { type: 'requestApply', then: 'tests' });
  assert.equal(parseWebviewMessage({ type: 'requestApply', then: 'file' }), null);
});

test('cancelling confirmation does not describe an edit', () => {
  const decision = decideFix({
    confirmed: false,
    applyMode: 'review_and_copy',
    documentText: 'print(1)\n',
    analyzedText: 'print(1)\n',
    correctedText: 'print(2)\n',
  });
  assert.equal(decision.kind, 'cancelled');
  assert.equal('newText' in decision, false);
});

test('a supported edit requires confirmation and does not replace a partial file', () => {
  const confirmed = decideFix({
    confirmed: true,
    applyMode: 'review_and_copy',
    documentText: 'print(1)\n',
    analyzedText: 'print(1)\n',
    correctedText: 'print(2)\n',
  });
  assert.deepEqual(confirmed, { kind: 'replace-all', newText: 'print(2)\n' });
  const partial = decideFix({
    confirmed: true,
    applyMode: 'review_and_copy',
    documentText: 'keep\nprint(1)\n',
    analyzedText: 'print(1)\n',
    correctedText: 'print(2)\n',
  });
  assert.equal(partial.kind, 'replace-span');
  assert.notEqual(partial.newText, 'keep\nprint(1)\n');
  assert.ok(partial.start > 0);
  const ambiguous = decideFix({
    confirmed: true,
    applyMode: 'review_and_copy',
    documentText: 'print(1)\nprint(1)\n',
    analyzedText: 'print(1)\n',
    correctedText: 'print(2)\n',
  });
  assert.equal(ambiguous.kind, 'refused');
});
