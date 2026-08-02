(function exposeRemoteOperationController(root, factory) {
  const Controller = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = Controller;
  if (root) root.RemoteOperationController = Controller;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createController() {
  const operations = {
    fetch: {
      buttonId: 'btn-fetch',
      progressKey: 'feedback.fetching',
      successKey: 'feedback.fetchComplete'
    },
    pull: {
      buttonId: 'btn-pull',
      progressKey: 'feedback.pulling',
      successKey: 'feedback.pullComplete'
    },
    push: {
      buttonId: 'btn-push',
      progressKey: 'feedback.pushing',
      successKey: 'feedback.pushComplete'
    }
  };

  return class RemoteOperationController {
    constructor({
      bridge,
      document: documentRef,
      translate,
      notify,
      getCurrentRepository,
      isCurrentRepository,
      repoTabs,
      createLoadSession,
      views
    }) {
      this.bridge = bridge;
      this.document = documentRef;
      this.translate = translate;
      this.notify = notify;
      this.getCurrentRepository = getCurrentRepository;
      this.isCurrentRepository = isCurrentRepository;
      this.repoTabs = repoTabs;
      this.createLoadSession = createLoadSession;
      this.views = views;
      this.currentOperation = null;
      this.visualGeneration = 0;
    }

    get busy() {
      return Boolean(this.currentOperation);
    }

    async run(action) {
      const config = operations[action];
      const repo = this.getCurrentRepository();
      if (!config || !repo || this.busy) return null;

      const operation = { action, repoPath: repo.path, external: false };
      this.currentOperation = operation;
      this.visualGeneration += 1;
      this.syncUI();
      this.repoTabs.setSyncBusy(repo.path, true);
      this.notify(this.translate(config.progressKey));

      let outcome = 'error';
      let result;
      try {
        result = await this.bridge[action](repo.path);
        if (result?.error) {
          this.notify(result.error, 'error');
          return result;
        }
        await this.refreshAfter(action, repo.path);
        this.notify(this.translate(config.successKey), 'success');
        outcome = 'success';
        return result;
      } catch (error) {
        result = { error: error.message || String(error) };
        this.notify(result.error, 'error');
        return result;
      } finally {
        this.repoTabs.setSyncBusy(repo.path, false);
        if (this.currentOperation === operation) this.currentOperation = null;
        this.syncUI();
        if (this.isCurrentRepository(repo.path)) {
          await this.showCompletion(config.buttonId, outcome);
        }
      }
    }

    async refreshAfter(action, repoPath) {
      if (!this.isCurrentRepository(repoPath)) {
        await this.repoTabs.refreshAllSync();
        return;
      }
      const loadSession = this.createLoadSession(repoPath);
      const tasks = [
        this.views.refreshGraph(repoPath, { preserveViewport: true }),
        this.views.refreshBranches(repoPath, loadSession, { background: true }),
        this.views.refreshStatus(repoPath, loadSession)
      ];
      if (action === 'pull') {
        tasks.push(this.views.refreshChanges(repoPath, { background: true }));
      }
      await Promise.all(tasks);
      if (this.isCurrentRepository(repoPath)) this.views.syncCurrent(repoPath);
    }

    setExternalBusy(buttonId, busy, repoPath = this.getCurrentRepository()?.path) {
      if (busy) {
        if (this.currentOperation) return false;
        const action = Object.keys(operations).find(key => operations[key].buttonId === buttonId);
        this.currentOperation = { action, repoPath, external: true };
        this.visualGeneration += 1;
      } else if (this.currentOperation?.external) {
        this.currentOperation = null;
      }
      this.syncUI();
      return true;
    }

    syncUI() {
      const operation = this.currentOperation;
      const visibleOperation = operation
        && this.isCurrentRepository(operation.repoPath)
        ? operation.action
        : null;
      for (const [action, config] of Object.entries(operations)) {
        const button = this.document.getElementById(config.buttonId);
        if (!button) continue;
        const icon = button.querySelector(':scope > i');
        if (icon && !icon.dataset.originalIcon) icon.dataset.originalIcon = icon.className;
        const active = action === visibleOperation;
        button.disabled = Boolean(operation);
        button.classList.toggle('is-busy', active);
        button.classList.remove('is-complete', 'is-error');
        button.dataset.operationState = active ? 'running' : 'idle';
        button.setAttribute('aria-busy', String(active));
        if (icon) {
          icon.className = active ? 'ph ph-circle-notch' : icon.dataset.originalIcon;
        }
      }
    }

    async showCompletion(buttonId, outcome) {
      const button = this.document.getElementById(buttonId);
      const icon = button?.querySelector(':scope > i');
      if (!button || !icon) return;
      const generation = ++this.visualGeneration;
      button.classList.add(outcome === 'success' ? 'is-complete' : 'is-error');
      button.dataset.operationState = outcome;
      icon.className = outcome === 'success' ? 'ph ph-check' : 'ph ph-warning-circle';

      await Promise.resolve();
      const animations = typeof button.getAnimations === 'function'
        ? button.getAnimations()
        : [];
      await Promise.allSettled(animations.map(animation => animation.finished));
      if (generation !== this.visualGeneration || this.currentOperation) return;
      button.classList.remove('is-complete', 'is-error');
      button.dataset.operationState = 'idle';
      icon.className = icon.dataset.originalIcon;
    }
  };
});
