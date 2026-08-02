const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

test('release dependencies are assigned to the correct package scopes', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.dependencies.electron, undefined);
  assert.match(packageJson.dependencies['electron-updater'], /^\^6\./);
  assert.match(packageJson.devDependencies.electron, /^\^43\./);
  assert.ok(packageJson.scripts['prepare:assets']);
  assert.ok(packageJson.scripts['release:check']);
  assert.equal(
    packageJson.scripts.quality,
    'npm run lint && npm run test && npm run test:coverage && npm run audit:design && npm run test:contracts'
  );
});

test('continuous integration validates the actual default branch', () => {
  const workflow = fs.readFileSync(
    path.join(root, '.github', 'workflows', 'ci.yml'),
    'utf8'
  );
  assert.match(workflow, /branches:\s*\[master\]/);
  assert.doesNotMatch(workflow, /branches:\s*\[main,\s*develop\]/);
  assert.match(workflow, /npm run quality/);
});

test('continuous integration exercises Electron on required operating systems', () => {
  const workflow = fs.readFileSync(
    path.join(root, '.github', 'workflows', 'ci.yml'),
    'utf8'
  );
  assert.match(workflow, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /xvfb-run\s+-a\s+npm run test:e2e/);
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /runs-on:\s*macos-latest/);
  assert.match(workflow, /github\.event_name == 'schedule'/);
  assert.match(workflow, /startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.match(workflow, /if:\s*failure\(\)/);
});

test('electron-builder emits installable and update-compatible artifacts', () => {
  const config = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  assert.match(config, /provider:\s*github/);
  assert.match(config, /owner:\s*lorenzogit98/);
  assert.match(config, /repo:\s*gittree-minimal/);
  assert.match(config, /target:\s*nsis/);
  assert.match(config, /-\s*zip/);
  assert.match(config, /-\s*AppImage/);
  assert.match(config, /generateUpdatesFilesForAllChannels:\s*true/);
  assert.match(config, /from:\s*build\/oauth-config\.json/);
  assert.match(config, /include:\s*installer\.nsh/);
  const nsh = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
  assert.match(nsh, /!macro customInstallMode/);
  assert.match(nsh, /!macro customFinishPage/);
  assert.match(nsh, /\$\{isUpdated\}/);
});

test('semantic-release maps feat and breaking to minor, fixes to patch', () => {
  const releaserc = JSON.parse(fs.readFileSync(path.join(root, '.releaserc'), 'utf8'));
  const analyzer = releaserc.plugins.find(plugin => (
    Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer'
  ));
  assert.ok(analyzer, 'commit-analyzer plugin missing');
  const rules = analyzer[1].releaseRules || [];
  assert.equal(rules.find(item => item.type === 'feat')?.release, 'minor');
  assert.equal(rules.find(item => item.breaking === true)?.release, 'minor');
  for (const type of ['fix', 'perf', 'refactor', 'style']) {
    const rule = rules.find(item => item.type === type);
    assert.equal(rule?.release, 'patch', `${type} must bump patch only`);
  }
  assert.match(releaserc.tagFormat, /^v\$\{version\}$/);
  const gitPlugin = releaserc.plugins.find(plugin => (
    Array.isArray(plugin) && plugin[0] === '@semantic-release/git'
  ));
  assert.ok(gitPlugin, 'semantic-release git plugin missing');
  assert.ok(gitPlugin[1].assets.includes('CHANGELOG.md'));
});

test('the master application icon is release ready', () => {
  const icon = fs.readFileSync(path.join(root, 'icon.png'));
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
  assert.equal(icon[25], 6);
});

test('release workflow publishes one atomic draft after every native build succeeds', () => {
  const workflow = fs.readFileSync(
    path.join(root, '.github', 'workflows', 'release.yml'),
    'utf8'
  );
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /runs-on:\s*macos-latest/);
  assert.match(workflow, /runs-on:\s*ubuntu-latest/);
  assert.doesNotMatch(workflow, /--publish always/);
  assert.equal((workflow.match(/--publish never/g) || []).length, 3);
  assert.match(workflow, /gh release create[\s\S]+--draft/);
  assert.match(workflow, /gh release delete-asset[\s\S]+--yes/);
  assert.equal((workflow.match(/scripts\/release-assets\.js/g) || []).length, 3);
  assert.match(workflow, /name:\s*Publish complete release/);
  assert.match(workflow, /needs:\s*\[windows,\s*macos,\s*linux\]/);
  assert.match(workflow, /gh release edit[\s\S]+--draft=false/);
  assert.match(workflow, /GH_REPO:\s*\${{\s*github\.repository\s*}}/);
  assert.match(workflow, /MACOS_OTA_ENABLED:/);
  assert.match(workflow, /platform="mac-manual"/);
  assert.match(workflow, /GITTREE_GITHUB_CLIENT_ID/);
  assert.match(workflow, /GITTREE_GITLAB_CLIENT_ID/);
});
