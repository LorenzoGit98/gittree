const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function loadBranchNaming() {
  const filename = path.join(
    __dirname,
    '..',
    'src',
    'renderer',
    'components',
    'branch-naming.js'
  );
  const source = fs.readFileSync(filename, 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.BranchNamingUnderTest = BranchNaming;`, context);
  return context.BranchNamingUnderTest;
}

test('quick branch naming follows folders already used by local and remote branches', () => {
  const naming = loadBranchNaming();
  const metadata = {
    branches: [
      { kind: 'local', name: 'feat/authentication' },
      { kind: 'local', name: 'feat/settings' },
      { kind: 'remote', remote: 'origin', name: 'origin/fix/1911' }
    ]
  };

  assert.equal(naming.compose('feature', 'Account Profiles', metadata), 'feat/account-profiles');
  assert.equal(naming.compose('bugfix', 'Issue #1911', metadata), 'fix/issue-1911');
});

test('quick branch naming uses stable defaults and creates a safe slug', () => {
  const naming = loadBranchNaming();

  assert.equal(naming.compose('feature', 'Nuova attività API', {}), 'feature/nuova-attivita-api');
  assert.equal(naming.compose('bugfix', '  Fix__Login...  ', {}), 'bugfix/fix-login');
  assert.equal(naming.compose('custom', 'release/Version 2', {}), 'release/version-2');
  assert.equal(naming.compose('feature', '///', {}), '');
});
