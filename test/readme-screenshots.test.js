const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const screenshotPaths = [
  'docs/screenshots/gittree-history-light.png',
  'docs/screenshots/gittree-history-dark.png'
];

test('README product screenshots are committed PNG files', () => {
  const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  for (const relativePath of screenshotPaths) {
    assert.match(readme, new RegExp(relativePath.replaceAll('/', '\\/')));
    const screenshot = fs.readFileSync(path.join(projectRoot, relativePath));
    assert.deepEqual(screenshot.subarray(0, 8), pngSignature);
    assert.ok(screenshot.length > 10_000, `${relativePath} should contain a real app capture`);
  }
});
