const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  MAX_DIAGNOSTICS,
  buildAnalyzeDiagnostics,
  countWorkspaceIssues,
  isGeneratedPath,
} = require('../out/diagnosticsModel');

function raw(overrides = {}) {
  return {
    message: 'Cannot find name x',
    severity: 'error',
    filePath: 'C:/proj/app.ts',
    line: 2,
    character: 4,
    source: 'ts',
    code: 2304,
    ...overrides,
  };
}

test('errors and warnings keep severity and zero-based locations', () => {
  const out = buildAnalyzeDiagnostics(
    [
      raw({ message: 'err', severity: 'error', line: 10, character: 2 }),
      raw({ message: 'warn', severity: 'warning', line: 11, character: 0, code: 'W1' }),
      raw({ message: 'info', severity: 'info', line: 12, character: 1 }),
    ],
    { kind: 'file', matchPath: 'C:/proj/app.ts', fileName: 'app.ts' },
  );
  assert.equal(out.length, 3);
  assert.equal(out[0].severity, 'error');
  assert.equal(out[0].line, 10);
  assert.equal(out[0].character, 2);
  assert.equal(out[0].file_name, 'app.ts');
  assert.equal(out[1].severity, 'warning');
  assert.equal(out[1].code, 'W1');
  assert.equal(out[2].severity, 'info');
});

test('empty diagnostics yield empty array', () => {
  const out = buildAnalyzeDiagnostics([], {
    kind: 'file',
    matchPath: 'C:/proj/app.ts',
    fileName: 'app.ts',
  });
  assert.deepEqual(out, []);
});

test('malformed or blank messages are skipped', () => {
  const out = buildAnalyzeDiagnostics(
    [
      raw({ message: '   ' }),
      raw({ message: 'ok', severity: 99 }),
      raw({ message: 'bad line', line: -1 }),
      raw({ message: 'good', severity: 0 }),
    ],
    { kind: 'file', matchPath: 'C:/proj/app.ts', fileName: 'app.ts' },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'error');
  assert.equal(out[0].message, 'good');
});

test('selection scope keeps only overlapping lines', () => {
  const out = buildAnalyzeDiagnostics(
    [
      raw({ message: 'before', line: 0 }),
      raw({ message: 'in-range', line: 4 }),
      raw({ message: 'after', line: 9 }),
    ],
    {
      kind: 'file',
      matchPath: 'C:/proj/app.ts',
      fileName: 'app.ts',
      startLine0: 3,
      endLine0: 5,
    },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].message, 'in-range');
});

test('file scope excludes other files; workspace includes them', () => {
  const mixed = [
    raw({ message: 'here', filePath: 'C:/proj/app.ts' }),
    raw({ message: 'other', filePath: 'C:/proj/other.ts', line: 1 }),
  ];
  const fileOnly = buildAnalyzeDiagnostics(mixed, {
    kind: 'file',
    matchPath: 'C:/proj/app.ts',
    fileName: 'app.ts',
  });
  assert.equal(fileOnly.length, 1);
  assert.equal(fileOnly[0].message, 'here');

  const workspace = buildAnalyzeDiagnostics(mixed, { kind: 'workspace' });
  assert.equal(workspace.length, 2);
  assert.equal(workspace[1].file_name, 'other.ts');
});

test('deduplicates identical diagnostics', () => {
  const out = buildAnalyzeDiagnostics(
    [raw(), raw(), raw({ message: 'different' })],
    { kind: 'file', matchPath: 'C:/proj/app.ts', fileName: 'app.ts' },
  );
  assert.equal(out.length, 2);
});

test('caps at MAX_DIAGNOSTICS', () => {
  const many = Array.from({ length: MAX_DIAGNOSTICS + 20 }, (_, i) =>
    raw({ message: `m${i}`, line: i }),
  );
  const out = buildAnalyzeDiagnostics(many, {
    kind: 'file',
    matchPath: 'C:/proj/app.ts',
    fileName: 'app.ts',
  });
  assert.equal(out.length, MAX_DIAGNOSTICS);
});

test('numeric vscode severities map correctly', () => {
  const out = buildAnalyzeDiagnostics(
    [
      raw({ severity: 0, message: 'e' }),
      raw({ severity: 1, message: 'w', line: 1 }),
      raw({ severity: 2, message: 'i', line: 2 }),
      raw({ severity: 3, message: 'h', line: 3 }),
    ],
    { kind: 'file', matchPath: 'C:/proj/app.ts', fileName: 'app.ts' },
  );
  assert.deepEqual(
    out.map((d) => d.severity),
    ['error', 'warning', 'info', 'hint'],
  );
});

test('code objects stringify value', () => {
  const out = buildAnalyzeDiagnostics(
    [raw({ code: { value: 2304 } })],
    { kind: 'file', matchPath: 'C:/proj/app.ts', fileName: 'app.ts' },
  );
  assert.equal(out[0].code, '2304');
});

test('does not claim verification — payload is evidence only', () => {
  const out = buildAnalyzeDiagnostics(
    [raw()],
    { kind: 'file', matchPath: 'C:/proj/app.ts', fileName: 'app.ts' },
  );
  assert.ok(!('verified' in out[0]));
  assert.ok(!('fix' in out[0]));
  assert.equal(typeof out[0].message, 'string');
});

// --- Diagnostics count stability (6 -> 49 inflation regression) -----------

function issue(overrides = {}) {
  return {
    filePath: 'C:/proj/src/app.ts',
    severity: 'error',
    line: 1,
    character: 2,
    message: 'Cannot find name x',
    source: 'ts',
    code: '2304',
    ...overrides,
  };
}

test('issue count excludes compiled mirrors, node_modules, and foreign files', () => {
  const roots = ['C:/proj'];
  const real = [0, 1, 2, 3, 4, 5].map((i) =>
    issue({ line: i, message: `problem ${i}` }),
  );
  const noise = [
    // Compiled twins of the same sources under out/ mirror every finding.
    ...real.map((e) => ({ ...e, filePath: 'C:/proj/out/app.js' })),
    issue({ filePath: 'C:/proj/node_modules/lib/index.d.ts', message: 'dep noise' }),
    issue({ filePath: 'C:/other-project/app.ts', message: 'outside workspace' }),
    issue({ filePath: 'C:/proj/dist/bundle.js', message: 'bundled copy' }),
    issue({ severity: 'info', message: 'not counted' }),
    issue({ severity: 'hint', message: 'not counted either' }),
  ];
  assert.equal(countWorkspaceIssues([...real, ...noise], roots), 6);
});

test('issue count is stable under repeated recomputation and duplicates', () => {
  const roots = ['C:/proj'];
  const entries = [
    issue(),
    issue({ message: 'second', line: 9 }),
    issue({ filePath: 'C:/proj/src/other.ts', message: 'third' }),
  ];
  const first = countWorkspaceIssues(entries, roots);
  // Simulate re-analysis cycles: the same diagnostics list reported again,
  // plus exact duplicate rows. The count must not grow.
  const replayed = [...entries, ...entries, ...entries.map((e) => ({ ...e }))];
  assert.equal(countWorkspaceIssues(replayed, roots), first);
  assert.equal(countWorkspaceIssues(entries, roots), first);
  assert.equal(first, 3);
});

test('generated path detection covers build output dirs', () => {
  assert.equal(isGeneratedPath('C:/proj/out/app.js'), true);
  assert.equal(isGeneratedPath('C:/proj/node_modules/x/index.js'), true);
  assert.equal(isGeneratedPath('C:/proj/src/output.ts'), false);
  assert.equal(isGeneratedPath('C:/proj/src/app.ts'), false);
});

test('extension never publishes native VS Code diagnostics', () => {
  // EYRA reads Problems; it must never create its own DiagnosticCollection,
  // which would double-report findings in the native Problems panel.
  const srcDir = path.join(__dirname, '..', 'src');
  const offenders = fs
    .readdirSync(srcDir)
    .filter((name) => name.endsWith('.ts'))
    .filter((name) =>
      fs.readFileSync(path.join(srcDir, name), 'utf8').includes('createDiagnosticCollection'),
    );
  assert.deepEqual(offenders, []);
});
