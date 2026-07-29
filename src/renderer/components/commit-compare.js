class CommitCompare {
  constructor(app) {
    this.app = app;
    this.hashA = null;
    this.hashB = null;
    this.data = null;
    this.selectedFile = null;
    this.container = null;
  }

  async open(hashA, hashB) {
    this.hashA = hashA;
    this.hashB = hashB;
    this.selectedFile = null;
    const repo = this.app.state.repo;
    if (!repo) return;

    this.ensureContainer();
    this.showLoading();

    try {
      const comparison = await window.gitTree.compareCommits(repo.path, hashA, hashB);
      if (comparison?.error) throw new Error(comparison.error);
      this.data = comparison;
      this.render();
    } catch (e) {
      this.app.showToast('Error comparing commits: ' + e.message, 'error');
      this.hide();
    }
  }

  ensureContainer() {
    this.container = document.getElementById('merge-workspace-overlay');
  }

  showLoading() {
    this.container.classList.remove('is-hidden');
    this.container.innerHTML = `<div class="empty-state"><i class="ph ph-circle-notch"></i>${t('commitCompare.loading')}</div>`;
  }

  hide() {
    this.container.classList.add('is-hidden');
    this.container.innerHTML = '';
    this.data = null;
  }

  render() {
    if (!this.data) return;
    const files = this.data.files || [];

    this.container.innerHTML = `
      <div class="commit-compare">
        <div class="commit-compare-header">
          <div class="commit-compare-direction">
            <span class="badge badge-head">${this.esc(this.hashA.slice(0, 8))}</span>
            <i class="ph ph-arrow-right commit-compare-arrow"></i>
            <span class="badge badge-branch">${this.esc(this.hashB.slice(0, 8))}</span>
          </div>
          <div class="commit-compare-stat">
            <span class="commit-compare-stat-value">${files.length}</span>
            <span class="commit-compare-stat-label">${t('commitCompare.filesChanged')}</span>
          </div>
          <button class="btn btn-small commit-compare-close" id="commit-compare-close">
            <i class="ph ph-x"></i>${t('commitCompare.close')}
          </button>
        </div>
        <div class="commit-compare-body">
          <div class="commit-compare-files">
            ${files.length ? files.map((f, i) => this.fileRow(f, i)).join('') : `<div class="diff-placeholder"><i class="ph ph-check-circle"></i>${t('commitCompare.noDiff')}</div>`}
          </div>
          <div class="commit-compare-diff" id="commit-compare-diff">
            <div class="diff-placeholder"><i class="ph ph-cursor-click"></i>${t('commitCompare.selectFile')}</div>
          </div>
        </div>
      </div>
    `;
    this.container.classList.remove('is-hidden');

    document.getElementById('commit-compare-close').onclick = () => this.hide();
    this.container.querySelectorAll('.commit-compare-file-item').forEach(item => {
      item.onclick = () => this.selectFile(item.dataset.path, item);
    });
  }

  fileRow(file, index) {
    const statusClass = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'renamed' }[file.status] || 'modified';
    const statusLabel = { A: t('commitCompare.added'), M: t('commitCompare.modified'), D: t('commitCompare.deleted'), R: t('commitCompare.renamed'), C: t('commitCompare.renamed') }[file.status] || file.status;
    const displayName = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
    return `
      <div class="commit-compare-file-item" data-path="${this.esc(file.path)}" data-index="${index}">
        <span class="commit-compare-file-status ${statusClass}">${this.esc(file.status)}</span>
        <span class="commit-compare-file-name" title="${this.esc(displayName)}">${this.esc(file.path.split('/').pop())}</span>
        <span class="commit-compare-file-path">${this.esc(file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '')}</span>
      </div>
    `;
  }

  async selectFile(filePath, element) {
    this.container.querySelectorAll('.commit-compare-file-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');
    this.selectedFile = filePath;

    const diffEl = document.getElementById('commit-compare-diff');
    diffEl.innerHTML = `<div class="diff-placeholder"><i class="ph ph-circle-notch"></i>${t('common.loading')}</div>`;

    try {
      const repo = this.app.state.repo;
      const diff = await window.gitTree.getCommitFileDiff(repo.path, this.hashA, this.hashB, filePath);
      if (diff?.error) {
        diffEl.innerHTML = `<div class="diff-placeholder">${this.esc(diff.error)}</div>`;
        return;
      }
      this.renderDiff(diffEl, diff);
    } catch (e) {
      diffEl.innerHTML = `<div class="diff-placeholder">${this.esc(e.message)}</div>`;
    }
  }

  renderDiff(container, diff) {
    container.innerHTML = '';
    if (diff.binary) {
      container.innerHTML = `<div class="diff-placeholder"><i class="ph ph-file-lock"></i>Binary file</div>`;
      return;
    }
    if (!diff.hunks?.length) {
      container.innerHTML = `<div class="diff-placeholder"><i class="ph ph-check-circle"></i>${t('commitCompare.noDiff')}</div>`;
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'commit-compare-diff-content';
    const numberedHunks = diff.hunks.map(hunk => ({
      hunk,
      lines: DiffParser.numberHunk(hunk)
    }));
    const allLines = numberedHunks.flatMap(item => item.lines);
    wrapper.style.setProperty('--diff-gutter-digits', DiffParser.maxDigits(allLines));

    numberedHunks.forEach(({ hunk, lines }) => {
      const section = document.createElement('section');
      section.className = 'commit-compare-hunk';
      const header = document.createElement('div');
      header.className = 'commit-compare-hunk-header';
      const code = document.createElement('code');
      code.textContent = hunk.header;
      header.appendChild(code);
      section.appendChild(header);

      lines.forEach(line => {
        const row = document.createElement('div');
        row.className = `diff-line ${line.kind}`;
        const oldNum = document.createElement('span');
        oldNum.className = 'diff-line-num is-old';
        oldNum.textContent = Number.isInteger(line.oldLine) ? String(line.oldLine) : '';
        const newNum = document.createElement('span');
        newNum.className = 'diff-line-num is-new';
        newNum.textContent = Number.isInteger(line.newLine) ? String(line.newLine) : '';
        const content = document.createElement('span');
        content.className = 'diff-line-content';
        content.textContent = line.content;
        row.append(oldNum, newNum, content);
        section.appendChild(row);
      });
      wrapper.appendChild(section);
    });
    container.appendChild(wrapper);
  }

  esc(value) {
    const el = document.createElement('div');
    el.textContent = value ?? '';
    return el.innerHTML;
  }
}

window.CommitCompare = CommitCompare;
