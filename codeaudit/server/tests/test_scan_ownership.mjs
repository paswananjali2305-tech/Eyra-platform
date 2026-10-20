import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ScanStorage } from '../src/services/storage.js';

const file = path.join(os.tmpdir(), `eyra-scans-${Date.now()}.json`);
const storage = new ScanStorage(file);

function scan(id, owner) {
  return {
    id,
    projectName: id,
    status: 'completed',
    createdAt: new Date().toISOString(),
    ownerUserId: owner,
    summary: {},
    meta: {},
  };
}

storage.createScan(scan('owned-a', 'user-a'));
storage.createScan(scan('owned-b', 'user-b'));
storage.createScan({
  id: 'legacy',
  projectName: 'legacy',
  status: 'completed',
  createdAt: new Date().toISOString(),
  summary: {},
  meta: {},
});

assert.deepStrictEqual(storage.listForUser('user-a').map((s) => s.id), ['owned-a']);
assert.strictEqual(storage.getOwnedScan('owned-b', 'user-a'), null);
assert.strictEqual(storage.getOwnedScan('legacy', 'user-a'), null);
assert.strictEqual(storage.getOwnedScan('legacy', 'user-b'), null);
assert.ok(storage.getScan('legacy'), 'legacy row stays on disk');

const cleared = storage.clearForUser('user-a');
assert.strictEqual(cleared, 1);
assert.ok(storage.getScan('owned-b'));
assert.ok(storage.getScan('legacy'));
assert.strictEqual(storage.listForUser('user-b').length, 1);

fs.rmSync(file, { force: true });
console.log('PASS scan ownership');
