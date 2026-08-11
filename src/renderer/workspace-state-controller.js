/* exported WorkspaceStateController */
class WorkspaceStateController {
  constructor({
    document,
    storage,
    translate,
    panelMotion,
    state,
    components,
    viewportWidth,
    computedStyle,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timer => clearTimeout(timer),
    onModeChange = () => {},
    onInspectorStateChange = () => {}
  }) {
    this.document = document;
    this.storage = storage;
    this.translate = translate;
    this.panelMotion = panelMotion;
    this.state = state;
    this.components = components;
    this.viewportWidth = viewportWidth;
    this.computedStyle = computedStyle;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onModeChange = onModeChange;
    this.onInspectorStateChange = onInspectorStateChange;
    this.mode = 'history';
    this.inspectorState = 'open';
    this.bindings = [];
    this.restoreTimers = new Set();
    this.mounted = false;
  }

  mount() {
    if (this.mounted) return;
    this.mounted = true;
    this.bindWorkspaceModes();
    this.setMode('history', false);
    this.bindInspector();
    this.setInspectorState(
      this.storage.getItem('gittree.workspace.inspector') || 'open',
      false
    );
    this.bindSidebar();
    this.setSidebarCollapsed(
      this.storage.getItem('gittree.sidebar.collapsed') === 'true',
      false
    );
    this.bindPersistentSidebarSections();
  }

  bind(element, eventName, listener) {
    if (!element) return;
    element.addEventListener(eventName, listener);
    this.bindings.push({ element, eventName, listener });
  }

  bindWorkspaceModes() {
    this.document.querySelectorAll('[data-workspace-mode]').forEach(button => {
      this.bind(button, 'click', () => this.setMode(button.dataset.workspaceMode));
    });
  }

  modeKey(repoPath = this.state.repo?.path) {
    return `gittree.workspace.mode:${repoPath || ''}`;
  }

  restoreMode(repoPath) {
    const savedMode = this.storage.getItem(this.modeKey(repoPath)) || 'history';
    this.setMode(savedMode, false);
    return this.mode;
  }

  setMode(mode, persist = true) {
    const safeMode = ['history', 'changes', 'pullRequests'].includes(mode)
      ? mode
      : 'history';
    this.mode = safeMode;
    this.onModeChange(safeMode);
    this.document.querySelectorAll('[data-workspace-mode]').forEach(button => {
      const active = button.dataset.workspaceMode === safeMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    this.document.getElementById('main-view').classList.toggle('is-hidden', safeMode !== 'history');
    this.document.getElementById('changes-view').classList.toggle('is-hidden', safeMode !== 'changes');
    this.document.getElementById('pull-requests-view').classList.toggle(
      'is-hidden',
      safeMode !== 'pullRequests'
    );
    this.document.getElementById('global-search').classList.toggle(
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
    const title = this.document.getElementById('workspace-title');
    const eyebrow = title.querySelector('.eyebrow');
    const heading = title.querySelector('h2');
    eyebrow.dataset.i18n = eyebrowKey;
    heading.dataset.i18n = titleKey;
    eyebrow.textContent = this.translate(eyebrowKey);
    heading.textContent = this.translate(titleKey);
    this.components.changes?.setActive(safeMode === 'changes');
    this.components.pullRequests?.setActive(safeMode === 'pullRequests');
    if (persist && this.state.repo) {
      this.storage.setItem(this.modeKey(), safeMode);
    }
  }

  bindSidebar() {
    const toggle = () => {
      const workspace = this.document.getElementById('workspace-body');
      this.setSidebarCollapsed(!workspace.classList.contains('sidebar-collapsed'));
    };
    this.bind(this.document.getElementById('btn-toggle-sidebar'), 'click', toggle);
    this.bind(this.document.getElementById('btn-collapse-sidebar'), 'click', toggle);
  }

  setSidebarCollapsed(collapsed, persist = true) {
    const workspace = this.document.getElementById('workspace-body');
    const toggleButton = this.document.getElementById('btn-toggle-sidebar');
    const changed = workspace.classList.contains('sidebar-collapsed') !== collapsed;
    this.panelMotion.transition('sidebar', {
      opening: !collapsed,
      animate: persist && changed,
      applyState: () => {
        workspace.classList.toggle('sidebar-collapsed', collapsed);
        toggleButton.classList.toggle('active', !collapsed);
        toggleButton.setAttribute('aria-pressed', String(!collapsed));
      }
    });
    if (persist) {
      this.storage.setItem('gittree.sidebar.collapsed', String(collapsed));
    }
  }

  bindInspector() {
    this.bind(this.document.getElementById('btn-toggle-inspector'), 'click', () => {
      const inspector = this.document.getElementById('detail-panel');
      const hiddenByResponsiveLayout = this.inspectorState !== 'closed' &&
        this.computedStyle(inspector).display === 'none';
      if (this.inspectorState === 'closed') {
        this.setInspectorState(this.viewportWidth() <= 1120 ? 'maximized' : 'open');
      } else if (hiddenByResponsiveLayout) {
        this.setInspectorState('maximized');
      } else {
        this.setInspectorState('closed');
      }
    });
    this.bind(this.document.getElementById('btn-close-inspector'), 'click', () => {
      this.setInspectorState('closed');
    });
    this.bind(this.document.getElementById('btn-maximize-inspector'), 'click', () => {
      this.toggleInspectorMaximized();
    });
    this.bind(this.document.querySelector('.detail-panel-header'), 'dblclick', event => {
      if (event.target.closest('button')) return;
      this.toggleInspectorMaximized();
    });
  }

  toggleInspectorMaximized() {
    this.setInspectorState(this.inspectorState === 'maximized' ? 'open' : 'maximized');
  }

  setInspectorState(state, persist = true) {
    const safeState = ['open', 'closed', 'maximized'].includes(state) ? state : 'open';
    const previousState = this.inspectorState;
    const workspace = this.document.getElementById('workspace-body');
    const toggleButton = this.document.getElementById('btn-toggle-inspector');
    const maximizeButton = this.document.getElementById('btn-maximize-inspector');
    const isOpen = safeState !== 'closed';
    const isMaximized = safeState === 'maximized';
    const changedVisibility = (previousState === 'closed') !== (safeState === 'closed');

    this.panelMotion.transition('inspector', {
      opening: isOpen,
      animate: persist && changedVisibility,
      applyState: () => {
        this.inspectorState = safeState;
        this.onInspectorStateChange(safeState);
        workspace.classList.toggle('inspector-closed', safeState === 'closed');
        workspace.classList.toggle('inspector-maximized', isMaximized);
        toggleButton.classList.toggle('active', isOpen);
        toggleButton.setAttribute('aria-pressed', String(isOpen));
      }
    });

    const maximizeIcon = maximizeButton.querySelector('i');
    maximizeIcon.className = isMaximized ? 'ph ph-arrows-in-simple' : 'ph ph-arrows-out-simple';
    maximizeButton.dataset.i18nTitle = isMaximized ? 'details.restore' : 'details.maximize';
    maximizeButton.title = this.translate(maximizeButton.dataset.i18nTitle);

    if (previousState !== safeState) {
      this.components.diffViewer?.setInspectorExpanded(isMaximized);
      if (previousState === 'maximized' && !isMaximized) {
        this.animatePanelRestore(workspace);
      }
    }
    if (persist) {
      this.storage.setItem('gittree.workspace.inspector', safeState);
    }
  }

  animatePanelRestore(workspace) {
    workspace.classList.add('is-restoring');
    const timer = this.setTimer(() => {
      this.restoreTimers.delete(timer);
      workspace.classList.remove('is-restoring');
    }, 320);
    this.restoreTimers.add(timer);
  }

  bindPersistentSidebarSections() {
    const storageKey = 'gittree.sidebar.sections';
    let savedSections = null;
    try {
      const parsed = JSON.parse(this.storage.getItem(storageKey));
      if (Array.isArray(parsed)) savedSections = new Set(parsed);
    } catch {
      // Invalid stored sections are ignored.
    }

    const headers = [...this.document.querySelectorAll('.sidebar-section-header.collapsible')];
    headers.forEach(header => {
      const section = header.parentElement;
      const sectionId = section.dataset.section;
      const body = section.querySelector('.sidebar-section-body');
      const arrow = header.querySelector('.collapse-arrow');
      if (!sectionId || !body || !arrow) return;

      const collapsed = savedSections
        ? savedSections.has(sectionId)
        : body.classList.contains('collapsed');
      this.applySidebarSectionState({ header, body, arrow }, collapsed);
      this.bind(header, 'click', () => {
        const nextCollapsed = !body.classList.contains('collapsed');
        this.applySidebarSectionState({ header, body, arrow }, nextCollapsed);
        const collapsedSections = headers
          .filter(item => item.classList.contains('collapsed'))
          .map(item => item.parentElement.dataset.section)
          .filter(Boolean);
        this.storage.setItem(storageKey, JSON.stringify(collapsedSections));
      });
    });
  }

  applySidebarSectionState({ header, body, arrow }, collapsed) {
    body.classList.toggle('collapsed', collapsed);
    arrow.classList.toggle('collapsed', collapsed);
    header.classList.toggle('collapsed', collapsed);
    header.setAttribute('aria-expanded', String(!collapsed));
  }

  destroy() {
    for (const { element, eventName, listener } of this.bindings) {
      element.removeEventListener(eventName, listener);
    }
    this.bindings = [];
    for (const timer of this.restoreTimers) this.clearTimer(timer);
    this.restoreTimers.clear();
    this.mounted = false;
  }
}

if (typeof module !== 'undefined') module.exports = WorkspaceStateController;
