const test = require('node:test');
const assert = require('node:assert/strict');
const GitService = require('../src/main/git-service');
const { createRepository } = require('./helpers/git-repository');

function createConflictingRepository(t) {
  const repo = createRepository();
  t.after(() => repo.cleanup());
  repo.write('conflict.txt', 'base\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'base');
  repo.git('switch', '-c', 'feature');
  repo.write('conflict.txt', 'feature\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'feature change');
  repo.git('switch', 'main');
  repo.write('conflict.txt', 'main\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'main change');
  return repo;
}

test('merge conflicts expose real stage content and continue after a manual resolution', async t => {
  const repo = createConflictingRepository(t);
  const service = new GitService(repo.repository);

  await assert.rejects(service.merge('feature', 'noff'), /Failed to merge/);
  const pending = await service.getOperationState();
  assert.deepEqual(pending, {
    type: 'merge',
    conflicts: ['conflict.txt'],
    canContinue: false
  });

  const conflict = await service.readConflict('conflict.txt');
  assert.equal(conflict.binary, false);
  assert.equal(conflict.base, 'base\n');
  assert.equal(conflict.ours, 'main\n');
  assert.equal(conflict.theirs, 'feature\n');

  await service.resolveConflict('conflict.txt', {
    strategy: 'manual',
    content: 'resolved\n'
  });
  assert.equal((await service.getOperationState()).canContinue, true);
  await service.continueOperation();

  assert.equal((await service.getOperationState()).type, null);
  assert.equal(repo.git('show', 'HEAD:conflict.txt'), 'resolved');
});

test('an in-progress merge can be aborted without changing the current branch', async t => {
  const repo = createConflictingRepository(t);
  const service = new GitService(repo.repository);

  await assert.rejects(service.merge('feature', 'noff'));
  await service.abortOperation();

  assert.equal((await service.getOperationState()).type, null);
  assert.equal(repo.git('branch', '--show-current'), 'main');
  assert.equal(repo.git('show', 'HEAD:conflict.txt'), 'main');
});

test('rebase conflicts use Git stage semantics and can continue with the rebased commit', async t => {
  const repo = createConflictingRepository(t);
  repo.git('switch', 'feature');
  const service = new GitService(repo.repository);

  await assert.rejects(service.rebaseOnto('main'), /Failed to rebase/);
  assert.equal((await service.getOperationState()).type, 'rebase');

  const conflict = await service.readConflict('conflict.txt');
  assert.equal(conflict.ours, 'main\n');
  assert.equal(conflict.theirs, 'feature\n');

  await service.resolveConflict('conflict.txt', { strategy: 'theirs' });
  await service.continueOperation();

  assert.equal((await service.getOperationState()).type, null);
  assert.equal(repo.git('show', 'HEAD:conflict.txt'), 'feature');
});

test('binary conflicts reject manual text and repository paths cannot escape the worktree', async t => {
  const repo = createRepository();
  t.after(() => repo.cleanup());
  repo.write('image.bin', Buffer.from([0, 1, 2]));
  repo.git('add', '.');
  repo.git('commit', '-m', 'base binary');
  repo.git('switch', '-c', 'feature');
  repo.write('image.bin', Buffer.from([0, 3, 4]));
  repo.git('add', '.');
  repo.git('commit', '-m', 'feature binary');
  repo.git('switch', 'main');
  repo.write('image.bin', Buffer.from([0, 5, 6]));
  repo.git('add', '.');
  repo.git('commit', '-m', 'main binary');

  const service = new GitService(repo.repository);
  await assert.rejects(service.merge('feature', 'noff'));
  assert.equal((await service.readConflict('image.bin')).binary, true);
  await assert.rejects(
    service.resolveConflict('image.bin', { strategy: 'manual', content: 'text' }),
    /Binary conflicts/
  );
  await assert.rejects(service.readConflict('../outside.txt'), /outside the repository/);
  await service.abortOperation();
});
