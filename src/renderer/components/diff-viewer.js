class DiffViewer {
  constructor(bodyEl, app) {
    this.body = bodyEl;
    this.app = app;
    this.mode = 'unified';
    this.currentDiff = null;

    document.getElementById('btn-diff-unified').onclick = () => this.setMode('unified');
    document.getElementById('btn-diff-split').onclick = () => this.setMode('split');
  }

  setMode(mode) {
    this.mode = mode;
    document.getElementById('btn-diff-unified').classList.toggle('active', mode === 'unified');
    document.getElementById('btn-diff-split').classList.toggle('active', mode === 'split');
    if (this.currentDiff) this.render(this.currentDiff);
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
    const left = document.createElement('div');
    left.className = 'diff-split-pane';
    const right = document.createElement('div');
    right.className = 'diff-split-pane';

    const lines = diffText.split('\n');
    lines.forEach(line => {
      if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') ||
          line.startsWith('+++ ') || line.startsWith('new file') || line.startsWith('deleted file')) {
        const el = document.createElement('div');
        el.className = 'diff-line header';
        el.textContent = line;
        wrapper.appendChild(el);
        return;
      }
      if (line.startsWith('@@')) {
        const el = document.createElement('div');
        el.className = 'diff-line hunk';
        el.textContent = line;
        wrapper.appendChild(el);
        return;
      }

      if (line.startsWith('-')) {
        left.appendChild(this.splitLine(line, 'del'));
        right.appendChild(this.splitLine('', 'context'));
      } else if (line.startsWith('+')) {
        left.appendChild(this.splitLine('', 'context'));
        right.appendChild(this.splitLine(line, 'add'));
      } else {
        left.appendChild(this.splitLine(line, 'context'));
        right.appendChild(this.splitLine(line, 'context'));
      }
    });

    wrapper.appendChild(left);
    wrapper.appendChild(right);
    this.body.innerHTML = '';
    this.body.appendChild(wrapper);
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
