import assert from 'assert';
import {
  parseVersion,
  cmpVersion,
  versionMatchesRange,
  auditDependencies,
} from '../src/services/dependencyAuditor.js';
import { normalizeAndDeduplicate } from '../src/services/analysis/findingsNormalize.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('parseVersion handles caret/tilde prefixes', () => {
  assert.deepStrictEqual(parseVersion('^4.17.20'), [4, 17, 20]);
  assert.deepStrictEqual(parseVersion('~1.2'), [1, 2, 0]);
  assert.strictEqual(parseVersion('latest'), null);
});

test('versionMatchesRange respects < bound', () => {
  assert.strictEqual(versionMatchesRange('4.17.20', '<4.17.21').matched, true);
  assert.strictEqual(versionMatchesRange('4.17.21', '<4.17.21').matched, false);
  assert.strictEqual(versionMatchesRange('9.0.0', '<9.0.0').matched, false);
});

test('unaffected lodash version is not reported', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyra-dep-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: { lodash: '^4.17.21' } }),
  );
  const { findings, toolStatus } = auditDependencies(dir);
  assert.strictEqual(findings.length, 0, 'patched lodash should not hit');
  assert.strictEqual(toolStatus.status, 'PASS');
  assert.strictEqual(toolStatus.liveLookup, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('affected lodash version is reported', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyra-dep-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: { lodash: '4.17.20' } }),
  );
  const { findings } = auditDependencies(dir);
  assert.ok(findings.some((f) => f.cve === 'CVE-2020-8203'));
  assert.strictEqual(findings[0].advisorySource, 'eyra-offline-known-cves');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('unknown version is uncertain, not hard confirm', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyra-dep-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: { lodash: 'latest' } }),
  );
  const { findings } = auditDependencies(dir);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].versionMatch, 'unknown');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dedupe merges same file/line complexity family', () => {
  const { issues, duplicatesRemoved } = normalizeAndDeduplicate([
    {
      id: 'a',
      ruleId: 'METRIC-HIGH-COMPLEXITY',
      file: 'a.py',
      line: 10,
      severity: 'Medium',
      sourceTool: 'eyra-ast',
      title: 'High complexity',
    },
    {
      id: 'b',
      ruleId: 'RADON-CC-HIGH',
      file: 'a.py',
      line: 10,
      severity: 'High',
      sourceTool: 'radon',
      title: 'Radon CC',
    },
  ]);
  assert.strictEqual(issues.length, 1);
  assert.ok(duplicatesRemoved >= 1);
  assert.strictEqual(issues[0].severity, 'High');
  assert.ok(issues[0].contributingTools.includes('radon'));
});

test('cmpVersion ordering', () => {
  assert.strictEqual(cmpVersion([1, 0, 0], [1, 0, 1]), -1);
  assert.strictEqual(cmpVersion([2, 0, 0], [1, 9, 9]), 1);
});

console.log('done');
