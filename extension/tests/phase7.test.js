const assert = require('node:assert/strict');
const test = require('node:test');
const { parseAnalyzeResult } = require('../out/parse');
const { renderInvestigation } = require('../out/investigationHtml');
const {
  afterConfirmedEdit,
  appliedDocument,
  decideFix,
  finishVerification,
  historyDetailPath,
  historyReopenDecision,
  parseWebviewMessage,
  proposalState,
  startVerification,
  suggestionDiff,
} = require('../out/phase4Model');

function analysisBody(overrides = {}) {
  return {
    session_id: 'EYRA-1',
    status: 'hypothesis',
    error_type: 'SyntaxError',
    error_summary: 'quote',
    root_cause: 'quote',
    explanation: 'explain',
    evidence: [{ kind: 'source', detail: 'line', location: 'app.py:1' }],
    execution_timeline: [],
    suggested_correction: {
      summary: 'Close the quote',
      corrected_code: 'print(2)\n',
      apply_mode: 'review_and_copy',
    },
    verification: { status: 'verified', method: 'none', detail: 'brain label only', is_hypothesis_only: false },
    reasoning_source: 'local_heuristic',
    file_name: 'app.py',
    language: 'python',
    code_snippet: 'print(1)\n',
    ...overrides,
  };
}

function shell(workflow, extra = {}) {
  return {
    tab: extra.tab || 'analysis',
    nonce: 'n',
    stale: Boolean(extra.stale),
    botImgUri: '',
    cspSource: '',
    brainOnline: true,
    userInitial: 'K',
    workflow,
    chat: { turns: [] },
    analysis: {
      status: 'ready',
      error: '',
      result: extra.result ?? null,
      localPath: extra.localPath || '',
      hasOrigin: Boolean(extra.hasOrigin),
      startLine: extra.startLine ?? null,
      endLine: extra.endLine ?? null,
    },
    execution: { status: 'empty', error: '', view: extra.execution ?? null, localPath: '', fileName: '' },
    tests: { status: 'empty', error: '', generated: null, run: extra.run ?? null, localPath: '', fileName: '' },
    suggestions: { status: 'ready', error: '', performance: null, optimize: extra.optimize ?? null, localPath: extra.localPath || '' },
    history: { status: 'empty', error: '', total: null, items: [], query: '' },
  };
}

function appliedSnapshot(text = 'print(2)\n') {
  return {
    state: 'applied',
    detail: 'The suggestion was applied. This analysis is stale. Verification has not run.',
    appliedText: text,
    investigationPath: 'src/app.py',
  };
}

test('a normal chat answer keeps prose and renders fenced code as a block', () => {
  const view = shell({ state: 'none', detail: '', appliedText: '', investigationPath: '' }, { tab: 'chat' });
  view.chat = {
    turns: [
      { id: 'u', role: 'user', text: 'can you tell me about if and else', at: 1 },
      {
        id: 'b',
        role: 'bot',
        text: 'An if statement checks a condition.\n\n```python\nif x > 0:\n    print(x)\n```\n\nThat runs when x is positive.',
        at: 2,
      },
    ],
  };
  const html = renderInvestigation(view);
  assert.match(html, /An if statement checks a condition/);
  assert.match(html, /md-code/);
  assert.match(html, /class="ui-ev-ln">1</);
  assert.match(html, /class="ui-ev-ln">2</);
  assert.match(html, />print</);
  assert.doesNotMatch(html, /```python/);
  assert.doesNotMatch(html, /Suggested Fix/);
});

test('a one-line fix in the explanation still renders Suggested Fix', () => {
  const snippet = 'x = 10\ny = 0\nif y = 0:\n    result = divide(x, y)\n';
  const result = parseAnalyzeResult(analysisBody({
    error_type: 'SyntaxError',
    error_summary: 'Invalid assignment in if statement',
    root_cause: 'The if condition uses = instead of ==.',
    explanation: 'Replace the assignment.\n\n```python\nif y == 0:\n```',
    code_snippet: snippet,
    file_name: 'test.py',
    suggested_correction: {
      summary: "Replace '=' with '==' in the if condition.",
      corrected_code: '',
      apply_mode: 'review_and_copy',
    },
  }));
  const html = renderInvestigation(shell({
    state: 'none',
    detail: '',
    appliedText: '',
    investigationPath: '',
  }, {
    tab: 'chat',
    result,
    hasOrigin: true,
    localPath: 'test.py',
    startLine: 1,
    endLine: 4,
  }));
  assert.match(html, /Suggested Fix/);
  assert.match(html, /Apply to Editor/);
  assert.match(html, /sfx-row add/);
  assert.match(html, /sfx-row del/);
});

test('a clean file is shown in green, including a no-runtime-error summary', () => {
  const result = parseAnalyzeResult(analysisBody({
    error_type: 'None',
    error_summary: 'No runtime error detected',
    root_cause: 'N/A',
    explanation: 'The code correctly accesses the last element of the list and prints it.',
    code_snippet: 'numbers = [1, 2, 3]\nprint(numbers[-1])\n',
    file_name: 'test.py',
    suggested_correction: {
      summary: '',
      corrected_code: '',
      apply_mode: 'review_and_copy',
    },
  }));
  const html = renderInvestigation(shell({
    state: 'none',
    detail: '',
    appliedText: '',
    investigationPath: '',
  }, {
    tab: 'chat',
    result,
    hasOrigin: true,
    localPath: 'test.py',
    startLine: 1,
    endLine: 2,
  }));
  assert.match(html, /chat-ok-card/);
  assert.match(html, /No error found/);
  assert.match(html, /correctly accesses the last element/);
  assert.doesNotMatch(html, /I found an issue/);
  assert.doesNotMatch(html, /composer-spark|title="Attach"|title="Voice"/);
});

test('a failed test run shows Apply Fix when the updated code is only in the explanation', () => {
  const snippet = 'def add(a, b):\n    return a - b\n';
  const result = parseAnalyzeResult(analysisBody({
    file_name: 'other.py',
    code_snippet: snippet,
    explanation: 'Use addition.\n\n```python\ndef add(a, b):\n    return a + b\n```',
    suggested_correction: {
      summary: 'Return the sum',
      corrected_code: '',
      apply_mode: 'review_and_copy',
    },
  }));
  const view = shell({
    state: 'none',
    detail: '',
    appliedText: '',
    investigationPath: '',
  }, {
    tab: 'tests',
    result,
    hasOrigin: true,
    localPath: 'src/app.py',
    startLine: 1,
    endLine: 2,
    run: {
      cases: [{ id: 1, description: 'adds two numbers', call: 'add(1, 2)', status: 'failed', raw: { stderr: 'expected 3' } }],
      counts: { total: 1, passed: 0, failed: 1, executed: 1, not_run: 0 },
      log: '',
      passing: false,
      headline: '1 failed',
    },
  });
  view.tests.fileName = 'C:/proj/test_app.py';
  view.tests.localPath = 'test_app.py';
  view.tests.status = 'ready';
  const html = renderInvestigation(view);
  assert.match(html, /id="apply-fix-tests"/);
  assert.match(html, /Apply Fix/);
  assert.match(html, /runs all test cases/);
  assert.doesNotMatch(html, /Analyze the file to get an updated version/);
});

test('suggestion diff prefers the Brain diff and otherwise compares lines locally', () => {
  const brain = suggestionDiff('print(1)\n', 'print(2)\n', '--- a\n+++ b\n-print(1)\n+print(2)\n');
  assert.equal(brain.source, 'brain');
  assert.match(brain.text, /--- a/);
  const local = suggestionDiff('print(1)\n', 'print(2)\n', '');
  assert.equal(local.source, 'local');
  assert.match(local.text, /--- analyzed/);
  assert.match(local.text, /-print\(1\)/);
  assert.match(local.text, /\+print\(2\)/);
  const result = parseAnalyzeResult(analysisBody({
    suggested_correction: {
      summary: 'Close the quote',
      corrected_code: 'print(2)\n',
      diff_unified: '--- a\n+++ b\n',
      apply_mode: 'review_and_copy',
    },
  }));
  const html = renderInvestigation(shell(proposalState('print(1)\n', 'print(2)\n', 'review_and_copy'), {
    result,
    hasOrigin: true,
    localPath: 'src/app.py',
    startLine: 1,
    endLine: 1,
  }));
  assert.match(html, /Suggested Fix|Ready to Apply|apply-fix/);
  assert.match(html, /Apply to Editor/);
  assert.match(html, /app\.py/);
  assert.match(html, /Line 1/);
  assert.doesNotMatch(html, /Fix Verified/);
  const analysisHtml = renderInvestigation(shell(proposalState('print(1)\n', 'print(2)\n', 'review_and_copy'), {
    tab: 'analysis',
    result,
    hasOrigin: true,
    localPath: 'src/app.py',
    startLine: 1,
    endLine: 1,
  }));
  // Analysis tab routes into Chat now.
  assert.match(analysisHtml, /I found a |Suggested Fix|Root Cause/);
  assert.match(analysisHtml, /Apply to Editor/);
  assert.doesNotMatch(analysisHtml, /Fix Verified/);
});

test('a changed, ambiguous, or cancelled document is not edited', () => {
  const changed = decideFix({
    confirmed: true,
    applyMode: 'review_and_copy',
    documentText: 'print(9)\n',
    analyzedText: 'print(1)\n',
    correctedText: 'print(2)\n',
  });
  assert.equal(changed.kind, 'refused');
  assert.match(changed.reason, /changed since this analysis/);
  assert.equal(appliedDocument('print(9)\n', changed), null);

  const ambiguous = decideFix({
    confirmed: true,
    applyMode: 'review_and_copy',
    documentText: 'print(1)\nprint(1)\n',
    analyzedText: 'print(1)\n',
    correctedText: 'print(2)\n',
  });
  assert.equal(ambiguous.kind, 'refused');
  assert.match(ambiguous.reason, /more than once/);

  const cancelled = decideFix({
    confirmed: false,
    applyMode: 'review_and_copy',
    documentText: 'print(1)\n',
    analyzedText: 'print(1)\n',
    correctedText: 'print(2)\n',
  });
  assert.equal(cancelled.kind, 'cancelled');
  assert.equal('newText' in cancelled, false);

  const failedEdit = afterConfirmedEdit(false);
  assert.equal(failedEdit.state, 'proposed');
  assert.equal(failedEdit.stale, false);
  assert.match(failedEdit.detail, /not recorded as updated/);
});

test('a confirmed unique edit becomes stale and keeps surrounding code', () => {
  const decision = decideFix({
    confirmed: true,
    applyMode: 'review_and_copy',
    documentText: 'keep\nprint(1)\n',
    analyzedText: 'print(1)\n',
    correctedText: 'print(2)\n',
  });
  assert.equal(decision.kind, 'replace-span');
  assert.equal(appliedDocument('keep\nprint(1)\n', decision), 'keep\nprint(2)\n');
  const outcome = afterConfirmedEdit(true);
  assert.equal(outcome.state, 'applied');
  assert.equal(outcome.stale, true);
  assert.match(outcome.detail, /Verification has not run/);
});

test('verification passes only after a real matching run', () => {
  const applied = appliedSnapshot();
  const pending = startVerification(applied, { path: 'src/app.py', documentText: applied.appliedText });
  assert.equal(pending.state, 'verification-pending');
  const verified = finishVerification(pending, {
    type: 'execution',
    path: 'src/app.py',
    documentText: applied.appliedText,
    ok: true,
    exitCode: 0,
    timedOut: false,
    runtimeAvailable: true,
    stdout: 'ok',
    stderr: '',
  });
  assert.equal(verified.state, 'verified');

  const failed = finishVerification(pending, {
    type: 'execution',
    path: 'src/app.py',
    documentText: applied.appliedText,
    ok: false,
    exitCode: 1,
    timedOut: false,
    runtimeAvailable: true,
    stdout: '',
    stderr: 'boom',
  });
  assert.equal(failed.state, 'verification-failed');
  assert.match(failed.detail, /exit 1/);

  const cancelled = finishVerification(pending, {
    type: 'cancelled',
    path: 'src/app.py',
    documentText: applied.appliedText,
  });
  assert.equal(cancelled.state, 'verification-failed');
  assert.match(cancelled.detail, /cancelled/);
  assert.doesNotMatch(cancelled.detail, /Verified/);

  const noTests = finishVerification(pending, {
    type: 'tests',
    path: 'src/app.py',
    documentText: applied.appliedText,
    total: 0,
    passed: 0,
    failed: 0,
    executed: 0,
    notRun: 0,
  });
  assert.equal(noTests.state, 'verification-failed');
  assert.match(noTests.detail, /not_run 0/);

  const executedOnly = finishVerification(pending, {
    type: 'tests',
    path: 'src/app.py',
    documentText: applied.appliedText,
    total: 2,
    passed: 0,
    failed: 0,
    executed: 2,
    notRun: 0,
  });
  assert.equal(executedOnly.state, 'verification-failed');
  assert.match(executedOnly.detail, /executed 2/);

  const unavailable = finishVerification(pending, {
    type: 'execution',
    path: 'src/app.py',
    documentText: applied.appliedText,
    ok: true,
    exitCode: 0,
    timedOut: false,
    runtimeAvailable: false,
    stdout: '',
    stderr: '',
  });
  assert.equal(unavailable.state, 'verification-failed');
});

test('a diverged document or another file cannot be verified', () => {
  const applied = appliedSnapshot();
  const diverged = startVerification(applied, { path: 'src/app.py', documentText: 'print(9)\n' });
  assert.equal(diverged.state, 'stale');
  assert.notEqual(finishVerification(diverged, {
    type: 'execution',
    path: 'src/app.py',
    documentText: 'print(9)\n',
    ok: true,
    exitCode: 0,
    timedOut: false,
    runtimeAvailable: true,
    stdout: '',
    stderr: '',
  }).state, 'verified');

  const otherFile = startVerification(applied, { path: 'src/other.py', documentText: applied.appliedText });
  assert.equal(otherFile.state, 'applied');
  assert.match(otherFile.detail, /different file/);
});

test('reopening history does not invent an editor path', () => {
  assert.equal(historyReopenDecision({
    previousSessionId: 'EYRA-1',
    nextSessionId: 'EYRA-2',
    previousFileName: 'app.py',
    nextFileName: 'app.py',
    hadOrigin: true,
  }).keepOrigin, false);
  assert.equal(historyReopenDecision({
    previousSessionId: 'EYRA-1',
    nextSessionId: 'EYRA-1',
    previousFileName: 'app.py',
    nextFileName: 'app.py',
    hadOrigin: false,
  }).keepOrigin, false);
  assert.equal(historyReopenDecision({
    previousSessionId: 'EYRA-1',
    nextSessionId: 'EYRA-1',
    previousFileName: 'app.py',
    nextFileName: 'app.py',
    hadOrigin: true,
  }).keepOrigin, true);
  const html = renderInvestigation(shell({
    state: 'proposed',
    detail: 'Opened from history. No local editor path was stored, so the current editor was not used.',
    appliedText: null,
    investigationPath: '',
  }, {
    result: parseAnalyzeResult(analysisBody()),
    hasOrigin: false,
  }));
  assert.match(html, /No local editor path is stored/);
  assert.match(html, /current editor was not used/);
  assert.doesNotMatch(html, /C:\\/);
});

test('malformed verify messages and session ids are rejected', () => {
  assert.equal(historyDetailPath('EYRA 1'), null);
  assert.equal(historyDetailPath('../secret'), null);
  assert.equal(parseWebviewMessage({ type: 'openSession', sessionId: 'EYRA 1' }), null);
  assert.equal(parseWebviewMessage({ type: 'requestVerify', method: 'apply' }), null);
  assert.equal(parseWebviewMessage({ type: 'requestVerify' }), null);
  assert.deepEqual(parseWebviewMessage({ type: 'requestVerify', method: 'execute' }), {
    type: 'requestVerify',
    method: 'execute',
  });
});
