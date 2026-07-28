class ConflictResolver {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('merge-workspace-overlay');
    this.state = null;
    this.currentPath = null;
    this.current = null;
    this.dirty = false;
  }

  async open(state = null) {
    const repo = this.app.state.repo;
    if (!repo) return;
    this.state = state?.type ? state : await window.gitTree.getOperationState(repo.path);
    if (this.state?.error) {
      this.app.showToast(this.state.error, 'error');
      return;
    }
    if (!this.state?.type) return;
    this.currentPath = this.state.conflicts[0] || null;
    this.current = null;
    this.dirty = false;
    this.render();
    this.container.classList.remove('is-hidden');
    if (this.currentPath) await this.loadFile(this.currentPath);
  }

  render() {
    const conflicts = this.state?.conflicts || [];
    this.container.innerHTML = `
      <div class="conflict-workspace">
        <header class="conflict-header">
          <div>
            <span class="eyebrow">${this.esc(t('conflicts.operation', { operation: this.state.type }))}</span>
            <h2>${this.esc(t('conflicts.title'))}</h2>
          </div>
          <div class="conflict-header-actions">
            <span class="badge badge-conflict">${conflicts.length} ${this.esc(t('conflicts.remaining'))}</span>
            <button class="btn" id="conflict-abort"><i class="ph ph-x-circle"></i>${this.esc(t('conflicts.abort'))}</button>
            <button class="btn btn-primary" id="conflict-continue" ${conflicts.length ? 'disabled' : ''}>
              <i class="ph ph-arrow-right"></i>${this.esc(t('common.continue'))}
            </button>
          </div>
        </header>
        <div class="conflict-body">
          <aside class="conflict-file-list" aria-label="${this.esc(t('conflicts.files'))}">
            ${conflicts.map(file => `<button class="conflict-file-item${file === this.currentPath ? ' active' : ''}" data-file="${this.esc(file)}">
              <span class="conflict-file-status pending"></span><span>${this.esc(file)}</span>
            </button>`).join('')}
            ${conflicts.length ? '' : `<div class="conflict-complete"><i class="ph ph-check-circle"></i>${this.esc(t('conflicts.allResolved'))}</div>`}
          </aside>
          <main class="conflict-editor" id="conflict-editor">
            <div class="empty-state">${this.esc(conflicts.length ? t('common.loading') : t('conflicts.readyContinue'))}</div>
          </main>
        </div>
      </div>`;

    this.container.querySelectorAll('[data-file]').forEach(button => {
      button.onclick = async () => {
        if (!await this.confirmDiscard()) return;
        await this.loadFile(button.dataset.file);
      };
    });
    document.getElementById('conflict-abort').onclick = () => this.abort();
    document.getElementById('conflict-continue').onclick = () => this.continue();
  }

  async loadFile(filePath) {
    const repo = this.app.state.repo;
    if (!repo) return;
    this.currentPath = filePath;
    this.current = await window.gitTree.readConflict(repo.path, filePath);
    if (this.current?.error) {
      this.app.showToast(this.current.error, 'error');
      return;
    }
    this.dirty = false;
    this.render();
    this.renderEditor();
  }

  renderEditor() {
    if (!this.current) return;
    const editor = document.getElementById('conflict-editor');
    if (!editor) return;
    const file = this.current;
    editor.innerHTML = `
      <div class="conflict-editor-toolbar">
        <div>
          <strong>${this.esc(file.path)}</strong>
          ${file.binary ? `<span class="badge">${this.esc(t('conflicts.binary'))}</span>` : ''}
        </div>
        <div class="conflict-toolbar-actions">
          <button class="btn conflict-ours" data-resolution="ours">${this.esc(t('conflicts.acceptOurs'))}</button>
          <button class="btn conflict-theirs" data-resolution="theirs">${this.esc(t('conflicts.acceptTheirs'))}</button>
          ${file.binary ? '' : `<button class="btn btn-primary" id="conflict-save">${this.esc(t('conflicts.saveResult'))}</button>`}
        </div>
      </div>
      ${file.binary ? `
        <div class="conflict-binary-state">
          <i class="ph ph-file-lock"></i>
          <h3>${this.esc(t('conflicts.binaryTitle'))}</h3>
          <p>${this.esc(t('conflicts.binaryHelp'))}</p>
        </div>
      ` : `
        <details class="conflict-base">
          <summary>${this.esc(t('conflicts.base'))}</summary>
          <pre>${this.esc(file.base)}</pre>
        </details>
        <div class="conflict-panes three-pane">
          ${this.readOnlyPane(t('conflicts.ours'), file.ours, 'ours')}
          ${this.readOnlyPane(t('conflicts.theirs'), file.theirs, 'theirs')}
          <section class="conflict-pane">
            <div class="conflict-pane-header result">${this.esc(t('conflicts.result'))}</div>
            <textarea id="conflict-result-editor" spellcheck="false">${this.esc(file.result)}</textarea>
          </section>
        </div>
      `}`;
    editor.querySelectorAll('[data-resolution]').forEach(button => {
      button.onclick = () => this.resolve(button.dataset.resolution);
    });
    const textarea = document.getElementById('conflict-result-editor');
    if (textarea) textarea.addEventListener('input', () => { this.dirty = true; });
    document.getElementById('conflict-save')?.addEventListener('click', () => (
      this.resolve('manual', textarea.value)
    ));
  }

  readOnlyPane(label, content, kind) {
    return `<section class="conflict-pane">
      <div class="conflict-pane-header ${kind}">${this.esc(label)}</div>
      <pre class="conflict-pane-content">${this.esc(content)}</pre>
    </section>`;
  }

  async resolve(strategy, content = '') {
    const repo = this.app.state.repo;
    if (!repo || !this.currentPath) return;
    const result = await window.gitTree.resolveConflict(repo.path, this.currentPath, {
      strategy,
      ...(strategy === 'manual' ? { content } : {})
    });
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      return;
    }
    this.state = result.state;
    this.currentPath = this.state.conflicts[0] || null;
    this.current = null;
    this.dirty = false;
    this.render();
    if (this.currentPath) await this.loadFile(this.currentPath);
  }

  async continue() {
    if (this.state?.conflicts?.length) return;
    const repo = this.app.state.repo;
    const result = await window.gitTree.continueOperation(repo.path);
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      const state = await window.gitTree.getOperationState(repo.path);
      if (state?.type) await this.open(state);
      return;
    }
    this.hide();
    this.app.showToast(t('conflicts.completed'), 'success');
    this.app.emit('refresh');
  }

  async abort() {
    if (!await this.confirm(t('conflicts.abortTitle'), t('conflicts.abortConfirm'))) return;
    const repo = this.app.state.repo;
    const result = await window.gitTree.abortOperation(repo.path);
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      return;
    }
    this.hide();
    this.app.emit('refresh');
  }

  async confirmDiscard() {
    if (!this.dirty) return true;
    return this.confirm(t('conflicts.discardTitle'), t('conflicts.discardConfirm'));
  }

  confirm(title, message) {
    const overlay = document.getElementById('modal-overlay');
    const dialog = document.getElementById('modal-dialog');
    return new Promise(resolve => {
      dialog.innerHTML = `<h3>${this.esc(title)}</h3><p>${this.esc(message)}</p>
        <div class="confirm-actions"><button class="btn" data-cancel>${this.esc(t('common.cancel'))}</button>
        <button class="btn btn-danger" data-confirm>${this.esc(t('common.continue'))}</button></div>`;
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

  hide() {
    this.container.classList.add('is-hidden');
    this.container.innerHTML = '';
    this.state = null;
    this.current = null;
    this.dirty = false;
  }

  esc(value) {
    const element = document.createElement('div');
    element.textContent = value ?? '';
    return element.innerHTML;
  }
}
