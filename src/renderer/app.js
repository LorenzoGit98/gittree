/* global WorktreeAgentPanel, InspectorWorkspace */
class GitTreeApp {
  constructor() {
    this.state = { repo: null, activeRepoIndex: -1, currentBranch: null };
    this.components = {};
    this.inspectorState = 'open';
    this.workspaceMode = 'history';
    this.updateState = null;
    this._events = {};
    this.dialogs = new DialogService();
  }

  pathKey(value) {
    if (this.repositoryWorkspace) return this.repositoryWorkspace.pathKey(value);
    return window.gitTree?.platform === 'win32'
      ? String(value).toLocaleLowerCase('en-US')
      : String(value);
  }

  isCurrentRepo(repoPath) {
    if (this.repositoryWorkspace) {
      return this.repositoryWorkspace.isCurrentRepository(repoPath);
    }
    const current = this.state.repo?.path;
    return Boolean(current) && this.pathKey(repoPath) === this.pathKey(current);
  }

  async init() {
    this.components.welcome = new WelcomeScreen();
    this.components.repoTabs = new RepoTabs(document.getElementById('repo-tab-list'), this, {
      storage: localStorage,
      platform: window.gitTree.platform
    });
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
    this.components.inspectorWorkspace = new InspectorWorkspace({
      container: document.getElementById('inspector-workspace'),
      graphContainer: document.getElementById('inspector-graph-view'),
      filesPanel: document.getElementById('inspector-files-panel'),
      fileList: document.getElementById('inspector-file-list'),
      filesToggle: document.getElementById('btn-toggle-inspector-files'),
      diffContainer: document.getElementById('detail-body'),
      translate: t,
      storage: localStorage,
      onGraphSelect: hash => this.components.graphView.select(hash),
      onGraphRequestMore: () => this.components.graphView.loadNextPage(),
      onFileSelect: path => {
        if (this.components.diffViewer.scrollToFile(path)) this.pushInspectorPayload?.();
      },
      onFilesOpenChange: () => this.pushInspectorPayload?.()
    });
    this.components.inspectorWorkspace.mount();
    this.components.search = new GlobalSearch(this);
    this.components.compare = new BranchCompare(this);
    this.components.commitCompare = new CommitCompare(this);
    this.components.merge = new MergeWorkspace(this);
    this.components.reflog = new ReflogView(this);
    this.components.conflict = new ConflictResolver(this);
    this.components.gitflow = new GitFlow(this);
    this.components.statusBar = new StatusBar();
    this.components.worktreeAgents = new WorktreeAgentPanel(this);
    this.repositoryWorkspace = new RepositoryWorkspaceController({
      bridge: window.gitTree,
      document,
      translate: t,
      state: this.state,
      components: this.components,
      createLoadSession: (bridge, repoPath) => new RepositoryLoadSession(bridge, repoPath),
      callbacks: {
        syncRemoteBusyUI: () => this.syncRemoteBusyUI(),
        restoreWorkspaceMode: repoPath => this.workspaceState.restoreMode(repoPath),
        loadStashes: repoPath => this.loadStashes(repoPath),
        loadTags: repoPath => this.loadTags(repoPath),
        loadWorktreeAgents: repo => this.components.worktreeAgents.load(repo),
        updateStatus: (repoPath, loadSession) => this.updateStatus(repoPath, loadSession),
        syncCurrentRepositoryState: repoPath => this.syncCurrentRepositoryState(repoPath)
      }
    });
    this.remoteOperations = new RemoteOperationController({
      bridge: window.gitTree,
      document,
      translate: t,
      notify: (message, type) => this.showToast(message, type),
      getCurrentRepository: () => this.state.repo,
      isCurrentRepository: repoPath => this.isCurrentRepo(repoPath),
      repoTabs: this.components.repoTabs,
      createLoadSession: repoPath => new RepositoryLoadSession(window.gitTree, repoPath),
      views: {
        refreshGraph: (repoPath, options) => this.components.graphView.load(repoPath, options),
        refreshBranches: (repoPath, session, options) => (
          this.components.branchList.load(repoPath, session, options)
        ),
        refreshChanges: repoPath => this.components.changes.load(repoPath),
        refreshStatus: (repoPath, session) => this.updateStatus(repoPath, session),
        syncCurrent: repoPath => this.syncCurrentRepositoryState(repoPath)
      }
    });
    this.panelMotion = new WorkspacePanelMotion({
      workspace: document.getElementById('workspace-body'),
      document,
      panels: {
        sidebar: {
          panel: document.getElementById('sidebar'),
          toggle: document.getElementById('btn-toggle-sidebar'),
          openingAnimation: 'motion-panel-enter-left',
          closingAnimation: 'motion-panel-exit-left'
        },
        inspector: {
          panel: document.getElementById('detail-panel'),
          toggle: document.getElementById('btn-toggle-inspector'),
          openingAnimation: 'motion-panel-enter-right',
          closingAnimation: 'motion-panel-exit-right'
        }
      },
      prefersReducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    });
    this.workspaceState = new WorkspaceStateController({
      document,
      storage: localStorage,
      translate: t,
      panelMotion: this.panelMotion,
      state: this.state,
      components: this.components,
      viewportWidth: () => window.innerWidth,
      computedStyle: element => getComputedStyle(element),
      onModeChange: mode => { this.workspaceMode = mode; },
      onInspectorStateChange: state => { this.inspectorState = state; }
    });
    this.shortcutController = new ShortcutController({
      document,
      platform: window.gitTree.platform || 'win32',
      translate: t,
      callbacks: {
        openRepository: () => this.components.welcome.openRepo(),
        fetch: () => this.doFetch(),
        pull: () => this.doPull(),
        push: () => this.doPush(),
        newBranch: () => this.components.branchList.promptCreateBranch(),
        getInspectorState: () => this.inspectorState,
        restoreInspector: () => this.setInspectorState('open')
      }
    });
    this.setupPlatformChrome();

    this.bindEvents();
    await this.setupUpdates();
    this.components.search.init();
    this.components.welcome.init(this);
    this.setupClearableSearches();
    this.setupResize();
    this.setupWorkspaceState();
    this.applyToolbarVisibility();
    this.setupGlobalShortcuts();
    await this.components.repoTabs.init();
    this.components.settings.init();
    this.components.worktreeAgents.mount();

    const repos = this.components.repoTabs.repos;
    if (repos && repos.length > 0) {
      const active = await window.gitTree.getActiveRepo();
      if (active) {
        this.components.repoTabs.syncActiveIndex(active.path);
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
      button.onclick = () => this.components.settings.open(null, {
        scope: button.dataset.settingsScope || 'full'
      });
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
    this.workspaceState.setMode('history', false);
  }

  workspaceModeKey(repoPath = this.state.repo?.path) {
    return this.workspaceState.modeKey(repoPath);
  }

  setWorkspaceMode(mode, persist = true) {
    return this.workspaceState.setMode(mode, persist);
  }

  setupPlatformChrome() {
    this.platform = window.gitTree.platform || 'win32';
    this.shortcutController.setPlatform(this.platform);
    document.documentElement.dataset.platform = this.platform;
    this.setupShortcutHints();
    window.gitTree.onWindowState(state => this.updateWindowChrome(state));
    window.gitTree.getWindowState().then(state => this.updateWindowChrome(state));
  }

  shortcutDefinitions() {
    return this.shortcutController.definitions();
  }

  shortcutLabel(action) {
    return this.shortcutController.label(action);
  }

  setupShortcutHints() {
    return this.shortcutController.refreshHints();
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
    return this.shortcutController.isPrimaryModifier(event);
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
    return this.repositoryWorkspace.open(repo, options);
  }

  setProjectLoading(loading) {
    return this.repositoryWorkspace.setLoading(loading);
  }

  setProjectInteractive() {
    return this.repositoryWorkspace.setInteractive();
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
    return this.dialogs.confirm({
      title,
      message,
      cancelLabel: t('common.cancel'),
      actionLabel,
      danger
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

  async updateStatus(repoPath, loadSession = null) {
    try {
      const status = await (loadSession?.status() || window.gitTree.getStatus(repoPath));
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

  syncCurrentRepositoryState(repoPath) {
    if (!this.isCurrentRepo(repoPath)) return '';
    const branchName = this.components.branchList.current || '';
    const currentBranchMetadata = (this.components.branchList.metadata?.branches || [])
      .find(branch => branch.kind === 'local' && branch.current);
    this.components.repoTabs.updateSync(repoPath, currentBranchMetadata
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
    return branchName;
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
    this.syncInspectorWorkspace();
  }

  syncInspectorWorkspace(options = {}) {
    const graph = this.components.graphView?.getInspectorSnapshot?.() || {
      revision: 0,
      laneCount: 1,
      hasMore: false,
      selectedHash: null,
      rows: []
    };
    this.components.inspectorWorkspace?.update({
      graph,
      selectedHash: graph.selectedHash,
      files: this.components.diffViewer?.fileSummaries || [],
      selectedFile: this.components.diffViewer?.selectedFilePath || null
    });
    if (options.push !== false) this.pushInspectorPayload?.();
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
    this.components.welcome?.markStep?.('branch');
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
    return this.remoteOperations.run('fetch');
  }

  async doPull() {
    return this.remoteOperations.run('pull');
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
    return this.remoteOperations.run('push');
  }

  setRemoteActionBusy(activeId, busy) {
    return this.remoteOperations.setExternalBusy(activeId, busy);
  }

  syncRemoteBusyUI() {
    this.remoteOperations.syncUI();
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
    this.workspaceResize = new WorkspaceResizeController({
      workspace,
      document,
      storage: localStorage,
      requestFrame: callback => requestAnimationFrame(callback),
      cancelFrame: frame => cancelAnimationFrame(frame),
      panels: {
        left: {
          handle: document.getElementById('resize-handle-left'),
          panel: document.getElementById('sidebar'),
          min: 220,
          max: 380,
          cssVariable: '--left-panel',
          storageKey: 'gittree.panel.left',
          direction: 1
        },
        right: {
          handle: document.getElementById('resize-handle-right'),
          panel: document.getElementById('detail-panel'),
          min: 300,
          max: 620,
          cssVariable: '--right-panel',
          storageKey: 'gittree.panel.right',
          direction: -1
        }
      }
    });
    this.workspaceResize.mount();
  }

  setupWorkspaceState() {
    this.workspaceState.mount();
    this.setupInspectorPopout();
  }

  setSidebarCollapsed(collapsed, persist = true) {
    return this.workspaceState.setSidebarCollapsed(collapsed, persist);
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
      const meta = [...document.querySelectorAll('#detail-meta > span')]
        .map(element => element.textContent.trim())
        .filter(Boolean)
        .join(' · ');
      const payload = {
        title,
        meta,
        theme,
        tone,
        mode,
        eyebrow: t('details.eyebrow'),
        modeLabel: t(mode === 'split' ? 'details.split' : 'details.unified'),
        wordLevel: Boolean(this.components.diffViewer?.wordLevel),
        graph: this.components.graphView?.getInspectorSnapshot?.(),
        files: this.components.diffViewer?.fileSummaries || [],
        selectedFile: this.components.diffViewer?.selectedFilePath || null,
        filesOpen: this.components.inspectorWorkspace?.filesOpen !== false
      };
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
    window.gitTree.onDeepLinkOpen(repo => {
      this.components.repoTabs?.addRepo(repo.path);
    });
    document.getElementById('btn-popout-inspector').onclick = async () => {
      const result = await window.gitTree.openInspectorWindow(this.buildInspectorPayload());
      this.popoutOpen = Boolean(result?.success);
    };
  }

  setInspectorState(state, persist = true) {
    return this.workspaceState.setInspectorState(state, persist);
  }

  animatePanelRestore(workspace) {
    return this.workspaceState.animatePanelRestore(workspace);
  }

  setupGlobalShortcuts() {
    return this.shortcutController.mount();
  }

  refreshLocalizedView() {
    Theme.syncControls();
    this.setupShortcutHints();
    this.updateWindowChrome(this.windowState);
    this.setInspectorState(this.inspectorState, false);
    this.components.inspectorWorkspace?.refreshTranslations();
    this.components.repoTabs?.render();
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
    return HtmlEncoder.encode(value);
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
