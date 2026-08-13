const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

function matches(source, pattern) {
  return [...source.matchAll(pattern)].map(match => match[1]);
}

test('every preload invoke has exactly one registered main-process handler', () => {
  const preload = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.js'), 'utf8');
  const gitHandlers = fs.readFileSync(
    path.join(root, 'src', 'main', 'ipc', 'git-handlers.js'),
    'utf8'
  );
  const hostingHandlers = fs.readFileSync(
    path.join(root, 'src', 'main', 'ipc', 'hosting-handlers.js'),
    'utf8'
  );
  const repositoryHandlers = fs.readFileSync(
    path.join(root, 'src', 'main', 'ipc', 'repository-handlers.js'),
    'utf8'
  );
  const windowHandlers = fs.readFileSync(
    path.join(root, 'src', 'main', 'ipc', 'window-application-handlers.js'),
    'utf8'
  );
  const agentHandlers = fs.readFileSync(
    path.join(root, 'src', 'main', 'ipc', 'agent-handlers.js'),
    'utf8'
  );
  const aiHandlers = fs.readFileSync(
    path.join(root, 'src', 'main', 'ipc', 'ai-handlers.js'),
    'utf8'
  );
  const handlerModules = [
    gitHandlers,
    hostingHandlers,
    repositoryHandlers,
    windowHandlers,
    agentHandlers,
    aiHandlers
  ].join('\n');
  const invoked = matches(preload, /ipcRenderer\.invoke\(\s*'([^']+)'/g);
  const registered = [
    ...matches(main, /ipcMain\.handle\(\s*'([^']+)'/g),
    ...matches(handlerModules, /\[\s*'([^']+:[^']+)'\s*,\s*'[^']+'\s*\]/g),
    ...matches(
      handlerModules,
      /register(?:Handler|ManagedRepoHandler|Logged|ConflictOperation)\(\s*'([^']+)'/g
    )
  ];

  assert.equal(invoked.length, 144);
  assert.equal(new Set(invoked).size, 144);
  assert.equal(registered.length, 144);
  assert.equal(new Set(registered).size, 144);
  assert.deepEqual([...registered].sort(), [...invoked].sort());
});

test('all managed Git channels use the validating registrar', () => {
  const preload = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');
  const gitHandlers = fs.readFileSync(
    path.join(root, 'src', 'main', 'ipc', 'git-handlers.js'),
    'utf8'
  );
  const managedGitChannels = matches(preload, /ipcRenderer\.invoke\(\s*'(git:[^']+)'/g)
    .filter(channel => !['git:is-repo', 'git:clone'].includes(channel));
  const registered = new Set([
    ...matches(gitHandlers, /\[\s*'([^']+:[^']+)'\s*,\s*'[^']+'\s*\]/g),
    ...matches(gitHandlers, /register(?:ManagedRepoHandler|Logged|ConflictOperation)\(\s*'([^']+)'/g)
  ]);

  assert.equal(managedGitChannels.length, 75);
  for (const channel of managedGitChannels) {
    assert.equal(registered.has(channel), true, `${channel} is not managed`);
  }
  assert.doesNotMatch(gitHandlers, /\bregisterHandler\s*\(/);
});
