const assert = require('node:assert/strict');
const test = require('node:test');
const { renderInvestigation, languageDisplayName, languageFromFileName } = require('../out/investigationHtml');
const { parseGeneratedTests, parseTestRun } = require('../out/phase3Model');

function testsView(generated, run = null) {
  return {
    tab: 'tests',
    nonce: 'n',
    stale: false,
    botImgUri: '',
    cspSource: '',
    brainOnline: true,
    userInitial: 'K',
    chat: { turns: [] },
    analysis: { status: 'empty', error: '', result: null, localPath: '', hasOrigin: false, startLine: null, endLine: null },
    execution: { status: 'empty', error: '', view: null, localPath: '', fileName: '' },
    tests: { status: 'ready', error: '', generated, run, localPath: 'ee.tsx', fileName: 'ee.tsx' },
    suggestions: { status: 'empty', error: '', performance: null, optimize: null, localPath: '' },
    history: { status: 'empty', error: '', total: null, items: [], query: '' },
  };
}

const TS_CASE = {
  id: 1,
  name: 'test_add_minimal_input',
  description: 'add minimal input',
  call: 'add(0, 0)',
  mode: 'function',
  target: 'add',
  status: 'not_run',
  expected: 0,
  assert_expected: true,
};

test('language display names follow the file, never default to Python', () => {
  assert.equal(languageDisplayName('typescript'), 'TypeScript');
  assert.equal(languageDisplayName('typescriptreact'), 'TypeScript');
  assert.equal(languageDisplayName('javascript'), 'JavaScript');
  assert.equal(languageDisplayName('', 'ee.tsx'), 'TypeScript');
  assert.equal(languageDisplayName('', 'add.js'), 'JavaScript');
  assert.equal(languageDisplayName('', 'main.py'), 'Python');
  assert.equal(languageDisplayName('', 'ee.tsx'), 'TypeScript');
  assert.equal(languageDisplayName(''), 'Code');
  assert.equal(languageFromFileName('ee.tsx'), 'typescript');
});

test('generate/run payloads carry language and file name', () => {
  const generated = parseGeneratedTests({
    cases: [TS_CASE],
    total: 1,
    mode: 'function',
    language: 'typescript',
    file_name: 'ee.tsx',
    coverage: { status: 'unavailable', measured: false, percent: null, reason: 'not run yet' },
  });
  assert.equal(generated.language, 'typescript');
  assert.equal(generated.fileName, 'ee.tsx');

  const run = parseTestRun({
    cases: [{ ...TS_CASE, status: 'passed' }],
    total: 1,
    passed: 1,
    failed: 0,
    not_run: 0,
    language: 'typescript',
    file_name: 'ee.tsx',
    coverage: {
      status: 'measured',
      measured: true,
      percent: 100,
      reason: 'Measured by Node V8 coverage after tsc compilation (lines mapped via source map): 3 of 3 executable lines executed.',
      covered_lines: 3,
      total_lines: 3,
    },
  });
  assert.equal(run.language, 'typescript');
  assert.equal(run.coverage.measured, true);
  assert.equal(run.coverage.coveredLines, 3);
});

test('tests panel shows TypeScript for ee.tsx and renders the coverage chart at 100%', () => {
  const generated = parseGeneratedTests({
    cases: [TS_CASE],
    total: 1,
    mode: 'function',
    target: 'calculateTotal',
    language: 'typescript',
    file_name: 'ee.tsx',
    coverage: { status: 'unavailable', measured: false, percent: null, reason: 'not run yet' },
  });
  const run = parseTestRun({
    cases: [{ ...TS_CASE, status: 'passed' }],
    total: 1,
    passed: 1,
    failed: 0,
    not_run: 0,
    pass_rate_percent: 100,
    language: 'typescript',
    file_name: 'ee.tsx',
    coverage: {
      status: 'measured',
      measured: true,
      percent: 100,
      reason: 'Measured by Node V8 coverage: 3 of 3 executable lines executed.',
      covered_lines: 3,
      total_lines: 3,
    },
  });
  const html = renderInvestigation(testsView(generated, run));
  assert.match(html, /TypeScript/);
  assert.doesNotMatch(html, />Python</);
  assert.match(html, /Function mode · calculateTotal/);
  assert.match(html, /Line Coverage 100%/);
  assert.match(html, /cov-ring/);
  assert.match(html, /tg-coverage-bar/);
  assert.match(html, /Covered lines: 3 of 3/);
});
