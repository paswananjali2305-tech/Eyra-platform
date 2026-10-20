const assert = require('node:assert/strict');
const test = require('node:test');
const { runCommandForFile, runLanguageForFile } = require('../out/runCommand');
const { canonicalLanguage } = require('../out/phase3Model');

test('tsx with typescriptreact runs through tsx on Windows and POSIX', () => {
  assert.equal(
    runCommandForFile('C:\\proj\\ee.tsx', 'typescriptreact', 'win32'),
    'npx --yes tsx "C:\\proj\\ee.tsx"',
  );
  assert.equal(
    runCommandForFile('/home/dev/ee.tsx', 'typescriptreact', 'posix'),
    'npx --yes tsx "/home/dev/ee.tsx"',
  );
  assert.equal(runLanguageForFile('ee.tsx', 'typescriptreact'), 'typescript');
});

test('ts with typescript runs through tsx; plain js runs through node', () => {
  assert.equal(
    runCommandForFile('/home/dev/main.ts', 'typescript', 'posix'),
    'npx --yes tsx "/home/dev/main.ts"',
  );
  assert.equal(
    runCommandForFile('C:\\proj\\main.mts', 'typescript', 'win32'),
    'npx --yes tsx "C:\\proj\\main.mts"',
  );
  assert.equal(
    runCommandForFile('/home/dev/app.js', 'javascript', 'posix'),
    'node "/home/dev/app.js"',
  );
  assert.equal(
    runCommandForFile('C:\\proj\\app.cjs', 'javascript', 'win32'),
    'node "C:\\proj\\app.cjs"',
  );
});

test('jsx with javascriptreact uses tsx, never plain node', () => {
  const cmd = runCommandForFile('/home/dev/app.jsx', 'javascriptreact', 'posix');
  assert.equal(cmd, 'npx --yes tsx "/home/dev/app.jsx"');
  assert.doesNotMatch(cmd, /^node /);
  assert.equal(runLanguageForFile('app.jsx', 'javascriptreact'), 'javascript');
});

test('python keeps python/python3 split', () => {
  assert.equal(runCommandForFile('C:\\proj\\a.py', 'python', 'win32'), 'python "C:\\proj\\a.py"');
  assert.equal(runCommandForFile('/home/dev/a.py', 'python', 'posix'), 'python3 "/home/dev/a.py"');
});

test('java, c, cpp, and go command selection', () => {
  assert.equal(
    runCommandForFile('/home/dev/Main.java', 'java', 'posix'),
    'java "/home/dev/Main.java"',
  );
  const cWin = runCommandForFile('C:\\proj\\main.c', 'c', 'win32');
  assert.equal(cWin, 'gcc "C:\\proj\\main.c" -o "C:\\proj\\main.exe"; if ($LASTEXITCODE -eq 0) { & "C:\\proj\\main.exe" }');
  const cPosix = runCommandForFile('/home/dev/main.c', 'c', 'posix');
  assert.equal(cPosix, 'gcc "/home/dev/main.c" -o "/home/dev/main.out" && "/home/dev/main.out"');
  assert.match(runCommandForFile('/home/dev/main.cpp', 'cpp', 'posix'), /^g\+\+ /);
  assert.match(runCommandForFile('/home/dev/main.cc', 'cpp', 'posix'), /^g\+\+ /);
  assert.match(runCommandForFile('/home/dev/main.cxx', 'cpp', 'posix'), /^g\+\+ /);
  assert.equal(
    runCommandForFile('/home/dev/main.go', 'go', 'posix'),
    'go run "/home/dev/main.go"',
  );
});

test('paths with spaces stay quoted', () => {
  assert.equal(
    runCommandForFile('C:\\my proj\\ee.tsx', 'typescriptreact', 'win32'),
    'npx --yes tsx "C:\\my proj\\ee.tsx"',
  );
  assert.equal(
    runCommandForFile('/home/my proj/app.py', 'python', 'posix'),
    'python3 "/home/my proj/app.py"',
  );
});

test('unsupported files return null instead of a guessed command', () => {
  assert.equal(runCommandForFile('/home/dev/index.html', 'html', 'posix'), null);
  assert.equal(runCommandForFile('/home/dev/styles.css', 'css', 'posix'), null);
  assert.equal(runCommandForFile('/home/dev/query.sql', 'sql', 'posix'), null);
  assert.equal(runCommandForFile('/home/dev/header.h', 'c', 'posix'), null);
  assert.equal(runCommandForFile('/home/dev/readme.xyz', 'plaintext', 'posix'), null);
  assert.equal(runLanguageForFile('/home/dev/readme.xyz', 'plaintext'), null);
});

test('language alias normalization covers react variants and keeps old aliases', () => {
  assert.equal(canonicalLanguage('typescriptreact'), 'typescript');
  assert.equal(canonicalLanguage('javascriptreact'), 'javascript');
  assert.equal(canonicalLanguage('TypeScriptReact'), 'typescript');
  assert.equal(canonicalLanguage('python'), 'python');
  assert.equal(canonicalLanguage('py'), 'python');
  assert.equal(canonicalLanguage('js'), 'javascript');
  assert.equal(canonicalLanguage('ts'), 'typescript');
  assert.equal(canonicalLanguage('c++'), 'cpp');
  assert.equal(canonicalLanguage('golang'), 'go');
});
