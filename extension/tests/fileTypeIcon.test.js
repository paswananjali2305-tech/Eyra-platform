const assert = require('node:assert/strict');
const test = require('node:test');
const { brandForFileName, fileExtension, fileTypeLogoSvg } = require('../out/fileTypeIcon');

test('fileExtension reads the last suffix', () => {
  assert.equal(fileExtension('bug.py'), 'py');
  assert.equal(fileExtension('src/main.ts'), 'ts');
  assert.equal(fileExtension('C:\\\\repo\\\\app.js'), 'js');
  assert.equal(fileExtension('README'), '');
});

test('brandForFileName matches web LanguageLogo catalog', () => {
  assert.equal(brandForFileName('solve.py')?.id, 'Python');
  assert.equal(brandForFileName('solve.py')?.logoColor, '#3776AB');
  assert.equal(brandForFileName('app.ts')?.id, 'TypeScript');
  assert.equal(brandForFileName('app.ts')?.logoColor, '#3178C6');
  assert.equal(brandForFileName('index.js')?.id, 'JavaScript');
  assert.equal(brandForFileName('index.js')?.logoColor, '#F7DF1E');
  assert.equal(brandForFileName('Main.java')?.logoColor, '#ED8B00');
  assert.equal(brandForFileName('styles.css')?.logoColor, '#1572B6');
  assert.equal(brandForFileName('query.sql')?.logoColor, '#336791');
  assert.equal(brandForFileName('main.go')?.id, 'Go');
  assert.equal(brandForFileName('index.html')?.id, 'HTML');
  assert.equal(brandForFileName('package.json'), null);
  assert.equal(brandForFileName('unknown.xyz'), null);
});

test('fileTypeLogoSvg matches web SVG shape (path + logoColor fill)', () => {
  const py = fileTypeLogoSvg('bug.py', 16);
  assert.match(py, /aria-label="Python"/);
  assert.match(py, /viewBox="0 0 24 24"/);
  assert.match(py, /fill="#3776AB"/);
  assert.match(py, /<path d="/);

  const css = fileTypeLogoSvg('app.css', 16);
  assert.match(css, /fill="#1572B6"/);
});
