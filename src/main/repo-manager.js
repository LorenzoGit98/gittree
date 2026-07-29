const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function repositoryName(repoPath) {
  return path.basename(String(repoPath).replace(/[\\/]+$/, '').replace(/\\/g, '/'));
}

class RepoManager {
  constructor() {
    this.repos = [];
    this.activeRepoIndex = -1;
    this.configPath = path.join(app.getPath('userData'), 'repos.json');
    this.loadRepos();
  }

  loadRepos() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(data);
        this.repos = parsed.repos || [];
        this.activeRepoIndex = parsed.activeRepoIndex >= 0 ? parsed.activeRepoIndex : (this.repos.length > 0 ? 0 : -1);
      }
    } catch (err) {
      this.repos = [];
      this.activeRepoIndex = -1;
    }
  }

  saveRepos() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify({
        repos: this.repos,
        activeRepoIndex: this.activeRepoIndex
      }, null, 2));
    } catch (err) {
      console.error('Failed to save repos config:', err);
    }
  }

  addRepo(repoPath) {
    const existing = this.repos.find(r => r.path === repoPath);
    if (existing) {
      this.activeRepoIndex = this.repos.indexOf(existing);
    } else {
      const name = repositoryName(repoPath);
      this.repos.push({ path: repoPath, name, addedAt: new Date().toISOString() });
      this.activeRepoIndex = this.repos.length - 1;
    }
    this.saveRepos();
    return this.getActiveRepo();
  }

  addRepos(repoPaths) {
    const paths = Array.isArray(repoPaths) ? repoPaths : [];
    const normalizeKey = value => {
      const normalized = path.normalize(value);
      return process.platform === 'win32'
        ? normalized.toLocaleLowerCase('en-US')
        : normalized;
    };
    const existingByPath = new Map(
      this.repos.map(repo => [normalizeKey(repo.path), repo])
    );
    const added = [];
    const existing = [];

    for (const repoPath of paths) {
      if (typeof repoPath !== 'string' || !repoPath.trim()) continue;
      const normalizedPath = path.normalize(repoPath);
      const key = normalizeKey(normalizedPath);
      const knownRepo = existingByPath.get(key);
      if (knownRepo) {
        if (!existing.includes(knownRepo)) existing.push(knownRepo);
        continue;
      }

      const repo = {
        path: normalizedPath,
        name: repositoryName(normalizedPath),
        addedAt: new Date().toISOString()
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
    const index = this.repos.findIndex(r => r.path === repoPath);
    if (index === -1) return false;
    this.repos.splice(index, 1);
    if (this.activeRepoIndex >= this.repos.length) {
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
      return this.repos[this.activeRepoIndex];
    }
    return null;
  }

  getAllRepos() {
    return this.repos;
  }
}

module.exports = RepoManager;
