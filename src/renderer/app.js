class GitTreeApp {
  constructor() {
    this.state = { repo: null, activeRepoIndex: -1, currentBranch: null };
    this.components = {};
    this.inspectorState = 'open';
    this.workspaceMode = 'history';
    this.updateState = null;
    this.repoLoadToken = 0;
    this.remoteActionBusy = false;
    this.remoteActionRepo = null;
    this._events = {};
  }

  pathKey(value) {
    return window.gitTree?.platform === 'win32' ? String(value).toLocaleLowerCase() : String(value);
  }

  isCurrentRepo(repoPath) {
    const current = this.state.repo?.path;
    return Boolean(current) && this.pathKey(repoPath) === this.pathKey(current);
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
    this.components.reflog = new ReflogView(this);
    this.components.conflict = new ConflictResolver(this);
    this.components.gitflow = new GitFlow(this);
    this.components.statusBar = new StatusBar();

    this.bindEvents();
    await this.setupUpdates();
    this.components.search.init();
    this.components.welcome.init(this);
    this.setupClearableSearches();
    this.setupResize();
    this.setupWorkspaceState();
    this.applyToolbarVisibility();
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

    document.getElementById('btn-fetch').onclick = () => this.doFetch();
    document.getElementById('btn-pull').onclick = () => this.doPull();
    document.getElementById('btn-push').onclick = () => this.doPush();
    document.getElementById('btn-new-branch').onclick = () => this.components.branchList.promptCreateBranch();
    document.getElementById('btn-gitflow').onclick = () => this.components.gitflow.open();
    document.getElementById('btn-terminal').onclick = () => this.openTerminal();
    document.getElementById('btn-explorer').onclick = () => this.openExplorer();
    document.getElementById('stash-search').addEventListener('input', event => {
      this.renderStashes(event.target.value);
    });
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

    const toast = document.getElementById('toast');
    toast.addEventListener('mouseenter', () => this.pauseToast());
    toast.addEventListener('mouseleave', () => this.resumeToast());
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
      newBranch: { key: 'b', shift: true }
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
      newBranch: 'sidebar.newBranch'
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
    this.syncRemoteBusyUI();
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
      this.updatePushPullCounts(
        currentBranchMetadata?.ahead || 0,
        currentBranchMetadata?.behind || 0
      );
      document.getElementById('status-branch').textContent = branchName ? t('statusBar.onBranch', { branch: branchName }) : '';
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
      if (!this.isCurrentRepo(repoPath)) return;
      this.state.stashes = list?.all || [];
      this.renderStashes(document.getElementById('stash-search')?.value || '');
    } catch {
      this.state.stashes = [];
      container.innerHTML = '';
    } finally { container.classList.remove('is-project-loading'); }
  }

  renderStashes(filter = '') {
    const container = document.getElementById('stash-list');
    if (!container) return;
    const needle = String(filter || '').trim().toLowerCase();
    const items = (this.state.stashes || [])
      .map((stash, index) => ({ index, label: stash.message || `Stash ${index}` }))
      .filter(item => !needle || item.label.toLowerCase().includes(needle));
    if (!items.length) { container.innerHTML = ''; return; }
    container.innerHTML = items.map(item => `
      <div class="branch-item stash-item" data-stash-index="${item.index}">
        <i class="ph ph-archive branch-icon" aria-hidden="true"></i>
        <span class="branch-name">${this.esc(item.label)}</span>
        <span class="stash-actions" role="group" aria-label="${this.esc(t('sidebar.stashActions'))}">
          <button type="button" class="icon-btn stash-action" data-action="pop" title="${this.esc(t('sidebar.stashPop'))}" aria-label="${this.esc(t('sidebar.stashPop'))}">
            <i class="ph ph-play" aria-hidden="true"></i>
          </button>
          <button type="button" class="icon-btn stash-action" data-action="apply" title="${this.esc(t('sidebar.stashApply'))}" aria-label="${this.esc(t('sidebar.stashApply'))}">
            <i class="ph ph-copy" aria-hidden="true"></i>
          </button>
          <button type="button" class="icon-btn stash-action is-danger" data-action="drop" title="${this.esc(t('sidebar.stashDrop'))}" aria-label="${this.esc(t('sidebar.stashDrop'))}">
            <i class="ph ph-trash" aria-hidden="true"></i>
          </button>
        </span>
      </div>
    `).join('');
    container.querySelectorAll('.stash-item').forEach(item => {
      item.querySelectorAll('[data-action]').forEach(button => {
        button.onclick = event => {
          event.stopPropagation();
          const index = Number(item.dataset.stashIndex);
          this.runStashAction(button.dataset.action, index);
        };
      });
    });
  }

  async runStashAction(action, index) {
    const repo = this.state.repo;
    if (!repo || !Number.isInteger(index)) return;
    if (action === 'drop') {
      const confirmed = await this.confirmDialog(
        t('sidebar.stashDropTitle'),
        t('sidebar.stashDropConfirm'),
        t('sidebar.stashDrop')
      );
      if (!confirmed) return;
    }
    const api = action === 'pop'
      ? window.gitTree.stashPop
      : action === 'apply'
        ? window.gitTree.stashApply
        : action === 'drop'
          ? window.gitTree.stashDrop
          : null;
    if (!api) return;
    const result = await api(repo.path, index);
    if (result?.error) { this.showToast(result.error, 'error'); return; }
    if (action === 'pop' || action === 'drop') {
      await this.loadStashes(repo.path);
      await this.refresh();
    } else {
      this.showToast(t('feedback.stashApplied'), 'success');
      await this.refresh();
    }
  }

  confirmDialog(title, message, actionLabel, danger = false) {
    const overlay = document.getElementById('modal-overlay');
    const dialog = document.getElementById('modal-dialog');
    return new Promise(resolve => {
      dialog.innerHTML = `<h3>${this.esc(title)}</h3><p>${this.esc(message)}</p>
        <div class="confirm-actions">
          <button class="btn" data-cancel>${this.esc(t('common.cancel'))}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${this.esc(actionLabel)}</button>
        </div>`;
      overlay.classList.remove('is-hidden');
      const finish = value => {
        overlay.classList.add('is-hidden');
        dialog.innerHTML = '';
        resolve(value);
      };
      dialog.querySelector('[data-cancel]').onclick = () => finish(false);
      dialog.querySelector('[data-confirm]').onclick = () => finish(true);
    });
  }

  async loadTags(repoPath) {
    const container = document.getElementById('tag-list');
    container.classList.add('is-project-loading');
    container.innerHTML = this.projectLoadingMarkup();
    try {
      const tags = await window.gitTree.getTags(repoPath);
      if (!this.isCurrentRepo(repoPath)) return;
      if (!tags?.all?.length) { container.innerHTML = ''; return; }
      container.innerHTML = tags.all.slice(0, 10).map(t => `
        <div class="branch-item">
          <i class="ph ph-tag branch-icon"></i>
          <span>${this.esc(t)}</span>
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
      if (!this.isCurrentRepo(repoPath)) return;
      this.state.currentBranch = status.current;
      const parts = [];
      if (status.ahead) parts.push(`↑${status.ahead}`);
      if (status.behind) parts.push(`↓${status.behind}`);
      document.getElementById('status-branch').textContent = status.current
        ? t('statusBar.onBranch', { branch: status.current })
        : '';
      const info = parts.length
        ? parts.join(' ')
        : (status.isClean ? t('statusBar.clean') : t('statusBar.modified'));
      document.getElementById('status-info').textContent = info;
      this.components.statusBar.setInfo(info);
      this.updatePushPullCounts(status.ahead || 0, status.behind || 0);
    } catch { /* status refresh is best effort */ }
  }

  updatePushPullCounts(ahead = 0, behind = 0) {
    const pullCount = document.getElementById('btn-pull-count');
    const pushCount = document.getElementById('btn-push-count');
    if (pullCount) {
      const show = behind > 0;
      pullCount.textContent = show ? String(behind) : '';
      pullCount.hidden = !show;
      pullCount.classList.toggle('is-hidden', !show);
    }
    if (pushCount) {
      const show = ahead > 0;
      pushCount.textContent = show ? String(ahead) : '';
      pushCount.hidden = !show;
      pushCount.classList.toggle('is-hidden', !show);
    }
  }

  animateContentRefresh(element) {
    if (!element) return;
    element.classList.remove('content-refresh');
    void element.offsetWidth;
    element.classList.add('content-refresh');
  }

  animateBranchSwitch(element, fromDirection) {
    if (!element) return;
    const next = fromDirection === 'top' ? 'content-refresh-from-top'
      : fromDirection === 'bottom' ? 'content-refresh-from-bottom'
      : 'content-refresh';
    element.classList.remove('content-refresh', 'content-refresh-from-top', 'content-refresh-from-bottom');
    void element.offsetWidth;
    element.classList.add(next);
  }

  async onCommitSelected(hash) {
    if (!this.state.repo) return;
    await this.components.diffViewer.showDiffForCommit(this.state.repo.path, hash);
    this.animateContentRefresh(document.getElementById('detail-body'));
    this.pushInspectorPayload?.();
  }

  async afterBranchCheckout(result = {}, repoPath = null) {
    const repo = this.state.repo;
    const branchName = result.branch;
    if (!repo || !branchName) return;
    if (repoPath && !this.isCurrentRepo(repoPath)) return;

    this.components.branchList.setCurrentBranch(branchName);
    this.components.diffViewer.clear();
    const fromDirection = this.components.branchList.switchFromDirection;
    this.components.branchList.switchFromDirection = null;
    this.animateBranchSwitch(this.components.graphView.body, fromDirection);
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
    this.updatePushPullCounts(
      currentBranchMetadata?.ahead || 0,
      currentBranchMetadata?.behind || 0
    );
    this.components.statusBar.setBranch(branchName);
    this.pushInspectorPayload?.();
  }

  async refresh(options = {}) {
    if (!this.state.repo) return;
    if (!options.silent) this.showToast(t('common.loading'));
    await this.openRepo(this.state.repo, options);
    this.components.repoTabs.refreshAllSync();
    if (!options.silent) this.showToast(t('feedback.refreshed'), 'success');
  }

  async doFetch() {
    if (!this.state.repo || this.remoteActionBusy) return;
    const repoPath = this.state.repo.path;
    this.setRemoteActionBusy('btn-fetch', true);
    this.components.repoTabs.setSyncBusy(repoPath, true);
    this.showToast(t('feedback.fetching'));
    try {
      const result = await window.gitTree.fetch(repoPath);
      if (result.error) { this.showToast(result.error, 'error'); return; }
      this.showToast(t('feedback.fetchComplete'), 'success');
      if (this.isCurrentRepo(repoPath)) await this.refresh();
    } finally {
      this.components.repoTabs.setSyncBusy(repoPath, false);
      this.setRemoteActionBusy('btn-fetch', false);
    }
  }

  async doPull() {
    if (!this.state.repo || this.remoteActionBusy) return;
    const repoPath = this.state.repo.path;
    this.setRemoteActionBusy('btn-pull', true);
    this.components.repoTabs.setSyncBusy(repoPath, true);
    this.showToast(t('feedback.pulling'));
    try {
      const result = await window.gitTree.pull(repoPath);
      if (result.error) { this.showToast(result.error, 'error'); return; }
      this.showToast(t('feedback.pullComplete'), 'success');
      if (this.isCurrentRepo(repoPath)) await this.refresh();
    } finally {
      this.components.repoTabs.setSyncBusy(repoPath, false);
      this.setRemoteActionBusy('btn-pull', false);
    }
  }

  async openTerminal() {
    const repo = this.state.repo;
    if (!repo) return;
    const result = await window.gitTree.openTerminal(repo.path);
    if (result?.error) this.showToast(result.error, 'error');
  }

  async openExplorer() {
    const repo = this.state.repo;
    if (!repo) return;
    const result = await window.gitTree.openExplorer(repo.path);
    if (result?.error) this.showToast(result.error, 'error');
  }

  toolbarButtons() {
    return {
      gitflow: 'btn-gitflow',
      terminal: 'btn-terminal',
      explorer: 'btn-explorer'
    };
  }

  readToolbarVisibility() {
    const defaults = { gitflow: true, terminal: true, explorer: true };
    try {
      const parsed = JSON.parse(localStorage.getItem('gittree.settings.toolbar'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...defaults, ...parsed };
      }
    } catch { /* invalid stored visibility falls back to defaults */ }
    return defaults;
  }

  applyToolbarVisibility() {
    const visibility = this.readToolbarVisibility();
    for (const [key, id] of Object.entries(this.toolbarButtons())) {
      const button = document.getElementById(id);
      if (button) button.classList.toggle('is-hidden', visibility[key] === false);
    }
  }

  async doPush() {
    if (!this.state.repo || this.remoteActionBusy) return;
    const repoPath = this.state.repo.path;
    this.setRemoteActionBusy('btn-push', true);
    this.components.repoTabs.setSyncBusy(repoPath, true);
    this.showToast(t('feedback.pushing'));
    try {
      const result = await window.gitTree.push(repoPath);
      if (result.error) { this.showToast(result.error, 'error'); return; }
      this.showToast(t('feedback.pushComplete'), 'success');
      if (this.isCurrentRepo(repoPath)) await this.refresh();
    } finally {
      this.components.repoTabs.setSyncBusy(repoPath, false);
      this.setRemoteActionBusy('btn-push', false);
    }
  }

  setRemoteActionBusy(activeId, busy) {
    if (busy) {
      this.remoteActionBusy = true;
      this.remoteActionRepo = this.state.repo?.path || null;
    } else {
      this.remoteActionBusy = false;
      this.remoteActionRepo = null;
    }
    this.syncRemoteBusyUI(activeId);
  }

  syncRemoteBusyUI(activeId = null) {
    const busyHere = this.remoteActionBusy &&
      Boolean(this.remoteActionRepo) &&
      this.isCurrentRepo(this.remoteActionRepo);
    for (const id of ['btn-fetch', 'btn-pull', 'btn-push']) {
      const button = document.getElementById(id);
      if (!button) continue;
      const icon = button.querySelector(':scope > i');
      const isActive = busyHere && id === activeId;
      button.disabled = busyHere;
      button.classList.toggle('is-busy', isActive);
      button.setAttribute('aria-busy', String(isActive));
      if (!icon) continue;
      if (isActive) {
        if (!icon.dataset.originalIcon) icon.dataset.originalIcon = icon.className;
        icon.className = 'ph ph-circle-notch';
      } else if (icon.dataset.originalIcon) {
        icon.className = icon.dataset.originalIcon;
        delete icon.dataset.originalIcon;
      }
    }
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

  setupClearableSearches(root = document) {
    root.querySelectorAll('.search-clearable').forEach(wrapper => {
      if (wrapper.dataset.clearBound === '1') return;
      const input = wrapper.querySelector('input');
      const button = wrapper.querySelector('.search-clear-btn');
      if (!input || !button) return;
      wrapper.dataset.clearBound = '1';
      const sync = () => {
        button.classList.toggle('is-hidden', !input.value);
        button.setAttribute('aria-label', t('common.clearSearch'));
      };
      input.addEventListener('input', sync);
      input.addEventListener('change', sync);
      button.addEventListener('click', event => {
        event.preventDefault();
        if (!input.value) return;
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        sync();
      });
      sync();
    });
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

        // ponytail: realtime CSS vars + rAF; pointer-events off during drag keeps layout cheap
        const paintWidth = () => {
          animationFrame = 0;
          pendingWidth = calculateWidth(latestX);
          workspace.style.setProperty(`--${side}-panel`, `${Math.round(pendingWidth)}px`);
        };

        handle.classList.add('is-dragging');
        workspace.classList.add('is-resizing');
        document.body.style.cursor = 'col-resize';
        handle.setPointerCapture?.(event.pointerId);

        const onMove = moveEvent => {
          latestX = moveEvent.clientX;
          if (!animationFrame) animationFrame = requestAnimationFrame(paintWidth);
        };

        const onUp = upEvent => {
          latestX = upEvent.clientX;
          if (animationFrame) cancelAnimationFrame(animationFrame);
          pendingWidth = calculateWidth(latestX);
          const width = Math.round(pendingWidth);
          workspace.style.setProperty(`--${side}-panel`, `${width}px`);
          localStorage.setItem(`gittree.panel.${side}`, String(width));
          handle.classList.remove('is-dragging');
          workspace.classList.remove('is-resizing');
          document.body.style.cursor = '';
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onUp);
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
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
    const toggle = () => {
      const isCollapsed = document.getElementById('workspace-body').classList.contains('sidebar-collapsed');
      this.setSidebarCollapsed(!isCollapsed);
    };
    document.getElementById('btn-toggle-sidebar').onclick = toggle;
    document.getElementById('btn-collapse-sidebar').onclick = toggle;
  }

  setSidebarCollapsed(collapsed, persist = true) {
    const workspace = document.getElementById('workspace-body');
    const toggleButton = document.getElementById('btn-toggle-sidebar');
    workspace.classList.toggle('sidebar-collapsed', collapsed);
    toggleButton.classList.toggle('active', !collapsed);
    toggleButton.setAttribute('aria-pressed', String(!collapsed));
    if (persist) localStorage.setItem('gittree.sidebar.collapsed', String(collapsed));
  }

  setupInspectorPopout() {
    this.popoutOpen = false;
    this.buildInspectorPayload = () => {
      const body = document.getElementById('detail-body');
      const title = document.getElementById('detail-title').textContent;
      const theme = document.documentElement.dataset.theme || 'light';
      const tone = document.documentElement.dataset.tone || '';
      const mode = this.components.diffViewer?.mode || 'unified';
      const html = body.innerHTML;
      const payload = { title, theme, tone, mode };
      if (html.length > 2_000_000 && this.components.diffViewer?.currentDiff) {
        payload.diffText = this.components.diffViewer.currentDiff;
      } else {
        payload.html = html;
      }
      return payload;
    };
    this.pushInspectorPayload = () => {
      if (!this.popoutOpen) return;
      window.gitTree.updateInspectorWindow(this.buildInspectorPayload());
    };
    window.gitTree.onInspectorClosed(() => {
      this.popoutOpen = false;
    });
    document.getElementById('btn-popout-inspector').onclick = async () => {
      const result = await window.gitTree.openInspectorWindow(this.buildInspectorPayload());
      this.popoutOpen = Boolean(result?.success);
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
      if (previousState === 'maximized' && !isMaximized) {
        this.animatePanelRestore(workspace);
      }
    }
    if (persist) localStorage.setItem('gittree.workspace.inspector', safeState);
  }

  animatePanelRestore(workspace) {
    workspace.classList.add('is-restoring');
    setTimeout(() => workspace.classList.remove('is-restoring'), 320);
  }

  setupPersistentSidebarSections() {
    const storageKey = 'gittree.sidebar.sections';
    let savedSections = null;
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey));
      if (Array.isArray(parsed)) savedSections = new Set(parsed);
    } catch { /* invalid stored sections are ignored */ }

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
    const kind = ['success', 'warning', 'error'].includes(type) ? type : 'loading';
    const icons = {
      loading: 'ph-circle-notch',
      success: 'ph-check-circle',
      warning: 'ph-warning',
      error: 'ph-x-circle'
    };
    const durations = { loading: 2500, success: 2800, warning: 4200, error: 5200 };
    const duration = durations[kind];

    clearTimeout(this._toastTimer);
    toast.className = `toast toast-${kind} show`;
    toast.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    toast.innerHTML =
      `<span class="toast-badge" aria-hidden="true"><i class="ph ${icons[kind]}"></i></span>` +
      `<span class="toast-message"></span>` +
      `<button type="button" class="toast-dismiss" aria-label="${this.esc(t('common.close'))}"><i class="ph ph-x" aria-hidden="true"></i></button>` +
      `<span class="toast-progress" aria-hidden="true"></span>`;
    toast.querySelector('.toast-message').textContent = message;
    toast.querySelector('.toast-progress').style.animationDuration = `${duration}ms`;
    toast.querySelector('.toast-dismiss').onclick = () => this.dismissToast();

    this._toastRemaining = duration;
    this._toastStarted = Date.now();
    if (toast.matches(':hover')) {
      toast.classList.add('paused');
    } else {
      this._toastTimer = setTimeout(() => this.dismissToast(), duration);
    }
  }

  dismissToast() {
    clearTimeout(this._toastTimer);
    document.getElementById('toast').classList.remove('show');
  }

  pauseToast() {
    const toast = document.getElementById('toast');
    if (!toast.classList.contains('show') || toast.classList.contains('paused')) return;
    clearTimeout(this._toastTimer);
    this._toastRemaining = Math.max((this._toastRemaining || 0) - (Date.now() - this._toastStarted), 0);
    toast.classList.add('paused');
  }

  resumeToast() {
    const toast = document.getElementById('toast');
    if (!toast.classList.contains('show') || !toast.classList.contains('paused')) return;
    toast.classList.remove('paused');
    this._toastStarted = Date.now();
    this._toastTimer = setTimeout(() => this.dismissToast(), Math.max(this._toastRemaining, 800));
  }

  esc(value) {
    const element = document.createElement('div');
    element.textContent = value ?? '';
    return element.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
