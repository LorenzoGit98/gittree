const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const GitService = require('../src/main/git-service');
const RepoManager = require('../src/main/repo-manager');
const CredentialVault = require('../src/main/credential-vault');
const { createRepository } = require('./helpers/git-repository');

test('diff and commit detail work for the repository root commit', async () => {
  const fixture = createRepository();
  try {
    fixture.write('a.txt', 'hello');
    fixture.git('add', '-A');
    fixture.git('commit', '-m', 'initial');
    const hash = fixture.git('rev-parse', 'HEAD');

    const service = new GitService(fixture.repository);
    const diff = await service.getDiff(hash);
    assert.match(diff, /diff --git a\/a\.txt b\/a\.txt/);

    const detail = await service.getCommitDetail(hash);
    assert.equal(detail.hash, hash);
    assert.match(detail.diff, /diff --git a\/a\.txt b\/a\.txt/);
  } finally {
    fixture.cleanup();
  }
});

test('revision positions reject option injection and invalid refs', async () => {
  const fixture = createRepository();
  try {
    fixture.write('a.txt', 'hello');
    fixture.git('add', '-A');
    fixture.git('commit', '-m', 'initial');

    const service = new GitService(fixture.repository);
    await assert.rejects(service.getLog(10, '--all'), /Invalid Git ref/);
    await assert.rejects(service.getDiff('--grep=x'), /Invalid Git ref/);
    await assert.rejects(service.getFileTree('--all'), /Invalid Git ref/);
    await assert.rejects(service.getCommitDetail('-n 1'), /Invalid Git ref/);
    await assert.rejects(service.getBranchComparison('--all', 'main'), /Invalid Git ref/);
    await assert.rejects(service.getBranchComparison('main', '--all'), /Invalid Git ref/);
    await assert.rejects(service.stashPop('abc'), /Invalid stash index/);
    await assert.rejects(service.stashPop(-1), /Invalid stash index/);
    await assert.rejects(service.stashPop('1.5'), /Invalid stash index/);
  } finally {
    fixture.cleanup();
  }
});

test('previewMerge reports exactly the conflicted files', async () => {
  const fixture = createRepository();
  try {
    fixture.write('a.txt', 'base');
    fixture.write('b.txt', 'base');
    fixture.git('add', '-A');
    fixture.git('commit', '-m', 'init');
    fixture.git('checkout', '-b', 'feature');
    fixture.write('a.txt', 'feature-version');
    fixture.write('c.txt', 'new');
    fixture.git('add', '-A');
    fixture.git('commit', '-m', 'feat');
    fixture.git('checkout', 'main');
    fixture.write('a.txt', 'main-version');
    fixture.write('d.txt', 'maind');
    fixture.git('add', '-A');
    fixture.git('commit', '-m', 'mainc');

    const service = new GitService(fixture.repository);
    const preview = await service.previewMerge('feature');
    assert.equal(preview.supported, true);
    assert.deepEqual(preview.conflictedFiles, ['a.txt']);
    assert.ok(preview.changedFiles.includes('a.txt'));
    assert.ok(preview.changedFiles.includes('c.txt'));
  } finally {
    fixture.cleanup();
  }
});

test('concurrent operations on one service are serialized without deadlock', async () => {
  const fixture = createRepository();
  try {
    fixture.write('a.txt', 'hello');
    fixture.git('add', '-A');
    fixture.git('commit', '-m', 'initial');

    const service = new GitService(fixture.repository);
    const results = await Promise.all([
      service.getLog(10),
      service.getBranches(),
      service.getStatus(),
      service.getGraphPage(),
      service.getTags(),
      service.getWorkingTree()
    ]);
    assert.ok(results.every(result => result !== undefined));
    assert.equal(results[0].all.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test('repo-manager keeps the active repository when a repo above it is removed', () => {
  const configPath = path.join(
    fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gittree-manager-')),
    'repos.json'
  );
  const manager = new RepoManager({ configPath });
  manager.addRepo('C:\\work\\a');
  manager.addRepo('C:\\work\\b');
  manager.addRepo('C:\\work\\c');
  manager.setActiveRepo(1);

  assert.equal(manager.removeRepo('C:\\work\\a'), true);
  assert.equal(manager.getActiveRepo().path, 'C:\\work\\b');
  assert.equal(manager.activeRepoIndex, 0);

  assert.equal(manager.removeRepo('C:\\work\\c'), true);
  assert.equal(manager.getActiveRepo().path, 'C:\\work\\b');

  assert.equal(manager.removeRepo('C:\\work\\b'), true);
  assert.equal(manager.getActiveRepo(), null);
  fs.rmSync(path.dirname(configPath), { recursive: true, force: true });
});

test('credential vault write queue recovers after a failed write', async () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gittree-vault-'));
  const blocker = path.join(root, 'blocker');
  const storagePath = path.join(blocker, 'vault.bin');
  fs.writeFileSync(blocker, 'i am a file');
  const vault = new CredentialVault({
    storagePath,
    platform: 'win32',
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: plaintext => Buffer.from(String(plaintext), 'utf8')
    }
  });
  try {
    await assert.rejects(vault.persist());

    fs.rmSync(blocker);
    await vault.setAccount('github', { token: 'secret-token' });
    assert.ok(fs.existsSync(storagePath));
    await vault.removeAccount('github');
    assert.ok(fs.existsSync(storagePath));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('credential vault reset clears accounts, drafts and the vault file', async () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gittree-vault-reset-'));
  const storagePath = path.join(root, 'vault.bin');
  const vault = new CredentialVault({
    storagePath,
    platform: 'win32',
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: plaintext => Buffer.from(String(plaintext), 'utf8')
    }
  });
  try {
    await vault.setAccount('github', { token: 'token-1' });
    await vault.saveReviewDraft('github:owner/repo:42', { body: 'draft' });
    const result = await vault.reset();
    assert.equal(result.success, true);
    assert.equal(await vault.getAccount('github'), null);
    assert.equal(await vault.getReviewDraft('github:owner/repo:42'), null);
    assert.equal(fs.existsSync(storagePath), false);
    await vault.setAccount('gitlab', { token: 'token-2' });
    assert.ok(fs.existsSync(storagePath));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('credential vault removes only the drafts of the given provider', async () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gittree-vault-drafts-'));
  const vault = new CredentialVault({
    storagePath: path.join(root, 'vault.bin'),
    platform: 'win32',
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: plaintext => Buffer.from(String(plaintext), 'utf8')
    }
  });
  try {
    await vault.saveReviewDraft('github:owner/repo:42', { body: 'gh' });
    await vault.saveReviewDraft('gitlab:owner/repo:7', { body: 'gl' });
    await vault.removeProviderDrafts('github');
    assert.equal(await vault.getReviewDraft('github:owner/repo:42'), null);
    assert.deepEqual(await vault.getReviewDraft('gitlab:owner/repo:7'), { body: 'gl' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('repository paths cannot traverse symbolic links', async t => {
  const fixture = createRepository();
  t.after(() => fixture.cleanup());
  const outside = path.join(fixture.root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'top-secret');
  const link = path.join(fixture.repository, 'link');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    fs.symlinkSync(outside, link, linkType);
  } catch {
    t.skip('symlinks are not available on this filesystem');
    return;
  }
  const service = new GitService(fixture.repository);
  await assert.rejects(service.getParsedWorkingDiff('link/secret.txt'), /symbolic links/);
  const snapshotId = (await service.getWorkingTree()).snapshotId;
  await assert.rejects(service.stagePaths(snapshotId, ['link/secret.txt']), /symbolic links/);
});

test('branch names starting with a dash are rejected before checkout and push', async () => {
  const fixture = createRepository();
  try {
    fixture.write('a.txt', 'hello');
    fixture.git('add', '-A');
    fixture.git('commit', '-m', 'initial');
    const bare = path.join(fixture.root, 'remote.git');
    const { git } = require('./helpers/git-repository');
    git(fixture.root, 'init', '--bare', 'remote.git');
    fixture.git('remote', 'add', 'origin', bare);

    const service = new GitService(fixture.repository);
    await assert.rejects(service.checkoutBranch('-f'), /Invalid local branch name/);
    await assert.rejects(service.checkoutBranch('-B'), /Invalid local branch name/);
    await assert.rejects(service.push('origin', '-f'), /Invalid local branch name/);
    await assert.rejects(service.checkoutTrackingBranch('origin/-f'), /Invalid remote branch/);
  } finally {
    fixture.cleanup();
  }
});
