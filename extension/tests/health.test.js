const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const originalRequire = Module.prototype.require;
Module.prototype.require = function mockVscode(id) {
  if (id === 'vscode') {
    return {
      workspace: {
        getConfiguration() {
          return {
            get() {
              return 'http://127.0.0.1:8000';
            },
          };
        },
      },
    };
  }
  return originalRequire.apply(this, arguments);
};

for (const rel of ['config.js', 'healthClient.js', 'http.js']) {
  const resolved = require.resolve(path.join('..', 'out', rel));
  delete require.cache[resolved];
}

const { checkBrainHealth } = require('../out/healthClient');
const { BrainHttpError } = require('../out/http');

test('Brain health-check success returns status, service, and version', async () => {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ status: 'ok', service: 'eyra-brain', version: '0.9.4' }),
  });
  try {
    const result = await checkBrainHealth();
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.status, 'ok');
    assert.equal(result.service, 'eyra-brain');
    assert.equal(result.version, '0.9.4');
    assert.match(result.url, /\/api\/health$/);
    const notification = `EYRA Brain responded: ${result.status} · ${result.service} ${result.version}`.trim();
    assert.match(notification, /EYRA Brain responded: ok · eyra-brain 0\.9\.4/);
  } finally {
    global.fetch = original;
  }
});

test('Brain health-check network failure stays a failure', async () => {
  const original = global.fetch;
  global.fetch = async () => {
    throw new BrainHttpError('Cannot reach EYRA Brain', 0);
  };
  try {
    const result = await checkBrainHealth();
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.match(result.message, /Cannot reach EYRA Brain|Brain/);
    assert.equal(result.message.includes('status ok'), false);
  } finally {
    global.fetch = original;
  }
});

test('Brain health-check rejects a non-object body', async () => {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(['ok']),
  });
  try {
    const result = await checkBrainHealth();
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.match(result.message, /not a health object/);
  } finally {
    global.fetch = original;
    Module.prototype.require = originalRequire;
  }
});
