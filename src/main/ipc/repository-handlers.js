const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function validateCloneUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) return null;
  const url = value.trim();
  if (url.startsWith('-')) return null;
  const supported = /^https:\/\//i.test(url) || /^ssh:\/\//i.test(url) ||
    /^git\+ssh:\/\//i.test(url) || /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^\s]+$/.test(url);
  const hasControlCharacters = [...url].some(character => {
    const code = character.codePointAt(0);
    return code < 0x20 || code === 0x7f;
  });
  return supported && !hasControlCharacters ? url : null;
}

async function cloneRepository(url, parentDirectory, repoManager) {
  const remoteUrl = validateCloneUrl(url);
  if (!remoteUrl) {
    return { error: 'Only remote repository URLs are supported (https, ssh or git@host:path)' };
  }
  if (typeof parentDirectory !== 'string' || !path.isAbsolute(parentDirectory)) {
    return { error: 'Invalid destination folder' };
  }
  let stat;
  try {
    stat = await fs.promises.stat(parentDirectory);
  } catch {
    return { error: 'Destination folder does not exist' };
  }
  if (!stat.isDirectory()) return { error: 'Destination is not a folder' };
  const rawName = remoteUrl.split('/').filter(Boolean).pop() || '';
  const name = rawName.replace(/\.git(\/)?$/, '').replace(/[<>:"/\\|?*]/g, '-');
  if (!name || name === '.' || name === '..') {
    return { error: 'Could not determine repository name from URL' };
  }
  const targetPath = path.join(parentDirectory, name);
  try {
    await fs.promises.access(targetPath);
    return { error: `Destination already exists: ${targetPath}` };
  } catch {
    // Destination is available.
  }
  await execFileAsync('git', ['clone', remoteUrl, targetPath], {
    cwd: parentDirectory,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });
  return repoManager.addRepo(targetPath) || { path: targetPath, name };
}

function registerScanHandlers({ registerHandler, scanRepositories, sendToRenderer }) {
  const scans = new Map();
  registerHandler('repo:scan-start', rootPath => {
    const scanId = crypto.randomUUID();
    const controller = new AbortController();
    scans.set(scanId, controller);
    let lastProgressAt = 0;
    scanRepositories(rootPath, {
      signal: controller.signal,
      onProgress(progress) {
        const now = Date.now();
        if (progress.repository || now - lastProgressAt >= 50) {
          lastProgressAt = now;
          sendToRenderer('repo:scan-progress', { scanId, ...progress });
        }
      }
    }).then(result => {
      sendToRenderer('repo:scan-complete', { scanId, ...result });
    }).catch(error => {
      sendToRenderer('repo:scan-complete', {
        scanId,
        repositories: [],
        scannedDirectories: 0,
        skipped: 0,
        canceled: controller.signal.aborted,
        error: error.message
      });
    }).finally(() => scans.delete(scanId));
    return { scanId };
  });
  registerHandler('repo:scan-cancel', scanId => {
    const controller = scans.get(scanId);
    if (!controller) return { success: false };
    controller.abort();
    return { success: true };
  });
}

async function addRepositories(repoPaths, createGitService, repoManager) {
  if (!Array.isArray(repoPaths) || repoPaths.length > 10000) {
    return { added: [], existing: [], failed: [], activeRepo: null, error: 'Invalid repository list' };
  }
  const valid = [];
  const failed = [];
  for (const repoPath of repoPaths) {
    if (typeof repoPath !== 'string' || !path.isAbsolute(repoPath)) {
      failed.push({ path: String(repoPath || ''), error: 'Invalid repository path' });
      continue;
    }
    try {
      const git = createGitService(repoPath);
      await git.git.checkIsRepo();
      const inside = (await git.git.raw(['rev-parse', '--is-inside-work-tree'])).trim();
      if (inside !== 'true') throw new Error('Bare repositories are not supported');
      valid.push(repoPath);
    } catch (error) {
      failed.push({ path: repoPath, error: error.message || 'Not a valid Git repository' });
    }
  }
  return { ...repoManager.addRepos(valid), failed };
}

function registerRepositoryHandlers(dependencies) {
  const {
    registerHandler,
    repoManager,
    isWorkingTreeRepository,
    createGitService,
    scanRepositories,
    sendToRenderer,
    evictGitService,
    logger
  } = dependencies;
  registerHandler('git:is-repo', repoPath => isWorkingTreeRepository(repoPath));
  registerHandler('git:clone', (url, directory) => cloneRepository(url, directory, repoManager));
  registerHandler('repo:list', () => repoManager.getAllRepos());
  registerHandler('repo:add', async repoPath => {
    if (!await isWorkingTreeRepository(repoPath)) {
      return { error: 'Not a valid Git repository' };
    }
    const repository = repoManager.addRepo(repoPath);
    logger?.info('Repository added', { path: repoPath });
    return repository;
  });
  registerScanHandlers({ registerHandler, scanRepositories, sendToRenderer });
  registerHandler('repo:add-many', repoPaths => (
    addRepositories(repoPaths, createGitService, repoManager)
  ));
  registerHandler('repo:remove', repoPath => {
    const removed = repoManager.removeRepo(repoPath);
    if (removed) evictGitService(repoPath);
    logger?.info('Repository removed', { path: repoPath });
    return repoManager.getActiveRepo();
  });
  registerHandler('repo:set-active', index => repoManager.setActiveRepo(index));
  registerHandler('repo:active', () => repoManager.getActiveRepo());
}

module.exports = { registerRepositoryHandlers };
