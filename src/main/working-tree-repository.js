const path = require('node:path');
const GitService = require('./git-service');

async function isWorkingTreeRepository(repoPath, createGitService = value => new GitService(value)) {
  if (typeof repoPath !== 'string' || !path.isAbsolute(repoPath)) return false;
  try {
    const git = createGitService(repoPath);
    const isRepository = await git.git.checkIsRepo();
    if (!isRepository) return false;
    const insideWorkTree = (await git.git.revparse(['--is-inside-work-tree'])).trim();
    if (insideWorkTree !== 'true') return false;
    const prefix = (await git.git.revparse(['--show-prefix'])).trim();
    return prefix === '';
  } catch {
    return false;
  }
}

module.exports = { isWorkingTreeRepository };
