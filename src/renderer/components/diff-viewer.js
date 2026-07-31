/* exported DiffViewer */
/* eslint-disable-next-line no-unused-vars -- script-tag global consumed by app.js */
class DiffViewer {
  constructor(bodyEl, app) {
    this.body = bodyEl;
    this.app = app;
    const savedMode = localStorage.getItem('gittree.diff.mode');
    this.mode = ['unified', 'split'].includes(savedMode) ? savedMode : 'unified';
    this.modeBeforeExpanded = null;
    this.inspectorExpanded = false;
    this.currentDiff = null;

    const savedPad = localStorage.getItem('gittree.diff.gutterPad');
    if (savedPad) document.documentElement.style.setProperty('--diff-gutter-pad', savedPad + 'px');

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
      if (detail?.error) { this.body.innerHTML = `<div class="diff-placeholder">${this.esc(detail.error)}</div>`; return; }
      this.currentDiff = detail.diff;
      this.render(detail.diff);

      if (detail.files?.length) {
        title.title = `${compactTitle} — ${detail.files.join(', ')}`;
      }
    } catch (e) {
      this.body.innerHTML = `<div class="diff-placeholder">${this.esc(e.message)}</div>`;
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
    const lines = DiffParser.parseUnified(diffText);
    const frag = document.createDocumentFragment();
    this.body.style.setProperty('--diff-gutter-digits', DiffParser.maxDigits(lines));

    lines.forEach(line => {
      if (line.kind === 'file') {
        const hdr = document.createElement('div');
        hdr.className = 'diff-file-header';
        hdr.innerHTML = `<span class="diff-file-path">${this.esc(this.extractPath(line.content) || line.content)}</span>`;
        frag.appendChild(hdr);
        return;
      }

      const el = document.createElement('div');
      el.className = `diff-line ${line.kind === 'no-newline' ? 'header' : line.kind}`;
      el.appendChild(this.lineNumber(line.oldLine, 'old'));
      el.appendChild(this.lineNumber(line.newLine, 'new'));

      const content = document.createElement('span');
      content.className = 'diff-line-content';
      content.textContent = line.content;
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

    const parsedRows = this.parseSplitRows(diffText);
    this.body.style.setProperty('--diff-gutter-digits', DiffParser.maxDigits(parsedRows));
    parsedRows.forEach(row => {
      if (row.type === 'full') {
        columns = null;
        const el = document.createElement('div');
        if (row.kind === 'file') {
          el.className = 'diff-file-header';
          el.innerHTML = `<span class="diff-file-path">${
            this.esc(this.extractPath(row.content) || row.content)
          }</span>`;
        } else {
          el.className = `diff-line ${row.kind}`;
          el.append(
            this.lineNumber(null, 'old'),
            this.lineNumber(null, 'new')
          );
          const content = document.createElement('span');
          content.className = 'diff-line-content';
          content.textContent = row.content;
          el.appendChild(content);
        }
        wrapper.appendChild(el);
        return;
      }
      const target = ensureColumns();
      target.appendChild(this.splitLine(row.left, 'old'));
      target.appendChild(this.splitLine(row.right, 'new'));
    });

    this.body.innerHTML = '';
    this.body.appendChild(wrapper);
  }

  parseSplitRows(diffText) {
    return DiffParser.parseSplit(diffText);
  }

  splitLine(line, side) {
    const el = document.createElement('div');
    el.className = `diff-line ${line.kind}`;
    el.appendChild(this.lineNumber(side === 'old' ? line.oldLine : line.newLine, side));
    const content = document.createElement('span');
    content.className = 'diff-line-content';
    content.textContent = line.content;
    el.appendChild(content);
    return el;
  }

  lineNumber(value, side) {
    const number = document.createElement('span');
    number.className = `diff-line-num is-${side}`;
    number.textContent = Number.isInteger(value) ? String(value) : '';
    return number;
  }

  extractPath(line) {
    const m = line.match(/diff --git a\/(.+) b\/(.+)/);
    return m ? m[2] : null;
  }

  esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  clear() {
    this.currentDiff = null;
    this.body.innerHTML = `<div class="diff-placeholder"><i class="ph ph-cursor-click"></i>${t('details.placeholder')}</div>`;
    const title = document.getElementById('detail-title');
    title.textContent = t('details.title');
    title.title = '';
  }
}
