/* exported RepoTabs */
class RepoTabs {
  constructor(container, app, options = {}) {
    this.container = container;
    this.app = app;
    this.repos = [];
    this.backendRepos = [];
    this.syncByRepoPath = new Map();
    this.busyRepoPaths = new Set();
    this.platform = options.platform || (
      typeof window !== 'undefined' ? window.gitTree?.platform : null
    ) || 'win32';
    this.storage = options.storage || (
      typeof localStorage !== 'undefined' ? localStorage : null
    );
    this.layoutStorageKey = 'gittree.repo-tabs.layout';
    this.pinnedKeys = new Set();
    this.draggedKey = null;
    this.dragOverKey = null;
    this.dragOverAfter = false;
    this._syncRefreshToken = 0;
    this._syncTimer = null;

    this.handleDragStart = event => this.onDragStart(event);
    this.handleDragOver = event => this.onDragOver(event);
    this.handleDrop = event => this.onDrop(event);
    this.handleDragEnd = () => this.clearDragState();
    this.container.addEventListener('dragstart', this.handleDragStart);
    this.container.addEventListener('dragover', this.handleDragOver);
    this.container.addEventListener('drop', this.handleDrop);
    this.container.addEventListener('dragend', this.handleDragEnd);
  }

  async init() {
    try {
      this.setRepositoryData(await window.gitTree.getRepos());
    } catch { /* repo list may be unavailable */ }
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
    this.container.replaceChildren();
    this.container.classList.toggle('has-pinned', this.pinnedKeys.size > 0);
    this.repos.forEach((repo, i) => {
      const el = document.createElement('div');
      el.className = 'repo-tab';
      const active = i === this.app.state.activeRepoIndex;
      const pinned = this.isPinned(repo);
      if (active) el.classList.add('active');
      if (pinned) el.classList.add('is-pinned');
      el.dataset.path = repo.path;
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(active));
      el.tabIndex = active ? 0 : -1;
      el.draggable = true;

      const name = document.createElement('span');
      name.className = 'repo-tab-name';
      name.textContent = repo.name;
      name.title = repo.path;

      const sync = this.createSyncIndicator(repo.path);
      const pin = this.createTabControl(
        'repo-tab-pin',
        pinned ? 'tabs.unpin' : 'tabs.pin',
        'ph-push-pin'
      );
      pin.classList.toggle('is-pinned', pinned);
      pin.setAttribute('aria-pressed', String(pinned));
      pin.onclick = event => {
        event.stopPropagation();
        this.togglePinned(repo.path);
      };

      const close = this.createTabControl('repo-tab-close', 'common.close', 'ph-x');
      close.onclick = e => { e.stopPropagation(); this.removeRepo(repo.path); };

      el.append(name, pin);
      if (sync) el.appendChild(sync);
      el.appendChild(close);
      el.onclick = event => {
        if (event.target.closest('button')) return;
        this.selectRepo(i);
      };
      el.onkeydown = event => this.handleTabKeydown(event, i);
      this.container.appendChild(el);
    });
  }

  createTabControl(className, labelKey, iconName) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `repo-tab-control ${className}`;
    button.setAttribute('aria-label', t(labelKey));
    button.title = t(labelKey);
    button.draggable = false;
    const icon = document.createElement('i');
    icon.className = `ph ${iconName}`;
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
    return button;
  }

  setRepositoryData(repositories, preferredActivePath = null) {
    const activePath = preferredActivePath || this.getActivePath();
    this.backendRepos = Array.isArray(repositories) ? [...repositories] : [];
    const layout = this.readLayout();
    const known = new Map(this.backendRepos.map(repo => [this.repoKey(repo.path), repo]));
    const orderedKeys = [
      ...layout.order,
      ...this.backendRepos.map(repo => this.repoKey(repo.path))
    ];
    const ordered = [];
    const seen = new Set();
    for (const key of orderedKeys) {
      const repo = known.get(key);
      if (!repo || seen.has(key)) continue;
      seen.add(key);
      ordered.push(repo);
    }
    this.pinnedKeys = new Set(layout.pinned.filter(key => known.has(key)));
    this.repos = [
      ...ordered.filter(repo => this.isPinned(repo)),
      ...ordered.filter(repo => !this.isPinned(repo))
    ];
    this.syncActiveIndex(activePath);
  }

  getActivePath() {
    const index = this.app.state.activeRepoIndex;
    return this.repos[index]?.path || null;
  }

  syncActiveIndex(path) {
    if (!path) {
      this.app.state.activeRepoIndex = -1;
      return;
    }
    const index = this.repos.findIndex(repo => this.sameRepo(repo.path, path));
    if (index >= 0) this.app.state.activeRepoIndex = index;
  }

  repoKey(path) {
    const value = String(path || '');
    return this.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value;
  }

  sameRepo(left, right) {
    return this.repoKey(left) === this.repoKey(right);
  }

  isPinned(repo) {
    return this.pinnedKeys.has(this.repoKey(repo.path));
  }

  readLayout() {
    try {
      const parsed = JSON.parse(this.storage?.getItem(this.layoutStorageKey) || '{}');
      const values = value => Array.isArray(value)
        ? value.filter(item => typeof item === 'string' && item.length <= 4096)
          .slice(0, 500).map(item => this.repoKey(item))
        : [];
      return { order: values(parsed?.order), pinned: values(parsed?.pinned) };
    } catch {
      return { order: [], pinned: [] };
    }
  }

  persistLayout() {
    try {
      this.storage?.setItem(this.layoutStorageKey, JSON.stringify({
        order: this.repos.map(repo => this.repoKey(repo.path)),
        pinned: [...this.pinnedKeys]
      }));
    } catch {
      // The visual order remains available for this session when storage fails.
    }
  }

  togglePinned(repoPath) {
    const activePath = this.getActivePath();
    const key = this.repoKey(repoPath);
    if (this.pinnedKeys.has(key)) this.pinnedKeys.delete(key);
    else this.pinnedKeys.add(key);
    const ordered = [...this.repos];
    this.repos = [
      ...ordered.filter(repo => this.isPinned(repo)),
      ...ordered.filter(repo => !this.isPinned(repo))
    ];
    this.syncActiveIndex(activePath);
    this.persistLayout();
    this.render();
  }

  handleTabKeydown(event, index) {
    if (event.target.closest('button')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.selectRepo(index);
      return;
    }
    if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === 'ArrowLeft' ? -1 : 1;
    const moved = this.moveRepoByOffset(index, offset);
    if (moved) {
      const element = this.container.querySelector(
        `[data-path="${CSS.escape(this.repos[index + offset].path)}"]`
      );
      element?.focus();
    }
  }

  moveRepoByOffset(index, offset) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= this.repos.length) return false;
    if (this.isPinned(this.repos[index]) !== this.isPinned(this.repos[targetIndex])) return false;
    return this.moveRepo(this.repos[index].path, this.repos[targetIndex].path, offset > 0);
  }

  moveRepo(draggedPath, targetPath, after = false) {
    const fromIndex = this.repos.findIndex(repo => this.sameRepo(repo.path, draggedPath));
    const targetIndex = this.repos.findIndex(repo => this.sameRepo(repo.path, targetPath));
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return false;
    if (this.isPinned(this.repos[fromIndex]) !== this.isPinned(this.repos[targetIndex])) return false;
    const activePath = this.getActivePath();
    const [moved] = this.repos.splice(fromIndex, 1);
    let insertionIndex = this.repos.findIndex(repo => this.sameRepo(repo.path, targetPath));
    if (after) insertionIndex += 1;
    this.repos.splice(insertionIndex, 0, moved);
    this.syncActiveIndex(activePath);
    this.persistLayout();
    this.render();
    return true;
  }

  onDragStart(event) {
    const tab = event.target.closest?.('.repo-tab');
    if (!tab || event.target.closest('button')) {
      event.preventDefault();
      return;
    }
    this.draggedKey = this.repoKey(tab.dataset.path);
    tab.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', tab.dataset.path);
    }
  }

  onDragOver(event) {
    if (event.target.closest?.('button')) return;
    const target = event.target.closest?.('.repo-tab');
    if (!this.draggedKey || !target) return;
    const dragged = this.repos.find(repo => this.repoKey(repo.path) === this.draggedKey);
    const targetRepo = this.repos.find(repo => this.sameRepo(repo.path, target.dataset.path));
    if (!dragged || !targetRepo || this.isPinned(dragged) !== this.isPinned(targetRepo)) return;
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    this.dragOverAfter = event.clientX >= rect.left + (rect.width / 2);
    this.dragOverKey = this.repoKey(target.dataset.path);
    this.container.querySelectorAll('.repo-tab').forEach(element => {
      element.classList.toggle(
        'is-drag-over-before',
        this.repoKey(element.dataset.path) === this.dragOverKey && !this.dragOverAfter
      );
      element.classList.toggle(
        'is-drag-over-after',
        this.repoKey(element.dataset.path) === this.dragOverKey && this.dragOverAfter
      );
    });
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  onDrop(event) {
    if (event.target.closest?.('button')) return;
    const target = event.target.closest?.('.repo-tab');
    if (!this.draggedKey || !target) return;
    event.preventDefault();
    const dragged = this.repos.find(repo => this.repoKey(repo.path) === this.draggedKey);
    const targetRepo = this.repos.find(repo => this.sameRepo(repo.path, target.dataset.path));
    if (dragged && targetRepo) {
      this.moveRepo(dragged.path, targetRepo.path, this.dragOverAfter);
    }
    this.clearDragState();
  }

  clearDragState() {
    this.container.querySelectorAll('.repo-tab').forEach(element => {
      element.classList.remove('is-dragging', 'is-drag-over-before', 'is-drag-over-after');
    });
    this.draggedKey = null;
    this.dragOverKey = null;
    this.dragOverAfter = false;
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
    const repoToSelect = this.repos[index];
    if (!repoToSelect) return;
    const backendIndex = this.backendRepos.findIndex(repo => (
      this.sameRepo(repo.path, repoToSelect.path)
    ));
    const repo = await window.gitTree.setActiveRepo(backendIndex);
    if (repo) {
      this.app.state.activeRepoIndex = index;
      this.render();
      this.app.emit('repo:changed', repo);
    }
  }

  async removeRepo(repoPath) {
    const active = await window.gitTree.removeRepo(repoPath);
    this.syncByRepoPath.delete(repoPath);
    this.pinnedKeys.delete(this.repoKey(repoPath));
    this.setRepositoryData(await window.gitTree.getRepos(), active?.path || null);
    this.persistLayout();
    this.render();
    if (active) this.app.emit('repo:changed', active);
    else this.app.emit('repo:cleared');
  }

  async addRepo(repoPath) {
    try {
      const result = await window.gitTree.addRepo(repoPath);
      if (result && !result.error) {
        this.setRepositoryData(await window.gitTree.getRepos(), result.path);
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
    this.setRepositoryData(await window.gitTree.getRepos(), result?.activeRepo?.path || null);
    if (result?.activeRepo) {
      this.render();
      this.app.emit('repo:changed', result.activeRepo);
    }
    this.refreshAllSync();
    return result;
  }
}

if (typeof module !== 'undefined') module.exports = RepoTabs;
