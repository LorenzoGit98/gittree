class RepoTabs {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.repos = [];
    this.syncByRepoPath = new Map();
    this.busyRepoPaths = new Set();
    this._syncRefreshToken = 0;
    this._syncTimer = null;
  }

  async init() {
    try { this.repos = await window.gitTree.getRepos(); } catch(e) {}
    this.render();
    this.refreshAllSync();
    this.startPeriodicSyncRefresh();
  }

  startPeriodicSyncRefresh() {
    this.stopPeriodicSyncRefresh();
    this._syncTimer = setInterval(() => this.refreshAllSync(), 60000);
  }

  stopPeriodicSyncRefresh() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
  }

  async refreshAllSync() {
    if (!this.repos.length) return;
    const token = ++this._syncRefreshToken;
    const results = await Promise.all(this.repos.map(async repo => {
      try {
        const metadata = await window.gitTree.getBranchMetadata(repo.path);
        if (!metadata || metadata.error || !Array.isArray(metadata.branches)) {
          return [repo.path, null];
        }
        const current = metadata.branches.find(b => b.kind === 'local' && b.current);
        return [repo.path, current
          ? {
              branch: current.name,
              upstream: current.upstream,
              ahead: current.ahead,
              behind: current.behind
            }
          : null];
      } catch {
        return [repo.path, null];
      }
    }));
    if (token !== this._syncRefreshToken) return;
    for (const [repoPath, state] of results) {
      if (state) this.syncByRepoPath.set(repoPath, state);
      else this.syncByRepoPath.delete(repoPath);
    }
    this.render();
  }

  render() {
    this.container.innerHTML = '';
    this.repos.forEach((repo, i) => {
      const el = document.createElement('div');
      el.className = 'repo-tab';
      if (i === this.app.state.activeRepoIndex) el.classList.add('active');

      const name = document.createElement('span');
      name.className = 'repo-tab-name';
      name.textContent = repo.name;
      name.title = repo.path;

      const sync = this.createSyncIndicator(repo.path);
      const close = document.createElement('span');
      close.className = 'repo-tab-close';
      close.innerHTML = '<i class="ph ph-x"></i>';
      close.onclick = e => { e.stopPropagation(); this.removeRepo(repo.path); };

      el.appendChild(name);
      if (sync) el.appendChild(sync);
      el.appendChild(close);
      el.onclick = () => this.selectRepo(i);
      this.container.appendChild(el);
    });
  }

  updateSync(repoPath, state) {
    if (!repoPath) return;
    if (!state) {
      this.syncByRepoPath.delete(repoPath);
    } else {
      this.syncByRepoPath.set(repoPath, state);
    }
    this.render();
  }

  setSyncBusy(repoPath, busy) {
    if (!repoPath) return;
    if (busy) this.busyRepoPaths.add(repoPath);
    else this.busyRepoPaths.delete(repoPath);
    this.render();
  }

  createSyncIndicator(repoPath) {
    const state = this.syncByRepoPath.get(repoPath);
    const busy = this.busyRepoPaths.has(repoPath);
    if (!busy && (!state || (!state.ahead && !state.behind))) return null;
    const indicator = document.createElement('span');
    indicator.className = 'sync-indicator repo-tab-sync';
    if (busy) {
      indicator.title = t('tabs.syncing');
      indicator.setAttribute('aria-label', indicator.title);
      indicator.appendChild(this.syncBusyPart());
      return indicator;
    }
    indicator.title = t('tabs.syncState', {
      branch: state.branch,
      ahead: state.ahead || 0,
      behind: state.behind || 0
    });
    indicator.setAttribute('aria-label', indicator.title);
    if (state.ahead > 0) indicator.appendChild(this.syncPart('ahead', state.ahead));
    if (state.behind > 0) indicator.appendChild(this.syncPart('behind', state.behind));
    return indicator;
  }

  syncBusyPart() {
    const part = document.createElement('span');
    part.className = 'sync-indicator-part is-syncing';
    const icon = document.createElement('i');
    icon.className = 'ph ph-circle-notch';
    icon.setAttribute('aria-hidden', 'true');
    part.appendChild(icon);
    return part;
  }

  syncPart(direction, count) {
    const part = document.createElement('span');
    part.className = `sync-indicator-part is-${direction}`;
    const icon = document.createElement('i');
    icon.className = `ph ph-arrow-${direction === 'ahead' ? 'up' : 'down'}`;
    icon.setAttribute('aria-hidden', 'true');
    part.appendChild(icon);
    const value = document.createElement('span');
    value.textContent = String(count);
    part.appendChild(value);
    return part;
  }

  async selectRepo(index) {
    const repo = await window.gitTree.setActiveRepo(index);
    if (repo) {
      this.app.state.activeRepoIndex = index;
      this.render();
      this.app.emit('repo:changed', repo);
    }
  }

  async removeRepo(repoPath) {
    const active = await window.gitTree.removeRepo(repoPath);
    this.repos = await window.gitTree.getRepos();
    this.syncByRepoPath.delete(repoPath);
    if (active) {
      this.app.state.activeRepoIndex = this.repos.findIndex(r => r.path === active.path);
    }
    this.render();
    if (active) this.app.emit('repo:changed', active);
    else this.app.emit('repo:cleared');
  }

  async addRepo(repoPath) {
    try {
      const result = await window.gitTree.addRepo(repoPath);
      if (result && !result.error) {
        this.repos = await window.gitTree.getRepos();
        this.app.state.activeRepoIndex = this.repos.findIndex(r => r.path === result.path);
        this.render();
        this.app.emit('repo:changed', result);
        this.refreshAllSync();
      } else if (result && result.error) {
        this.app.showToast(result.error, 'error');
      }
    } catch (e) {
      this.app.showToast(`${t('common.error')}: ${e.message}`, 'error');
    }
  }

  async addRepos(repoPaths) {
    const result = await window.gitTree.addRepos(repoPaths);
    this.repos = await window.gitTree.getRepos();
    if (result?.activeRepo) {
      this.app.state.activeRepoIndex = this.repos.findIndex(
        repo => repo.path === result.activeRepo.path
      );
      this.render();
      this.app.emit('repo:changed', result.activeRepo);
    }
    this.refreshAllSync();
    return result;
  }
}
