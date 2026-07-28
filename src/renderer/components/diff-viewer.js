class DiffViewer {
  constructor(bodyEl, app) {
    this.body = bodyEl;
    this.app = app;
    const savedMode = localStorage.getItem('gittree.diff.mode');
    this.mode = ['unified', 'split'].includes(savedMode) ? savedMode : 'unified';
    this.modeBeforeExpanded = null;
    this.inspectorExpanded = false;
    this.currentDiff = null;

    document.getElementById('btn-diff-unified').onclick = () => this.setMode('unified');
    document.getElementById('btn-diff-split').onclick = () => this.setMode('split');
    this.syncModeButtons();
  }

  setMode(mode, options = {}) {
    if (!['unified', 'split'].includes(mode)) return;
    this.mode = mode;
    if (options.persist !== false) {
      localStorage.setItem('gittree.diff.mode', mode);
      if (this.inspectorExpanded) this.modeBeforeExpanded = null;
    }
    this.syncModeButtons();
    if (this.currentDiff) this.render(this.currentDiff);
  }

  syncModeButtons() {
    document.getElementById('btn-diff-unified').classList.toggle(
      'active',
      this.mode === 'unified'
    );
    document.getElementById('btn-diff-split').classList.toggle(
      'active',
      this.mode === 'split'
    );
  }

  setInspectorExpanded(expanded) {
    const nextExpanded = Boolean(expanded);
    if (nextExpanded === this.inspectorExpanded) return;
    this.inspectorExpanded = nextExpanded;
    if (nextExpanded) {
      this.modeBeforeExpanded = this.mode;
      this.setMode('split', { persist: false });
    } else if (this.modeBeforeExpanded) {
      const previousMode = this.modeBeforeExpanded;
      this.modeBeforeExpanded = null;
      this.setMode(previousMode, { persist: false });
    }
  }

  async showDiffForCommit(repoPath, hash) {
    const title = document.getElementById('detail-title');
    const compactTitle = t('details.changesIn', { hash: hash.substring(0, 7) });
    title.textContent = compactTitle;
    title.title = compactTitle;
    this.body.innerHTML = `<div class="diff-placeholder"><i class="ph ph-circle-notch"></i>${t('details.loading')}</div>`;
    try {
      const detail = await window.gitTree.getCommitDetail(repoPath, hash);
      if (detail?.error) { this.body.innerHTML = `<div class="diff-placeholder">${detail.error}</div>`; return; }
      this.currentDiff = detail.diff;
      this.render(detail.diff);

      if (detail.files?.length) {
        title.title = `${compactTitle} — ${detail.files.join(', ')}`;
      }
    } catch (e) {
      this.body.innerHTML = `<div class="diff-placeholder">${e.message}</div>`;
    }
  }

  render(diffText) {
    if (!diffText) {
      this.body.innerHTML = `<div class="diff-placeholder"><i class="ph ph-check-circle"></i>${t('details.noChanges')}</div>`;
      return;
    }
    if (this.mode === 'unified') this.renderUnified(diffText);
    else this.renderSplit(diffText);
  }

  renderUnified(diffText) {
    const lines = diffText.split('\n');
    const frag = document.createDocumentFragment();

    lines.forEach(line => {
      if (line.startsWith('diff --git')) {
        const hdr = document.createElement('div');
        hdr.className = 'diff-file-header';
        hdr.innerHTML = `<span class="diff-file-path">${this.esc(this.extractPath(line) || line)}</span>`;
        frag.appendChild(hdr);
        return;
      }
      if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') ||
          line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('similarity')) {
        const el = document.createElement('div');
        el.className = 'diff-line header';
        el.textContent = line;
        frag.appendChild(el);
        return;
      }

      const el = document.createElement('div');
      el.className = 'diff-line';
      if (line.startsWith('@@')) el.classList.add('hunk');
      else if (line.startsWith('+')) el.classList.add('add');
      else if (line.startsWith('-')) el.classList.add('del');
      else el.classList.add('context');

      const num = document.createElement('span');
      num.className = 'diff-line-num';
      el.appendChild(num);

      const content = document.createElement('span');
      content.className = 'diff-line-content';
      content.textContent = line;
      el.appendChild(content);

      frag.appendChild(el);
    });

    this.body.innerHTML = '';
    this.body.appendChild(frag);
  }

  renderSplit(diffText) {
    const wrapper = document.createElement('div');
    wrapper.className = 'diff-split';
    let columns = null;
    const ensureColumns = () => {
      if (columns) return columns;
      columns = document.createElement('div');
      columns.className = 'diff-split-columns';
      wrapper.appendChild(columns);
      return columns;
    };

    this.parseSplitRows(diffText).forEach(row => {
      if (row.type === 'full') {
        columns = null;
        const el = document.createElement('div');
        if (row.kind === 'file') {
          el.className = 'diff-file-header';
          el.innerHTML = `<span class="diff-file-path">${
            this.esc(this.extractPath(row.text) || row.text)
          }</span>`;
        } else {
          el.className = `diff-line ${row.kind}`;
          el.textContent = row.text;
        }
        wrapper.appendChild(el);
        return;
      }
      const target = ensureColumns();
      target.appendChild(this.splitLine(row.left.text, row.left.kind));
      target.appendChild(this.splitLine(row.right.text, row.right.kind));
    });

    this.body.innerHTML = '';
    this.body.appendChild(wrapper);
  }

  parseSplitRows(diffText) {
    const rows = [];
    let deletions = [];
    let additions = [];
    const flushChanges = () => {
      const length = Math.max(deletions.length, additions.length);
      for (let index = 0; index < length; index += 1) {
        rows.push({
          type: 'pair',
          left: {
            text: deletions[index] || '',
            kind: deletions[index] ? 'del' : 'context'
          },
          right: {
            text: additions[index] || '',
            kind: additions[index] ? 'add' : 'context'
          }
        });
      }
      deletions = [];
      additions = [];
    };

    diffText.split('\n').forEach(line => {
      if (line.startsWith('diff --git')) {
        flushChanges();
        rows.push({ type: 'full', kind: 'file', text: line });
      } else if (
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ') ||
        line.startsWith('new file') ||
        line.startsWith('deleted file') ||
        line.startsWith('similarity')
      ) {
        flushChanges();
        rows.push({ type: 'full', kind: 'header', text: line });
      } else if (line.startsWith('@@')) {
        flushChanges();
        rows.push({ type: 'full', kind: 'hunk', text: line });
      } else if (line.startsWith('-')) {
        deletions.push(line);
      } else if (line.startsWith('+')) {
        additions.push(line);
      } else {
        flushChanges();
        rows.push({
          type: 'pair',
          left: { text: line, kind: 'context' },
          right: { text: line, kind: 'context' }
        });
      }
    });
    flushChanges();
    return rows;
  }

  splitLine(text, cls) {
    const el = document.createElement('div');
    el.className = `diff-line ${cls}`;
    const num = document.createElement('span');
    num.className = 'diff-line-num';
    el.appendChild(num);
    const content = document.createElement('span');
    content.className = 'diff-line-content';
    content.textContent = text;
    el.appendChild(content);
    return el;
  }

  extractPath(line) {
    const m = line.match(/diff --git a\/(.+) b\/(.+)/);
    return m ? m[2] : null;
  }

  esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  clear() {
    this.currentDiff = null;
    this.body.innerHTML = `<div class="diff-placeholder"><i class="ph ph-cursor-click"></i>${t('details.placeholder')}</div>`;
    const title = document.getElementById('detail-title');
    title.textContent = t('details.title');
    title.title = '';
  }
}
