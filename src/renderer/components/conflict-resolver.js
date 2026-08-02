/* exported ConflictResolver */
/* eslint-disable-next-line no-unused-vars -- script-tag global consumed by app.js */
class ConflictResolver {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('merge-workspace-overlay');
    this.state = null;
    this.allFiles = [];
    this.currentPath = null;
    this.current = null;
    this.resultContent = '';
    this.blocks = [];
    this.activeBlockIndex = 0;
    this.pendingBinaryStrategy = null;
    this.dirty = false;
    this.manualEdited = false;
    this.undoStack = [];
    this.blockCounts = new Map();
    this.binaryMap = new Map();
    this.fileFilter = '';
    this.reparseTimer = null;
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
    const conflicts = this.state.conflicts || [];
    this.allFiles = [...conflicts];
    this.blockCounts = new Map(conflicts.map(file => [file, null]));
    this.binaryMap = new Map();
    this.currentPath = conflicts[0] || null;
    this.current = null;
    this.dirty = false;
    this.undoStack = [];
    this.fileFilter = '';
    this.render();
    this.container.classList.remove('is-hidden');
    if (this.currentPath) await this.loadFile(this.currentPath);
  }

  remainingFiles() {
    return (this.state?.conflicts || []).filter(file => this.allFiles.includes(file));
  }

  unresolvedCount() {
    const remaining = this.remainingFiles();
    const known = remaining
      .map(file => this.blockCounts.get(file))
      .filter(count => Number.isInteger(count));
    return known.length === remaining.length ? known.reduce((sum, count) => sum + count, 0) : null;
  }

  render() {
    const conflicts = this.remainingFiles();
    const resolved = this.allFiles.length - conflicts.length;
    const total = this.allFiles.length;
    const conflictsSum = this.unresolvedCount();
    this.container.innerHTML = `
      <div class="conflict-workspace">
        <header class="conflict-header">
          <div class="conflict-header-title">
            <span class="eyebrow">${this.esc(t('conflicts.operation', { operation: this.state.type }))}</span>
            <h2>${this.esc(t('conflicts.title'))}</h2>
            <span class="conflict-progress">${this.esc(t('conflicts.filesResolved', { resolved, total }))}</span>
          </div>
          <div class="conflict-header-actions">
            ${conflictsSum !== null && conflictsSum > 0
              ? `<span class="badge badge-conflict">${this.esc(t('conflicts.blockCountTotal', { count: conflictsSum }))}</span>`
              : ''}
            <span class="badge ${conflicts.length ? 'badge-conflict' : 'badge-head'}">${conflicts.length} ${this.esc(t('conflicts.remaining'))}</span>
            <button class="btn" id="conflict-abort"><i class="ph ph-x-circle" aria-hidden="true"></i><span>${this.esc(t('conflicts.abort'))}</span></button>
            ${['rebase', 'cherry-pick'].includes(this.state.type) ? `
              <button class="btn" id="conflict-skip"><i class="ph ph-skip-forward" aria-hidden="true"></i><span>${this.esc(t('conflicts.skip'))}</span></button>
            ` : ''}
            <button class="btn btn-primary" id="conflict-continue" ${conflicts.length ? 'disabled' : ''}>
              <i class="ph ph-arrow-right" aria-hidden="true"></i><span>${this.esc(t('common.continue'))}</span>
            </button>
          </div>
        </header>
        <div class="conflict-body">
          <aside class="conflict-file-list" aria-label="${this.esc(t('conflicts.files'))}">
            <div class="conflict-file-search search-clearable">
              <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
              <input type="text" id="conflict-file-filter" class="conflict-file-filter-input" placeholder="${this.esc(t('conflicts.filterFiles'))}" data-i18n-placeholder="conflicts.filterFiles">
              <button type="button" class="search-clear-btn is-hidden" id="conflict-file-filter-clear" aria-label="${this.esc(t('common.clearSearch'))}" data-i18n-aria-label="common.clearSearch">
                <i class="ph ph-x" aria-hidden="true"></i>
              </button>
            </div>
            <div class="conflict-file-scroll" id="conflict-file-scroll">
              ${this.renderFileList()}
            </div>
          </aside>
          <main class="conflict-editor" id="conflict-editor">
            <div class="empty-state">${this.esc(conflicts.length ? t('common.loading') : t('conflicts.readyContinue'))}</div>
          </main>
        </div>
      </div>`;

    document.getElementById('conflict-abort').onclick = () => this.abort();
    document.getElementById('conflict-skip')?.addEventListener('click', () => this.skip());
    document.getElementById('conflict-continue').onclick = () => this.continue();
    const filterInput = document.getElementById('conflict-file-filter');
    if (filterInput) {
      filterInput.value = this.fileFilter;
      filterInput.oninput = () => {
        this.fileFilter = filterInput.value;
        const clearButton = document.getElementById('conflict-file-filter-clear');
        if (clearButton) clearButton.classList.toggle('is-hidden', !this.fileFilter);
        this.refreshFileList();
      };
      filterInput.onkeydown = event => {
        if (event.key === 'Escape') {
          filterInput.value = '';
          this.fileFilter = '';
          document.getElementById('conflict-file-filter-clear')?.classList.add('is-hidden');
          this.refreshFileList();
        }
      };
      document.getElementById('conflict-file-filter-clear').onclick = () => {
        filterInput.value = '';
        this.fileFilter = '';
        document.getElementById('conflict-file-filter-clear').classList.add('is-hidden');
        this.refreshFileList();
      };
    }
    this.bindGlobalKeys();
  }

  renderFileList() {
    const needle = this.fileFilter.trim().toLowerCase();
    const remaining = this.remainingFiles();
    const rows = this.allFiles
      .filter(file => !needle || file.toLowerCase().includes(needle))
      .map(file => {
        const isResolved = !remaining.includes(file);
        const isActive = file === this.currentPath;
        const blockCount = this.blockCounts.get(file);
        const binary = this.binaryMap.get(file);
        const showCount = !isResolved && Number.isInteger(blockCount) && blockCount > 0;
        return `
          <button class="conflict-file-item${isActive ? ' active' : ''}${isResolved ? ' is-resolved' : ''}"
            data-file="${this.esc(file)}" ${isResolved ? 'disabled' : ''} title="${this.esc(file)}">
            <i class="ph ${isResolved ? 'ph-check-circle' : 'ph-warning-circle'} conflict-file-status" aria-hidden="true"></i>
            <span class="conflict-file-name">${this.esc(file)}</span>
            ${this.dirty && file === this.currentPath ? `<i class="ph ph-dot-outline conflict-file-unsaved" aria-hidden="true" title="${this.esc(t('conflicts.unsaved'))}"></i>` : ''}
            ${showCount ? `<span class="badge badge-conflict conflict-file-count" title="${this.esc(t('conflicts.blockCountTitle', { count: blockCount }))}">${blockCount}</span>` : ''}
            ${binary ? `<span class="badge conflict-file-binary">${this.esc(t('conflicts.binary'))}</span>` : ''}
          </button>`;
      });
    return rows.length
      ? rows.join('')
      : `<div class="conflict-file-empty">${this.esc(t('conflicts.noFilesMatch'))}</div>`;
  }

  refreshFileList() {
    const scroll = document.getElementById('conflict-file-scroll');
    if (!scroll) return;
    scroll.innerHTML = this.renderFileList();
    scroll.querySelectorAll('[data-file]').forEach(button => {
      button.onclick = async () => {
        if (!await this.confirmDiscard()) return;
        await this.loadFile(button.dataset.file);
      };
    });
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
    this.undoStack = [];
    this.blockCounts.set(filePath, this.blocks.length);
    if (this.current.binary) this.binaryMap.set(filePath, true);
    this.refreshFileList();
    this.renderEditor();
  }

  renderEditor() {
    if (!this.current) return;
    const editor = document.getElementById('conflict-editor');
    if (!editor) return;
    const file = this.current;
    const blockCount = this.blocks.length;
    editor.innerHTML = `
      <div class="conflict-editor-toolbar">
        <div class="conflict-current-file">
          <strong>${this.esc(file.path)}</strong>
          ${file.binary ? `<span class="badge">${this.esc(t('conflicts.binary'))}</span>` : ''}
          ${!file.binary && blockCount > 0 ? `<span class="badge badge-conflict">${this.esc(t('conflicts.blockCountTitle', { count: blockCount }))}</span>` : ''}
        </div>
        <div class="conflict-toolbar-actions">
          ${file.binary ? `
            <button class="btn" data-binary="ours">${this.esc(t('conflicts.acceptCurrent'))}</button>
            <button class="btn" data-binary="theirs">${this.esc(t('conflicts.acceptIncoming'))}</button>
          ` : `
            <div class="conflict-resolve-all">
              <button class="btn" id="conflict-resolve-all">${this.esc(t('conflicts.resolveAll'))}<i class="ph ph-caret-down" aria-hidden="true"></i></button>
              <div class="conflict-resolve-all-menu is-hidden">
                <button class="conflict-resolve-all-item" data-all="current">${this.esc(t('conflicts.resolveAllCurrent'))}</button>
                <button class="conflict-resolve-all-item" data-all="incoming">${this.esc(t('conflicts.resolveAllIncoming'))}</button>
                <button class="conflict-resolve-all-item" data-all="both">${this.esc(t('conflicts.resolveAllBoth'))}</button>
              </div>
            </div>
            <button class="btn" data-whole="current" title="${this.esc(t('conflicts.useCurrentFile'))}">${this.esc(t('conflicts.useCurrentFile'))}</button>
            <button class="btn" data-whole="incoming" title="${this.esc(t('conflicts.useIncomingFile'))}">${this.esc(t('conflicts.useIncomingFile'))}</button>
            <button class="btn" id="conflict-layout">
              <i class="ph ph-layout" aria-hidden="true"></i>${this.esc(
                this.layout === 'horizontal' ? t('conflicts.verticalLayout') : t('conflicts.horizontalLayout')
              )}
            </button>
            <button class="btn" id="conflict-undo" disabled title="${this.esc(t('conflicts.undo'))}">
              <i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i>${this.esc(t('conflicts.undo'))}
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
      button.onclick = () => this.useWholeFile(button.dataset.whole);
    });
    const resolveAllButton = document.getElementById('conflict-resolve-all');
    if (resolveAllButton) {
      resolveAllButton.onclick = event => {
        event.stopPropagation();
        const menu = document.querySelector('.conflict-resolve-all-menu');
        menu?.classList.toggle('is-hidden');
      };
      editor.querySelectorAll('.conflict-resolve-all-item').forEach(item => {
        item.onclick = () => {
          document.querySelector('.conflict-resolve-all-menu')?.classList.add('is-hidden');
          this.applyToAll(item.dataset.all);
        };
      });
      if (this.closeResolveAllMenu) {
        document.removeEventListener('click', this.closeResolveAllMenu);
      }
      document.addEventListener('click', this.closeResolveAllMenu = event => {
        if (!event.target.closest('.conflict-resolve-all')) {
          document.querySelector('.conflict-resolve-all-menu')?.classList.add('is-hidden');
        }
      });
    }
    document.getElementById('conflict-layout')?.addEventListener('click', () => {
      this.layout = this.layout === 'horizontal' ? 'vertical' : 'horizontal';
      localStorage.setItem('gittree.mergeEditor.layout', this.layout);
      this.renderEditor();
    });
    document.getElementById('conflict-undo')?.addEventListener('click', () => this.undo());
    document.getElementById('conflict-mark-resolved')?.addEventListener('click', () => this.markResolved());
    const resultEditor = document.getElementById('conflict-result-editor');
    if (resultEditor) resultEditor.value = this.resultContent;
    this.bindTextEditor();
  }

  renderBinaryState() {
    return `
      <div class="conflict-binary-state">
        <i class="ph ph-file-lock" aria-hidden="true"></i>
        <h3>${this.esc(t('conflicts.binaryTitle'))}</h3>
        <p>${this.esc(t('conflicts.binaryHelp'))}</p>
        <p class="conflict-selection-note">${this.esc(
          this.pendingBinaryStrategy ? t('conflicts.selectionPending') : t('conflicts.chooseVersion')
        )}</p>
      </div>`;
  }

  renderTextEditor() {
    const active = this.blocks[this.activeBlockIndex] || null;
    const currentRanges = this.blocks.map(block => this.locateLines(this.current.current, block.current));
    const incomingRanges = this.blocks.map(block => this.locateLines(this.current.incoming, block.incoming));
    return `
      <div class="conflict-block-toolbar">
        <div class="conflict-navigation">
          <button class="icon-btn" id="conflict-previous" ${this.activeBlockIndex <= 0 ? 'disabled' : ''} aria-label="${this.esc(t('conflicts.previous'))}" title="${this.esc(t('conflicts.previous'))}">
            <i class="ph ph-arrow-up" aria-hidden="true"></i>
          </button>
          <button class="icon-btn" id="conflict-next" ${this.activeBlockIndex >= this.blocks.length - 1 ? 'disabled' : ''} aria-label="${this.esc(t('conflicts.next'))}" title="${this.esc(t('conflicts.next'))}">
            <i class="ph ph-arrow-down" aria-hidden="true"></i>
          </button>
          <strong>${this.esc(t('conflicts.blockCount', {
            current: this.blocks.length ? this.activeBlockIndex + 1 : 0,
            total: this.blocks.length
          }))}</strong>
        </div>
        ${active && !this.manualEdited ? `
          <div class="conflict-block-actions">
            <span class="conflict-keyhint">${this.esc(t('conflicts.acceptHint'))}</span>
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
        ${this.codePane(this.current.base, 'base', false, null, [])}
      </details>
      <div class="conflict-merge-grid is-${this.layout}">
        ${this.sourcePane(t('conflicts.incoming'), this.current.incoming, 'incoming', incomingRanges, this.activeBlockIndex)}
        ${this.sourcePane(t('conflicts.current'), this.current.current, 'current', currentRanges, this.activeBlockIndex)}
        <section class="conflict-pane conflict-result-pane">
          <div class="conflict-pane-header result">${this.esc(t('conflicts.result'))}</div>
          <div class="conflict-result-editor" id="conflict-result-stack">
            <pre class="conflict-result-gutter" aria-hidden="true"></pre>
            <div class="conflict-result-overlay">
              <pre class="conflict-highlight-layer" id="conflict-highlight-layer" aria-hidden="true"></pre>
              <div class="conflict-action-bar is-hidden" id="conflict-action-bar"></div>
              <textarea id="conflict-result-editor" spellcheck="false" aria-label="${this.esc(t('conflicts.result'))}"></textarea>
            </div>
          </div>
        </section>
      </div>`;
  }

  sourcePane(label, content, kind, blockRanges, activeIndex) {
    return `<section class="conflict-pane conflict-source-pane">
      <div class="conflict-pane-header ${kind}">${this.esc(label)}</div>
      ${this.codePane(content, kind, true, blockRanges?.[activeIndex] || null, blockRanges || [])}
    </section>`;
  }

  codePane(content, kind, synchronized, activeRange, blockRanges) {
    const lines = ConflictHighlight.splitLines(content).map(line => line.replace(/\r?\n|\r$/, ''));
    const active = activeRange
      ? new Set(rangeLines(activeRange.start, activeRange.end))
      : new Set();
    const blocks = blockRanges
      .map(range => range ? new Set(rangeLines(range.start, range.end)) : new Set());
    const dimmed = blockRanges.length > 0 && !activeRange;
    return `<div class="conflict-code-scroll${synchronized ? ' is-synchronized' : ''}" data-pane="${kind}">
      <pre class="conflict-code-gutter" aria-hidden="true">${lines.map((_, index) => index + 1).join('\n')}</pre>
      <div class="conflict-pane-rows${dimmed ? ' is-dimmed' : ''}">
        ${lines.map((text, index) => {
          const inActive = active.has(index + 1);
          const inBlock = blocks.some(set => set.has(index + 1));
          const css = inActive ? ' is-active' : (inBlock ? ' is-block' : '');
          return `<div class="conflict-pane-row${css}" data-pane-line="${index + 1}">${this.esc(text)}</div>`;
        }).join('')}
      </div>
    </div>`;
  }

  buildResultLayer() {
    const layer = document.getElementById('conflict-highlight-layer');
    if (!layer) return;
    const rows = ConflictHighlight.buildHighlightLines(this.resultContent, this.blocks);
    layer.innerHTML = rows.map(row => {
      const cls = row.kind === 'plain' ? '' : ` hl-${row.kind}`;
      const text = (row.kind === 'marker' || row.kind === 'separator') ? '' : row.text;
      return `<div class="conflict-hl-row${cls}">${text ? this.esc(text) : ' '}</div>`;
    }).join('');
    this.highlightRows = rows;

    const textarea = document.getElementById('conflict-result-editor');
    if (textarea) {
      this.refreshResultGutter(textarea, document.querySelector('.conflict-result-gutter'));
      this.syncHighlightScroll(textarea);
    }
    this.positionActionBar();
  }

  positionActionBar() {
    const bar = document.getElementById('conflict-action-bar');
    const stack = document.getElementById('conflict-result-stack');
    if (!bar || !stack) return;
    const block = this.blocks[this.activeBlockIndex];
    if (!block || this.current?.binary) {
      bar.classList.add('is-hidden');
      return;
    }
    const rowIndex = Math.max(0, block.startLine - 1);
    const lineHeight = 21;
    const paddingTop = 8;
    const top = paddingTop + rowIndex * lineHeight - (document.getElementById('conflict-result-editor')?.scrollTop || 0);
    stack.style.setProperty('--action-bar-top', `${top}px`);
    bar.innerHTML = `
      <span class="conflict-action-bar-label"><i class="ph ph-warning-circle" aria-hidden="true"></i>${this.esc(t('conflicts.blockCount', {
        current: this.activeBlockIndex + 1,
        total: this.blocks.length
      }))}</span>
      <button class="btn btn-small btn-primary" data-choice="current">${this.esc(t('conflicts.acceptCurrent'))}</button>
      <button class="btn btn-small" data-choice="incoming">${this.esc(t('conflicts.acceptIncoming'))}</button>
      <button class="btn btn-small" data-choice="both">${this.esc(t('conflicts.acceptBoth'))}</button>
      <button class="btn btn-small" data-choice="smart" ${block.smartCombination === null ? 'disabled' : ''}>${this.esc(t('conflicts.smartCombination'))}</button>
    `;
    bar.classList.remove('is-hidden');
    bar.querySelectorAll('[data-choice]').forEach(button => {
      button.onclick = () => this.applyBlockChoice(button.dataset.choice);
    });
  }

  syncHighlightScroll(textarea) {
    const layer = document.getElementById('conflict-highlight-layer');
    const gutter = document.querySelector('.conflict-result-gutter');
    const stack = document.getElementById('conflict-result-stack');
    const bar = document.getElementById('conflict-action-bar');
    if (layer) layer.scrollTop = textarea.scrollTop;
    if (gutter) gutter.scrollTop = textarea.scrollTop;
    if (stack) {
      stack.style.setProperty('--action-bar-top', `${8 + Math.max(0, (this.blocks[this.activeBlockIndex]?.startLine || 1) - 1) * 21 - textarea.scrollTop}px`);
    }
    if (bar) bar.classList.toggle('is-hidden', !this.blocks.length);
  }

  bindTextEditor() {
    if (this.current?.binary) return;
    document.getElementById('conflict-previous')?.addEventListener('click', () => this.jumpToBlock(this.activeBlockIndex - 1));
    document.getElementById('conflict-next')?.addEventListener('click', () => this.jumpToBlock(this.activeBlockIndex + 1));
    document.querySelectorAll('[data-choice]').forEach(button => {
      button.onclick = () => this.applyBlockChoice(button.dataset.choice);
    });

    this.bindResultEditor();
    this.bindSourcePanes();
  }

  bindResultEditor() {
    const textarea = document.getElementById('conflict-result-editor');
    if (!textarea) return;
    this.buildResultLayer();
    const active = this.blocks[this.activeBlockIndex];
    if (active && !this.manualEdited) {
      textarea.setSelectionRange(active.startOffset, active.endOffset);
    }
    textarea.addEventListener('input', () => {
      this.resultContent = textarea.value;
      this.dirty = true;
      this.manualEdited = true;
      this.refreshResultGutter(textarea, document.querySelector('.conflict-result-gutter'));
      this.updateMarkButton();
      this.scheduleReparse();
    });
    textarea.addEventListener('scroll', () => {
      this.syncHighlightScroll(textarea);
    }, { passive: true });
    textarea.addEventListener('keydown', event => this.handleEditorKeys(event));
  }

  handleEditorKeys(event) {
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      this.jumpToBlock(this.activeBlockIndex - 1);
      return;
    }
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      this.jumpToBlock(this.activeBlockIndex + 1);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.markResolved();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.undo();
    }
    if (!this.manualEdited && this.blocks[this.activeBlockIndex] && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const choice = { c: 'current', i: 'incoming', b: 'both' }[event.key.toLowerCase()];
      if (choice) {
        event.preventDefault();
        this.applyBlockChoice(choice);
      }
    }
  }

  bindSourcePanes() {
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
    const pane = document.querySelector('.conflict-code-scroll[data-pane="current"]') ||
      document.querySelector('.conflict-code-scroll[data-pane="incoming"]');
    if (pane) {
      pane.parentElement.querySelectorAll('.conflict-pane-row[data-pane-line]').forEach(row => {
        row.addEventListener('click', () => {
          const line = Number(row.dataset.paneLine);
          const ranges = pane.dataset.pane === 'current'
            ? this.blocks.map(block => this.locateLines(this.current.current, block.current))
            : this.blocks.map(block => this.locateLines(this.current.incoming, block.incoming));
          const index = ranges.findIndex(range => range && line >= range.start && line <= range.end);
          if (index !== -1) this.jumpToBlock(index);
        });
      });
    }
  }

  jumpToBlock(index) {
    if (index < 0 || index >= this.blocks.length) return;
    this.activeBlockIndex = index;
    this.renderEditor();
  }

  locateLines(content, needle) {
    if (!needle || needle === '') return null;
    const position = String(content || '').indexOf(needle);
    if (position === -1) return null;
    const before = String(content || '').slice(0, position);
    const start = before.split(/\r?\n|\r/).length;
    const lines = needle.split(/\r?\n|\r/).length;
    return { start, end: start + lines - 1 };
  }

  blockPaneRange(block) {
    return this.locateLines(this.current?.current || '', block.current);
  }

  scheduleReparse() {
    clearTimeout(this.reparseTimer);
    this.reparseTimer = setTimeout(async () => {
      const repo = this.app.state.repo;
      if (!repo || !this.currentPath || this.container.classList.contains('is-hidden')) return;
      const result = await window.gitTree.parseConflictBlocks(repo.path, this.resultContent);
      if (result?.error) return;
      this.blocks = (result || []).map(block => ({ ...block }));
      this.activeBlockIndex = Math.min(this.activeBlockIndex, Math.max(0, this.blocks.length - 1));
      this.blockCounts.set(this.currentPath, this.blocks.length);
      this.updateMarkButton();
      this.buildResultLayer();
      this.refreshFileList();
    }, 500);
  }

  useWholeFile(kind) {
    this.snapshot();
    this.resultContent = kind === 'current' ? this.current.current : this.current.incoming;
    this.blocks = [];
    this.activeBlockIndex = 0;
    this.manualEdited = false;
    this.dirty = true;
    this.blockCounts.set(this.currentPath, 0);
    this.renderEditor();
  }

  applyToAll(choice) {
    if (!this.blocks.length) return;
    this.snapshot();
    const eol = this.current.eol === 'crlf' ? '\r\n' : '\n';
    for (const block of [...this.blocks]) {
      let replacement;
      if (choice === 'current') replacement = block.current;
      else if (choice === 'incoming') replacement = block.incoming;
      else replacement = `${block.current}${block.current.endsWith(eol) || !block.current ? '' : eol}${block.incoming}`;
      if (replacement === null || replacement === undefined) continue;
      this.resultContent =
        this.resultContent.slice(0, block.startOffset) +
        replacement +
        this.resultContent.slice(block.endOffset);
      const delta = replacement.length - (block.endOffset - block.startOffset);
      for (const other of this.blocks) {
        if (other.startOffset > block.endOffset) {
          other.startOffset += delta;
          other.endOffset += delta;
        }
      }
    }
    this.blocks = [];
    this.activeBlockIndex = 0;
    this.dirty = true;
    this.blockCounts.set(this.currentPath, 0);
    this.renderEditor();
  }

  snapshot() {
    this.undoStack.push({
      content: this.resultContent,
      blocks: this.blocks.map(block => ({ ...block })),
      activeBlockIndex: this.activeBlockIndex
    });
    if (this.undoStack.length > 30) this.undoStack.shift();
    const undoButton = document.getElementById('conflict-undo');
    if (undoButton) undoButton.disabled = false;
  }

  undo() {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.resultContent = snapshot.content;
    this.blocks = snapshot.blocks;
    this.activeBlockIndex = Math.min(snapshot.activeBlockIndex, Math.max(0, this.blocks.length - 1));
    this.manualEdited = false;
    this.dirty = true;
    this.blockCounts.set(this.currentPath, this.blocks.length);
    const undoButton = document.getElementById('conflict-undo');
    if (undoButton) undoButton.disabled = this.undoStack.length === 0;
    this.renderEditor();
  }

  applyBlockChoice(choice) {
    const block = this.blocks[this.activeBlockIndex];
    if (!block) return;
    if (choice === 'ignore') {
      this.jumpToBlock(this.activeBlockIndex + 1);
      return;
    }
    this.snapshot();
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
    this.blockCounts.set(this.currentPath, this.blocks.length);
    this.renderEditor();
  }

  refreshResultGutter(textarea, gutter) {
    const count = Math.max(1, textarea.value.split(/\r?\n/).length);
    if (gutter) gutter.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
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
    const resolvedPath = this.currentPath;
    const nextConflicts = result.state?.conflicts || [];
    this.allFiles = [...new Set([...this.allFiles, ...nextConflicts])];
    for (const file of nextConflicts) {
      if (!this.blockCounts.has(file)) this.blockCounts.set(file, null);
    }
    this.blockCounts.set(resolvedPath, 0);
    this.state = result.state;
    this.currentPath = nextConflicts[0] || null;
    this.current = null;
    this.dirty = false;
    this.undoStack = [];
    const remaining = this.remainingFiles().length;
    if (remaining) {
      this.app.showToast(t('conflicts.fileResolvedToast', {
        file: resolvedPath.split(/[\\/]/).pop(),
        remaining
      }), 'success');
    } else {
      this.app.showToast(t('conflicts.allFilesResolved'), 'success');
    }
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

  bindGlobalKeys() {
    if (this.globalKeysHandler) {
      document.removeEventListener('keydown', this.globalKeysHandler);
    }
    this.globalKeysHandler = event => {
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const target = event.target;
        if (target === document.getElementById('conflict-result-editor')) return;
        event.preventDefault();
        const direction = event.key === 'ArrowUp' ? -1 : 1;
        this.jumpToBlock(this.activeBlockIndex + direction);
      }
      if (!event.altKey && !event.ctrlKey && !event.metaKey && !this.manualEdited) {
        const choice = { c: 'current', i: 'incoming', b: 'both' }[event.key.toLowerCase()];
        if (choice && !event.target.closest?.('textarea, input')) {
          event.preventDefault();
          this.applyBlockChoice(choice);
        }
      }
    };
    document.addEventListener('keydown', this.globalKeysHandler);
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
    clearTimeout(this.reparseTimer);
    if (this.globalKeysHandler) {
      document.removeEventListener('keydown', this.globalKeysHandler);
      this.globalKeysHandler = null;
    }
    if (this.closeResolveAllMenu) {
      document.removeEventListener('click', this.closeResolveAllMenu);
      this.closeResolveAllMenu = null;
    }
  }

  esc(value) {
    return HtmlEncoder.encode(value);
  }
}

function rangeLines(start, end) {
  const lines = [];
  for (let line = start; line <= end; line += 1) lines.push(line);
  return lines;
}
