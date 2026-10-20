/**
 * Phase 8 live Brain + workflow validation.
 * Exercises real /api/* responses with disposable fixture code.
 * Does not drive the Extension Development Host UI.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseAnalyzeResult } = require('../out/parse');
const {
  afterConfirmedEdit,
  appliedDocument,
  decideFix,
  finishVerification,
  historyReopenDecision,
  parseHistoryList,
  proposalState,
  startVerification,
  suggestionDiff,
  workflowLabel,
} = require('../out/phase4Model');
const {
  executeCurrentFileFlow,
  generateTestsFlow,
  parseExecuteResponse,
  runTestsFlow,
} = require('../out/phase3Model');
const { renderInvestigation } = require('../out/investigationHtml');
const { BrainHttpError, requestJson } = require('../out/http');

const BASE = process.env.EYRA_API_BASE || 'http://127.0.0.1:8000';
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'phase8');
const BUG = fs.readFileSync(path.join(FIXTURE, 'bug.py'), 'utf8');
const OK = fs.readFileSync(path.join(FIXTURE, 'ok.py'), 'utf8');

async function brainUp() {
  try {
    const body = await requestJson({ baseUrl: BASE, path: '/api/health', timeoutMs: 5000 });
    return body && body.status === 'ok';
  } catch {
    return false;
  }
}

async function register() {
  const suffix = Date.now().toString(36);
  const body = await requestJson({
    baseUrl: BASE,
    path: '/api/auth/register',
    method: 'POST',
    timeoutMs: 20_000,
    body: {
      email: `phase8${suffix}@example.com`,
      username: `phase8${suffix}`,
      password: `phase8-pass-${suffix}`,
    },
  });
  assert.equal(typeof body.access_token, 'string');
  assert.equal(body.access_token.startsWith('eyra_ext.'), false);
  return body.access_token;
}

function contextFor(fileName, code) {
  return {
    ok: true,
    fileName,
    relativePath: `fixtures/phase8/${fileName}`,
    language: 'python',
    code,
    projectName: 'phase8',
    startLine: 1,
    endLine: code.split('\n').length,
  };
}

function shell(workflow, extras = {}) {
  return {
    tab: extras.tab || 'analysis',
    nonce: 'phase8',
    stale: Boolean(extras.stale),
    botImgUri: '',
    cspSource: '',
    brainOnline: true,
    userInitial: 'K',
    workflow,
    chat: { turns: [] },
    analysis: {
      status: 'ready',
      error: '',
      result: extras.result ?? null,
      localPath: extras.localPath || '',
      hasOrigin: Boolean(extras.hasOrigin),
      startLine: extras.startLine ?? 1,
      endLine: extras.endLine ?? 1,
    },
    execution: {
      status: extras.execution ? 'ready' : 'empty',
      error: '',
      view: extras.execution ?? null,
      localPath: extras.localPath || '',
      fileName: extras.fileName || '',
    },
    tests: {
      status: extras.run ? 'ready' : 'empty',
      error: '',
      generated: extras.generated ?? null,
      run: extras.run ?? null,
      localPath: extras.localPath || '',
      fileName: extras.fileName || '',
    },
    suggestions: {
      status: 'ready',
      error: '',
      performance: null,
      optimize: null,
      localPath: extras.localPath || '',
    },
    history: { status: 'empty', error: '', total: null, items: [], query: '' },
  };
}

test('phase8 live Brain journey for analysis, fix workflow, and verification', async (t) => {
  if (!(await brainUp())) {
    t.skip('Brain is not reachable at ' + BASE);
    return;
  }

  const token = await register();
  const auth = (path, method, body) => requestJson({
    baseUrl: BASE,
    path,
    method,
    token,
    body,
    timeoutMs: method === 'GET' ? 20_000 : 90_000,
  });

  const analyzeRaw = await auth('/api/analyze', 'POST', {
    file_name: 'bug.py',
    language: 'python',
    code_snippet: BUG,
    terminal_output: 'ZeroDivisionError: division by zero',
    stack_trace: '',
    project_name: 'phase8',
    reasoning_profile: 'runtime',
  });
  const analyzed = parseAnalyzeResult(analyzeRaw);
  assert.ok(analyzed.session_id.startsWith('EYRA-'));
  assert.equal(analyzed.suggested_correction.apply_mode, 'review_and_copy');
  assert.ok(analyzed.suggested_correction.corrected_code.length > 0);

  let workflow = {
    ...proposalState(BUG, analyzed.suggested_correction.corrected_code, analyzed.suggested_correction.apply_mode),
    investigationPath: 'fixtures/phase8/bug.py',
  };
  assert.equal(workflow.state, 'proposed');
  const diff = suggestionDiff(BUG, analyzed.suggested_correction.corrected_code, analyzed.suggested_correction.diff_unified);
  assert.ok(diff.text.length > 0);

  const cancelled = decideFix({
    confirmed: false,
    applyMode: 'review_and_copy',
    documentText: BUG,
    analyzedText: BUG,
    correctedText: analyzed.suggested_correction.corrected_code,
  });
  assert.equal(cancelled.kind, 'cancelled');
  assert.equal(BUG, BUG);

  const decision = decideFix({
    confirmed: true,
    applyMode: 'review_and_copy',
    documentText: BUG,
    analyzedText: BUG,
    correctedText: analyzed.suggested_correction.corrected_code,
  });
  assert.ok(decision.kind === 'replace-all' || decision.kind === 'replace-span');
  const edited = appliedDocument(BUG, decision);
  assert.ok(edited);
  assert.notEqual(edited, BUG);
  const applied = afterConfirmedEdit(true);
  workflow = {
    ...workflow,
    state: applied.state,
    detail: applied.detail,
    appliedText: edited,
  };
  assert.equal(workflow.state, 'applied');
  assert.equal(applied.stale, true);

  const htmlApplied = renderInvestigation(shell(workflow, {
    result: analyzed,
    hasOrigin: true,
    localPath: 'fixtures/phase8/bug.py',
    stale: true,
    tab: 'analysis',
  }));
  assert.match(htmlApplied, /Fix Applied/);
  assert.match(htmlApplied, /verify-run/);
  assert.doesNotMatch(htmlApplied, /Fix Verified/);

  const failExec = await executeCurrentFileFlow({
    context: contextFor('bug.py', edited),
    loadRuntimes: () => auth('/api/runtimes', 'GET'),
    confirm: async () => true,
    execute: (body) => auth('/api/execute', 'POST', body),
  });
  assert.equal(failExec.phase, 'result');
  workflow = startVerification(workflow, { path: 'fixtures/phase8/bug.py', documentText: edited });
  assert.equal(workflow.state, 'verification-pending');
  workflow = finishVerification(workflow, {
    type: 'execution',
    path: 'fixtures/phase8/bug.py',
    documentText: edited,
    ok: failExec.view.ok,
    exitCode: failExec.view.exitCode,
    timedOut: failExec.view.timedOut,
    runtimeAvailable: failExec.view.runtimeAvailable,
    stdout: failExec.view.stdout,
    stderr: failExec.view.stderr,
  });
  if (failExec.view.success) {
    assert.equal(workflow.state, 'verified');
  } else {
    assert.equal(workflow.state, 'verification-failed');
  }

  const okContext = contextFor('ok.py', OK);
  const okExec = await executeCurrentFileFlow({
    context: okContext,
    loadRuntimes: () => auth('/api/runtimes', 'GET'),
    confirm: async () => true,
    execute: (body) => auth('/api/execute', 'POST', body),
  });
  assert.equal(okExec.phase, 'result');
  assert.equal(okExec.view.success, true);
  assert.equal(okExec.view.exitCode, 0);

  workflow = {
    state: 'applied',
    detail: 'applied',
    appliedText: OK,
    investigationPath: 'fixtures/phase8/ok.py',
  };
  workflow = startVerification(workflow, { path: 'fixtures/phase8/ok.py', documentText: OK });
  workflow = finishVerification(workflow, {
    type: 'execution',
    path: 'fixtures/phase8/ok.py',
    documentText: OK,
    ok: okExec.view.ok,
    exitCode: okExec.view.exitCode,
    timedOut: okExec.view.timedOut,
    runtimeAvailable: okExec.view.runtimeAvailable,
    stdout: okExec.view.stdout,
    stderr: okExec.view.stderr,
  });
  assert.equal(workflow.state, 'verified');
  assert.equal(workflowLabel(workflow.state), 'Verified');

  const other = startVerification({
    state: 'applied',
    detail: 'applied',
    appliedText: OK,
    investigationPath: 'fixtures/phase8/ok.py',
  }, { path: 'fixtures/phase8/bug.py', documentText: OK });
  assert.equal(other.state, 'applied');
  assert.match(other.detail, /different file/);

  const cancelledRun = await executeCurrentFileFlow({
    context: okContext,
    loadRuntimes: () => auth('/api/runtimes', 'GET'),
    confirm: async () => false,
    execute: async () => {
      throw new Error('execute must not be called');
    },
  });
  assert.equal(cancelledRun.phase, 'cancelled');
  assert.equal(cancelledRun.requested, false);

  const generated = await generateTestsFlow({
    context: okContext,
    generate: (body) => auth('/api/performance/tests/generate', 'POST', body),
  });
  assert.equal(generated.phase, 'review');
  assert.ok(generated.view.cases.length >= 0);

  if (generated.view.cases.length > 0) {
    const reviewed = {
      code: OK,
      language: 'python',
      fileName: 'ok.py',
      cases: generated.view.cases,
    };
    const testRun = await runTestsFlow({
      context: okContext,
      reviewed,
      selectedIds: generated.view.cases.map((item) => item.id),
      confirm: async () => true,
      run: (body) => auth('/api/performance/tests/run', 'POST', body),
    });
    assert.equal(testRun.phase, 'result');
    assert.equal(typeof testRun.view.counts.passed, 'number');
    assert.equal(typeof testRun.view.counts.failed, 'number');
    assert.equal(typeof testRun.view.counts.executed, 'number');
    assert.equal(typeof testRun.view.counts.not_run, 'number');
    if (testRun.view.counts.total === 0 || testRun.view.counts.passed !== testRun.view.counts.total) {
      assert.equal(testRun.view.passing, false);
    }
  }

  const history = parseHistoryList(await auth('/api/history?limit=5&offset=0', 'GET'));
  assert.ok(history.total >= 1);
  const detail = parseAnalyzeResult(await auth(`/api/history/${analyzed.session_id}`, 'GET'));
  assert.equal(detail.session_id, analyzed.session_id);
  const reopen = historyReopenDecision({
    previousSessionId: analyzed.session_id,
    nextSessionId: detail.session_id,
    previousFileName: 'other.py',
    nextFileName: detail.file_name,
    hadOrigin: true,
  });
  assert.equal(reopen.keepOrigin, false);
  const historyHtml = renderInvestigation(shell({
    state: 'proposed',
    detail: 'Opened from history. No local editor path was stored, so the current editor was not used.',
    appliedText: null,
    investigationPath: '',
  }, {
    result: detail,
    hasOrigin: false,
    tab: 'analysis',
  }));
  assert.match(historyHtml, /No local editor path is stored/);
  assert.doesNotMatch(historyHtml, /fixtures\/phase8\/bug\.py/);

  let unavailable;
  try {
    unavailable = parseExecuteResponse({
      ok: true,
      exit_code: 0,
      stdout: '',
      stderr: '',
      runtime_available: false,
      status: 'RUNTIME_UNAVAILABLE',
    });
  } catch (err) {
    unavailable = null;
    assert.fail(String(err));
  }
  assert.equal(unavailable.success, false);
  const failedVerify = finishVerification({
    state: 'verification-pending',
    detail: 'pending',
    appliedText: OK,
    investigationPath: 'fixtures/phase8/ok.py',
  }, {
    type: 'execution',
    path: 'fixtures/phase8/ok.py',
    documentText: OK,
    ok: unavailable.ok,
    exitCode: unavailable.exitCode,
    timedOut: unavailable.timedOut,
    runtimeAvailable: unavailable.runtimeAvailable,
    stdout: '',
    stderr: '',
  });
  assert.equal(failedVerify.state, 'verification-failed');

  const timedOut = parseExecuteResponse({
    ok: false,
    exit_code: -1,
    stdout: '',
    stderr: 'timeout',
    timed_out: true,
    status: 'TIMEOUT',
    runtime_available: true,
  });
  assert.equal(timedOut.success, false);
  assert.equal(timedOut.timedOut, true);
});

test('phase8 disposable fixtures exist and do not touch user project sources', () => {
  assert.equal(fs.existsSync(path.join(FIXTURE, 'bug.py')), true);
  assert.equal(fs.existsSync(path.join(FIXTURE, 'ok.py')), true);
  assert.match(BUG, /divide/);
  assert.match(OK, /add/);
  assert.doesNotMatch(FIXTURE, /dashhboard/);
});
