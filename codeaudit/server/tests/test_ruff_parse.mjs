import assert from 'assert';
import { toolResult } from '../src/services/analysis/toolRunner.js';

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('toolResult shapes statuses', () => {
  const t = toolResult('UNAVAILABLE', { message: 'missing' }, []);
  assert.strictEqual(t.status, 'UNAVAILABLE');
  assert.strictEqual(t.issues.length, 0);
});

test('ruff severity heuristic via import of map logic', async () => {
  // Smoke: module loads without throwing
  const mod = await import('../src/services/analysis/ruffAnalyzer.js');
  assert.equal(typeof mod.runRuffAnalysis, 'function');
});

console.log('done');
