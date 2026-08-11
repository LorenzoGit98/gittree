const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function repositoryName(repoPath) {
  return path.basename(String(repoPath).replace(/[\\/]+$/, '').replace(/\\/g, '/'));
}

function normalizedRepositoryPath(repoPath) {
  if (typeof repoPath !== 'string' || !repoPath.trim() || !path.isAbsolute(repoPath)) {
    throw new Error('Invalid repository path');
  }
  return path.normalize(repoPath);
}

function repositoryKey(repoPath, platform = process.platform) {
  const normalized = normalizedRepositoryPath(repoPath);
  return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

class RepoManager {
  constructor(options = {}) {
    this.repos = [];
    this.activeRepoIndex = -1;
    this.platform = options.platform || process.platform;
    this.fileSystem = options.fileSystem || fs;
    this.now = options.now || (() => new Date().toISOString());
    this.configPath = options.configPath || path.join(app.getPath('userData'), 'repos.json');
    this.loadRepos();
  }

  loadRepos() {
    try {
      if (this.fileSystem.existsSync(this.configPath)) {
        const data = this.fileSystem.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(data);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.repos)) {
          throw new Error('Invalid repository workspace file');
        }
        const seen = new Set();
        this.repos = parsed.repos.flatMap(repository => {
          try {
            const normalizedPath = normalizedRepositoryPath(repository?.path);
            const key = repositoryKey(normalizedPath, this.platform);
            if (seen.has(key)) return [];
            seen.add(key);
            return [{
              path: normalizedPath,
              name: repositoryName(normalizedPath),
              addedAt: typeof repository.addedAt === 'string' ? repository.addedAt : this.now()
            }];
          } catch {
            return [];
          }
        });
        const requestedIndex = Number.isInteger(parsed.activeRepoIndex)
          ? parsed.activeRepoIndex
          : -1;
        this.activeRepoIndex = requestedIndex >= 0 && requestedIndex < this.repos.length
          ? requestedIndex
          : (this.repos.length > 0 ? 0 : -1);
      }
    } catch {
      this.repos = [];
      this.activeRepoIndex = -1;
    }
  }

  saveRepos() {
    let temporaryPath = null;
    try {
      const dir = path.dirname(this.configPath);
      if (!this.fileSystem.existsSync(dir)) {
        this.fileSystem.mkdirSync(dir, { recursive: true });
      }
      temporaryPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
      this.fileSystem.writeFileSync(temporaryPath, JSON.stringify({
        repos: this.repos,
        activeRepoIndex: this.activeRepoIndex
      }, null, 2));
      this.fileSystem.renameSync(temporaryPath, this.configPath);
      temporaryPath = null;
    } catch (err) {
      console.error('Failed to save repos config:', err);
    } finally {
      if (temporaryPath) {
        try {
          this.fileSystem.rmSync(temporaryPath, { force: true });
        } catch {
          // Best-effort cleanup after a failed atomic replacement.
        }
      }
    }
  }

  addRepo(repoPath) {
    const normalizedPath = normalizedRepositoryPath(repoPath);
    const key = repositoryKey(normalizedPath, this.platform);
    const existing = this.repos.find(r => repositoryKey(r.path, this.platform) === key);
    if (existing) {
      this.activeRepoIndex = this.repos.indexOf(existing);
    } else {
      const name = repositoryName(normalizedPath);
      this.repos.push({ path: normalizedPath, name, addedAt: this.now() });
      this.activeRepoIndex = this.repos.length - 1;
    }
    this.saveRepos();
    return this.getActiveRepo();
  }

  addRepos(repoPaths) {
    const paths = Array.isArray(repoPaths) ? repoPaths : [];
    const existingByPath = new Map(
      this.repos.map(repo => [repositoryKey(repo.path, this.platform), repo])
    );
    const added = [];
    const existing = [];

    for (const repoPath of paths) {
      if (typeof repoPath !== 'string' || !repoPath.trim()) continue;
      let normalizedPath;
      try {
        normalizedPath = normalizedRepositoryPath(repoPath);
      } catch {
        continue;
      }
      const key = repositoryKey(normalizedPath, this.platform);
      const knownRepo = existingByPath.get(key);
      if (knownRepo) {
        if (!existing.includes(knownRepo)) existing.push(knownRepo);
        continue;
      }

      const repo = {
        path: normalizedPath,
        name: repositoryName(normalizedPath),
        addedAt: this.now()
      };
      this.repos.push(repo);
      existingByPath.set(key, repo);
      added.push(repo);
    }

    if (added.length) {
      this.activeRepoIndex = this.repos.indexOf(added[0]);
      this.saveRepos();
    }

    return {
      added,
      existing,
      activeRepo: this.getActiveRepo()
    };
  }

  removeRepo(repoPath) {
    let key;
    try {
      key = repositoryKey(repoPath, this.platform);
    } catch {
      return false;
    }
    const index = this.repos.findIndex(r => repositoryKey(r.path, this.platform) === key);
    if (index === -1) return false;
    this.repos.splice(index, 1);
    if (index < this.activeRepoIndex) {
      this.activeRepoIndex -= 1;
    } else if (this.activeRepoIndex >= this.repos.length) {
      this.activeRepoIndex = this.repos.length - 1;
    }
    this.saveRepos();
    return true;
  }

  setActiveRepo(index) {
    if (index >= 0 && index < this.repos.length) {
      this.activeRepoIndex = index;
      this.saveRepos();
      return this.getActiveRepo();
    }
    return null;
  }

  getActiveRepo() {
    if (this.activeRepoIndex >= 0 && this.activeRepoIndex < this.repos.length) {
      return { ...this.repos[this.activeRepoIndex] };
    }
    return null;
  }

  getAllRepos() {
    return this.repos.map(repository => ({ ...repository }));
  }
}

module.exports = RepoManager;
