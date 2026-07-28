const test = require('node:test');
const assert = require('node:assert/strict');
const GitService = require('../src/main/git-service');
const { createRepository } = require('./helpers/git-repository');

test('graph pages expose topology parents and refs from every branch', async t => {
  const repo = createRepository();
  t.after(() => repo.cleanup());

  repo.write('base.txt', 'base\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'base');
  repo.git('switch', '-c', 'feature/topic');
  repo.write('feature.txt', 'feature\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'feature');
  repo.git('switch', 'main');
  repo.write('main.txt', 'main\n');
  repo.git('add', '.');
  repo.git('commit', '-m', 'main');
  repo.git('merge', '--no-ff', 'feature/topic', '-m', 'merge topic');

  const service = new GitService(repo.repository);
  const page = await service.getGraphPage(0, 500);
  const mergeCommit = page.commits.find(commit => commit.subject === 'merge topic');

  assert.equal(mergeCommit.parents.length, 2);
  assert.equal(page.hasMore, false);
  assert.equal(page.nextOffset, page.commits.length);
  assert.ok(page.refs.some(ref => ref.fullName === 'refs/heads/main'));
  assert.ok(page.refs.some(ref => ref.fullName === 'refs/heads/feature/topic'));
});
