const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const GitService = require('../src/main/git-service');
const { createRepository, git } = require('./helpers/git-repository');

function createRepositoryWithRemote(t) {
  const repo = createRepository();
  t.after(() => repo.cleanup());
  const remotePath = path.join(repo.root, 'remote.git');
  git(repo.root, 'init', '--bare', remotePath);
  git(remotePath, 'symbolic-ref', 'HEAD', 'refs/heads/main');

  repo.write('README.md', 'base\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'base');
  repo.git('remote', 'add', 'origin', remotePath);
  repo.git('push', '-u', 'origin', 'main');
  repo.git('switch', '-c', 'feature/topic');
  repo.write('feature.txt', 'topic\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'topic');
  repo.git('push', '-u', 'origin', 'feature/topic');
  return repo;
}

test('branch metadata exposes local, remote, upstream and default branch information', async t => {
  const repo = createRepositoryWithRemote(t);
  const service = new GitService(repo.repository);

  const metadata = await service.getBranchMetadata();
  const local = metadata.branches.find(branch => branch.fullName === 'refs/heads/feature/topic');
  const remote = metadata.branches.find(
    branch => branch.fullName === 'refs/remotes/origin/feature/topic'
  );

  assert.equal(metadata.current, 'feature/topic');
  assert.equal(metadata.defaultBranch, 'main');
  assert.equal(local.kind, 'local');
  assert.equal(local.upstream, 'origin/feature/topic');
  assert.equal(remote.kind, 'remote');
  assert.equal(remote.remote, 'origin');
  assert.ok(metadata.remotes.some(item => item.name === 'origin'));
});

test('branch metadata reports ahead and behind counts against each local upstream', async t => {
  const repo = createRepositoryWithRemote(t);
  const sharedCommit = repo.git('rev-parse', 'feature/topic');

  repo.write('local-only.txt', 'local\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'local only');

  repo.git('switch', '-c', 'remote-work', sharedCommit);
  repo.write('remote-only.txt', 'remote\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'remote only');
  const remoteCommit = repo.git('rev-parse', 'HEAD');
  repo.git('switch', 'feature/topic');
  repo.git('update-ref', 'refs/remotes/origin/feature/topic', remoteCommit);

  const metadata = await new GitService(repo.repository).getBranchMetadata();
  const feature = metadata.branches.find(branch => (
    branch.fullName === 'refs/heads/feature/topic'
  ));

  assert.equal(feature.ahead, 1);
  assert.equal(feature.behind, 1);
});

test('branch actions rename safely and checkout a remote using its complete local name', async t => {
  const repo = createRepositoryWithRemote(t);
  const service = new GitService(repo.repository);

  await service.renameBranch('feature/topic', 'feature/renamed');
  assert.equal(repo.git('branch', '--show-current'), 'feature/renamed');
  await assert.rejects(
    service.renameBranch('feature/renamed', 'invalid branch name'),
    /Invalid branch name/
  );

  repo.git('switch', 'main');
  await service.deleteBranch('feature/renamed', true);
  await service.checkoutTrackingBranch('origin/feature/topic');

  assert.equal(repo.git('branch', '--show-current'), 'feature/topic');
  assert.equal(
    repo.git('for-each-ref', '--format=%(upstream:short)', 'refs/heads/feature/topic'),
    'origin/feature/topic'
  );
});

test('tracking, branch fetch and remote deletion use explicit validated refs', async t => {
  const repo = createRepositoryWithRemote(t);
  const service = new GitService(repo.repository);

  repo.git('switch', '-c', 'scratch', 'main');
  await service.trackBranch('scratch', 'origin/main');
  assert.equal(
    repo.git('for-each-ref', '--format=%(upstream:short)', 'refs/heads/scratch'),
    'origin/main'
  );

  await service.fetchBranch('origin', 'feature/topic');
  await service.deleteRemoteBranch('origin', 'feature/topic');
  assert.equal(repo.git('ls-remote', '--heads', 'origin', 'feature/topic'), '');
});

test('rebase requires a clean worktree and rebases the current branch onto the target', async t => {
  const repo = createRepository();
  t.after(() => repo.cleanup());

  repo.write('base.txt', 'base\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'base');
  repo.git('switch', '-c', 'feature');
  repo.write('feature.txt', 'feature\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'feature');
  repo.git('switch', 'main');
  repo.write('main.txt', 'main\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'main');
  repo.git('switch', 'feature');

  const service = new GitService(repo.repository);
  await service.rebaseOnto('main');
  assert.doesNotThrow(() => repo.git('merge-base', '--is-ancestor', 'main', 'feature'));

  repo.write('dirty.txt', 'dirty\n');
  await assert.rejects(service.rebaseOnto('main'), /clean working tree/);
});

test('safe deletion refuses unmerged work, force deletion is explicit, and current deletion is blocked', async t => {
  const repo = createRepository();
  t.after(() => repo.cleanup());
  repo.write('base.txt', 'base\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'base');
  repo.git('switch', '-c', 'unmerged');
  repo.write('unmerged.txt', 'work\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'unmerged work');
  repo.git('switch', 'main');

  const service = new GitService(repo.repository);
  await assert.rejects(service.deleteBranch('unmerged', false), /not fully merged|Failed to delete/);
  await service.deleteBranch('unmerged', true);
  assert.equal(repo.git('branch', '--list', 'unmerged'), '');
  await assert.rejects(service.deleteBranch('main', true), /current branch cannot be deleted/i);
});

test('merge strategy is passed through for no-ff and squash without implicit commits', async t => {
  const noff = createRepository();
  const squash = createRepository();
  t.after(() => noff.cleanup());
  t.after(() => squash.cleanup());

  for (const repo of [noff, squash]) {
    repo.write('base.txt', 'base\n');
    repo.git('add', '.');
    repo.git('commit', '-m', 'base');
    repo.git('switch', '-c', 'feature');
    repo.write('feature.txt', 'feature\n');
    repo.git('add', '.');
    repo.git('commit', '-m', 'feature');
    repo.git('switch', 'main');
  }

  const noffService = new GitService(noff.repository);
  const noffResult = await noffService.merge('feature', 'noff');
  assert.equal(noffResult.strategy, 'noff');
  assert.equal(noff.git('show', '-s', '--format=%P', 'HEAD').split(/\s+/).length, 2);

  const squashService = new GitService(squash.repository);
  const squashResult = await squashService.merge('feature', 'squash');
  assert.equal(squashResult.strategy, 'squash');
  assert.equal(squash.git('rev-parse', 'HEAD'), squash.git('rev-parse', 'main'));
  assert.match(squash.git('diff', '--cached', '--name-only'), /feature\.txt/);
});
