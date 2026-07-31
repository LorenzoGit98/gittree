class GitFlow {
  constructor(app) {
    this.app = app;
    this.overlay = document.getElementById('modal-overlay');
    this.dialog = document.getElementById('modal-dialog');
    this.mode = 'start';
    this.type = 'feature';
    this.localBranches = [];
    this.currentBranch = '';
    this.finishTarget = null;
    this.handedOff = false;
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.dialog.classList.contains('gitflow-dialog')) {
        event.preventDefault();
        this.close();
      }
    });
  }

  async open() {
    const repo = this.app.state.repo;
    if (!repo) {
      this.app.showToast(t('gitflow.openRepositoryFirst'), 'error');
      return;
    }
    const [metadata, status] = await Promise.all([
      window.gitTree.getBranchMetadata(repo.path),
      window.gitTree.getStatus(repo.path)
    ]);
    this.localBranches = (metadata?.branches || [])
      .filter(branch => branch.kind === 'local')
      .map(branch => branch.name);
    this.currentBranch = status?.current || '';
    this.mode = 'start';
    this.type = 'feature';
    this.finishTarget = null;
    this.render();
    this.overlay.classList.remove('is-hidden');
    this.dialog.querySelector('#gitflow-description')?.focus();
  }

  close() {
    this.overlay.classList.add('is-hidden');
    this.overlay.onclick = null;
    this.dialog.className = 'confirm-dialog';
    this.dialog.innerHTML = '';
  }

  gitflowBranches() {
    return this.localBranches.filter(name => this.branchType(name));
  }

  branchType(name) {
    if (name.startsWith('feature/')) return 'feature';
    if (name.startsWith('release/')) return 'release';
    if (name.startsWith('hotfix/')) return 'hotfix';
    return null;
  }

  productionBranch(names) {
    if (names.includes('main')) return 'main';
    if (names.includes('master')) return 'master';
    return this.currentBranch || names[0] || '';
  }

  integrationBranch(names) {
    if (names.includes('develop')) return 'develop';
    return this.productionBranch(names);
  }

  baseForType(type) {
    return type === 'hotfix'
      ? this.productionBranch(this.localBranches)
      : this.integrationBranch(this.localBranches);
  }

  previewName() {
    const input = this.dialog.querySelector('#gitflow-description');
    const slug = BranchNaming.slugify(input?.value || '');
    return slug ? `${this.type}/${slug}` : '';
  }

  versionFromBranch(name) {
    let suffix = name.split('/').slice(1).join('-') || 'release';
    if (suffix.startsWith('v')) suffix = suffix.slice(1);
    return suffix;
  }

  render() {
    const branches = this.gitflowBranches();
    this.dialog.className = 'confirm-dialog gitflow-dialog';
    this.dialog.innerHTML = `
      <div class="settings-header">
        <div>
          <span class="eyebrow">${this.esc(t('gitflow.eyebrow'))}</span>
          <h2>${this.esc(t('gitflow.title'))}</h2>
        </div>
        <button class="btn-icon" type="button" data-gitflow-close
          title="${this.esc(t('common.close'))}" aria-label="${this.esc(t('common.close'))}">
          <i class="ph ph-x" aria-hidden="true"></i>
        </button>
      </div>
      <div class="settings-scroll">
        <div class="segmented-control gitflow-tabs" role="tablist">
          <button type="button" class="btn btn-small${this.mode === 'start' ? ' active' : ''}"
            data-gitflow-mode="start">${this.esc(t('gitflow.startTab'))}</button>
          <button type="button" class="btn btn-small${this.mode === 'finish' ? ' active' : ''}"
            data-gitflow-mode="finish">${this.esc(t('gitflow.finishTab'))}</button>
        </div>

        <section class="settings-section gitflow-panel" data-gitflow-panel="start"
          ${this.mode === 'start' ? '' : 'hidden'}>
          <div class="settings-section-heading">
            <i class="ph ph-git-branch" aria-hidden="true"></i>
            <div>
              <h3>${this.esc(t('gitflow.startTab'))}</h3>
              <p>${this.esc(t('gitflow.startHelp'))}</p>
            </div>
          </div>
          <div class="gitflow-types" role="group">
            ${['feature', 'release', 'hotfix'].map(type => `
              <button type="button" class="gitflow-type${type === this.type ? ' selected' : ''}"
                data-gitflow-type="${type}">
                <i class="ph ${this.typeIcon(type)}" aria-hidden="true"></i>
                <span>${this.esc(t(`gitflow.type_${type}`))}</span>
                <small>${this.esc(this.baseForType(type))}</small>
              </button>`).join('')}
          </div>
          <label class="gitflow-field">
            <span>${this.esc(t('gitflow.descriptionLabel'))}</span>
            <input type="text" id="gitflow-description" maxlength="120"
              placeholder="${this.esc(t('gitflow.descriptionPlaceholder'))}">
          </label>
          <div class="gitflow-preview">
            <span class="gitflow-preview-label">${this.esc(t('gitflow.preview'))}</span>
            <code id="gitflow-preview-name">—</code>
          </div>
          <div class="gitflow-actions">
            <button type="button" class="btn btn-primary" id="gitflow-start" disabled>
              <i class="ph ph-plus" aria-hidden="true"></i>
              ${this.esc(t('gitflow.startButton'))}
            </button>
          </div>
        </section>

        <section class="settings-section gitflow-panel" data-gitflow-panel="finish"
          ${this.mode === 'finish' ? '' : 'hidden'}>
          <div class="settings-section-heading">
            <i class="ph ph-git-merge" aria-hidden="true"></i>
            <div>
              <h3>${this.esc(t('gitflow.finishTab'))}</h3>
              <p>${this.esc(t('gitflow.finishHelp'))}</p>
            </div>
          </div>
          <div class="gitflow-branch-list">
            ${branches.length ? branches.map(name => `
              <button type="button" class="gitflow-branch" data-gitflow-branch="${this.esc(name)}">
                <span class="badge ${this.typeBadge(this.branchType(name))}">
                  ${this.esc(this.branchType(name))}
                </span>
                <span class="gitflow-branch-name">${this.esc(name)}</span>
              </button>`).join('')
              : `<div class="settings-empty">${this.esc(t('gitflow.noBranches'))}</div>`}
          </div>
          <div class="gitflow-actions">
            <button type="button" class="btn btn-primary" id="gitflow-finish" disabled>
              <i class="ph ph-git-merge" aria-hidden="true"></i>
              ${this.esc(t('gitflow.finishButton'))}
            </button>
          </div>
        </section>
      </div>
    `;
    this.bind();
  }

  typeIcon(type) {
    return { feature: 'ph-lightbulb', release: 'ph-package', hotfix: 'ph-first-aid' }[type] || 'ph-git-branch';
  }

  typeBadge(type) {
    return { feature: 'badge-branch', release: 'badge-tag', hotfix: 'badge-conflict' }[type] || 'badge-branch';
  }

  bind() {
    this.dialog.querySelector('[data-gitflow-close]').onclick = () => this.close();
    this.overlay.onclick = event => {
      if (event.target === this.overlay) this.close();
    };

    this.dialog.querySelectorAll('[data-gitflow-mode]').forEach(button => {
      button.onclick = () => {
        this.mode = button.dataset.gitflowMode;
        this.render();
      };
    });

    if (this.mode === 'start') this.bindStart();
    else this.bindFinish();
  }

  bindStart() {
    const description = this.dialog.querySelector('#gitflow-description');
    const preview = this.dialog.querySelector('#gitflow-preview-name');
    const startButton = this.dialog.querySelector('#gitflow-start');

    const updatePreview = () => {
      const name = this.previewName();
      preview.textContent = name || '—';
      startButton.disabled = !name;
    };

    description.oninput = updatePreview;
    this.dialog.querySelectorAll('[data-gitflow-type]').forEach(button => {
      button.onclick = () => {
        this.type = button.dataset.gitflowType;
        this.dialog.querySelectorAll('[data-gitflow-type]').forEach(other => {
          other.classList.toggle('selected', other === button);
        });
        updatePreview();
      };
    });
    startButton.onclick = () => this.startBranch();
    updatePreview();
  }

  bindFinish() {
    const finishButton = this.dialog.querySelector('#gitflow-finish');
    this.dialog.querySelectorAll('[data-gitflow-branch]').forEach(button => {
      button.onclick = () => {
        this.finishTarget = button.dataset.gitflowBranch;
        this.dialog.querySelectorAll('[data-gitflow-branch]').forEach(other => {
          other.classList.toggle('selected', other === button);
        });
        finishButton.disabled = false;
      };
    });
    finishButton.onclick = () => {
      if (this.finishTarget) this.finishBranch(this.finishTarget);
    };
  }

  setBusy(busy) {
    this.dialog.querySelectorAll('#gitflow-start, #gitflow-finish').forEach(button => {
      button.disabled = busy;
    });
  }

  async startBranch() {
    const repo = this.app.state.repo;
    if (!repo) return;
    const name = this.previewName();
    if (!name) {
      this.app.showToast(t('gitflow.invalidDescription'), 'error');
      return;
    }
    const base = this.baseForType(this.type);
    this.setBusy(true);
    const result = await window.gitTree.createBranch(repo.path, name, base);
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      this.setBusy(false);
      return;
    }
    this.app.showToast(t('gitflow.started', { branch: name }), 'success');
    this.close();
    this.app.emit('refresh');
  }

  async checkoutAndMerge(target, source) {
    const repo = this.app.state.repo;
    const checkout = await window.gitTree.checkoutBranch(repo.path, target);
    if (checkout?.error) throw new Error(checkout.error);
    const merge = await window.gitTree.merge(repo.path, source, 'noff');
    if (merge?.error) {
      if (merge.conflictState?.type) {
        this.handedOff = true;
        this.close();
        await this.app.components.conflict.open(merge.conflictState);
      }
      throw new Error(merge.error);
    }
  }

  async tagHead(name, message) {
    const repo = this.app.state.repo;
    const log = await window.gitTree.getLog(repo.path, 1);
    const hash = log?.latest?.hash;
    if (!hash) throw new Error('Could not resolve HEAD for tagging');
    const tag = await window.gitTree.createTag(repo.path, name, hash, message);
    if (tag?.error) throw new Error(tag.error);
  }

  async finishBranch(branchName) {
    const repo = this.app.state.repo;
    if (!repo) return;
    const type = this.branchType(branchName);
    const names = this.localBranches;
    const integration = this.integrationBranch(names);
    const production = this.productionBranch(names);
    const version = this.versionFromBranch(branchName);

    this.setBusy(true);
    this.handedOff = false;
    try {
      if (type === 'feature') {
        await this.checkoutAndMerge(integration, branchName);
      } else if (type === 'release') {
        await this.checkoutAndMerge(integration, branchName);
        if (production !== integration) await this.checkoutAndMerge(production, branchName);
        await this.tagHead(`v${version}`, branchName);
      } else if (type === 'hotfix') {
        await this.checkoutAndMerge(production, branchName);
        await this.tagHead(`v${version}`, branchName);
        if (integration !== production) await this.checkoutAndMerge(integration, branchName);
      }
      const del = await window.gitTree.deleteBranch(repo.path, branchName, false);
      if (del?.error) throw new Error(del.error);
      this.app.showToast(t('gitflow.finished', { branch: branchName }), 'success');
      this.close();
      this.app.emit('refresh');
    } catch (err) {
      if (!this.handedOff) {
        this.app.showToast(err.message || String(err), 'error');
        this.setBusy(false);
      }
      this.app.emit('refresh');
    }
  }

  esc(value) {
    const element = document.createElement('div');
    element.textContent = value ?? '';
    return element.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}
