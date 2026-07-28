class RepoTabs {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.repos = [];
    this.syncByRepoPath = new Map();
  }

  async init() {
    try { this.repos = await window.gitTree.getRepos(); } catch(e) {}
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

  createSyncIndicator(repoPath) {
    const state = this.syncByRepoPath.get(repoPath);
    if (!state) return null;
    const indicator = document.createElement('span');
    indicator.className = 'sync-indicator repo-tab-sync';
    const synchronized = !state.ahead && !state.behind;
    indicator.title = synchronized
      ? t('tabs.syncedState', { branch: state.branch })
      : t('tabs.syncState', {
          branch: state.branch,
          ahead: state.ahead || 0,
          behind: state.behind || 0
        });
    indicator.setAttribute('aria-label', indicator.title);
    const label = document.createElement('span');
    label.className = 'repo-tab-sync-label';
    label.textContent = t('tabs.sync');
    indicator.appendChild(label);
    if (state.ahead > 0) indicator.appendChild(this.syncPart('ahead', state.ahead));
    if (state.behind > 0) indicator.appendChild(this.syncPart('behind', state.behind));
    if (synchronized) indicator.appendChild(this.syncPart('synced', null));
    return indicator;
  }

  syncPart(direction, count) {
    const part = document.createElement('span');
    part.className = `sync-indicator-part is-${direction}`;
    const icon = document.createElement('i');
    icon.className = direction === 'synced'
      ? 'ph ph-check'
      : `ph ph-arrow-${direction === 'ahead' ? 'up' : 'down'}`;
    icon.setAttribute('aria-hidden', 'true');
    part.appendChild(icon);
    if (count !== null) {
      const value = document.createElement('span');
      value.textContent = String(count);
      part.appendChild(value);
    }
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
      } else if (result && result.error) {
        this.app.showToast(result.error, 'error');
      }
    } catch (e) {
      this.app.showToast(`${t('common.error')}: ${e.message}`, 'error');
    }
  }
}
