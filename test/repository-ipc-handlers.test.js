const test = require('node:test');
const assert = require('node:assert/strict');

const { registerRepositoryHandlers } = require('../src/main/ipc/repository-handlers');

test('adding a repository rejects non-working-tree paths without persisting them', async () => {
  const registrations = new Map();
  let additions = 0;
  registerRepositoryHandlers({
    registerHandler(channel, implementation) {
      registrations.set(channel, implementation);
    },
    repoManager: {
      addRepo() {
        additions += 1;
      }
    },
    isWorkingTreeRepository: async () => false,
    createGitService() {},
    scanRepositories() {},
    sendToRenderer() {},
    evictGitService() {}
  });

  assert.deepEqual(await registrations.get('repo:add')('C:\\not-a-repo'), {
    error: 'Not a valid Git repository'
  });
  assert.equal(additions, 0);
});
