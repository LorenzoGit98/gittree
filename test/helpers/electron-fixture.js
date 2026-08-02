const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRepository } = require('./git-repository');

function createElectronFixture() {
  const repo = createRepository();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gittree-user-data-'));

  repo.write('README.md', '# Deterministic GitTree fixture\n');
  repo.git('add', 'README.md');
  repo.git('commit', '-m', 'Initial fixture commit');
  repo.git('branch', 'feature/known-branch');
  repo.git('tag', 'v0.1.0');
  repo.write('dirty.txt', 'known working tree change\n');

  return {
    repository: repo.repository,
    userData,
    deepLink: `gittree://open?path=${encodeURIComponent(repo.repository)}`,
    cleanup() {
      repo.cleanup();
      fs.rmSync(userData, { recursive: true, force: true });
    }
  };
}

module.exports = { createElectronFixture };
