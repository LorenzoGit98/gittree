const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'GitTree Tests',
      GIT_AUTHOR_EMAIL: 'gittree@example.test',
      GIT_COMMITTER_NAME: 'GitTree Tests',
      GIT_COMMITTER_EMAIL: 'gittree@example.test',
      GIT_EDITOR: 'true'
    }
  }).trim();
}

function toWindowsShortPath(targetPath) {
  if (process.platform !== 'win32') return targetPath;
  const escapedPath = targetPath.replaceAll('%', '%%').replaceAll('"', '""');
  const shortPath = execFileSync('cmd.exe', [
    '/d',
    '/s',
    '/c',
    `for %I in ("${escapedPath}") do @echo %~sI`
  ], { encoding: 'utf8', windowsVerbatimArguments: true }).trim();
  return shortPath || targetPath;
}

function createRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gittree-test-'));
  const repository = path.join(root, 'repo');
  fs.mkdirSync(repository);
  git(repository, 'init', '-b', 'main');
  git(repository, 'config', 'user.name', 'GitTree Tests');
  git(repository, 'config', 'user.email', 'gittree@example.test');

  return {
    root,
    repository,
    git: (...args) => git(repository, ...args),
    write(relativePath, content) {
      const target = path.join(repository, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

module.exports = {
  createRepository,
  git,
  toWindowsShortPath
};
