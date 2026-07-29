class GitTreeApp {
  constructor() {
    this.state = { repo: null, activeRepoIndex: -1, currentBranch: null };
    this.components = {};
    this.inspectorState = 'open';
    this.workspaceMode = 'history';
    this.updateState = null;
    this.repoLoadToken = 0;
    this._events = {};
  }

  async init() {
    this.setupPlatformChrome();
    this.components.welcome = new WelcomeScreen();
    this.components.repoTabs = new RepoTabs(document.getElementById('repo-tab-list'), this);
    this.components.settings = new SettingsView(this);
    this.components.branchContextMenu = new BranchContextMenu(this);
    this.components.commitContextMenu = new CommitContextMenu(this);
    this.components.branchList = new BranchListView(document.getElementById('branch-list'), this);
    this.components.graphView = new GraphView(
      document.getElementById('graph-view'), document.getElementById('graph-body'), this
    );
    this.components.changes = new ChangesView(
      document.getElementById('changes-view'),
      this
    );
    this.components.pullRequests = new PullRequestView(
      document.getElementById('pull-requests-view'),
      this
    );
    this.components.diffViewer = new DiffViewer(document.getElementById('detail-body'), this);
    this.components.search = new GlobalSearch(this);
    this.components.compare = new BranchCompare(this);
    this.components.commitCompare = new CommitCompare(this);
    this.components.merge = new MergeWorkspace(this);
    this.components.conflict = new ConflictResolver(this);
    this.components.statusBar = new StatusBar();

    this.bindEvents();
    await this.setupUpdates();
    this.components.search.init();
    this.components.welcome.init(this);
    this.setupResize();
    this.setupWorkspaceState();
    this.setupWorkspaceModes();
    this.setupGlobalShortcuts();
    await this.components.repoTabs.init();
    this.components.settings.init();

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

    document.getElementById('btn-add-repo-tab').onclick = () => this.components.welcome.openRepositoryPicker();
    document.querySelectorAll('.settings-open').forEach(button => {
      button.onclick = () => this.components.settings.open();
    });

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
      button.onclick = async () => {
        this.updateWindowChrome(await window.gitTree.toggleMaximizeWindow());
      };
    });
    document.querySelectorAll('.window-close').forEach(button => {
      button.onclick = () => window.gitTree.closeWindow();
    });
    document.querySelectorAll('.app-header, .welcome-card').forEach(surface => {
      surface.addEventListener('dblclick', event => {
        if (event.target.closest('button, input, .repo-tab')) return;
        window.gitTree.toggleMaximizeWindow().then(state => this.updateWindowChrome(state));
      });
    });

    window.addEventListener('gittree:language-changed', () => this.refreshLocalizedView());
  }

  setupWorkspaceModes() {
    document.querySelectorAll('[data-workspace-mode]').forEach(button => {
      button.onclick = () => this.setWorkspaceMode(button.dataset.workspaceMode);
    });
    this.setWorkspaceMode('history', false);
  }

  workspaceModeKey(repoPath = this.state.repo?.path) {
    return `gittree.workspace.mode:${repoPath || ''}`;
  }

  setWorkspaceMode(mode, persist = true) {
    const safeMode = ['history', 'changes', 'pullRequests'].includes(mode)
      ? mode
      : 'history';
    this.workspaceMode = safeMode;
    document.querySelectorAll('[data-workspace-mode]').forEach(button => {
      const active = button.dataset.workspaceMode === safeMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.getElementById('main-view').classList.toggle('is-hidden', safeMode !== 'history');
    document.getElementById('changes-view').classList.toggle('is-hidden', safeMode !== 'changes');
    document.getElementById('pull-requests-view').classList.toggle(
      'is-hidden',
      safeMode !== 'pullRequests'
    );
    document.getElementById('global-search').classList.toggle(
      'is-hidden',
      safeMode !== 'history'
    );
    const eyebrowKey = safeMode === 'history'
      ? 'history.eyebrow'
      : safeMode === 'changes'
        ? 'changes.eyebrow'
        : 'pullRequests.eyebrow';
    const titleKey = safeMode === 'history'
      ? 'history.title'
      : safeMode === 'changes'
        ? 'changes.title'
        : 'pullRequests.title';
    const title = document.getElementById('workspace-title');
    const eyebrow = title.querySelector('.eyebrow');
    const heading = title.querySelector('h2');
    eyebrow.dataset.i18n = eyebrowKey;
    heading.dataset.i18n = titleKey;
    eyebrow.textContent = t(eyebrowKey);
    heading.textContent = t(titleKey);
    this.components.changes?.setActive(safeMode === 'changes');
    this.components.pullRequests?.setActive(safeMode === 'pullRequests');
    if (persist && this.state.repo) {
      localStorage.setItem(this.workspaceModeKey(), safeMode);
    }
  }

  setupPlatformChrome() {
    this.platform = window.gitTree.platform || 'win32';
    document.documentElement.dataset.platform = this.platform;
    this.setupShortcutHints();
    window.gitTree.onWindowState(state => this.updateWindowChrome(state));
    window.gitTree.getWindowState().then(state => this.updateWindowChrome(state));
  }

  shortcutDefinitions() {
    return {
      open: { key: 'o' },
      search: { key: 'p' },
      fetch: { key: 'f', shift: true },
      pull: { key: 'l', shift: true },
      push: { key: 'p', shift: true },
      newBranch: { key: 'b', shift: true },
      refresh: { key: 'F5', primary: false }
    };
  }

  shortcutLabel(action) {
    const shortcut = this.shortcutDefinitions()[action];
    if (!shortcut) return '';
    if (shortcut.primary === false) return shortcut.key;
    if (this.platform === 'darwin') {
      return `⌘${shortcut.shift ? '⇧' : ''}${shortcut.key.toUpperCase()}`;
    }
    return `Ctrl+${shortcut.shift ? 'Shift+' : ''}${shortcut.key.toUpperCase()}`;
  }

  setupShortcutHints() {
    document.querySelectorAll('[data-platform-shortcut]').forEach(element => {
      element.textContent = this.shortcutLabel(element.dataset.platformShortcut);
    });
    const titleKeys = {
      fetch: 'actions.fetch',
      pull: 'actions.pull',
      push: 'actions.push',
      newBranch: 'sidebar.newBranch',
      refresh: 'actions.refresh'
    };
    document.querySelectorAll('[data-shortcut-title]').forEach(element => {
      const action = element.dataset.shortcutTitle;
      element.title = `${t(titleKeys[action])} (${this.shortcutLabel(action)})`;
      element.setAttribute('aria-label', element.title);
    });
  }

  updateWindowChrome(state) {
    if (!state) return;
    this.windowState = state;
    document.querySelectorAll('.window-maximize').forEach(button => {
      const isRestore = Boolean(state.isMaximized);
      const restoreIcon = this.platform === 'win32'
        ? 'ph-copy-simple'
        : 'ph-corners-in';
      button.querySelector('i').className =
        `ph ${isRestore ? restoreIcon : 'ph-square'}`;
      button.dataset.i18nTitle = isRestore ? 'common.restore' : 'common.maximize';
      button.title = t(button.dataset.i18nTitle);
      button.setAttribute('aria-label', button.title);
    });
  }

  isPrimaryModifier(event) {
    return this.platform === 'darwin' ? event.metaKey : event.ctrlKey;
  }

  async setupUpdates() {
    const button = document.getElementById('btn-update');
    button.onclick = async () => {
      if (this.updateState?.status === 'available') {
        button.disabled = true;
        const result = await window.gitTree.downloadUpdate();
        if (result?.error) this.showToast(result.error, 'error');
      } else if (this.updateState?.status === 'downloaded') {
        await window.gitTree.installUpdate();
      }
    };
    window.gitTree.onUpdateState(state => this.handleUpdateState(state));
    this.handleUpdateState(await window.gitTree.getUpdateState());
  }

  handleUpdateState(state) {
    if (!state) return;
    const previousStatus = this.updateState?.status;
    this.updateState = state;
    const button = document.getElementById('btn-update');
    const icon = button.querySelector('i');
    const label = button.querySelector('span');
    button.disabled = state.status === 'downloading' || state.status === 'checking';
    button.classList.toggle(
      'is-hidden',
      !['available', 'downloading', 'downloaded'].includes(state.status)
    );

    if (state.status === 'available') {
      icon.className = 'ph ph-download-simple';
      label.textContent = t('updates.availableVersion', { version: state.availableVersion });
      if (previousStatus !== 'available') {
        this.showToast(t('updates.availableVersion', { version: state.availableVersion }), 'success');
      }
    } else if (state.status === 'downloading') {
      icon.className = 'ph ph-circle-notch';
      label.textContent = t('updates.downloading', { progress: state.progress });
    } else if (state.status === 'downloaded') {
      icon.className = 'ph ph-arrows-clockwise';
      label.textContent = t('updates.restart');
      if (previousStatus !== 'downloaded') this.showToast(t('updates.ready'), 'success');
    } else if (state.status === 'error' && state.error) {
      this.showToast(t('updates.failed', { error: state.error }), 'error');
    }
  }

  async openRepo(repo, options = {}) {
    const loadToken = ++this.repoLoadToken;
    this.state.repo = repo;
    this.components.welcome.hide();
    this.setProjectLoading(true);
    const savedMode = localStorage.getItem(this.workspaceModeKey(repo.path)) || 'history';
    this.setWorkspaceMode(savedMode, false);

    try {
      await Promise.all([
        this.components.graphView.load(repo.path),
        this.components.branchList.load(repo.path),
        this.components.changes.load(repo.path),
        this.components.pullRequests.load(repo.path),
        this.loadStashes(repo.path),
        this.loadTags(repo.path),
        this.updateStatus(repo.path)
      ]);

      if (loadToken !== this.repoLoadToken) return;
      this.components.diffViewer.clear();
      if (options.selectHash) this.components.graphView.select(options.selectHash);
      const branchName = this.components.branchList.current;
      const currentBranchMetadata = (this.components.branchList.metadata?.branches || [])
        .find(branch => branch.kind === 'local' && branch.current);
      this.components.repoTabs.updateSync(repo.path, currentBranchMetadata
        ? {
            branch: currentBranchMetadata.name,
            upstream: currentBranchMetadata.upstream,
            ahead: currentBranchMetadata.ahead,
            behind: currentBranchMetadata.behind
          }
        : null);
      document.getElementById('status-branch').textContent = branchName ? `On ${branchName}` : '';
      document.getElementById('status-repo').textContent = repo.name;
      this.components.statusBar.setRepo(repo.name);
      this.components.statusBar.setBranch(branchName || '');
      const operationState = await window.gitTree.getOperationState(repo.path);
      if (loadToken === this.repoLoadToken && operationState?.type) {
        await this.components.conflict.open(operationState);
      }
    } finally {
      if (loadToken === this.repoLoadToken) this.setProjectLoading(false);
    }
  }

  setProjectLoading(loading) {
    const workspace = document.getElementById('workspace');
    workspace?.classList.toggle('is-project-loading', loading);
    workspace?.setAttribute('aria-busy', String(loading));
    document.querySelectorAll('#branch-loading-indicator, #workspace-loading-indicator, #inspector-loading-indicator')
      .forEach(indicator => indicator.classList.toggle('is-hidden', !loading));
    document.getElementById('sidebar')?.setAttribute('aria-busy', String(loading));
    document.querySelector('.main')?.setAttribute('aria-busy', String(loading));
    document.getElementById('detail-panel')?.setAttribute('aria-busy', String(loading));
  }

  async loadStashes(repoPath) {
    const container = document.getElementById('stash-list');
    container.classList.add('is-project-loading');
    container.innerHTML = this.projectLoadingMarkup();
    try {
      const list = await window.gitTree.getStashList(repoPath);
      if (!list?.all?.length) { container.innerHTML = ''; return; }
      container.innerHTML = list.all.map((s, i) => `
        <div class="branch-item">
          <i class="ph ph-archive branch-icon"></i>
          <span>${s.message || `Stash ${i}`}</span>
        </div>
      `).join('');
    } catch { container.innerHTML = ''; }
    finally { container.classList.remove('is-project-loading'); }
  }

  async loadTags(repoPath) {
    const container = document.getElementById('tag-list');
    container.classList.add('is-project-loading');
    container.innerHTML = this.projectLoadingMarkup();
    try {
      const tags = await window.gitTree.getTags(repoPath);
      if (!tags?.all?.length) { container.innerHTML = ''; return; }
      container.innerHTML = tags.all.slice(0, 10).map(t => `
        <div class="branch-item">
          <i class="ph ph-tag branch-icon"></i>
          <span>${t}</span>
        </div>
      `).join('');
    } catch { container.innerHTML = ''; }
    finally { container.classList.remove('is-project-loading'); }
  }

  projectLoadingMarkup() {
    return `<div class="project-loading-inline" role="status" aria-live="polite">
      <i class="ph ph-circle-notch" aria-hidden="true"></i>
      <span>${t('common.loading')}</span>
    </div>`;
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

  async afterBranchCheckout(result = {}) {
    const repo = this.state.repo;
    const branchName = result.branch;
    if (!repo || !branchName) return;

    this.components.branchList.setCurrentBranch(branchName);
    this.components.diffViewer.clear();
    await Promise.all([
      this.components.graphView.load(repo.path),
      this.components.changes.load(repo.path),
      this.updateStatus(repo.path)
    ]);

    const currentBranchMetadata = (this.components.branchList.metadata?.branches || [])
      .find(branch => branch.kind === 'local' && branch.name === branchName);
    this.components.repoTabs.updateSync(repo.path, currentBranchMetadata
      ? {
          branch: currentBranchMetadata.name,
          upstream: currentBranchMetadata.upstream,
          ahead: currentBranchMetadata.ahead,
          behind: currentBranchMetadata.behind
        }
      : null);
    this.components.statusBar.setBranch(branchName);
  }

  async refresh(options = {}) {
    if (!this.state.repo) return;
    if (!options.silent) this.showToast(t('common.loading'));
    await this.openRepo(this.state.repo, options);
    if (!options.silent) this.showToast(t('feedback.refreshed'), 'success');
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
    this.components.changes?.setActive(false);
    this.components.pullRequests?.setActive(false);
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
        if (side === 'left' && document.getElementById('workspace-body').classList.contains('sidebar-collapsed')) return;
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

    this.setupSidebarToggle();
    this.setupInspectorPopout();
    this.setupPersistentSidebarSections();
  }

  setupSidebarToggle() {
    const collapsed = localStorage.getItem('gittree.sidebar.collapsed') === 'true';
    this.setSidebarCollapsed(collapsed, false);
    document.getElementById('btn-collapse-sidebar').onclick = () => this.setSidebarCollapsed(true);
    document.getElementById('btn-expand-sidebar').onclick = () => this.setSidebarCollapsed(false);
  }

  setSidebarCollapsed(collapsed, persist = true) {
    const workspace = document.getElementById('workspace-body');
    workspace.classList.toggle('sidebar-collapsed', collapsed);
    document.getElementById('btn-expand-sidebar').classList.toggle('is-hidden', !collapsed);
    if (persist) localStorage.setItem('gittree.sidebar.collapsed', String(collapsed));
  }

  setupInspectorPopout() {
    document.getElementById('btn-popout-inspector').onclick = () => {
      const body = document.getElementById('detail-body');
      const title = document.getElementById('detail-title').textContent;
      const theme = document.documentElement.dataset.theme || 'light';
      const mode = this.components.diffViewer?.mode || 'unified';
      const html = body.innerHTML;
      const payload = { title, theme, mode };
      if (html.length > 2_000_000 && this.components.diffViewer?.currentDiff) {
        payload.diffText = this.components.diffViewer.currentDiff;
      } else {
        payload.html = html;
      }
      window.gitTree.openInspectorWindow(payload);
    };
  }

  setInspectorState(state, persist = true) {
    const safeState = ['open', 'closed', 'maximized'].includes(state) ? state : 'open';
    const previousState = this.inspectorState;
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

    if (previousState !== safeState) {
      this.components.diffViewer?.setInspectorExpanded(isMaximized);
    }
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
      const editable = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
      const modalOpen = !document.getElementById('modal-overlay').classList.contains('is-hidden');
      const primary = this.isPrimaryModifier(e);
      const key = e.key.toLowerCase();

      if (!e.repeat && !editable && !modalOpen && primary && !e.shiftKey && key === 'o') {
        e.preventDefault();
        this.components.welcome.openRepo();
      }
      if (!e.repeat && !editable && !modalOpen && primary && e.shiftKey) {
        if (key === 'f') {
          e.preventDefault();
          this.doFetch();
        } else if (key === 'l') {
          e.preventDefault();
          this.doPull();
        } else if (key === 'p') {
          e.preventDefault();
          this.doPush();
        } else if (key === 'b') {
          e.preventDefault();
          this.components.branchList.promptCreateBranch();
        }
      }
      if (!editable && !modalOpen && e.key === 'F5') {
        e.preventDefault();
        this.refresh();
      }
      if (e.key === 'Escape' && !modalOpen && this.inspectorState === 'maximized') {
        this.setInspectorState('open');
      }
    });
  }

  refreshLocalizedView() {
    Theme.syncControls();
    this.setupShortcutHints();
    this.updateWindowChrome(this.windowState);
    this.setInspectorState(this.inspectorState, false);
    if (this.state.repo) {
      this.components.branchList.render();
      this.components.graphView.render();
      this.components.diffViewer.clear();
      this.setWorkspaceMode(this.workspaceMode, false);
      this.components.changes.render();
      if (this.components.pullRequests.detail) {
        this.components.pullRequests.renderDetail();
      } else {
        this.components.pullRequests.renderViewport(true);
      }
    }
    this.components.welcome.loadRecent();
    if (this.updateState) this.handleUpdateState(this.updateState);
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
