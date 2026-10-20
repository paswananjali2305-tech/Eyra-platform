import assert from 'assert';
import {
  buildOpenExtensionUri,
  EYRA_EXTENSION_ID,
  launchOpenExtension,
  validateOpenExtensionUri,
} from '../src/lib/openExtension.js';

assert.strictEqual(EYRA_EXTENSION_ID, 'eyra-runtime-debugger.eyra-runtime-debugger');
assert.strictEqual(
  buildOpenExtensionUri('vscode'),
  'vscode://eyra-runtime-debugger.eyra-runtime-debugger/open',
);
assert.strictEqual(
  buildOpenExtensionUri('cursor'),
  'cursor://eyra-runtime-debugger.eyra-runtime-debugger/open',
);
assert.throws(() => buildOpenExtensionUri('http'), /Unsupported URI scheme/);

assert.deepStrictEqual(
  validateOpenExtensionUri('vscode://eyra-runtime-debugger.eyra-runtime-debugger/open'),
  { ok: true },
);

const withToken = validateOpenExtensionUri(
  'vscode://eyra-runtime-debugger.eyra-runtime-debugger/open?token=secret',
);
assert.strictEqual(withToken.ok, false);

const noBrain = await launchOpenExtension({ editor: 'vscode' });
assert.strictEqual(noBrain.ok, false);
assert.match(noBrain.reason, /Brain|Marketplace/i);

const okBrain = await launchOpenExtension({
  editor: 'vscode',
  openViaBrain: async (body) => {
    assert.strictEqual(body.editor, 'vscode');
    return {
      ok: true,
      editor: 'vscode',
      mode: 'vsix',
      installed: true,
      opened: true,
      uri: 'vscode://eyra-runtime-debugger.eyra-runtime-debugger/open',
      message: 'Opened EYRA in VS Code.',
    };
  },
});
assert.strictEqual(okBrain.ok, true);
assert.strictEqual(okBrain.mode, 'vsix');
assert.strictEqual(okBrain.installed, true);
assert.strictEqual(okBrain.editor, 'vscode');

const failBrain = await launchOpenExtension({
  editor: 'vscode',
  openViaBrain: async () => ({
    ok: false,
    message: 'VS Code was not found on this machine.',
    mode: 'none',
  }),
});
assert.strictEqual(failBrain.ok, false);
assert.match(failBrain.reason, /VS Code/i);

const throwBrain = await launchOpenExtension({
  openViaBrain: async () => {
    throw new Error('Brain offline');
  },
});
assert.strictEqual(throwBrain.ok, false);
assert.match(throwBrain.reason, /Brain offline/);

console.log('openExtension.test.mjs: ok');
