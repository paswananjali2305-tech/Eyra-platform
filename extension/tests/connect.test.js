const assert = require('node:assert/strict');
const test = require('node:test');
const { isExtensionCredential, signOutPlan } = require('../out/session');

test('extension sign-out revokes only an extension credential', () => {
  assert.equal(signOutPlan(undefined), 'already-out');
  assert.equal(signOutPlan(''), 'already-out');
  assert.equal(signOutPlan('hmac-web-or-password-token'), 'local-only');
  assert.equal(isExtensionCredential('eyra_ext.example'), true);
  assert.equal(signOutPlan('eyra_ext.example'), 'revoke-extension');
});
