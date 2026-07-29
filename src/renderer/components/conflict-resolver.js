class ConflictResolver {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('merge-workspace-overlay');
    this.state = null;
    this.currentPath = null;
    this.current = null;
    this.resultContent = '';
    this.blocks = [];
    this.activeBlockIndex = 0;
    this.pendingBinaryStrategy = null;
    this.dirty = false;
    this.manualEdited = false;
    this.layout = localStorage.getItem('gittree.mergeEditor.layout') === 'vertical'
      ? 'vertical'
      : 'horizontal';
    window.addEventListener('beforeunload', event => {
      if (!this.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
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
            ${['rebase', 'cherry-pick'].includes(this.state.type) ? `
              <button class="btn" id="conflict-skip"><i class="ph ph-skip-forward"></i>${this.esc(t('conflicts.skip'))}</button>
            ` : ''}
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
    document.getElementById('conflict-skip')?.addEventListener('click', () => this.skip());
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
    this.resultContent = this.current.result;
    this.blocks = (this.current.blocks || []).map(block => ({ ...block }));
    this.activeBlockIndex = 0;
    this.pendingBinaryStrategy = null;
    this.manualEdited = false;
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
        <div class="conflict-current-file">
          <strong>${this.esc(file.path)}</strong>
          ${file.binary ? `<span class="badge">${this.esc(t('conflicts.binary'))}</span>` : ''}
        </div>
        <div class="conflict-toolbar-actions">
          ${file.binary ? `
            <button class="btn" data-binary="ours">${this.esc(t('conflicts.acceptCurrent'))}</button>
            <button class="btn" data-binary="theirs">${this.esc(t('conflicts.acceptIncoming'))}</button>
          ` : `
            <button class="btn" data-whole="current">${this.esc(t('conflicts.useCurrentFile'))}</button>
            <button class="btn" data-whole="incoming">${this.esc(t('conflicts.useIncomingFile'))}</button>
            <button class="btn" id="conflict-layout">
              <i class="ph ph-layout" aria-hidden="true"></i>${this.esc(
                this.layout === 'horizontal' ? t('conflicts.verticalLayout') : t('conflicts.horizontalLayout')
              )}
            </button>
          `}
          <button class="btn btn-primary" id="conflict-mark-resolved" ${this.canMarkResolved() ? '' : 'disabled'}>
            <i class="ph ph-check-circle" aria-hidden="true"></i>${this.esc(t('conflicts.markResolved'))}
          </button>
        </div>
      </div>
      ${file.binary ? this.renderBinaryState() : this.renderTextEditor()}`;

    editor.querySelectorAll('[data-binary]').forEach(button => {
      button.onclick = () => {
        this.pendingBinaryStrategy = button.dataset.binary;
        this.dirty = true;
        editor.querySelectorAll('[data-binary]').forEach(item => {
          item.classList.toggle('active', item === button);
        });
        this.updateMarkButton();
      };
    });
    editor.querySelectorAll('[data-whole]').forEach(button => {
      button.onclick = () => {
        this.resultContent = button.dataset.whole === 'current'
          ? this.current.current
          : this.current.incoming;
        this.blocks = [];
        this.activeBlockIndex = 0;
        this.manualEdited = false;
        this.dirty = true;
        this.renderEditor();
      };
    });
    document.getElementById('conflict-layout')?.addEventListener('click', () => {
      this.layout = this.layout === 'horizontal' ? 'vertical' : 'horizontal';
      localStorage.setItem('gittree.mergeEditor.layout', this.layout);
      this.renderEditor();
    });
    document.getElementById('conflict-mark-resolved')?.addEventListener('click', () => this.markResolved());
    this.bindTextEditor();
  }

  renderBinaryState() {
    return `
      <div class="conflict-binary-state">
        <i class="ph ph-file-lock"></i>
        <h3>${this.esc(t('conflicts.binaryTitle'))}</h3>
        <p>${this.esc(t('conflicts.binaryHelp'))}</p>
        <p class="conflict-selection-note">${this.esc(
          this.pendingBinaryStrategy ? t('conflicts.selectionPending') : t('conflicts.chooseVersion')
        )}</p>
      </div>`;
  }

  renderTextEditor() {
    const active = this.blocks[this.activeBlockIndex] || null;
    return `
      <div class="conflict-block-toolbar">
        <div class="conflict-navigation">
          <button class="icon-btn" id="conflict-previous" ${this.activeBlockIndex <= 0 ? 'disabled' : ''} aria-label="${this.esc(t('conflicts.previous'))}">
            <i class="ph ph-arrow-up"></i>
          </button>
          <button class="icon-btn" id="conflict-next" ${this.activeBlockIndex >= this.blocks.length - 1 ? 'disabled' : ''} aria-label="${this.esc(t('conflicts.next'))}">
            <i class="ph ph-arrow-down"></i>
          </button>
          <strong>${this.esc(t('conflicts.blockCount', {
            current: this.blocks.length ? this.activeBlockIndex + 1 : 0,
            total: this.blocks.length
          }))}</strong>
        </div>
        ${active && !this.manualEdited ? `
          <div class="conflict-block-actions">
            <button class="btn btn-small" data-choice="current">${this.esc(t('conflicts.acceptCurrent'))}</button>
            <button class="btn btn-small" data-choice="incoming">${this.esc(t('conflicts.acceptIncoming'))}</button>
            <button class="btn btn-small" data-choice="both">${this.esc(t('conflicts.acceptBoth'))}</button>
            <button class="btn btn-small" data-choice="smart" ${active.smartCombination === null ? 'disabled' : ''}>${this.esc(t('conflicts.smartCombination'))}</button>
            <button class="btn btn-small" data-choice="ignore">${this.esc(t('conflicts.ignore'))}</button>
          </div>
        ` : `<span class="conflict-manual-note">${this.esc(
          this.manualEdited ? t('conflicts.manualMode') : t('conflicts.noUnresolvedBlocks')
        )}</span>`}
      </div>
      <details class="conflict-base">
        <summary>${this.esc(t('conflicts.base'))}</summary>
        ${this.codePane(fileOrEmpty(this.current.base), 'base', false)}
      </details>
      <div class="conflict-merge-grid is-${this.layout}">
        ${this.sourcePane(t('conflicts.incoming'), this.current.incoming, 'incoming')}
        ${this.sourcePane(t('conflicts.current'), this.current.current, 'current')}
        <section class="conflict-pane conflict-result-pane">
          <div class="conflict-pane-header result">${this.esc(t('conflicts.result'))}</div>
          <div class="conflict-result-editor">
            <pre class="conflict-result-gutter" aria-hidden="true"></pre>
            <textarea id="conflict-result-editor" spellcheck="false" aria-label="${this.esc(t('conflicts.result'))}">${this.esc(this.resultContent)}</textarea>
          </div>
        </section>
      </div>`;

    function fileOrEmpty(value) {
      return value || '';
    }
  }

  sourcePane(label, content, kind) {
    return `<section class="conflict-pane conflict-source-pane">
      <div class="conflict-pane-header ${kind}">${this.esc(label)}</div>
      ${this.codePane(content, kind, true)}
    </section>`;
  }

  codePane(content, kind, synchronized) {
    const lines = String(content || '').split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    return `<div class="conflict-code-scroll${synchronized ? ' is-synchronized' : ''}" data-pane="${kind}">
      <pre class="conflict-code-gutter" aria-hidden="true">${lines.map((_, index) => index + 1).join('\n')}</pre>
      <pre class="conflict-pane-content">${this.esc(content)}</pre>
    </div>`;
  }

  bindTextEditor() {
    if (this.current?.binary) return;
    document.getElementById('conflict-previous')?.addEventListener('click', () => {
      this.activeBlockIndex = Math.max(0, this.activeBlockIndex - 1);
      this.renderEditor();
    });
    document.getElementById('conflict-next')?.addEventListener('click', () => {
      this.activeBlockIndex = Math.min(this.blocks.length - 1, this.activeBlockIndex + 1);
      this.renderEditor();
    });
    document.querySelectorAll('[data-choice]').forEach(button => {
      button.onclick = () => this.applyBlockChoice(button.dataset.choice);
    });

    const textarea = document.getElementById('conflict-result-editor');
    const gutter = document.querySelector('.conflict-result-gutter');
    if (textarea && gutter) {
      this.refreshResultGutter(textarea, gutter);
      const active = this.blocks[this.activeBlockIndex];
      if (active && !this.manualEdited) {
        textarea.setSelectionRange(active.startOffset, active.endOffset);
      }
      textarea.addEventListener('input', () => {
        this.resultContent = textarea.value;
        this.dirty = true;
        this.manualEdited = true;
        this.refreshResultGutter(textarea, gutter);
        this.updateMarkButton();
      });
      textarea.addEventListener('scroll', () => {
        gutter.scrollTop = textarea.scrollTop;
      }, { passive: true });
    }

    const synchronized = [...document.querySelectorAll('.conflict-code-scroll.is-synchronized')];
    synchronized.forEach(source => {
      source.addEventListener('scroll', () => {
        if (this.syncFrame) return;
        this.syncFrame = requestAnimationFrame(() => {
          this.syncFrame = null;
          const maximum = Math.max(1, source.scrollHeight - source.clientHeight);
          const ratio = source.scrollTop / maximum;
          synchronized.forEach(target => {
            if (target !== source) {
              target.scrollTop = ratio * Math.max(0, target.scrollHeight - target.clientHeight);
              target.scrollLeft = source.scrollLeft;
            }
          });
        });
      }, { passive: true });
    });
  }

  applyBlockChoice(choice) {
    const block = this.blocks[this.activeBlockIndex];
    if (!block) return;
    if (choice === 'ignore') {
      this.activeBlockIndex = Math.min(this.blocks.length - 1, this.activeBlockIndex + 1);
      this.renderEditor();
      return;
    }
    const eol = this.current.eol === 'crlf' ? '\r\n' : '\n';
    let replacement;
    if (choice === 'current') replacement = block.current;
    else if (choice === 'incoming') replacement = block.incoming;
    else if (choice === 'smart') replacement = block.smartCombination;
    else replacement = `${block.current}${block.current.endsWith(eol) || !block.current ? '' : eol}${block.incoming}`;
    if (replacement === null || replacement === undefined) return;

    const removedLength = block.endOffset - block.startOffset;
    this.resultContent =
      this.resultContent.slice(0, block.startOffset) +
      replacement +
      this.resultContent.slice(block.endOffset);
    const delta = replacement.length - removedLength;
    this.blocks.splice(this.activeBlockIndex, 1);
    for (let index = this.activeBlockIndex; index < this.blocks.length; index += 1) {
      this.blocks[index].startOffset += delta;
      this.blocks[index].endOffset += delta;
    }
    this.activeBlockIndex = Math.min(this.activeBlockIndex, Math.max(0, this.blocks.length - 1));
    this.dirty = true;
    this.renderEditor();
  }

  refreshResultGutter(textarea, gutter) {
    const count = Math.max(1, textarea.value.split(/\r?\n/).length);
    gutter.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
  }

  canMarkResolved() {
    if (!this.current) return false;
    if (this.current.binary) return Boolean(this.pendingBinaryStrategy);
    return (this.blocks.length === 0 || this.manualEdited) && !this.hasConflictMarkers();
  }

  hasConflictMarkers() {
    return /^(?:<<<<<<<|>>>>>>>)(?:\s|$)/m.test(this.resultContent);
  }

  updateMarkButton() {
    const button = document.getElementById('conflict-mark-resolved');
    if (button) button.disabled = !this.canMarkResolved();
  }

  async markResolved() {
    if (!this.canMarkResolved()) {
      this.app.showToast(t('conflicts.unresolvedWarning'), 'warning');
      return;
    }
    if (!await this.confirm(t('conflicts.markResolved'), t('conflicts.markResolvedConfirm'))) return;
    const strategy = this.current.binary ? this.pendingBinaryStrategy : 'manual';
    await this.resolve(strategy, this.resultContent);
  }

  async resolve(strategy, content = '') {
    const repo = this.app.state.repo;
    if (!repo || !this.currentPath) return;
    const result = await window.gitTree.resolveConflict(repo.path, this.currentPath, {
      strategy,
      snapshotId: this.current.snapshotId,
      ...(strategy === 'manual' ? { content } : {})
    });
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      if (/changed externally/i.test(result.error)) await this.loadFile(this.currentPath);
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

  async skip() {
    if (!await this.confirm(t('conflicts.skipTitle'), t('conflicts.skipConfirm'))) return;
    const repo = this.app.state.repo;
    const result = await window.gitTree.skipOperation(repo.path);
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      return;
    }
    if (result.state?.type) {
      await this.open(result.state);
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
