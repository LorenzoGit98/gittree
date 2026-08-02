const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadMergeWorkspace(gitTree) {
  const filename = path.join(
    __dirname,
    '..',
    'src',
    'renderer',
    'components',
    'merge-workspace.js'
  );
  global.window = { gitTree };
  global.document = {
    createElement: () => ({ textContent: '', innerHTML: '' }),
    getElementById: () => null
  };
  global.t = key => key;
  return require(filename);
}

test('merge preview compares develop against quality without treating the range as a commit', async () => {
  const calls = [];
  const MergeWorkspace = loadMergeWorkspace({
    compareBranches: async (repoPath, target, source) => {
      calls.push({ repoPath, target, source });
      return {
        commits: [{ hash: 'develop-commit', message: 'change' }],
        diff: 'diff --git a/file b/file'
      };
    },
    getLog: async () => ({ latest: { hash: 'quality-commit' } }),
    getStatus: async () => ({ isClean: true }),
    previewMerge: async () => ({
      supported: true,
      canFastForward: false,
      conflictedFiles: ['a.txt'],
      changedFiles: ['a.txt', 'b.txt']
    })
  });
  const errors = [];
  const workspace = new MergeWorkspace({
    state: { repo: { path: 'C:\\repo' } },
    showToast: message => errors.push(message)
  });
  workspace.container = {
    classList: { add() {}, remove() {} },
    innerHTML: ''
  };
  workspace.showLoading = () => {};
  workspace.renderMerge = () => {};

  await workspace.open('develop', 'quality');

  assert.deepEqual(calls, [{
    repoPath: 'C:\\repo',
    target: 'quality',
    source: 'develop'
  }]);
  assert.equal(workspace.mergeData.source, 'develop');
  assert.equal(workspace.mergeData.target, 'quality');
  assert.equal(workspace.mergeData.commitsCount, 1);
  assert.equal(workspace.mergeData.diff, 'diff --git a/file b/file');
  assert.deepEqual(workspace.preview.conflictedFiles, ['a.txt']);
  assert.equal(workspace.preview.changedFiles.length, 2);
  assert.deepEqual(errors, []);
});
