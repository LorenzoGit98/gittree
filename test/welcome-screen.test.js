const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadWelcomeScreen(gitTree) {
  const filename = path.join(
    __dirname,
    '..',
    'src',
    'renderer',
    'components',
    'welcome.js'
  );
  const elements = new Map();
  global.window = { gitTree };
  global.document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          classList: { add() {}, remove() {} },
          innerHTML: ''
        });
      }
      return elements.get(id);
    },
    createElement() {
      return { textContent: '', innerHTML: '' };
    }
  };
  global.t = key => key;
  return require(filename);
}

test('a fresh install adds the first repository through the registered tabs component', async () => {
  const selectedPath = 'C:\\work\\first-repository';
  const added = [];
  const errors = [];
  const WelcomeScreen = loadWelcomeScreen({
    selectDirectory: async () => selectedPath,
    checkIsGitRepo: async repoPath => repoPath === selectedPath
  });
  const welcome = new WelcomeScreen();
  welcome.app = {
    components: {
      repoTabs: {
        addRepo: async repoPath => added.push(repoPath)
      }
    },
    showToast: message => errors.push(message)
  };

  await welcome.openRepo();

  assert.deepEqual(added, [selectedPath]);
  assert.deepEqual(errors, []);
});

test('bulk repository import persists once and selects the first newly added repository', () => {
  const RepoManager = require('../src/main/repo-manager');
  const repositories = {
    existing: path.resolve('workspace', 'existing'),
    alpha: path.resolve('workspace', 'alpha'),
    beta: path.resolve('workspace', 'beta')
  };
  const manager = Object.create(RepoManager.prototype);
  manager.repos = [
    { path: repositories.existing, name: 'existing', addedAt: 'before' }
  ];
  manager.activeRepoIndex = 0;
  manager.platform = process.platform;
  manager.now = () => 'now';
  let saves = 0;
  manager.saveRepos = () => { saves += 1; };

  const result = manager.addRepos([
    repositories.existing,
    repositories.alpha,
    repositories.beta
  ]);

  assert.equal(saves, 1);
  assert.deepEqual(result.added.map(item => item.name), ['alpha', 'beta']);
  assert.deepEqual(result.existing.map(item => item.name), ['existing']);
  assert.equal(result.activeRepo.name, 'alpha');
});
