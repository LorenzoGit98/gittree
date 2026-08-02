const test = require('node:test');
const assert = require('node:assert/strict');

const { registerGitHandlers } = require('../src/main/ipc/git-handlers');

test('git status is registered as a managed repository handler', async () => {
  const registrations = [];
  const requestedPaths = [];
  registerGitHandlers({
    registerManagedRepoHandler(channel, implementation) {
      registrations.push({ channel, implementation });
    },
    getGitService(repoPath) {
      requestedPaths.push(repoPath);
      return { getStatus: async () => ({ isClean: true }) };
    }
  });

  const statusHandler = registrations.find(item => item.channel === 'git:status');
  assert.ok(statusHandler);
  assert.deepEqual(await statusHandler.implementation('C:\\repo'), { isClean: true });
  assert.deepEqual(requestedPaths, ['C:\\repo']);
});

test('managed Git forwarding preserves renderer arguments and Git results', async () => {
  const registrations = [];
  registerGitHandlers({
    registerManagedRepoHandler(channel, implementation) {
      registrations.push({ channel, implementation });
    },
    getGitService() {
      return {
        getWorkingDiff: async (...args) => ({ args, binary: false })
      };
    }
  });
  const handler = registrations.find(item => item.channel === 'git:working-diff');

  assert.deepEqual(
    await handler.implementation('C:\\repo', 'nested/file.txt', true),
    { args: ['nested/file.txt', true], binary: false }
  );
});

test('conflicting Git operations preserve the conflict state envelope', async () => {
  const registrations = [];
  registerGitHandlers({
    registerManagedRepoHandler(channel, implementation) {
      registrations.push({ channel, implementation });
    },
    getGitService() {
      return {
        async rebaseOnto() {
          throw new Error('Resolve conflicts before continuing');
        },
        async getOperationState() {
          return { type: 'rebase', conflicts: ['README.md'] };
        }
      };
    },
    sendToRenderer() {}
  });
  const handler = registrations.find(item => item.channel === 'git:branch-rebase');

  assert.deepEqual(await handler.implementation('C:\\repo', 'main'), {
    error: 'Resolve conflicts before continuing',
    conflictState: { type: 'rebase', conflicts: ['README.md'] }
  });
});
