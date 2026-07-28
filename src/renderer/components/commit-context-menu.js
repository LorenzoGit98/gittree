class CommitContextMenu {
  constructor(app) {
    this.app = app;
    this.hashes = [];
    this.previews = {};
    this.generation = 0;
    this.element = document.createElement('div');
    this.element.className = 'commit-context-menu is-hidden';
    this.element.setAttribute('role', 'menu');
    document.body.appendChild(this.element);

    document.addEventListener('pointerdown', event => {
      if (!this.element.contains(event.target)) this.close();
    }, true);
    document.addEventListener('scroll', () => this.close(), true);
    document.addEventListener('keydown', event => this.handleKeyDown(event));
    window.addEventListener('resize', () => this.close());
    window.addEventListener('blur', () => this.close());
  }

  open(event, hashes) {
    if (!this.app.state.repo || !hashes.length) return;
    event.preventDefault();
    this.hashes = hashes;
    this.previews = {};
    const generation = ++this.generation;
    this.render();
    this.element.classList.remove('is-hidden');
    this.place(event.clientX, event.clientY);
    requestAnimationFrame(() => this.focusFirst());
    Promise.all([
      hashes.length === 1
        ? window.gitTree.previewCommitAction(
            this.app.state.repo.path,
            'rebase',
            hashes
          )
        : Promise.resolve({
            allowed: false,
            reason: t('commitMenu.singleRebase')
          }),
      window.gitTree.previewCommitAction(
        this.app.state.repo.path,
        'cherry-pick',
        hashes
      )
    ]).then(([rebase, cherryPick]) => {
      if (generation !== this.generation || this.element.classList.contains('is-hidden')) return;
      this.previews = { rebase, 'cherry-pick': cherryPick };
      this.render();
      this.place(event.clientX, event.clientY);
    });
  }

  render() {
    const loading = Object.keys(this.previews).length === 0;
    const rebase = this.previews.rebase;
    const cherryPick = this.previews['cherry-pick'];
    const actions = [
      {
        action: 'rebase',
        icon: 'ph-git-branch',
        label: t('commitMenu.rebase'),
        disabled: loading || this.hashes.length !== 1 || rebase?.allowed === false,
        reason: this.hashes.length !== 1
          ? t('commitMenu.singleRebase')
          : (rebase?.reason || (loading ? t('common.loading') : ''))
      },
      {
        action: 'cherry-pick',
        icon: 'ph-copy',
        label: t('commitMenu.cherryPick', { count: this.hashes.length }),
        disabled: loading || cherryPick?.allowed === false,
        reason: cherryPick?.reason || (loading ? t('common.loading') : '')
      }
    ];
    this.element.innerHTML = actions.map(item => `
      <div class="branch-menu-item" role="menuitem" tabindex="-1"
        data-action="${item.action}"
        ${item.disabled ? 'aria-disabled="true"' : ''}
        ${item.reason ? `title="${this.esc(item.reason)}"` : ''}>
        <i class="ph ${item.icon}" aria-hidden="true"></i>
        <span>${this.esc(item.label)}</span>
      </div>
    `).join('');
    this.element.querySelectorAll('[data-action]:not([aria-disabled="true"])').forEach(item => {
      item.onclick = event => {
        event.stopPropagation();
        this.execute(item.dataset.action);
      };
    });
  }

  async execute(action) {
    const repo = this.app.state.repo;
    const preview = this.previews[action];
    if (!repo || !preview) return;
    this.close();
    if (!await this.previewDialog(preview)) return;
    const result = action === 'rebase'
      ? await window.gitTree.rebaseOntoCommit(repo.path, this.hashes[0])
      : await window.gitTree.cherryPick(repo.path, this.hashes);
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      if (result.conflictState?.type) {
        await this.app.components.conflict.open(result.conflictState);
      }
      return;
    }
    this.app.showToast(t('commitMenu.completed'), 'success');
    await this.app.refresh({ selectHash: result.head, silent: true });
  }

  previewDialog(preview) {
    const overlay = document.getElementById('modal-overlay');
    const dialog = document.getElementById('modal-dialog');
    return new Promise(resolve => {
      const commits = preview.commits || [];
      const files = preview.files || [];
      dialog.innerHTML = `
        <div class="commit-action-preview">
          <span class="eyebrow">${this.esc(t('commitMenu.previewEyebrow'))}</span>
          <h3>${this.esc(t(
            preview.action === 'rebase' ? 'commitMenu.rebaseTitle' : 'commitMenu.cherryPickTitle'
          ))}</h3>
          <div class="commit-preview-status ${preview.allowed ? 'allowed' : 'blocked'}">
            <i class="ph ${preview.allowed ? 'ph-check-circle' : 'ph-warning-circle'}"></i>
            <span>${this.esc(preview.allowed ? t('commitMenu.ready') : preview.reason)}</span>
          </div>
          <dl class="commit-preview-facts">
            <div><dt>${this.esc(t('commitMenu.target'))}</dt><dd><code>${this.esc((preview.target || '').slice(0, 12))}</code></dd></div>
            <div><dt>${this.esc(t('commitMenu.commits'))}</dt><dd>${commits.length}</dd></div>
            <div><dt>${this.esc(t('commitMenu.files'))}</dt><dd>${files.length}</dd></div>
            <div><dt>${this.esc(t('commitMenu.workingTree'))}</dt><dd>${this.esc(preview.workingTree?.clean ? t('commitMenu.clean') : t('commitMenu.dirty'))}</dd></div>
          </dl>
          <div class="commit-preview-scroll">
            ${commits.map(commit => `<div class="commit-preview-row">
              <code>${this.esc(commit.hash.slice(0, 8))}</code>
              <span>${this.esc(commit.subject)}</span>
            </div>`).join('')}
            ${files.slice(0, 100).map(file => `<div class="commit-preview-file">
              <i class="ph ph-file"></i><span>${this.esc(file)}</span>
            </div>`).join('')}
          </div>
          <div class="confirm-actions">
            <button class="btn" type="button" data-cancel>${this.esc(t('common.cancel'))}</button>
            <button class="btn btn-primary" type="button" data-confirm ${preview.allowed ? '' : 'disabled'}>
              ${this.esc(t('common.continue'))}
            </button>
          </div>
        </div>`;
      overlay.classList.remove('is-hidden');
      const finish = value => {
        overlay.classList.add('is-hidden');
        dialog.innerHTML = '';
        resolve(value);
      };
      dialog.querySelector('[data-cancel]').onclick = () => finish(false);
      dialog.querySelector('[data-confirm]').onclick = () => finish(true);
      dialog.querySelector(preview.allowed ? '[data-confirm]' : '[data-cancel]')?.focus();
    });
  }

  close() {
    if (this.element.classList.contains('is-hidden')) return;
    this.generation += 1;
    this.element.classList.add('is-hidden');
    this.element.innerHTML = '';
  }

  place(x, y) {
    const margin = 8;
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
    const rect = this.element.getBoundingClientRect();
    this.element.style.left = `${Math.max(
      margin,
      Math.min(x, window.innerWidth - rect.width - margin)
    )}px`;
    this.element.style.top = `${Math.max(
      margin,
      Math.min(y, window.innerHeight - rect.height - margin)
    )}px`;
  }

  focusFirst() {
    this.element.querySelector('.branch-menu-item:not([aria-disabled="true"])')?.focus();
  }

  handleKeyDown(event) {
    if (this.element.classList.contains('is-hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    const items = [...this.element.querySelectorAll(
      '.branch-menu-item:not([aria-disabled="true"])'
    )];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(current + delta + items.length) % items.length].focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      document.activeElement?.click();
    }
  }

  esc(value) {
    const element = document.createElement('div');
    element.textContent = value ?? '';
    return element.innerHTML;
  }
}

window.CommitContextMenu = CommitContextMenu;
