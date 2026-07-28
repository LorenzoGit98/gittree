class GitTreeApp {
  constructor() {
    this.state = { repo: null, activeRepoIndex: -1, currentBranch: null };
    this.components = {};
    this.inspectorState = 'open';
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
    this.setupResize();
    this.setupWorkspaceState();
    this.setupGlobalShortcuts();
    await this.components.repoTabs.init();

    const repos = this.components.repoTabs.repos;
    if (repos && repos.length > 0) {
      const active = await window.gitTree.getActiveRepo();
      if (active) {
        this.state.activeRepoIndex = repos.findIndex(r => r.path === active.path);
        this.components.repoTabs.render();
        await this.openRepo(active);
        return;
      }
    }
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
    document.getElementById('branch-create-row').onclick = () => this.components.branchList.promptCreateBranch();
    document.querySelectorAll('.theme-toggle').forEach(button => {
      button.onclick = () => Theme.toggle();
    });
    document.querySelectorAll('.language-toggle').forEach(button => {
      button.onclick = () => I18n.toggleLanguage();
    });
    document.querySelectorAll('.window-minimize').forEach(button => {
      button.onclick = () => window.gitTree.minimizeWindow();
    });
    document.querySelectorAll('.window-maximize').forEach(button => {
      button.onclick = () => window.gitTree.toggleMaximizeWindow();
    });
    document.querySelectorAll('.window-close').forEach(button => {
      button.onclick = () => window.gitTree.closeWindow();
    });
    document.querySelectorAll('.app-header, .welcome-card').forEach(surface => {
      surface.addEventListener('dblclick', event => {
        if (event.target.closest('button, input, .repo-tab')) return;
        window.gitTree.toggleMaximizeWindow();
      });
    });

    window.addEventListener('gittree:language-changed', () => this.refreshLocalizedView());
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
        <div class="branch-item">
          <i class="ph ph-archive branch-icon"></i>
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
        <div class="branch-item">
          <i class="ph ph-tag branch-icon"></i>
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
      const info = parts.length ? parts.join(' ') : (status.isClean ? 'Clean' : 'Modified');
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
    this.showToast(t('common.loading'));
    await this.openRepo(this.state.repo);
    this.showToast(t('feedback.refreshed'), 'success');
  }

  async doFetch() {
    if (!this.state.repo) return;
    this.showToast(t('feedback.fetching'));
    const result = await window.gitTree.fetch(this.state.repo.path);
    if (result.error) { this.showToast(result.error, 'error'); return; }
    this.showToast(t('feedback.fetchComplete'), 'success');
    this.refresh();
  }

  async doPull() {
    if (!this.state.repo) return;
    this.showToast(t('feedback.pulling'));
    const result = await window.gitTree.pull(this.state.repo.path);
    if (result.error) { this.showToast(result.error, 'error'); return; }
    this.showToast(t('feedback.pullComplete'), 'success');
    this.refresh();
  }

  async doPush() {
    if (!this.state.repo) return;
    this.showToast(t('feedback.pushing'));
    const result = await window.gitTree.push(this.state.repo.path);
    if (result.error) { this.showToast(result.error, 'error'); return; }
    this.showToast(t('feedback.pushComplete'), 'success');
    this.refresh();
  }

  showWelcome() {
    this.state.repo = null;
    this.components.welcome.show();
    this.components.graphView.body.innerHTML = `<div class="empty-state">${t('welcome.open')}</div>`;
    this.components.diffViewer.clear();
    this.components.statusBar.clear();
  }

  setupResize() {
    const workspace = document.getElementById('workspace-body');
    const leftHandle = document.getElementById('resize-handle-left');
    const rightHandle = document.getElementById('resize-handle-right');
    const savedLeft = Number(localStorage.getItem('gittree.panel.left'));
    const savedRight = Number(localStorage.getItem('gittree.panel.right'));

    if (Number.isFinite(savedLeft) && savedLeft > 0) {
      workspace.style.setProperty('--left-panel', `${savedLeft}px`);
    }
    if (Number.isFinite(savedRight) && savedRight > 0) {
      workspace.style.setProperty('--right-panel', `${savedRight}px`);
    }

    const bindHandle = (handle, side, min, max) => {
      handle.addEventListener('pointerdown', event => {
        event.preventDefault();
        const startX = event.clientX;
        const panel = side === 'left'
          ? document.getElementById('sidebar')
          : document.getElementById('detail-panel');
        const startWidth = panel.getBoundingClientRect().width;
        let latestX = startX;
        let pendingWidth = startWidth;
        let animationFrame = 0;

        const calculateWidth = clientX => {
          const delta = clientX - startX;
          return Math.min(max, Math.max(min, startWidth + (side === 'left' ? delta : -delta)));
        };

        const paintPreview = () => {
          animationFrame = 0;
          pendingWidth = calculateWidth(latestX);
          const offset = side === 'left'
            ? pendingWidth - startWidth
            : startWidth - pendingWidth;
          handle.style.transform = `translate3d(${offset}px, 0, 0)`;
        };

        handle.classList.add('is-dragging');
        workspace.classList.add('is-resizing');
        document.body.style.cursor = 'col-resize';

        const onMove = moveEvent => {
          latestX = moveEvent.clientX;
          if (!animationFrame) animationFrame = requestAnimationFrame(paintPreview);
        };

        const onUp = upEvent => {
          latestX = upEvent.clientX;
          if (animationFrame) cancelAnimationFrame(animationFrame);
          pendingWidth = calculateWidth(latestX);
          const width = Math.round(pendingWidth);
          workspace.style.setProperty(`--${side}-panel`, `${width}px`);
          localStorage.setItem(`gittree.panel.${side}`, String(width));
          handle.style.removeProperty('transform');
          handle.classList.remove('is-dragging');
          workspace.classList.remove('is-resizing');
          document.body.style.cursor = '';
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
    };

    bindHandle(leftHandle, 'left', 220, 380);
    bindHandle(rightHandle, 'right', 300, 620);
  }

  setupWorkspaceState() {
    const savedInspectorState = localStorage.getItem('gittree.workspace.inspector') || 'open';
    this.setInspectorState(savedInspectorState, false);

    document.getElementById('btn-toggle-inspector').onclick = () => {
      const hiddenByResponsiveLayout =
        this.inspectorState !== 'closed' &&
        getComputedStyle(document.getElementById('detail-panel')).display === 'none';
      if (this.inspectorState === 'closed') {
        this.setInspectorState(window.innerWidth <= 1120 ? 'maximized' : 'open');
      } else if (hiddenByResponsiveLayout) {
        this.setInspectorState('maximized');
      } else {
        this.setInspectorState('closed');
      }
    };
    document.getElementById('btn-close-inspector').onclick = () => {
      this.setInspectorState('closed');
    };
    document.getElementById('btn-maximize-inspector').onclick = () => {
      this.setInspectorState(this.inspectorState === 'maximized' ? 'open' : 'maximized');
    };
    document.querySelector('.detail-panel-header').addEventListener('dblclick', event => {
      if (event.target.closest('button')) return;
      this.setInspectorState(this.inspectorState === 'maximized' ? 'open' : 'maximized');
    });

    this.setupPersistentSidebarSections();
  }

  setInspectorState(state, persist = true) {
    const safeState = ['open', 'closed', 'maximized'].includes(state) ? state : 'open';
    const workspace = document.getElementById('workspace-body');
    const panel = document.getElementById('detail-panel');
    const toggleButton = document.getElementById('btn-toggle-inspector');
    const maximizeButton = document.getElementById('btn-maximize-inspector');
    const isOpen = safeState !== 'closed';
    const isMaximized = safeState === 'maximized';

    this.inspectorState = safeState;
    workspace.classList.toggle('inspector-closed', safeState === 'closed');
    workspace.classList.toggle('inspector-maximized', isMaximized);
    panel.setAttribute('aria-hidden', String(!isOpen));
    toggleButton.classList.toggle('active', isOpen);
    toggleButton.setAttribute('aria-pressed', String(isOpen));

    const maximizeIcon = maximizeButton.querySelector('i');
    maximizeIcon.className = isMaximized ? 'ph ph-arrows-in-simple' : 'ph ph-arrows-out-simple';
    maximizeButton.dataset.i18nTitle = isMaximized ? 'details.restore' : 'details.maximize';
    maximizeButton.title = t(maximizeButton.dataset.i18nTitle);

    if (persist) localStorage.setItem('gittree.workspace.inspector', safeState);
  }

  setupPersistentSidebarSections() {
    const storageKey = 'gittree.sidebar.sections';
    let savedSections = null;
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey));
      if (Array.isArray(parsed)) savedSections = new Set(parsed);
    } catch {}

    const headers = document.querySelectorAll('.sidebar-section-header.collapsible');
    headers.forEach(header => {
      const section = header.parentElement;
      const sectionId = section.dataset.section;
      const body = section.querySelector('.sidebar-section-body');
      const arrow = header.querySelector('.collapse-arrow');
      if (!sectionId || !body || !arrow) return;

      const collapsed = savedSections
        ? savedSections.has(sectionId)
        : body.classList.contains('collapsed');
      body.classList.toggle('collapsed', collapsed);
      arrow.classList.toggle('collapsed', collapsed);
      header.classList.toggle('collapsed', collapsed);
      header.setAttribute('aria-expanded', String(!collapsed));

      header.addEventListener('click', () => {
        const nextCollapsed = !body.classList.contains('collapsed');
        body.classList.toggle('collapsed', nextCollapsed);
        arrow.classList.toggle('collapsed', nextCollapsed);
        header.classList.toggle('collapsed', nextCollapsed);
        header.setAttribute('aria-expanded', String(!nextCollapsed));

        const collapsedSections = [...headers]
          .filter(item => item.classList.contains('collapsed'))
          .map(item => item.parentElement.dataset.section)
          .filter(Boolean);
        localStorage.setItem(storageKey, JSON.stringify(collapsedSections));
      });
    });
  }

  setupGlobalShortcuts() {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        this.components.welcome.openRepo();
      }
      if (e.key === 'F5') { e.preventDefault(); this.refresh(); }
      if (e.key === 'Escape' && this.inspectorState === 'maximized') {
        this.setInspectorState('open');
      }
    });
  }

  refreshLocalizedView() {
    Theme.syncControls();
    this.setInspectorState(this.inspectorState, false);
    if (this.state.repo) {
      this.components.branchList.render();
      this.components.graphView.render();
      this.components.diffViewer.clear();
    }
    this.components.welcome.loadRecent();
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

document.addEventListener('DOMContentLoaded', async () => {
  await I18n.init();
  I18n.translateDOM();
  Theme.apply(document.documentElement.dataset.theme, false);

  window.addEventListener('error', (e) => {
    const bar = document.createElement('div');
    bar.className = 'system-alert system-alert-error';
    const message = document.createElement('span');
    message.textContent = `JS ERROR: ${e.message} (${e.filename}:${e.lineno})`;
    const close = document.createElement('button');
    close.className = 'btn-icon';
    close.innerHTML = '<i class="ph ph-x"></i>';
    close.onclick = () => bar.remove();
    bar.append(message, close);
    document.body.appendChild(bar);
    setTimeout(() => bar.remove(), 8000);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const bar = document.createElement('div');
    bar.className = 'system-alert system-alert-warning';
    const message = document.createElement('span');
    message.textContent = `PROMISE ERROR: ${e.reason?.message || e.reason}`;
    const close = document.createElement('button');
    close.className = 'btn-icon';
    close.innerHTML = '<i class="ph ph-x"></i>';
    close.onclick = () => bar.remove();
    bar.append(message, close);
    document.body.appendChild(bar);
    setTimeout(() => bar.remove(), 8000);
  });

  const app = new GitTreeApp();
  window.app = app;
  await app.init();
});
