const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('project metadata and contributor documentation declare the MIT license', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  const license = read('LICENSE');
  const readme = read('README.md');
  const trademarks = read('TRADEMARKS.md');
  const contributing = read('CONTRIBUTING.md');

  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageLock.packages[''].license, 'MIT');
  assert.match(license, /^MIT License\r?\n/);
  assert.match(license, /Copyright \(c\) 2026 Lorenzo Giannoccaro/);
  assert.match(readme, /license-MIT/);
  assert.match(readme, /Source code is MIT-licensed/);
  assert.match(trademarks, /distributed under the MIT license/);
  assert.match(contributing, /licensed under the project's \[MIT License\]/);
});
