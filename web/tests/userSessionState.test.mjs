import assert from 'assert';
import { clearLoggedOutBrowserState, inflightEpoch, invalidateInflightRequests, isStaleEpoch, workspaceKeyForUser } from '../src/lib/userSessionState.js';

function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
  };
}

const local = memoryStore({
  'eyra.activeSessionId': 'EYRA-1',
  'eyra.activeScanId': 'scan-1',
  'eyra.uiMode': 'audit',
  'eyra.auditView': 'code',
  'eyra.runtimeWorkspace.v1': '{"editor":1}',
  'eyra.runtimeWorkspace.v1:user-a': '{"editor":"a"}',
  'eyra.backendBaseUrl': 'http://127.0.0.1:8000',
});
const session = memoryStore({ 'eyra.welcomePending': '1' });
const started = inflightEpoch();
const result = clearLoggedOutBrowserState(local, session, 'user-a');
assert.strictEqual(local.getItem('eyra.activeSessionId'), null);
assert.strictEqual(local.getItem('eyra.activeScanId'), null);
assert.strictEqual(local.getItem('eyra.uiMode'), null);
assert.strictEqual(local.getItem('eyra.runtimeWorkspace.v1'), null);
assert.strictEqual(local.getItem('eyra.runtimeWorkspace.v1:user-a'), '{"editor":"a"}');
assert.strictEqual(local.getItem('eyra.backendBaseUrl'), 'http://127.0.0.1:8000');
assert.strictEqual(session.getItem('eyra.welcomePending'), null);
assert.strictEqual(result.keptDraftKey, workspaceKeyForUser('user-a'));
assert.strictEqual(isStaleEpoch(started), true);
invalidateInflightRequests();
assert.ok(inflightEpoch() > started);

console.log('PASS logout state');
