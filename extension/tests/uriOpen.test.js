const assert = require('node:assert/strict');
const test = require('node:test');
const { buildOpenExtensionUri, EYRA_EXTENSION_ID, parseOpenUri } = require('../out/uriOpen');

test('open URI is publisher.name /open with no query', () => {
  assert.equal(EYRA_EXTENSION_ID, 'eyra-runtime-debugger.eyra-runtime-debugger');
  assert.equal(buildOpenExtensionUri('vscode'), 'vscode://eyra-runtime-debugger.eyra-runtime-debugger/open');
  assert.equal(buildOpenExtensionUri('cursor'), 'cursor://eyra-runtime-debugger.eyra-runtime-debugger/open');
});

test('parseOpenUri accepts /open and empty path', () => {
  assert.deepEqual(parseOpenUri({ path: '/open', query: '' }), { kind: 'open' });
  assert.deepEqual(parseOpenUri({ path: '/', query: '' }), { kind: 'open' });
  assert.deepEqual(parseOpenUri({ path: '', query: '' }), { kind: 'open' });
  assert.deepEqual(parseOpenUri({ path: '/open/', query: '' }), { kind: 'open' });
});

test('parseOpenUri rejects unknown paths', () => {
  const result = parseOpenUri({ path: '/workspace', query: '' });
  assert.equal(result.kind, 'reject');
  assert.match(result.reason, /Unsupported/);
});

test('parseOpenUri rejects secrets and any query parameters', () => {
  for (const key of ['token', 'access_token', 'code', 'password', 'secret', 'authorization']) {
    const result = parseOpenUri({ path: '/open', query: `${key}=abc` });
    assert.equal(result.kind, 'reject', key);
    assert.match(result.reason, /sensitive|query/i);
  }
  const other = parseOpenUri({ path: '/open', query: 'folder=/tmp' });
  assert.equal(other.kind, 'reject');
  assert.match(other.reason, /query parameters/i);
});
