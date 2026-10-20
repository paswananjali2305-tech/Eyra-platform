const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseWebviewMessage } = require('../out/phase4Model');
const { parseAnalyzeResult } = require('../out/parse');
const { renderInvestigation } = require('../out/investigationHtml');
const {
  afterConfirmedEdit,
  appliedDocument,
  decideFix,
  finishVerification,
  proposalState,
  startVerification,
  suggestionDiff,
} = require('../out/phase4Model');

const extensionDir = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf8'));

test('package commands are registered with matching activation events', () => {
  const commands = manifest.contributes.commands.map((item) => item.command);
  assert.ok(commands.includes('eyra.checkBrain'));
  assert.ok(commands.includes('eyra.signIn'));
  assert.ok(commands.includes('eyra.analyzeFile'));
  assert.ok(commands.includes('eyra.connectWeb'));
  assert.ok(commands.includes('eyra.focusSidebar'));
  // Workspace stays in the left (Primary) Side Bar; Chat lives on the right
  // (Secondary Side Bar, where Copilot Chat sits) in its own container.
  const viewIds = manifest.contributes.views.eyra.map((item) => item.id);
  assert.deepEqual(viewIds, ['eyra.healthView']);
  const chatViewIds = manifest.contributes.views.eyraChat.map((item) => item.id);
  assert.deepEqual(chatViewIds, ['eyra.chatView']);
  assert.deepEqual(
    manifest.contributes.viewsContainers.secondarySidebar.map((item) => item.id),
    ['eyraChat'],
  );
  assert.deepEqual(
    manifest.contributes.viewsContainers.activitybar.map((item) => item.id),
    ['eyra'],
  );
  // Keep the URI event and both sidebar views explicit so clicking EYRA activates the host.
  assert.deepEqual(manifest.activationEvents || [], ['onUri', 'onView:eyra.chatView', 'onView:eyra.healthView']);
  const source = fs.readFileSync(path.join(extensionDir, 'src', 'extension.ts'), 'utf8');
  assert.match(source, /registerWebviewViewProvider\(EyraChatViewProvider\.viewId/);
  assert.match(source, /registerEyraUriHandler/);
  const chatHost = fs.readFileSync(path.join(extensionDir, 'src', 'investigationPanel.ts'), 'utf8');
  assert.match(chatHost, /static readonly viewId = 'eyra\.chatView'/);
  assert.doesNotMatch(chatHost, /createWebviewPanel|ViewColumn|setEditorLayout/);
  const uriHandler = fs.readFileSync(path.join(extensionDir, 'src', 'uriHandler.ts'), 'utf8');
  assert.match(uriHandler, /eyra\.focusSidebar/);
  assert.doesNotMatch(uriHandler, /showInformationMessage|showInputBox|eyra\.signIn|eyra\.connectWeb/);
  for (const command of commands) {
    if (command === 'eyra.focusSidebar') {
      continue; // registered in uriHandler.ts
    }
    assert.match(source, new RegExp(`registerCommand\\('${command.replace('.', '\\.')}'`));
  }
});

test('analysis response feeds the investigation strip and proposed correction', () => {
  const result = parseAnalyzeResult({
    session_id: 'EYRA-ACCEPT',
    status: 'hypothesis',
    error_type: 'ZeroDivisionError',
    error_summary: 'division by zero',
    root_cause: 'divisor is zero',
    explanation: 'b is 0',
    evidence: [{ kind: 'source', detail: 'line 3', location: 'phase8_div.py:3' }],
    execution_timeline: [],
    suggested_correction: {
      summary: 'Guard the divisor',
      corrected_code: 'a = 10\nb = 0\nif b == 0:\n    print("Cannot divide by zero")\nelse:\n    print(a / b)\n',
      apply_mode: 'review_and_copy',
      diff_unified: '--- a\n+++ b\n-print(a / b)\n+print("Cannot divide by zero")\n',
    },
    verification: { status: 'not_run', method: 'none', detail: '', is_hypothesis_only: true },
    reasoning_source: 'local_heuristic',
    file_name: 'phase8_div.py',
    language: 'python',
    code_snippet: 'a = 10\nb = 0\nprint(a / b)\n',
  });
  const workflow = {
    ...proposalState(result.code_snippet, result.suggested_correction.corrected_code, result.suggested_correction.apply_mode),
    investigationPath: 'phase8_div.py',
  };
  const html = renderInvestigation({
    tab: 'chat',
    nonce: 'n',
    stale: false,
    botImgUri: '',
    cspSource: '',
    brainOnline: true,
    userInitial: 'K',
    workflow,
    chat: { turns: [] },
    analysis: {
      status: 'ready',
      error: '',
      result,
      localPath: 'phase8_div.py',
      hasOrigin: true,
      startLine: 1,
      endLine: 3,
    },
    execution: { status: 'empty', error: '', view: null, localPath: '', fileName: '' },
    tests: { status: 'empty', error: '', generated: null, run: null, localPath: '', fileName: '' },
    suggestions: { status: 'ready', error: '', performance: null, optimize: null, localPath: 'phase8_div.py' },
    history: { status: 'empty', error: '', total: null, items: [], query: '' },
  });
  assert.match(html, /I found a /);
  assert.match(html, /Suggested Fix/);
  assert.match(html, /apply-fix/);
  assert.doesNotMatch(html, /View Full Diff|view-full-diff|full-diff-panel/);
  assert.match(html, /Guard the divisor/);
  assert.match(html, /role="tablist"/);
  assert.doesNotMatch(html, /Fix Verified/);
  const analysisHtml = renderInvestigation({
    tab: 'analysis',
    nonce: 'n',
    stale: false,
    botImgUri: '',
    cspSource: '',
    brainOnline: true,
    userInitial: 'K',
    workflow,
    chat: { turns: [] },
    analysis: {
      status: 'ready',
      error: '',
      result,
      localPath: 'phase8_div.py',
      hasOrigin: true,
      startLine: 1,
      endLine: 3,
    },
    execution: { status: 'empty', error: '', view: null, localPath: '', fileName: '' },
    tests: { status: 'empty', error: '', generated: null, run: null, localPath: '', fileName: '' },
    suggestions: { status: 'ready', error: '', performance: null, optimize: null, localPath: 'phase8_div.py' },
    history: { status: 'empty', error: '', total: null, items: [], query: '' },
  });
  // Tab bar hidden; Chat has no ← Chat titlebar; Tests/History get ← Chat from sidebar entry.
  assert.match(analysisHtml, /ZeroDivisionError/);
  assert.match(analysisHtml, /I found a /);
  assert.match(analysisHtml, /Root Cause/);
  assert.match(analysisHtml, /Evidence/);
  assert.match(analysisHtml, /Suggested Fix|Ready to Apply/);
  assert.doesNotMatch(analysisHtml, /data-tab="analysis"/);
  assert.doesNotMatch(analysisHtml, /data-tab="execution"/);
  assert.doesNotMatch(analysisHtml, /Runtime Error|No error detected|Root Cause: None/);
  assert.match(analysisHtml, /#111111/);
  assert.doesNotMatch(html, /← Chat/);
  assert.doesNotMatch(html, /titlebar-menu|data-settings/);
  assert.doesNotMatch(html, /Quick Actions/);
  assert.doesNotMatch(html, /Current File/);
  assert.match(html, /Apply to Editor|Apply Fix|apply-fix/);
  assert.match(html, /\[role="tablist"\][^{]*\{[^}]*display:\s*none/);
  assert.doesNotMatch(html, />Analysis</);
  assert.doesNotMatch(html, />Run</);
  assert.deepEqual(parseWebviewMessage({ type: 'requestApply' }), { type: 'requestApply' });
  assert.deepEqual(parseWebviewMessage({ type: 'chatPrompt', prompt: 'why crash?' }), { type: 'chatPrompt', prompt: 'why crash?' });
  assert.equal(parseWebviewMessage({ type: 'dropTable' }), null);
});

test('analysis without error_type stays honest and sidebar matches reference actions', () => {
  const { renderSidebar } = require('../out/sidebarHtml');
  const result = parseAnalyzeResult({
    session_id: 'EYRA-NEUTRAL',
    status: 'ok',
    error_type: '',
    error_summary: '',
    root_cause: '',
    explanation: '',
    evidence: [],
    execution_timeline: [],
    suggested_correction: {
      summary: '',
      corrected_code: '',
      apply_mode: 'review_and_copy',
      diff_unified: '',
    },
    verification: { status: '', method: '', detail: '', is_hypothesis_only: true },
    reasoning_source: 'local_heuristic',
    file_name: 'ok.py',
    language: 'python',
    code_snippet: 'print(1)\n',
  });
  const html = renderInvestigation({
    tab: 'analysis',
    nonce: 'n',
    stale: false,
    botImgUri: '',
    cspSource: '',
    brainOnline: true,
    userInitial: 'J',
    chat: { turns: [] },
    analysis: {
      status: 'ready',
      error: '',
      result,
      localPath: 'ok.py',
      hasOrigin: true,
      startLine: 1,
      endLine: 1,
    },
    execution: { status: 'empty', error: '', view: null, localPath: '', fileName: '' },
    tests: { status: 'empty', error: '', generated: null, run: null, localPath: '', fileName: '' },
    suggestions: { status: 'empty', error: '', performance: null, optimize: null, localPath: '' },
    history: { status: 'empty', error: '', total: null, items: [], query: '' },
  });
  // Empty error_type/summary → honest "No error found" card (not a fabricated RuntimeError).
  assert.match(html, /No named error|Analysis complete|No error found/);
  assert.match(html, /No root cause was returned|Code looks correct/);
  assert.doesNotMatch(html, /RuntimeError|Runtime Error|No error detected/);
  const sidebar = renderSidebar({
    nonce: 'n',
    health: { ok: true, url: 'http://127.0.0.1:8000/api/health', status: 'ok', service: 'eyra', version: '1', body: {} },
    checking: false,
    backendUrl: 'http://127.0.0.1:8000',
    workspaceName: 'project',
    issueCount: 0,
    user: null,
    activeAction: '',
    treeOpen: true,
    treeLoading: false,
    tree: [{ kind: 'file', name: 'a.py', path: '/a.py' }],
    expanded: [],
    selectedPath: '',
  });
  assert.match(sidebar, /AI Debugger &amp; Dev Assistant/);
  assert.match(sidebar, />Online</);
  assert.doesNotMatch(sidebar, /Issues & Diagnostics/);
  assert.doesNotMatch(sidebar, /Analyze Current File/);
  assert.match(sidebar, /Investigation History/);
  assert.match(sidebar, /Explain Selected Code/);
  assert.match(sidebar, /Find Bugs/);
  assert.match(sidebar, /Run Current File/);
  assert.match(sidebar, /Generate Tests/);
  assert.match(sidebar, /#111111/);
  assert.match(sidebar, /#1B1B1B/);
  assert.match(sidebar, /data-more="\/a\.py"/);
  // The ⋯ menu is one floating overlay (not clipped inside the tree panel);
  // Rename/Delete targets are set on it when a row's ⋯ is clicked.
  assert.match(sidebar, /id="tree-menu"/);
  assert.match(sidebar, /\.tree-menu \{[^}]*position: fixed/);
  assert.match(sidebar, /showTreeMenu/);
  assert.match(sidebar, /setAttribute\('data-rename', path\)/);
  assert.match(sidebar, /setAttribute\('data-delete', path\)/);
  assert.match(sidebar, /tree-panel" style="height:62px"/);
  const collapsed = renderSidebar({
    nonce: 'n',
    health: { ok: true, url: 'http://127.0.0.1:8000/api/health', status: 'ok', service: 'eyra', version: '1', body: {} },
    checking: false,
    backendUrl: 'http://127.0.0.1:8000',
    workspaceName: 'project',
    issueCount: 0,
    user: null,
    activeAction: '',
    treeOpen: false,
    treeLoading: false,
    tree: [{ kind: 'file', name: 'a.py', path: '/a.py' }],
    expanded: [],
    selectedPath: '',
  });
  assert.doesNotMatch(collapsed, /data-open-file="\/a\.py"/);
  assert.match(collapsed, /tree-panel" style="height:35px"/);
});

test('safe apply becomes stale and verification follows the real run outcome', () => {
  const analyzed = 'a = 10\nb = 0\nprint(a / b)\n';
  const corrected = 'a = 10\nb = 1\nprint(a / b)\n';
  assert.equal(suggestionDiff(analyzed, corrected, '').source, 'local');
  const cancelled = decideFix({
    confirmed: false,
    applyMode: 'review_and_copy',
    documentText: analyzed,
    analyzedText: analyzed,
    correctedText: corrected,
  });
  assert.equal(cancelled.kind, 'cancelled');
  const decision = decideFix({
    confirmed: true,
    applyMode: 'review_and_copy',
    documentText: analyzed,
    analyzedText: analyzed,
    correctedText: corrected,
  });
  assert.equal(decision.kind, 'replace-all');
  assert.equal(appliedDocument(analyzed, decision), corrected);
  const applied = afterConfirmedEdit(true);
  assert.equal(applied.state, 'applied');
  assert.equal(applied.stale, true);
  let workflow = {
    state: applied.state,
    detail: applied.detail,
    appliedText: corrected,
    investigationPath: 'phase8_div.py',
  };
  workflow = startVerification(workflow, { path: 'phase8_div.py', documentText: corrected });
  assert.equal(workflow.state, 'verification-pending');
  const failed = finishVerification(workflow, {
    type: 'execution',
    path: 'phase8_div.py',
    documentText: corrected,
    ok: false,
    exitCode: 1,
    timedOut: false,
    runtimeAvailable: true,
    stdout: '',
    stderr: 'boom',
  });
  assert.equal(failed.state, 'verification-failed');
  const verified = finishVerification(workflow, {
    type: 'execution',
    path: 'phase8_div.py',
    documentText: corrected,
    ok: true,
    exitCode: 0,
    timedOut: false,
    runtimeAvailable: true,
    stdout: '10\n',
    stderr: '',
  });
  assert.equal(verified.state, 'verified');
});

test('tests panel shows script mode, honest coverage, and generation defects', () => {
  const generated = {
    cases: [{
      id: 1,
      description: 'Run the script and check its observable output',
      call: null,
      status: 'not_run',
      raw: {
        id: 1,
        name: 'test_script_behavior',
        mode: 'script',
        expected_stdout_contains: ['3'],
        expected_exit_code: 0,
        expected_result: 'exit code 0; stdout contains \'3\'',
      },
    }],
    total: 1,
    passed: 0,
    failed: 0,
    notRun: 1,
    headline: 'Generated 1 case(s) for review. They have not been run.',
    mode: 'script',
    target: null,
    coverage: { status: 'unavailable', measured: false, percent: null, reason: 'Coverage instrumentation was not run.' },
  };
  const run = {
    cases: [{
      id: 1,
      description: 'Calls a missing target',
      call: 'test()',
      status: 'error',
      raw: {
        id: 1,
        name: 'test_missing_target',
        mode: 'function',
        target: 'test',
        generation_defect: 'target_not_found',
        expected_result: 'Returns 0',
        actual_result: 'Raised NameError',
        failure_reason: 'Generation defect: target function \'test\' does not exist in the source.',
      },
    }],
    counts: { total: 1, passed: 0, failed: 0, error: 1, skipped: 0, executed: 0, not_run: 0 },
    log: '',
    passing: false,
    headline: 'Passed 0 · Failed 0 · Error 1',
    passRatePercent: null,
    coverage: { status: 'unavailable', measured: false, percent: null, reason: 'Coverage instrumentation was not run.' },
  };
  const html = renderInvestigation({
    tab: 'tests',
    nonce: 'n',
    stale: false,
    botImgUri: '',
    cspSource: '',
    brainOnline: true,
    userInitial: 'J',
    chat: { turns: [] },
    analysis: { status: 'empty', error: '', result: null, localPath: 'test.py', hasOrigin: true, startLine: 1, endLine: 3 },
    execution: { status: 'empty', error: '', view: null, localPath: '', fileName: '' },
    tests: { status: 'ready', error: '', generated, run, localPath: 'test.py', fileName: 'test.py' },
    suggestions: { status: 'empty', error: '', performance: null, optimize: null, localPath: '' },
    history: { status: 'empty', error: '', total: null, items: [], query: '' },
  });
  assert.match(html, /Script mode/);
  assert.match(html, /test_script_behavior/);
  assert.match(html, /Expected: exit code 0; stdout contains '3'/);
  assert.match(html, /Coverage unavailable/);
  assert.match(html, /Test pass rate:/);
  assert.doesNotMatch(html, /Line Coverage/);
  assert.match(html, /Generation defect/);
  assert.match(html, /not a bug in your code/);
  assert.match(html, /Actual: Raised NameError/);

  const measuredHtml = renderInvestigation({
    tab: 'tests',
    nonce: 'n',
    stale: false,
    botImgUri: '',
    cspSource: '',
    brainOnline: true,
    userInitial: 'J',
    chat: { turns: [] },
    analysis: { status: 'empty', error: '', result: null, localPath: 'test.py', hasOrigin: true, startLine: 1, endLine: 3 },
    execution: { status: 'empty', error: '', view: null, localPath: '', fileName: '' },
    tests: {
      status: 'ready',
      error: '',
      generated,
      run: {
        ...run,
        cases: [{ ...run.cases[0], status: 'passed', raw: { ...run.cases[0].raw, generation_defect: null, failure_reason: null } }],
        counts: { total: 1, passed: 1, failed: 0, error: 0, skipped: 0, executed: 0, not_run: 0 },
        passRatePercent: 100,
        coverage: { status: 'measured', measured: true, percent: 50, reason: 'Measured by line tracing: 1 of 2 executable lines executed.' },
      },
      localPath: 'test.py',
      fileName: 'test.py',
    },
    suggestions: { status: 'empty', error: '', performance: null, optimize: null, localPath: '' },
    history: { status: 'empty', error: '', total: null, items: [], query: '' },
  });
  assert.match(measuredHtml, /Line Coverage 50%/);
  assert.match(measuredHtml, /Test pass rate: 100%/);
  assert.doesNotMatch(measuredHtml, /Coverage unavailable/);
});
