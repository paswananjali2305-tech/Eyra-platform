const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionDir = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(extensionDir, '..', '..');
const devPath = path.join(workspaceRoot, 'stitch_eyra_runtime_debugger', 'extension');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('F5 loads the EYRA extension, not the workspace root', () => {
  for (const launchPath of [
    path.join(workspaceRoot, '.vscode', 'launch.json'),
    path.join(extensionDir, '.vscode', 'launch.json'),
  ]) {
    const launch = readJson(launchPath);
    const config = launch.configurations.find((item) => item.name === 'Run EYRA Extension');
    assert.ok(config, launchPath);
    assert.equal(config.type, 'extensionHost');
    assert.deepEqual(config.args, [
      '--extensionDevelopmentPath=${workspaceFolder}/stitch_eyra_runtime_debugger/extension',
    ]);
    assert.equal(config.preLaunchTask, 'compile EYRA extension');
    assert.equal(path.resolve(devPath), extensionDir);
  }

  // Windows Chromium re-parses the process command line. An unquoted path with a
  // space is truncated (Error scanning .../Antigravity). Keep this as one argv.
  const sample = `--extensionDevelopmentPath=${workspaceRoot}/stitch_eyra_runtime_debugger/extension`;
  assert.match(workspaceRoot, / /);
  assert.match(sample, /Antigravity project/);
  const truncated = sample.split(' ')[0];
  assert.notEqual(truncated, sample);
  assert.equal(fs.existsSync(truncated.replace('--extensionDevelopmentPath=', '')), false);
  assert.equal(fs.existsSync(devPath), true);
  assert.equal(fs.existsSync(path.join(extensionDir, 'scripts', 'launch-edh.ps1')), true);

  const manifest = readJson(path.join(devPath, 'package.json'));
  assert.equal(typeof manifest.engines, 'object');
  assert.equal(typeof manifest.engines.vscode, 'string');
  assert.equal(manifest.main, './out/extension.js');
  assert.equal(fs.existsSync(path.join(devPath, 'out', 'extension.js')), true);

  for (const unrelated of ['dashhboard']) {
    const unrelatedManifest = readJson(path.join(workspaceRoot, unrelated, 'package.json'));
    assert.equal(unrelatedManifest.engines, undefined);
    assert.notEqual(unrelatedManifest.name, manifest.name);
  }
});

test('the compile task runs inside the extension directory', () => {
  for (const tasksPath of [
    path.join(workspaceRoot, '.vscode', 'tasks.json'),
    path.join(extensionDir, '.vscode', 'tasks.json'),
  ]) {
    const tasks = readJson(tasksPath);
    const task = tasks.tasks.find((item) => item.label === 'compile EYRA extension');
    assert.ok(task, tasksPath);
    assert.equal(task.type, 'npm');
    assert.equal(task.script, 'compile');
    assert.equal(task.path, 'stitch_eyra_runtime_debugger/extension');
  }
});
