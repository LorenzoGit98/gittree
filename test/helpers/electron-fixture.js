const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRepository, git, toWindowsShortPath } = require('./git-repository');

function createElectronFixture({ withRemote = false } = {}) {
  const repo = createRepository();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gittree-user-data-'));

  repo.write('README.md', '# Deterministic GitTree fixture\n');
  repo.git('add', 'README.md');
  repo.git('commit', '-m', 'Initial fixture commit');
  repo.git('branch', 'feature/known-branch');
  repo.git('tag', 'v0.1.0');
  let remote = null;
  if (withRemote) {
    remote = path.join(repo.root, 'origin.git');
    fs.mkdirSync(remote);
    git(remote, 'init', '--bare');
    repo.git('remote', 'add', 'origin', remote);
    repo.git('push', '--set-upstream', 'origin', 'main');
  }
  repo.write('dirty.txt', 'known working tree change\n');
  const deepLinkRepository = toWindowsShortPath(repo.repository);

  return {
    repository: repo.repository,
    remote,
    userData,
    deepLink: `gittree://open?path=${encodeURIComponent(deepLinkRepository)}`,
    cleanup() {
      repo.cleanup();
      fs.rmSync(userData, { recursive: true, force: true });
    }
  };
}

module.exports = { createElectronFixture };
