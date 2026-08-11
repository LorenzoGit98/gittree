const fs = require('node:fs');
const path = require('node:path');
const GitService = require('./git-service');
const RepositoryQueue = require('./git/repository-queue');

function isInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

class RepositoryWorkspace {
  constructor({
    repoStore,
    createGitService = (repoPath, options) => new GitService(repoPath, options),
    platform = process.platform,
    fileSystem = fs
  }) {
    if (!repoStore) throw new TypeError('repoStore is required');
    this.repoStore = repoStore;
    this.createGitService = createGitService;
    this.platform = platform;
    this.fs = fileSystem;
    this.authorizedDirectories = new Map();
    this.activeScanRoots = new Map();
    this.gitServices = new Map();
    this.queues = new Map();
  }

  resolvePath(repoPath, { mustExist = true } = {}) {
    if (typeof repoPath !== 'string' || !repoPath || !path.isAbsolute(repoPath)) {
      throw new Error('Invalid repository path');
    }
    const resolved = path.resolve(repoPath);
    if (!mustExist) return path.normalize(resolved);
    const realpath = this.fs.realpathSync.native || this.fs.realpathSync;
    return path.normalize(realpath(resolved));
  }

  pathKey(repoPath, options) {
    const normalized = this.resolvePath(repoPath, options);
    return this.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
  }

  repositories() {
    return this.repoStore.getAllRepos();
  }

  list() {
    return this.repositories().map(repository => ({ ...repository }));
  }

  active() {
    const repository = this.repoStore.getActiveRepo();
    return repository ? { ...repository } : null;
  }

  setActive(index) {
    const repository = this.repoStore.setActiveRepo(index);
    return repository ? { ...repository } : null;
  }

  pathKeys(repoPath) {
    const keys = new Set();
    try {
      keys.add(this.pathKey(repoPath));
    } catch {
      // Missing repositories still need to be removable from the persisted workspace.
    }
    try {
      keys.add(this.pathKey(repoPath, { mustExist: false }));
    } catch {
      // Invalid paths never match a managed repository.
    }
    return keys;
  }

  managedRepository(repoPath) {
    const requestedKeys = this.pathKeys(repoPath);
    if (requestedKeys.size === 0) return null;
    return this.repositories().find(repository => {
      const managedKeys = this.pathKeys(repository.path);
      return [...managedKeys].some(key => requestedKeys.has(key));
    }) || null;
  }

  isManaged(repoPath) {
    return Boolean(this.managedRepository(repoPath));
  }

  assertManaged(repoPath) {
    if (!this.isManaged(repoPath)) {
      throw new Error('Repository is not opened in this workspace');
    }
  }

  authorizeDirectory(directoryPath) {
    const canonical = this.resolvePath(directoryPath);
    this.authorizedDirectories.set(this.pathKey(canonical), canonical);
    return canonical;
  }

  canInspect(repoPath) {
    if (this.isManaged(repoPath)) return true;
    try {
      return this.authorizedDirectories.has(this.pathKey(repoPath));
    } catch {
      return false;
    }
  }

  canAdd(repoPath) {
    return this.canInspect(repoPath);
  }

  consumeAuthorizedDirectory(directoryPath) {
    const key = this.pathKey(directoryPath);
    const canonical = this.authorizedDirectories.get(key);
    if (!canonical) throw new Error('Repository path was not authorized');
    this.authorizedDirectories.delete(key);
    return canonical;
  }

  beginScan(rootPath) {
    const root = this.consumeAuthorizedDirectory(rootPath);
    this.activeScanRoots.set(this.pathKey(root), root);
    return root;
  }

  authorizeScanResults(rootPath, repositories) {
    const rootKey = this.pathKey(rootPath);
    const root = this.activeScanRoots.get(rootKey);
    if (!root) throw new Error('Repository scan root was not authorized');
    this.activeScanRoots.delete(rootKey);
    for (const repository of Array.isArray(repositories) ? repositories : []) {
      const candidatePath = typeof repository === 'string' ? repository : repository?.path;
      try {
        const canonical = this.resolvePath(candidatePath);
        if (isInside(root, canonical)) {
          this.authorizedDirectories.set(this.pathKey(canonical), canonical);
        }
      } catch {
        // Invalid and vanished scan results are not admitted.
      }
    }
  }

  addTrustedRepository(repoPath) {
    const canonical = this.resolvePath(repoPath);
    const managed = this.managedRepository(canonical);
    return managed
      ? this.repoStore.addRepo(managed.path)
      : this.repoStore.addRepo(canonical);
  }

  addAuthorizedRepository(repoPath) {
    const managed = this.managedRepository(repoPath);
    if (managed) return this.repoStore.addRepo(managed.path);
    return this.repoStore.addRepo(this.consumeAuthorizedDirectory(repoPath));
  }

  addTrustedRepositories(repoPaths) {
    const canonical = (Array.isArray(repoPaths) ? repoPaths : [])
      .map(repoPath => this.resolvePath(repoPath));
    return this.repoStore.addRepos(canonical);
  }

  addAuthorizedRepositories(repoPaths) {
    const valid = [];
    const failed = [];
    for (const repoPath of Array.isArray(repoPaths) ? repoPaths : []) {
      const managed = this.managedRepository(repoPath);
      if (managed) {
        valid.push(managed.path);
        continue;
      }
      try {
        valid.push(this.consumeAuthorizedDirectory(repoPath));
      } catch (error) {
        failed.push({ path: String(repoPath || ''), error: error.message });
      }
    }
    return { ...this.repoStore.addRepos(valid), failed };
  }

  remove(repoPath) {
    const managed = this.managedRepository(repoPath);
    if (!managed) return false;
    const removed = this.repoStore.removeRepo(managed.path);
    if (removed) this.evictGitService(managed.path);
    return removed;
  }

  resolveCommonDirectory(repoPath) {
    const dotGit = path.join(repoPath, '.git');
    const stat = this.fs.statSync(dotGit);
    let gitDirectory = dotGit;
    if (stat.isFile()) {
      const match = /^gitdir:\s*(.+)\s*$/im.exec(this.fs.readFileSync(dotGit, 'utf8'));
      if (!match) throw new Error('Invalid Git worktree metadata');
      gitDirectory = path.resolve(repoPath, match[1]);
    }
    const commonFile = path.join(gitDirectory, 'commondir');
    let commonDirectory = gitDirectory;
    if (this.fs.existsSync(commonFile)) {
      const relative = this.fs.readFileSync(commonFile, 'utf8').trim();
      if (relative) commonDirectory = path.resolve(gitDirectory, relative);
    }
    return this.resolvePath(commonDirectory);
  }

  getGitService(repoPath) {
    this.assertManaged(repoPath);
    const canonical = this.resolvePath(repoPath);
    const serviceKey = this.pathKey(canonical);
    if (this.gitServices.has(serviceKey)) return this.gitServices.get(serviceKey);
    const commonDirectory = this.resolveCommonDirectory(canonical);
    const queueKey = this.pathKey(commonDirectory);
    let queue = this.queues.get(queueKey);
    if (!queue) {
      queue = new RepositoryQueue();
      this.queues.set(queueKey, queue);
    }
    const service = this.createGitService(canonical, { queue });
    this.gitServices.set(serviceKey, service);
    return service;
  }

  evictGitService(repoPath) {
    try {
      return this.gitServices.delete(this.pathKey(repoPath, { mustExist: false }));
    } catch {
      return false;
    }
  }
}

module.exports = RepositoryWorkspace;
