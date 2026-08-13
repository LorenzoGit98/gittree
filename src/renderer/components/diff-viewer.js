/* exported DiffViewer */
class DiffViewer {
  constructor(bodyEl, app) {
    this.body = bodyEl;
    this.app = app;
    const savedMode = localStorage.getItem('gittree.diff.mode');
    this.mode = ['unified', 'split'].includes(savedMode) ? savedMode : 'unified';
    this.modeBeforeExpanded = null;
    this.inspectorExpanded = false;
    this.currentDiff = null;
    this.fileSummaries = [];
    this.selectedFilePath = null;

    const savedPad = localStorage.getItem('gittree.diff.gutterPad');
    if (savedPad) document.documentElement.style.setProperty('--diff-gutter-pad', savedPad + 'px');

    this.wordLevel = localStorage.getItem('gittree.diff.wordLevel') !== '0';

    document.getElementById('btn-diff-unified').onclick = () => this.setMode('unified');
    document.getElementById('btn-diff-split').onclick = () => this.setMode('split');
    document.getElementById('btn-diff-word').onclick = () => {
      this.wordLevel = !this.wordLevel;
      localStorage.setItem('gittree.diff.wordLevel', this.wordLevel ? '1' : '0');
      this.syncModeButtons();
      if (this.currentDiff) this.render(this.currentDiff);
      this.app.pushInspectorPayload?.();
    };
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
    this.app.pushInspectorPayload?.();
  }

  syncModeButtons() {
    const unifiedButton = document.getElementById('btn-diff-unified');
    const splitButton = document.getElementById('btn-diff-split');
    const wordButton = document.getElementById('btn-diff-word');
    unifiedButton.classList.toggle('active', this.mode === 'unified');
    unifiedButton.setAttribute('aria-pressed', String(this.mode === 'unified'));
    splitButton.classList.toggle('active', this.mode === 'split');
    splitButton.setAttribute('aria-pressed', String(this.mode === 'split'));
    wordButton?.classList.toggle('active', this.wordLevel);
    wordButton?.setAttribute('aria-pressed', String(this.wordLevel));
  }

  appendHighlightedLine(contentEl, text, counterpart) {
    if (!this.wordLevel || !text || !counterpart || text === counterpart) {
      contentEl.textContent = text;
      return;
    }
    let prefix = 0;
    const max = Math.min(text.length, counterpart.length);
    while (prefix < max && text[prefix] === counterpart[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < text.length - prefix &&
      suffix < counterpart.length - prefix &&
      text[text.length - 1 - suffix] === counterpart[counterpart.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    const midStart = prefix;
    const midEnd = text.length - suffix;
    if (midStart >= midEnd) {
      contentEl.textContent = text;
      return;
    }
    contentEl.append(document.createTextNode(text.slice(0, midStart)));
    const mark = document.createElement('span');
    mark.className = 'diff-word';
    mark.textContent = text.slice(midStart, midEnd);
    contentEl.append(mark, document.createTextNode(text.slice(midEnd)));
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
    this.activeRepoPath = repoPath;
    this.activeHash = hash;
    const title = document.getElementById('detail-title');
    const compactTitle = t('details.changesIn', { hash: hash.substring(0, 7) });
    title.textContent = compactTitle;
    title.title = compactTitle;
    this.currentDiff = null;
    this.fileSummaries = [];
    this.selectedFilePath = null;
    this.syncCommitMeta({ hash });
    this.body.innerHTML = `<div class="diff-placeholder"><i class="ph ph-circle-notch"></i>${t('details.loading')}</div>`;
    this.app.syncInspectorWorkspace?.({ push: false });
    try {
      const detail = await window.gitTree.getCommitDetail(repoPath, hash);
      if (detail?.error) { this.body.innerHTML = `<div class="diff-placeholder">${this.esc(detail.error)}</div>`; return; }
      this.currentDiff = detail.diff;
      this.fileSummaries = this.extractFileSummaries(detail.diff);
      const subject = String(detail.message || '').split(/\r?\n/)[0].trim();
      title.textContent = subject || compactTitle;
      title.title = detail.message || compactTitle;
      this.syncCommitMeta(detail);
      this.render(detail.diff);
    } catch (e) {
      this.body.innerHTML = `<div class="diff-placeholder">${this.esc(e.message)}</div>`;
    }
  }

  syncCommitMeta(detail = null) {
    const meta = document.getElementById('detail-meta');
    if (!meta) return;
    const hash = detail?.hash || '';
    document.getElementById('detail-hash').textContent = hash ? hash.slice(0, 7) : '';
    document.getElementById('detail-author').textContent = detail?.author_name || '';
    document.getElementById('detail-date').textContent = detail?.date
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        .format(new Date(detail.date))
      : '';
    const count = typeof detail?.diff === 'string'
      ? (detail.diff.match(/^diff --git /gm) || []).length
      : 0;
    document.getElementById('detail-files').textContent = count
      ? t('details.files', { count })
      : '';
    meta.classList.toggle('is-hidden', !hash);
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
    let lastRemoval = null;
    let target = frag;
    let fileIndex = 0;

    lines.forEach(line => {
      if (line.kind === 'file') {
        const block = document.createElement('section');
        block.className = 'diff-file-block';
        block.style.setProperty('--file-index', String(fileIndex++));
        const hdr = this.createFileHeader(block, line.content);
        block.appendChild(hdr);
        frag.appendChild(block);
        target = block;
        return;
      }

      const el = document.createElement('div');
      el.className = `diff-line ${line.kind === 'no-newline' ? 'header' : line.kind}`;
      el.appendChild(this.lineNumber(line.oldLine, 'old'));
      el.appendChild(this.lineNumber(line.newLine, 'new'));

      const content = document.createElement('span');
      content.className = 'diff-line-content';
      if (line.kind === 'add') {
        this.appendHighlightedLine(content, line.content, lastRemoval);
        lastRemoval = null;
      } else {
        content.textContent = line.content;
        lastRemoval = line.kind === 'del' ? line.content : null;
      }
      el.appendChild(content);

      target.appendChild(el);
    });

    this.body.innerHTML = '';
    this.body.appendChild(frag);
  }

  renderSplit(diffText) {
    const wrapper = document.createElement('div');
    wrapper.className = 'diff-split';
    let columns = null;
    let target = wrapper;
    let fileIndex = 0;
    const ensureColumns = () => {
      if (columns) return columns;
      columns = document.createElement('div');
      columns.className = 'diff-split-columns';
      target.appendChild(columns);
      return columns;
    };

    const parsedRows = this.parseSplitRows(diffText);
    this.body.style.setProperty('--diff-gutter-digits', DiffParser.maxDigits(parsedRows));
    parsedRows.forEach(row => {
      if (row.type === 'full') {
        columns = null;
        const el = document.createElement('div');
        if (row.kind === 'file') {
          const block = document.createElement('section');
          block.className = 'diff-file-block';
          block.style.setProperty('--file-index', String(fileIndex++));
          const header = this.createFileHeader(block, row.content);
          block.appendChild(header);
          wrapper.appendChild(block);
          target = block;
          return;
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
        target.appendChild(el);
        return;
      }
      const columnTarget = ensureColumns();
      columnTarget.appendChild(this.splitLine(row.left, 'old', row.right?.content));
      columnTarget.appendChild(this.splitLine(row.right, 'new', row.left?.content));
    });

    this.body.innerHTML = '';
    this.body.appendChild(wrapper);
  }

  parseSplitRows(diffText) {
    return DiffParser.parseSplit(diffText);
  }

  splitLine(line, side, counterpart) {
    const el = document.createElement('div');
    el.className = `diff-line ${line.kind}`;
    el.appendChild(this.lineNumber(side === 'old' ? line.oldLine : line.newLine, side));
    const content = document.createElement('span');
    content.className = 'diff-line-content';
    if ((line.kind === 'add' || line.kind === 'del') && counterpart) {
      this.appendHighlightedLine(content, line.content, counterpart);
    } else {
      content.textContent = line.content;
    }
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

  createFileHeader(block, content) {
    const path = this.extractPath(content) || content;
    block.dataset.filePath = path;
    const header = document.createElement('div');
    header.className = 'diff-file-header';
    const label = document.createElement('span');
    label.className = 'diff-file-path';
    label.textContent = path;
    header.appendChild(label);
    if (this.activeRepoPath && this.activeHash) {
      const blameButton = document.createElement('button');
      blameButton.type = 'button';
      blameButton.className = 'diff-file-blame';
      blameButton.title = t('details.aiBlame');
      blameButton.setAttribute('aria-label', t('details.aiBlame'));
      const icon = document.createElement('i');
      icon.className = 'ph ph-sparkle';
      icon.setAttribute('aria-hidden', 'true');
      blameButton.appendChild(icon);
      blameButton.onclick = event => {
        event.stopPropagation();
        this.openBlameDialog(path);
      };
      header.appendChild(blameButton);
    }
    return header;
  }

  async openBlameDialog(filePath) {
    const repoPath = this.activeRepoPath;
    const hash = this.activeHash;
    if (!repoPath || !hash) return;
    const overlay = document.getElementById('modal-overlay');
    const dialog = document.getElementById('modal-dialog');
    dialog.className = 'confirm-dialog ai-blame-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `
      <div class="ai-explain-loading">
        <i class="ph ph-circle-notch" aria-hidden="true"></i>
        <span>${this.esc(t('details.aiExplaining'))}</span>
      </div>`;
    overlay.classList.remove('is-hidden');
    const language = await this.aiLanguage().catch(() => 'en');
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeydown);
        overlay.classList.add('is-hidden');
        dialog.className = 'confirm-dialog';
        dialog.removeAttribute('role');
        dialog.removeAttribute('aria-modal');
        dialog.innerHTML = '';
        resolve(value);
      };
      const onKeydown = event => {
        if (event.key === 'Escape') finish(null);
      };
      document.addEventListener('keydown', onKeydown);
      Promise.allSettled([
        window.gitTree.getBlame(repoPath, filePath, hash),
        window.gitTree.explainLines(repoPath, { file: filePath, hash, language })
      ]).then(([blameResult, explainResult]) => {
        if (settled) return;
        const blame = blameResult.status === 'fulfilled' && !blameResult.value?.error
          ? (blameResult.value?.rows || []).slice(0, 30)
          : [];
        const explanation = explainResult.status === 'fulfilled' ? explainResult.value : null;
        if (explanation?.error) {
          finish(null);
          this.app.showToast(explanation.error, 'error');
          return;
        }
        if (!explanation) {
          finish(null);
          this.app.showToast(t('common.error'), 'error');
          return;
        }
        const rows = blame.map(row => `
          <div class="ai-blame-row">
            <code>${this.esc(String(row.hash || '').slice(0, 7))}</code>
            <span class="ai-blame-author">${this.esc(row.author || '')}</span>
            <span class="ai-blame-summary">${this.esc(row.summary || '')}</span>
          </div>`).join('');
        dialog.innerHTML = `
          <div class="ai-explain-result">
            <span class="eyebrow">${this.esc(filePath)} · ${this.esc(hash.slice(0, 7))}</span>
            <h3>${this.esc(explanation.summary || '')}</h3>
            <div class="ai-explain-body">${this.esc(explanation.body || '')}</div>
            ${rows ? `<div class="ai-blame-list">${rows}</div>` : ''}
            <div class="confirm-actions">
              <button class="btn btn-primary" type="button" data-close>${this.esc(t('common.cancel'))}</button>
            </div>
          </div>`;
        dialog.querySelector('[data-close]').onclick = () => finish(null);
      });
    });
  }

  async aiLanguage() {
    const settings = await window.gitTree.getAiSettings().catch(() => null);
    if (settings?.language === 'en' || settings?.language === 'it') {
      return settings.language;
    }
    const current = localStorage.getItem('gittree.language') || 'en';
    return current.startsWith('it') ? 'it' : 'en';
  }

  extractFileSummaries(diffText) {
    const summaries = [];
    let current = null;
    const finish = () => {
      if (current?.path) summaries.push(current);
      current = null;
    };

    for (const line of DiffParser.parseUnified(diffText || '')) {
      if (line.kind === 'file') {
        finish();
        current = {
          path: this.extractPath(line.content) || line.content,
          oldPath: null,
          status: 'M',
          additions: 0,
          deletions: 0
        };
        continue;
      }
      if (!current) continue;
      if (line.kind === 'add') current.additions += 1;
      else if (line.kind === 'del') current.deletions += 1;
      else if (line.kind === 'header') {
        if (line.content.startsWith('new file mode ')) current.status = 'A';
        else if (line.content.startsWith('deleted file mode ')) current.status = 'D';
        else if (line.content.startsWith('rename from ')) {
          current.status = 'R';
          current.oldPath = line.content.slice('rename from '.length);
        } else if (line.content.startsWith('rename to ')) {
          current.status = 'R';
          current.path = line.content.slice('rename to '.length);
        }
      }
    }
    finish();
    return summaries;
  }

  scrollToFile(path) {
    const blocks = [...this.body.querySelectorAll('.diff-file-block')];
    const block = blocks.find(element => element.dataset.filePath === path);
    if (!block) return false;
    this.selectedFilePath = path;
    this.app.components?.inspectorWorkspace?.setSelectedFile(path);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    block.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    block.classList.add('is-file-target');
    window.setTimeout(() => block.classList.remove('is-file-target'), 1000);
    return true;
  }

  esc(value) { return HtmlEncoder.encode(value); }

  clear() {
    this.currentDiff = null;
    this.fileSummaries = [];
    this.selectedFilePath = null;
    this.activeRepoPath = null;
    this.activeHash = null;
    this.body.innerHTML = `<div class="diff-placeholder"><i class="ph ph-cursor-click"></i>${t('details.placeholder')}</div>`;
    const title = document.getElementById('detail-title');
    title.textContent = t('details.title');
    title.title = '';
    this.syncCommitMeta();
    this.app.syncInspectorWorkspace?.();
  }
}

if (typeof module !== 'undefined') module.exports = DiffViewer;
