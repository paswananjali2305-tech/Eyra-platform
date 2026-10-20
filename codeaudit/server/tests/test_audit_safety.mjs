import assert from 'assert';
import { handleBindError, signAuditUser, verifyAuditHeaders } from '../src/services/internalAuth.js';
import { applyPatchGrounding } from '../src/services/patchGrounding.js';
import { localHeuristicPass } from '../src/services/aiSemanticPass.js';

const bind = handleBindError({ code: 'EADDRINUSE' }, 5000);
assert.strictEqual(bind.action, 'fail');
assert.match(bind.message, /will not stop/i);
assert.doesNotMatch(bind.message, /taskkill/i);

process.env.EYRA_AUDIT_INTERNAL_SECRET = 'test-secret';
const ts = String(Math.floor(Date.now() / 1000));
const sig = signAuditUser('user-a', ts);
const ok = verifyAuditHeaders({
  'x-eyra-user-id': 'user-a',
  'x-eyra-ts': ts,
  'x-eyra-sig': sig,
});
assert.strictEqual(ok.ok, true);
assert.strictEqual(ok.userId, 'user-a');

const forged = verifyAuditHeaders({
  'x-eyra-user-id': 'user-b',
  'x-eyra-ts': ts,
  'x-eyra-sig': sig,
});
assert.strictEqual(forged.ok, false);

const bare = verifyAuditHeaders({ 'x-eyra-user-id': 'user-a' });
assert.strictEqual(bare.ok, false);

const issue = {
  file: 'app.py',
  line: 2,
  title: 'SQL',
  ruleId: 'SQLI',
  patchDiff: '--- a/app.py\n+++ b/app.py\n@@ -2 +2 @@\n- db.execute(f"SELECT * FROM accounts WHERE id = \'{user_id}\'")\n+ db.execute("SELECT * FROM accounts WHERE id = %s", (user_id,))\n',
};
applyPatchGrounding(issue, { 'app.py': 'rows = db.query(name)\n' });
assert.strictEqual(issue.patchDiff, '');
assert.strictEqual(issue.patchApplicable, false);
assert.strictEqual(issue.patchProvenance, 'unavailable');

const real = {
  file: 'app.py',
  patchDiff: '--- a/app.py\n+++ b/app.py\n@@ -1 +1 @@\n- rows = db.query(name)\n+ rows = db.query(safe)\n',
  patchProvenance: 'ai_generated',
};
applyPatchGrounding(real, { 'app.py': 'rows = db.query(name)\n' });
assert.strictEqual(real.patchApplicable, true);
assert.ok(real.patchSourceHash);

const noted = { file: 'a.py', line: 1, title: 'TODO', ruleId: 'TODO' };
const { issues } = localHeuristicPass([noted]);
assert.strictEqual(issues[0].patchDiff, '');
assert.notStrictEqual(issues[0].patchProvenance, 'heuristic_template');

console.log('PASS auth, port, and patch grounding');
