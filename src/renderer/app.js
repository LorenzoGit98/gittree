class GitTreeApp {
  constructor() {
    this.state = { repo: null, activeRepoIndex: -1, currentBranch: null };
    this.components = {};
    this._events = {};
  }

  async init() {
    this.components.welcome = new WelcomeScreen();
    this.components.repoTabs = new RepoTabs(document.getElementById('repo-tab-list'), this);
    this.components.branchList = new BranchListView(document.getElementById('branch-list'), this);
    this.components.graphView = new GraphView(
      document.getElementById('graph-view'), document.getElementById('graph-body'), this
    );
    this.components.diffViewer = new DiffViewer(document.getElementById('detail-body'), this);
    this.components.search = new GlobalSearch(this);
    this.components.compare = new BranchCompare(this);
    this.components.merge = new MergeWorkspace(this);
    this.components.conflict = new ConflictResolver(this);
    this.components.statusBar = new StatusBar();

    this.bindEvents();
    this.components.search.init();
    this.components.welcome.init(this);
    await this.components.repoTabs.init();

    const repos = this.components.repoTabs.repos;
    if (repos && repos.length > 0) {
      const active = await window.gitTree.getActiveRepo();
      if (active) {
        this.state.activeRepoIndex = repos.findIndex(r => r.path === active.path);
        this.openRepo(active);
        return;
      }
    }

    this.setupResize();
    this.setupGlobalShortcuts();
  }

  bindEvents() {
    this.on('repo:changed', (repo) => { this.openRepo(repo); });
    this.on('repo:cleared', () => this.showWelcome());
    this.on('commit:selected', (hash) => this.onCommitSelected(hash));
    this.on('refresh', () => this.refresh());

    document.getElementById('btn-add-repo-tab').onclick = () => this.components.welcome.openRepo();

    document.getElementById('btn-refresh').onclick = () => this.refresh();
    document.getElementById('btn-fetch').onclick = () => this.doFetch();
    document.getElementById('btn-pull').onclick = () => this.doPull();
    document.getElementById('btn-push').onclick = () => this.doPush();
    document.getElementById('btn-new-branch').onclick = () => this.components.branchList.promptCreateBranch();

    document.getElementById('global-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const term = e.target.value.trim();
        if (term && this.state.repo) {
          this.components.search.input.value = term;
          this.components.search.show();
          this.components.search.search();
        }
      }
    });
  }

  async openRepo(repo) {
    this.state.repo = repo;
    this.components.welcome.hide();

    await Promise.all([
      this.components.graphView.load(repo.path),
      this.components.branchList.load(repo.path),
      this.loadStashes(repo.path),
      this.loadTags(repo.path),
      this.updateStatus(repo.path)
    ]);

    this.components.diffViewer.clear();
    const branchName = this.components.branchList.current;
    document.getElementById('status-branch').textContent = branchName ? `On ${branchName}` : '';
    document.getElementById('status-repo').textContent = repo.name;
    this.components.statusBar.setRepo(repo.name);
    this.components.statusBar.setBranch(branchName || '');
  }

  async loadStashes(repoPath) {
    try {
      const list = await window.gitTree.getStashList(repoPath);
      const container = document.getElementById('stash-list');
      if (!list?.all?.length) { container.innerHTML = ''; return; }
      container.innerHTML = list.all.map((s, i) => `
        <div class="branch-item" style="font-size:11px;color:var(--text-secondary)">
          <span>${s.message || `Stash ${i}`}</span>
        </div>
      `).join('');
    } catch { document.getElementById('stash-list').innerHTML = ''; }
  }

  async loadTags(repoPath) {
    try {
      const tags = await window.gitTree.getTags(repoPath);
      const container = document.getElementById('tag-list');
      if (!tags?.all?.length) { container.innerHTML = ''; return; }
      container.innerHTML = tags.all.slice(0, 10).map(t => `
        <div class="branch-item" style="font-size:11px;color:var(--text-secondary)">
          <span class="badge badge-tag" style="margin-right:6px">tag</span>
          <span>${t}</span>
        </div>
      `).join('');
    } catch { document.getElementById('tag-list').innerHTML = ''; }
  }

  async updateStatus(repoPath) {
    try {
      const status = await window.gitTree.getStatus(repoPath);
      if (!status || status.error) return;
      this.state.currentBranch = status.current;
      const parts = [];
      if (status.ahead) parts.push(`↑${status.ahead}`);
      if (status.behind) parts.push(`↓${status.behind}`);
      document.getElementById('status-branch').textContent = status.current ? `On ${status.current}` : '';
      const info = parts.length ? parts.join(' ') : (status.isClean?.() ? 'Clean' : 'Modified');
      document.getElementById('status-info').textContent = info;
      this.components.statusBar.setInfo(info);
    } catch {}
  }

  async onCommitSelected(hash) {
    if (!this.state.repo) return;
    await this.components.diffViewer.showDiffForCommit(this.state.repo.path, hash);
  }

  async refresh() {
    if (!this.state.repo) return;
    this.showToast('Refreshing...');
    await this.openRepo(this.state.repo);
    this.showToast('Refreshed', 'success');
  }

  async doFetch() {
    if (!this.state.repo) return;
    this.showToast('Fetching...');
    const result = await window.gitTree.fetch(this.state.repo.path);
    if (result.error) { this.showToast(result.error, 'error'); return; }
    this.showToast('Fetch complete', 'success');
    this.refresh();
  }

  async doPull() {
    if (!this.state.repo) return;
    this.showToast('Pulling...');
    const result = await window.gitTree.pull(this.state.repo.path);
    if (result.error) { this.showToast(result.error, 'error'); return; }
    this.showToast('Pull complete', 'success');
    this.refresh();
  }

  async doPush() {
    if (!this.state.repo) return;
    this.showToast('Pushing...');
    const result = await window.gitTree.push(this.state.repo.path);
    if (result.error) { this.showToast(result.error, 'error'); return; }
    this.showToast('Push complete', 'success');
    this.refresh();
  }

  showWelcome() {
    this.state.repo = null;
    this.components.welcome.show();
    this.components.graphView.body.innerHTML = '<div class="empty-state">Open a repository to start</div>';
    this.components.diffViewer.clear();
    this.components.statusBar.clear();
  }

  setupResize() {
    const handle = document.getElementById('resize-handle-h');
    const topPanel = document.getElementById('main-view');
    const bottomPanel = document.getElementById('detail-panel');
    let startY, startHeight;

    handle.onmousedown = (e) => {
      startY = e.clientY;
      startHeight = topPanel.offsetHeight;
      document.body.style.cursor = 'row-resize';

      const onMove = (ev) => {
        const delta = ev.clientY - startY;
        const newH = Math.max(120, startHeight + delta);
        const totalH = topPanel.parentElement.offsetHeight;
        const diffH = totalH - newH - 2;
        if (diffH >= 80) {
          topPanel.style.flex = 'none';
          topPanel.style.height = newH + 'px';
          bottomPanel.style.flex = 'none';
          bottomPanel.style.height = diffH + 'px';
        }
      };
      const onUp = () => {
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
  }

  setupGlobalShortcuts() {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        this.components.welcome.openRepo();
      }
      if (e.key === 'F5') { e.preventDefault(); this.refresh(); }
    });

    document.querySelectorAll('.sidebar-section-header.collapsible').forEach(header => {
      header.addEventListener('click', () => {
        const section = header.parentElement;
        const body = section.querySelector('.sidebar-section-body');
        const arrow = header.querySelector('.collapse-arrow');
        if (!body || !arrow) return;
        const collapsed = !body.classList.contains('collapsed');
        body.classList.toggle('collapsed', collapsed);
        arrow.classList.toggle('collapsed', collapsed);
        header.classList.toggle('collapsed', collapsed);
      });
    });
  }

  showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  }

  on(event, cb) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(cb);
  }

  emit(event, data) {
    if (this._events[event]) this._events[event].forEach(cb => cb(data));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('error', (e) => {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c0392b;color:#fff;padding:8px 30px 8px 12px;z-index:99999;font-size:12px;font-family:monospace;display:flex;align-items:center;justify-content:space-between';
    bar.innerHTML = `<span>JS ERROR: ${e.message} (${e.filename}:${e.lineno})</span>`;
    const x = document.createElement('span');
    x.style.cssText = 'cursor:pointer;font-size:16px;opacity:0.7;padding:0 4px';
    x.textContent = '×';
    x.onclick = () => bar.remove();
    bar.appendChild(x);
    document.body.appendChild(bar);
    setTimeout(() => bar.remove(), 8000);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#d35400;color:#fff;padding:8px 30px 8px 12px;z-index:99999;font-size:12px;font-family:monospace;display:flex;align-items:center;justify-content:space-between';
    bar.innerHTML = `<span>PROMISE ERROR: ${e.reason?.message || e.reason}</span>`;
    const x = document.createElement('span');
    x.style.cssText = 'cursor:pointer;font-size:16px;opacity:0.7;padding:0 4px';
    x.textContent = '×';
    x.onclick = () => bar.remove();
    bar.appendChild(x);
    document.body.appendChild(bar);
    setTimeout(() => bar.remove(), 8000);
  });

  const app = new GitTreeApp();
  app.init();
  window.app = app;
});
