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
});

test('the master application icon is release ready', () => {
  const icon = fs.readFileSync(path.join(root, 'icon.png'));
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
  assert.equal(icon[25], 6);
});

test('release workflow builds each operating system on its native runner', () => {
  const workflow = fs.readFileSync(
    path.join(root, '.github', 'workflows', 'release.yml'),
    'utf8'
  );
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /runs-on:\s*macos-latest/);
  assert.match(workflow, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /--publish always/g);
  assert.match(workflow, /GITTREE_GITHUB_CLIENT_ID/);
  assert.match(workflow, /GITTREE_GITLAB_CLIENT_ID/);
});
