const assert = require('node:assert/strict');
const test = require('node:test');
const { BrainHttpError } = require('../out/http');
const {
  executeCurrentFileFlow,
  generateTestsFlow,
  parseExecuteResponse,
  parseGeneratedTests,
  parseOptimize,
  parsePerformance,
  parseTestRun,
  planTestRun,
  runTestsFlow,
  suiteSummary,
} = require('../out/phase3Model');
const { renderExecuteHtml, renderOptimizeHtml, renderTestRunHtml } = require('../out/resultHtml');

function file(language = 'python') {
  return {
    ok: true,
    fileName: 'app.py',
    relativePath: 'src/app.py',
    language,
    code: 'print(1)\n',
    projectName: 'demo',
    startLine: 1,
    endLine: 1,
  };
}

function runtimes() {
  return {
    runtimes: [
      { language: 'python', displayName: 'Python', runtime: 'cpython', available: true, version: '3', detail: 'ok', executable: true },
      { language: 'javascript', displayName: 'JavaScript', runtime: 'node', available: false, version: null, detail: 'node is not installed', executable: true },
      { language: 'html', displayName: 'HTML', runtime: null, available: false, version: null, detail: 'Adapter not implemented yet — analyze-only', executable: false },
      { language: 'css', displayName: 'CSS', runtime: null, available: false, version: null, detail: 'Adapter not implemented yet — analyze-only', executable: false },
      { language: 'sql', displayName: 'SQL', runtime: null, available: false, version: null, detail: 'Adapter not implemented yet — analyze-only', executable: false },
    ],
  };
}

const reviewed = {
  code: 'print(1)\n',
  language: 'python',
  fileName: 'app.py',
  cases: [
    { id: 1, description: 'prints', call: 'print(1)', status: 'not_run', raw: { id: 1, call: 'print(1)', description: 'prints' } },
  ],
};

test('cancelled execution sends no execute request', async () => {
  let executions = 0;
  const result = await executeCurrentFileFlow({
    context: file(),
    loadRuntimes: async () => runtimes(),
    confirm: async () => false,
    execute: async () => {
      executions += 1;
      return {};
    },
  });
  assert.equal(executions, 0);
  assert.equal(result.requested, false);
  assert.equal(result.phase, 'cancelled');
  assert.equal(result.success, false);
});

test('unsupported runtime prevents execution', async () => {
  let executions = 0;
  let confirms = 0;
  for (const language of ['html', 'css', 'sql', 'javascript']) {
    const result = await executeCurrentFileFlow({
      context: file(language),
      loadRuntimes: async () => runtimes(),
      confirm: async () => {
        confirms += 1;
        return true;
      },
      execute: async () => {
        executions += 1;
        return {};
      },
    });
    assert.equal(result.phase, 'unsupported');
    assert.equal(result.success, false);
  }
  assert.equal(executions, 0);
  assert.equal(confirms, 0);
});

test('confirmed execution uses the execute payload', async () => {
  const seen = [];
  const result = await executeCurrentFileFlow({
    context: file(),
    loadRuntimes: async () => runtimes(),
    confirm: async () => true,
    execute: async (body) => {
      seen.push(body);
      return {
        ok: true,
        exit_code: 0,
        stdout: '1\n',
        stderr: '',
        runtime_available: true,
        status: 'OK',
        timed_out: false,
        duration_ms: 12,
        language: 'python',
        runtime: 'cpython',
      };
    },
  });
  assert.deepEqual(seen, [{ code: 'print(1)\n', language: 'python', file_name: 'app.py' }]);
  assert.equal(result.success, true);
  assert.equal(result.view.durationMs, 12);
  assert.equal(result.view.runtimeAvailable, true);
});

test('http failure is not a successful execution', async () => {
  const result = await executeCurrentFileFlow({
    context: file(),
    loadRuntimes: async () => runtimes(),
    confirm: async () => true,
    execute: async () => {
      throw new BrainHttpError('Brain returned HTTP 500.', 500);
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.phase, 'http');
  assert.equal('view' in result, false);
  const failed = parseExecuteResponse({
    ok: false,
    exit_code: 1,
    stdout: '',
    stderr: '<script>alert(1)</script>',
    runtime_available: true,
    status: 'ERROR',
    duration_ms: 4,
  });
  const html = renderExecuteHtml(failed);
  assert.equal(failed.success, false);
  assert.match(html, /not a successful execution/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('tests are reviewed before any run request', async () => {
  let runs = 0;
  const generated = await generateTestsFlow({
    context: file(),
    generate: async (body) => {
      assert.deepEqual(body, { code: 'print(1)\n', language: 'python', file_name: 'app.py' });
      assert.equal('function_name' in body, false);
      return {
        cases: [{ id: 1, description: 'review me', call: null, status: 'not_run' }],
        total: 1,
        passed: 0,
        failed: 0,
        not_run: 1,
      };
    },
  });
  assert.equal(generated.phase, 'review');
  assert.match(generated.view.headline, /have not been run/);
  const cancelled = await runTestsFlow({
    context: file(),
    reviewed,
    selectedIds: [1],
    confirm: async () => false,
    run: async () => {
      runs += 1;
      return {};
    },
  });
  assert.equal(cancelled.phase, 'cancelled');
  assert.equal(runs, 0);
  const planned = planTestRun({ context: file(), reviewed, selectedIds: [1], confirmed: true });
  assert.deepEqual(planned.request.case_ids, [1]);
  assert.deepEqual(planned.request.cases, [{ id: 1, call: 'print(1)', description: 'prints' }]);
  assert.equal(planned.request.file_name, 'app.py');
});

test('zero executed tests are not a passing suite', () => {
  const counts = { total: 2, passed: 0, failed: 0, error: 0, skipped: 0, executed: 0, not_run: 2 };
  const summary = suiteSummary(counts);
  assert.equal(summary.passing, false);
  assert.match(summary.headline, /not a passing suite/);
  const view = parseTestRun({ cases: [], ...counts, log: '' });
  const html = renderTestRunHtml(view);
  assert.equal(view.passing, false);
  assert.match(html, /not a passing suite/);
  const onlyRan = suiteSummary({ total: 1, passed: 0, failed: 0, error: 0, skipped: 1, executed: 1, not_run: 0 });
  assert.equal(onlyRan.passing, false);
  assert.match(onlyRan.headline, /not counted as passed/);
});

test('generated script cases are preserved without padding or invented calls', () => {
  const view = parseGeneratedTests({
    cases: [{
      id: 1,
      name: 'test_script_behavior',
      description: 'Run the script and check its observable output',
      call: null,
      status: 'not_run',
      mode: 'script',
      expected_stdout_contains: ['3'],
      expected_exit_code: 0,
    }],
    total: 1,
    passed: 0,
    failed: 0,
    not_run: 1,
    mode: 'script',
    target: null,
    coverage: { status: 'unavailable', measured: false, percent: null, reason: 'No instrumentation.' },
  });
  assert.equal(view.cases.length, 1);
  assert.equal(view.mode, 'script');
  assert.equal(view.cases[0].call, null);
  assert.equal(view.coverage.measured, false);
});

test('non-python generation surfaces the python-only notice with no fake cases', () => {
  const view = parseGeneratedTests({
    cases: [],
    total: 0,
    passed: 0,
    failed: 0,
    not_run: 0,
    mode: 'unsupported',
    target: null,
    notice: 'Automatic test generation is currently Python-only. No test cases were generated for typescriptreact.',
    coverage: { status: 'unavailable', measured: false, percent: null, reason: 'No instrumentation.' },
  });
  assert.equal(view.cases.length, 0);
  assert.equal(view.mode, 'unsupported');
  assert.match(view.notice, /Python-only/);
  assert.match(view.headline, /Python-only/);
});

test('test run separates pass rate from unavailable coverage', () => {
  const view = parseTestRun({
    cases: [{ id: 1, description: 'script output', call: null, status: 'passed' }],
    total: 1,
    passed: 1,
    failed: 0,
    error: 0,
    skipped: 0,
    executed: 0,
    not_run: 0,
    pass_rate_percent: 100,
    coverage: { status: 'unavailable', measured: false, percent: null, reason: 'No instrumentation.' },
    log: 'done',
  });
  assert.equal(view.passing, true);
  assert.equal(view.passRatePercent, 100);
  assert.equal(view.coverage.measured, false);
  const html = renderTestRunHtml(view);
  assert.match(html, /Coverage unavailable/);
  assert.doesNotMatch(html, /Line Coverage 100%/);
});

test('malformed api responses are rejected', () => {
  assert.throws(() => parseExecuteResponse(null), /unexpected execution response/);
  assert.throws(() => parseGeneratedTests({ cases: 'nope' }), /cases list/);
  assert.throws(() => parseTestRun({ cases: [], passed: 0, failed: 0, not_run: 0 }), /missing total/);
  assert.throws(() => parseTestRun({ cases: [{ id: 0, description: 'bad', status: 'not_run' }], total: 1, passed: 0, failed: 0, not_run: 1 }), /positive integer id/);
  assert.throws(() => parsePerformance({}), /complexity/);
  assert.throws(() => parseOptimize({ suggestion: { reasons: [] } }), /applied_transform/);
  const suggestion = parseOptimize({
    file_name: 'app.py',
    language: 'python',
    suggestion: {
      applied_transform: false,
      current_time: 'O(n)',
      current_space: 'O(1)',
      optimized_time: 'O(n)',
      optimized_space: 'O(1)',
      reasons: ['keep the source'],
      optimized_code: 'print(1)\n',
      reasoning_source: 'local_heuristic',
    },
  });
  const html = renderOptimizeHtml(suggestion);
  assert.match(html, /not a measured speedup/);
  assert.match(html, /not a measured performance improvement/i);
});
