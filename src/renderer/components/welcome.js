/* exported WelcomeScreen */
/* eslint-disable-next-line no-unused-vars -- script-tag global consumed by app.js */
class WelcomeScreen {
  constructor() {
    this.screen = document.getElementById('welcome-screen');
    this.recentList = document.getElementById('recent-repos');
    this.onboardingContainer = document.getElementById('welcome-onboarding');
    this.steps = ['open', 'branch', 'commit'];
    this.storageKey = 'gittree.onboarding';
  }

  async init(app) {
    this.app = app;
    document.getElementById('btn-open-repo').onclick = () => this.openRepositoryPicker();
    document.getElementById('btn-clone-repo').onclick = () => this.cloneRepo();
    await this.loadRecent();
    this.renderOnboarding();
  }

  readProgress() {
    try {
      const parsed = JSON.parse(localStorage.getItem(this.storageKey));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  markStep(step) {
    if (!this.steps.includes(step)) return;
    const progress = this.readProgress();
    progress[step] = true;
    localStorage.setItem(this.storageKey, JSON.stringify(progress));
    this.renderOnboarding();
  }

  renderOnboarding() {
    if (!this.onboardingContainer) return;
    const progress = this.readProgress();
    const complete = this.steps.every(step => progress[step]);
    this.onboardingContainer.classList.toggle('is-hidden', complete);
    if (complete) return;
    this.onboardingContainer.innerHTML = `
      <div class="onboarding-card">
        <div class="onboarding-title">${this.esc(t('onboarding.title'))}</div>
        ${this.steps.map(step => `
          <div class="onboarding-step${progress[step] ? ' is-done' : ''}">
            <i class="ph ${progress[step] ? 'ph-check-circle' : 'ph-circle'}" aria-hidden="true"></i>
            <span>${this.esc(t(`onboarding.${step}`))}</span>
          </div>
        `).join('')}
      </div>`;
  }

  async openRepo() {
    try {
      if (!window.gitTree) return;
      const dir = await window.gitTree.selectDirectory();
      if (!dir) return;
      const isRepo = await window.gitTree.checkIsGitRepo(dir);
      if (!isRepo) { this.app.showToast(t('feedback.notRepo'), 'error'); return; }
      await this.app.components.repoTabs.addRepo(dir);
    } catch (e) { this.app.showToast('Error: ' + e.message, 'error'); }
  }

  openRepositoryPicker() {
    this.closeRepositoryPicker();
    const overlay = document.createElement('div');
    overlay.className = 'repository-picker-overlay';
    overlay.innerHTML = `
      <section class="repository-picker" role="dialog" aria-modal="true" aria-labelledby="repository-picker-title">
        <header class="repository-picker-header">
          <div>
            <span class="eyebrow">${t('discovery.eyebrow')}</span>
            <h2 id="repository-picker-title">${t('discovery.title')}</h2>
          </div>
          <button class="icon-btn repository-picker-close" type="button" aria-label="${t('common.close')}">
            <i class="ph ph-x" aria-hidden="true"></i>
          </button>
        </header>
        <div class="repository-picker-options">
          <button class="repository-picker-option" type="button" data-mode="single">
            <i class="ph ph-folder-open" aria-hidden="true"></i>
            <span><strong>${t('discovery.single')}</strong><small>${t('discovery.singleHelp')}</small></span>
            <i class="ph ph-caret-right" aria-hidden="true"></i>
          </button>
          <button class="repository-picker-option" type="button" data-mode="scan">
            <i class="ph ph-folders" aria-hidden="true"></i>
            <span><strong>${t('discovery.scan')}</strong><small>${t('discovery.scanHelp')}</small></span>
            <i class="ph ph-caret-right" aria-hidden="true"></i>
          </button>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    this.repositoryPicker = overlay;
    overlay.querySelector('.repository-picker-close').onclick = () => this.closeRepositoryPicker();
    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay) this.closeRepositoryPicker();
    });
    overlay.querySelector('[data-mode="single"]').onclick = async () => {
      this.closeRepositoryPicker();
      await this.openRepo();
    };
    overlay.querySelector('[data-mode="scan"]').onclick = async () => {
      const rootPath = await window.gitTree.selectDirectory();
      if (rootPath) await this.startRepositoryScan(rootPath);
    };
    this.repositoryPickerKeydown = event => {
      if (event.key === 'Escape') this.closeRepositoryPicker();
    };
    document.addEventListener('keydown', this.repositoryPickerKeydown);
    overlay.querySelector('[data-mode="single"]').focus();
  }

  async startRepositoryScan(rootPath) {
    if (!this.repositoryPicker) return;
    const repositories = await window.gitTree.getRepos();
    this.knownRepositoryPaths = new Set(
      (repositories || []).map(repo => this.pathKey(repo.path))
    );
    this.scanRepositories = [];
    this.scanSelection = new Set();
    this.scanQuery = '';
    this.scanFinished = false;
    this.repositoryPicker.querySelector('.repository-picker').innerHTML = `
      <header class="repository-picker-header">
        <div>
          <span class="eyebrow">${t('discovery.scanningEyebrow')}</span>
          <h2>${t('discovery.results')}</h2>
          <p class="repository-picker-root"></p>
        </div>
        <button class="icon-btn repository-picker-close" type="button" aria-label="${t('common.close')}">
          <i class="ph ph-x" aria-hidden="true"></i>
        </button>
      </header>
      <div class="repository-scan-toolbar">
        <label class="repository-scan-search search-clearable">
          <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
          <input type="search" placeholder="${t('discovery.search')}" aria-label="${t('discovery.search')}">
          <button type="button" class="search-clear-btn is-hidden" aria-label="${t('common.clearSearch')}">
            <i class="ph ph-x" aria-hidden="true"></i>
          </button>
        </label>
        <button class="btn btn-secondary btn-sm" type="button" data-action="all">${t('discovery.selectAll')}</button>
        <button class="btn btn-secondary btn-sm" type="button" data-action="none">${t('discovery.selectNone')}</button>
      </div>
      <div class="repository-scan-status" role="status">
        <span class="repository-scan-spinner"><i class="ph ph-spinner-gap" aria-hidden="true"></i></span>
        <span data-status>${t('discovery.scanning', { count: 0 })}</span>
      </div>
      <div class="repository-scan-list" role="listbox" aria-multiselectable="true">
        <div class="repository-scan-spacer"></div>
        <div class="repository-scan-rows"></div>
      </div>
      <footer class="repository-picker-footer">
        <span data-summary>${t('discovery.selected', { count: 0 })}</span>
        <div>
          <button class="btn btn-secondary" type="button" data-action="cancel">${t('common.cancel')}</button>
          <button class="btn btn-primary" type="button" data-action="import" disabled>${t('discovery.import')}</button>
        </div>
      </footer>`;

    const picker = this.repositoryPicker;
    picker.querySelector('.repository-picker-root').textContent = rootPath;
    picker.querySelector('.repository-picker-close').onclick = () => this.closeRepositoryPicker();
    picker.querySelector('[data-action="cancel"]').onclick = () => this.closeRepositoryPicker();
    picker.querySelector('[data-action="all"]').onclick = () => {
      this.visibleScanRepositories().forEach(repo => {
        if (!this.knownRepositoryPaths.has(this.pathKey(repo.path))) {
          this.scanSelection.add(repo.path);
        }
      });
      this.renderRepositoryScan();
    };
    picker.querySelector('[data-action="none"]').onclick = () => {
      this.visibleScanRepositories().forEach(repo => this.scanSelection.delete(repo.path));
      this.renderRepositoryScan();
    };
    picker.querySelector('[data-action="import"]').onclick = () => this.importScannedRepositories();
    picker.querySelector('input[type="search"]').oninput = event => {
      this.scanQuery = event.target.value.trim().toLocaleLowerCase();
      this.scanList.scrollTop = 0;
      this.renderRepositoryScan();
    };
    this.app?.setupClearableSearches?.(picker);
    this.scanList = picker.querySelector('.repository-scan-list');
    this.scanList.addEventListener('scroll', () => {
      if (this.scanRenderFrame) return;
      this.scanRenderFrame = requestAnimationFrame(() => {
        this.scanRenderFrame = null;
        this.renderRepositoryScan();
      });
    }, { passive: true });

    this.unsubscribeScanProgress = window.gitTree.onRepositoryScanProgress(update => {
      if (update.scanId !== this.scanId) return;
      if (update.repository) this.appendScannedRepository(update.repository);
      this.updateScanStatus(update.scannedDirectories);
    });
    this.unsubscribeScanComplete = window.gitTree.onRepositoryScanComplete(result => {
      if (result.scanId !== this.scanId) return;
      this.scanFinished = true;
      for (const repository of result.repositories || []) this.appendScannedRepository(repository);
      this.updateScanStatus(result.scannedDirectories, result);
      this.renderRepositoryScan();
    });
    const started = await window.gitTree.startRepositoryScan(rootPath);
    this.scanId = started.scanId;
  }

  appendScannedRepository(repository) {
    if (this.scanRepositories.some(item => this.pathKey(item.path) === this.pathKey(repository.path))) return;
    this.scanRepositories.push(repository);
    if (!this.knownRepositoryPaths.has(this.pathKey(repository.path))) {
      this.scanSelection.add(repository.path);
    }
    this.renderRepositoryScan();
  }

  visibleScanRepositories() {
    if (!this.scanQuery) return this.scanRepositories;
    return this.scanRepositories.filter(repo => (
      repo.name.toLocaleLowerCase().includes(this.scanQuery) ||
      repo.path.toLocaleLowerCase().includes(this.scanQuery)
    ));
  }

  renderRepositoryScan() {
    if (!this.repositoryPicker || !this.scanList) return;
    const items = this.visibleScanRepositories();
    const rowHeight = 54;
    const overscan = 12;
    const viewportRows = Math.ceil(this.scanList.clientHeight / rowHeight);
    const start = Math.max(0, Math.floor(this.scanList.scrollTop / rowHeight) - overscan);
    const end = Math.min(items.length, start + viewportRows + overscan * 2);
    const spacer = this.scanList.querySelector('.repository-scan-spacer');
    const rows = this.scanList.querySelector('.repository-scan-rows');
    spacer.style.height = `${items.length * rowHeight}px`;
    rows.style.transform = `translateY(${start * rowHeight}px)`;
    rows.innerHTML = '';

    for (let index = start; index < end; index += 1) {
      const repository = items[index];
      const existing = this.knownRepositoryPaths.has(this.pathKey(repository.path));
      const row = document.createElement('label');
      row.className = `repository-scan-row${existing ? ' is-existing' : ''}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(this.scanSelection.has(repository.path)));
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.disabled = existing;
      checkbox.checked = !existing && this.scanSelection.has(repository.path);
      checkbox.onchange = () => {
        if (checkbox.checked) this.scanSelection.add(repository.path);
        else this.scanSelection.delete(repository.path);
        this.updateScanSummary();
      };
      const details = document.createElement('span');
      details.className = 'repository-scan-details';
      const name = document.createElement('strong');
      name.textContent = repository.name;
      const location = document.createElement('small');
      location.textContent = repository.path;
      details.append(name, location);
      row.append(checkbox, details);
      if (existing) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = t('discovery.alreadyAdded');
        row.appendChild(badge);
      }
      rows.appendChild(row);
    }
    this.updateScanSummary();
  }

  updateScanStatus(scannedDirectories, result) {
    if (!this.repositoryPicker) return;
    const status = this.repositoryPicker.querySelector('[data-status]');
    const spinner = this.repositoryPicker.querySelector('.repository-scan-spinner');
    if (result) {
      spinner.classList.add('is-hidden');
      status.textContent = result.error
        ? result.error
        : result.canceled
          ? t('discovery.canceled')
          : t('discovery.complete', {
              repositories: this.scanRepositories.length,
              directories: scannedDirectories || 0
            });
    } else {
      status.textContent = t('discovery.scanning', { count: scannedDirectories || 0 });
    }
  }

  updateScanSummary() {
    if (!this.repositoryPicker) return;
    const count = this.scanSelection.size;
    this.repositoryPicker.querySelector('[data-summary]').textContent = t('discovery.selected', { count });
    this.repositoryPicker.querySelector('[data-action="import"]').disabled = count === 0;
  }

  async importScannedRepositories() {
    const button = this.repositoryPicker?.querySelector('[data-action="import"]');
    if (!button || button.disabled) return;
    button.disabled = true;
    const result = await this.app.components.repoTabs.addRepos([...this.scanSelection]);
    this.closeRepositoryPicker();
    await this.loadRecent();
    if (result?.failed?.length) {
      this.app.showToast(t('discovery.partialFailure', { count: result.failed.length }), 'warning');
    } else {
      this.app.showToast(t('discovery.imported', { count: result?.added?.length || 0 }), 'success');
    }
  }

  closeRepositoryPicker() {
    if (this.scanId && !this.scanFinished) window.gitTree.cancelRepositoryScan(this.scanId);
    if (this.unsubscribeScanProgress) this.unsubscribeScanProgress();
    if (this.unsubscribeScanComplete) this.unsubscribeScanComplete();
    if (this.repositoryPickerKeydown) {
      document.removeEventListener('keydown', this.repositoryPickerKeydown);
    }
    if (this.scanRenderFrame) cancelAnimationFrame(this.scanRenderFrame);
    this.repositoryPicker?.remove();
    this.repositoryPicker = null;
    this.scanList = null;
    this.scanId = null;
    this.unsubscribeScanProgress = null;
    this.unsubscribeScanComplete = null;
  }

  pathKey(value) {
    return window.gitTree?.platform === 'win32' ? value.toLocaleLowerCase() : value;
  }

  async cloneRepo() {
    const cloneUrl = await this.cloneDialog();
    if (!cloneUrl) return;
    const parentDirectory = await window.gitTree.selectDirectory();
    if (!parentDirectory) return;
    this.app.showToast(t('feedback.cloning'), 'info');
    try {
      const result = await window.gitTree.cloneRepository(cloneUrl, parentDirectory);
      if (result?.error) { this.app.showToast(result.error, 'error'); return; }
      this.app.showToast(t('feedback.cloneComplete'), 'success');
      await this.app.components.repoTabs.addRepo(result.path);
    } catch (e) {
      this.app.showToast('Error: ' + e.message, 'error');
    }
  }

  cloneDialog() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'repository-picker-overlay';
      overlay.innerHTML = `
        <section class="repository-picker" role="dialog" aria-modal="true" aria-labelledby="clone-dialog-title">
          <header class="repository-picker-header">
            <div>
              <span class="eyebrow">${t('welcome.clone')}</span>
              <h2 id="clone-dialog-title">${t('clone.title')}</h2>
            </div>
            <button class="icon-btn repository-picker-close" type="button" aria-label="${t('common.close')}">
              <i class="ph ph-x" aria-hidden="true"></i>
            </button>
          </header>
          <div class="clone-dialog-body">
            <label>
              <span>${t('clone.urlLabel')}</span>
              <input class="clone-url-input" type="text" placeholder="https://github.com/user/repo.git" spellcheck="false" autocomplete="off">
            </label>
          </div>
          <footer class="repository-picker-footer">
            <div>
              <button class="btn btn-secondary" type="button" data-action="cancel">${t('common.cancel')}</button>
              <button class="btn btn-primary" type="button" data-action="next">${t('clone.next')}</button>
            </div>
          </footer>
        </section>`;
      const finish = value => {
        overlay.remove();
        document.removeEventListener('keydown', keydown);
        resolve(value);
      };
      const keydown = event => {
        if (event.key === 'Escape') finish(null);
        if (event.key === 'Enter') submit();
      };
      const submit = () => {
        const input = overlay.querySelector('.clone-url-input');
        const value = input.value.trim();
        if (!value) return;
        finish(value);
      };
      document.body.appendChild(overlay);
      overlay.querySelector('.repository-picker-close').onclick = () => finish(null);
      overlay.addEventListener('mousedown', event => {
        if (event.target === overlay) finish(null);
      });
      overlay.querySelector('[data-action="cancel"]').onclick = () => finish(null);
      overlay.querySelector('[data-action="next"]').onclick = submit;
      document.addEventListener('keydown', keydown);
      overlay.querySelector('.clone-url-input').focus();
    });
  }

  async loadRecent() {
    try {
      const repos = await window.gitTree.getRepos();
      if (!repos || !repos.length) { this.recentList.innerHTML = ''; return; }
      this.recentList.innerHTML = `<div class="welcome-recent-title">${t('welcome.recent')}</div>`;
      repos.slice(0, 5).forEach((repo, index) => {
        const el = document.createElement('div');
        el.className = 'welcome-recent-item';
        el.style.setProperty('--item-index', index);
        el.innerHTML = `<div class="recent-name">${this.esc(repo.name)}</div><div class="recent-path">${this.esc(repo.path)}</div>`;
        el.addEventListener('click', () => {
          this.app.components.repoTabs.addRepo(repo.path);
        });
        this.recentList.appendChild(el);
      });
    } catch (e) { console.error('loadRecent:', e); }
  }

  show() {
    this.screen.classList.remove('is-hidden');
    document.getElementById('workspace').classList.add('is-hidden');
  }

  hide() {
    this.screen.classList.add('is-hidden');
    document.getElementById('workspace').classList.remove('is-hidden');
  }

  esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
}
