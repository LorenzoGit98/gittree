class MergeWorkspace {
  constructor(app) {
    this.app = app;
    this.sourceBranch = null;
    this.targetBranch = null;
    this.mergeData = null;
    this.preview = null;
    this.container = null;
    this.strategy = 'noff';
  }

  async open(source, target) {
    this.sourceBranch = source;
    this.targetBranch = target;
    this.strategy = 'noff';
    const repo = this.app.state.repo;
    if (!repo) return;

    this.showLoading();

    try {
      const [comparison, logTgt, status, preview] = await Promise.all([
        window.gitTree.compareBranches(repo.path, target, source),
        window.gitTree.getLog(repo.path, 1, target),
        window.gitTree.getStatus(repo.path),
        window.gitTree.previewMerge(repo.path, source)
      ]);
      if (comparison?.error) throw new Error(comparison.error);

      this.mergeData = {
        source, target,
        commitsCount: comparison.commits?.length || 0,
        commits: comparison.commits || [],
        targetCommit: logTgt.latest,
        diff: comparison.diff || '',
        status: status || {}
      };
      this.preview = preview && !preview.error ? preview : null;

      this.renderMerge();
    } catch (e) {
      this.app.showToast('Error: ' + e.message, 'error');
      this.hide();
    }
  }

  showLoading() {
    this.ensureContainer();
    this.container.classList.remove('is-hidden');
    this.container.innerHTML = '<div class="empty-state">' + this.esc(t('common.loading')) + '</div>';
  }

  ensureContainer() {
    if (this.container) return;
    this.container = document.getElementById('merge-preview-overlay');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'merge-preview-overlay';
      document.getElementById('app').appendChild(this.container);
    }
    this.container.className = 'merge-workspace-shell fullscreen-workspace is-hidden';
  }

  renderMerge() {
    this.ensureContainer();
    if (!this.mergeData) return;

    const d = this.mergeData;
    const preview = this.preview;
    const conflictFiles = preview?.conflictedFiles || [];
    const changedCount = preview?.changedFiles?.length ?? 0;
    const hasLocalChanges = this.hasLocalChanges(d.status);
    const blockingSummary = this.blockingSummary(d.status);
    const conflictList = conflictFiles.slice(0, 6).join(', ');

    this.container.innerHTML = `
      <header class="merge-header">
        <div class="merge-heading">
          <span class="eyebrow">${this.esc(t('mergeWorkspace.mergeAction'))}</span>
          <div class="merge-direction">
            <span class="merge-chip merge-chip-source">${this.esc(d.source)}</span>
            <i class="ph ph-arrow-right merge-arrow" aria-hidden="true"></i>
            <span class="merge-chip merge-chip-target">${this.esc(d.target)}</span>
          </div>
        </div>
        <div class="merge-header-actions">
          ${conflictFiles.length
            ? `<span class="badge badge-conflict">${this.esc(t('mergeWorkspace.conflictsBadge', { count: conflictFiles.length }))}</span>`
            : `<span class="badge badge-head">${this.esc(t('mergeWorkspace.noConflictsBadge'))}</span>`}
          <button id="merge-cancel-btn" class="btn"><i class="ph ph-x" aria-hidden="true"></i><span>${this.esc(t('common.close'))}</span></button>
        </div>
      </header>

      <div class="merge-body">
        <aside class="merge-sidebar" aria-label="${this.esc(t('mergeWorkspace.summary'))}">
          <section class="merge-section">
            <div class="merge-section-header">${this.esc(t('mergeWorkspace.summary'))}</div>
            <div class="merge-summary">
              <div class="merge-stat">
                <div class="merge-stat-label">${this.esc(t('mergeWorkspace.commitsToMerge'))}</div>
                <div class="merge-stat-value">${d.commitsCount}</div>
              </div>
              <div class="merge-stat">
                <div class="merge-stat-label">${this.esc(t('mergeWorkspace.filesChanged'))}</div>
                <div class="merge-stat-value">${changedCount}</div>
              </div>
              <div class="merge-stat">
                <div class="merge-stat-label">${this.esc(t('mergeWorkspace.conflictsShort'))}</div>
                <div class="merge-stat-value${conflictFiles.length ? ' merge-stat-warn' : ''}">${conflictFiles.length}</div>
              </div>
            </div>
          </section>

          <section class="merge-section merge-commits-section">
            <div class="merge-section-header">${this.esc(t('mergeWorkspace.commits'))} (${d.commitsCount})</div>
            <div class="merge-commit-scroll">
              ${d.commits.slice(0, 40).map(c => `
                <div class="compare-commit-item">
                  <span class="compare-commit-hash">${c.hash.substring(0, 7)}</span>
                  <span class="compare-commit-message">${this.esc(c.message.split('\n')[0])}</span>
                  <span class="compare-commit-author">${this.esc(c.author_name)}</span>
                  <span class="compare-commit-date">${this.fmtDate(c.date)}</span>
                </div>
              `).join('')}
              ${d.commitsCount > 40 ? `<div class="merge-overflow-note">…${this.esc(t('mergeWorkspace.conflictPredictionMore', { count: d.commitsCount - 40 }))}</div>` : ''}
            </div>
          </section>

          <section class="merge-section">
            <div class="merge-section-header">${this.esc(t('mergeWorkspace.riskAssessment'))}</div>
            <div class="merge-risk-list">
              ${hasLocalChanges ? `
                <div class="merge-risk-item">
                  <i class="ph ph-warning merge-risk-icon warning" aria-hidden="true"></i>
                  <div class="merge-risk-content">
                    <div class="merge-risk-title">${this.esc(t('mergeWorkspace.localChangesTitle'))}</div>
                    <div class="merge-risk-detail">${this.esc(t('mergeWorkspace.localChangesDetail', { files: blockingSummary }))}</div>
                  </div>
                  <div class="merge-risk-action">
                    <button id="merge-view-changes-btn" class="btn btn-small">${this.esc(t('mergeWorkspace.viewChanges'))}</button>
                    <button id="merge-stash-btn" class="btn btn-small"><i class="ph ph-archive" aria-hidden="true"></i>${this.esc(t('mergeWorkspace.stashAndContinue'))}</button>
                  </div>
                </div>
              ` : ''}
              ${preview?.canFastForward ? `
                <div class="merge-risk-item">
                  <i class="ph ph-lightning merge-risk-icon info" aria-hidden="true"></i>
                  <div class="merge-risk-content">
                    <div class="merge-risk-title">${this.esc(t('mergeWorkspace.ff'))}</div>
                    <div class="merge-risk-detail">${this.esc(t('mergeWorkspace.ffAvailable', { branch: d.source }))}</div>
                  </div>
                </div>
              ` : ''}
              <div class="merge-risk-item">
                <i class="ph ph-info merge-risk-icon info" aria-hidden="true"></i>
                <div class="merge-risk-content">
                  <div class="merge-risk-title">${this.esc(t('mergeWorkspace.commitsFrom', { count: d.commitsCount, source: d.source }))}</div>
                  <div class="merge-risk-detail">${this.esc(t('mergeWorkspace.commitsBy', { authors: [...new Set(d.commits.map(c => c.author_name))].slice(0, 3).join(', ') }))}</div>
                </div>
              </div>
            </div>
          </section>
        </aside>

        <main class="merge-main">
          ${conflictFiles.length ? `
            <section class="merge-section merge-conflict-prediction">
              <div class="merge-conflict-prediction-title">
                <i class="ph ph-warning merge-risk-icon warning" aria-hidden="true"></i>
                <span>${this.esc(t('mergeWorkspace.conflictPredictionTitle'))}</span>
              </div>
              <div class="merge-conflict-prediction-detail">${this.esc(t('mergeWorkspace.conflictPredictionDetail'))}</div>
              <div class="merge-conflict-prediction-files">${this.esc(conflictList)}${conflictFiles.length > 6 ? ` ${this.esc(t('mergeWorkspace.conflictPredictionMore', { count: conflictFiles.length - 6 }))}` : ''}</div>
            </section>
          ` : ''}
          <section class="merge-section merge-diff-section">
            <div class="merge-section-header">
              <span>${this.esc(t('mergeWorkspace.incomingChanges'))}</span>
              <span class="merge-section-count">${changedCount}</span>
            </div>
            <div class="merge-diff-scroll" id="merge-diff-scroll">${this.renderDiff(d.diff)}</div>
          </section>
        </main>
      </div>

      <footer class="merge-actions">
        <div class="merge-strategy" role="group" aria-label="Merge strategy">
          <button id="merge-opt-ff" class="btn btn-small merge-strategy-option${this.strategy === 'ff' ? ' active' : ''}" title="${this.esc(t('mergeWorkspace.ffDesc'))}">${this.esc(t('mergeWorkspace.ff'))}</button>
          <button id="merge-opt-noff" class="btn btn-small merge-strategy-option${this.strategy === 'noff' ? ' active' : ''}" title="${this.esc(t('mergeWorkspace.noffDesc'))}">${this.esc(t('mergeWorkspace.noff'))}</button>
          <button id="merge-opt-squash" class="btn btn-small merge-strategy-option${this.strategy === 'squash' ? ' active' : ''}" title="${this.esc(t('mergeWorkspace.squashDesc'))}">${this.esc(t('mergeWorkspace.squash'))}</button>
        </div>
        <span class="merge-action-summary">${this.esc(t('mergeWorkspace.mergeSummary', { source: d.source, target: d.target }))}</span>
        <button id="merge-only-btn" class="btn btn-primary merge-confirm"
          ${hasLocalChanges ? `disabled title="${this.esc(t('mergeWorkspace.mergeBlocked'))}"` : ''}>
          <i class="ph ph-git-merge" aria-hidden="true"></i>
          <span>${this.esc(t('mergeWorkspace.mergeAction'))}</span>
        </button>
        <button id="merge-push-btn" class="btn merge-confirm"
          ${hasLocalChanges ? `disabled title="${this.esc(t('mergeWorkspace.mergeBlocked'))}"` : ''}>
          <i class="ph ph-git-merge" aria-hidden="true"></i>
          <span>${this.esc(t('mergeWorkspace.mergeAndPush'))}</span>
        </button>
      </footer>
    `;

    document.getElementById('merge-cancel-btn').onclick = () => this.hide();
    document.getElementById('merge-only-btn').onclick = () => this.executeMerge(false);
    document.getElementById('merge-push-btn').onclick = () => this.executeMerge(true);
    const viewChangesButton = document.getElementById('merge-view-changes-btn');
    if (viewChangesButton) {
      viewChangesButton.onclick = () => {
        this.hide();
        this.app.setWorkspaceMode('changes');
      };
    }
    const stashButton = document.getElementById('merge-stash-btn');
    if (stashButton) stashButton.onclick = () => this.stashAndReload();

    document.querySelectorAll('.merge-strategy-option').forEach(button => {
      button.onclick = () => {
        this.strategy = button.id.replace('merge-opt-', '');
        document.querySelectorAll('.merge-strategy-option').forEach(item => {
          item.classList.toggle('active', item === button);
        });
      };
    });

    this.container.classList.remove('is-hidden');
  }

  renderDiff(diffText) {
    if (!diffText) {
      return `<div class="empty-state">${this.esc(t('mergeWorkspace.noDiffPreview'))}</div>`;
    }
    const lines = DiffParser.parseUnified(diffText);
    const scroll = document.createElement('div');
    const fragment = document.createDocumentFragment();
    scroll.style.setProperty('--diff-gutter-digits', DiffParser.maxDigits(lines));
    lines.forEach(line => {
      if (line.kind === 'file') {
        const header = document.createElement('div');
        header.className = 'diff-file-header';
        const match = line.content.match(/diff --git a\/(.+) b\/(.+)/);
        header.innerHTML = `<span class="diff-file-path">${this.esc(match ? match[2] : line.content)}</span>`;
        fragment.appendChild(header);
        return;
      }
      const row = document.createElement('div');
      row.className = `diff-line ${line.kind === 'no-newline' ? 'header' : line.kind}`;
      row.appendChild(this.lineNumber(line.oldLine, 'old'));
      row.appendChild(this.lineNumber(line.newLine, 'new'));
      const content = document.createElement('span');
      content.className = 'diff-line-content';
      content.textContent = line.content;
      row.appendChild(content);
      fragment.appendChild(row);
    });
    scroll.appendChild(fragment);
    return scroll.innerHTML;
  }

  lineNumber(value, side) {
    const number = document.createElement('span');
    number.className = `diff-line-num is-${side}`;
    number.textContent = Number.isInteger(value) ? String(value) : '';
    return number;
  }

  async executeMerge(andPush = false) {
    const repo = this.app.state.repo;
    if (!repo) return;
    if (this.mergeData?.status?.isClean === false) {
      this.app.showToast(t('mergeWorkspace.mergeBlocked'), 'error');
      return;
    }
    this.app.showToast(t('mergeWorkspace.mergeStarted'));

    const result = await window.gitTree.merge(repo.path, this.mergeData.source, this.strategy);
    if (result.error) {
      if (result.conflictState?.type) {
        this.hide();
        await this.app.components.conflict.open(result.conflictState);
      }
      this.app.showToast(result.error, 'error');
      return;
    }

    if (!andPush) {
      this.hide();
      this.app.showToast(t('mergeWorkspace.mergeCompleted'), 'success');
      this.app.emit('refresh');
      return;
    }

    this.setPushing(true);
    const metadata = this.app.components.branchList.metadata;
    const targetBranch = (metadata?.branches || []).find(
      branch => branch.name === this.mergeData.target && branch.kind === 'local'
    );
    const remoteName = targetBranch?.upstream?.split('/')[0]
      || metadata?.remotes?.[0]?.name
      || 'origin';
    const pushResult = await window.gitTree.push(repo.path, remoteName, this.mergeData.target);
    this.setPushing(false);
    this.hide();
    if (pushResult.error) {
      this.app.showToast(t('mergeWorkspace.pushFailed', { error: pushResult.error }), 'error');
    } else {
      this.app.showToast(t('mergeWorkspace.mergeAndPushCompleted'), 'success');
    }
    this.app.emit('refresh');
  }

  setPushing(pushing) {
    if (!this.container) return;
    this.container.querySelectorAll('.merge-confirm, #merge-cancel-btn').forEach(button => {
      button.disabled = pushing;
    });
    const pushButton = this.container.querySelector('#merge-push-btn');
    if (pushButton && pushing) {
      pushButton.innerHTML = `<i class="ph ph-circle-notch merge-pushing-spinner" aria-hidden="true"></i> ${this.esc(t('mergeWorkspace.pushing'))}`;
    }
  }

  async stashAndReload() {
    const repo = this.app.state.repo;
    const data = this.mergeData;
    if (!repo || !data) return;
    const result = await window.gitTree.stash(
      repo.path,
      `GitTree: before merging ${data.source} into ${data.target}`
    );
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      return;
    }
    this.app.showToast(t('mergeWorkspace.changesStashed'), 'success');
    await this.open(data.source, data.target);
  }

  hide() {
    if (this.container) this.container.classList.add('is-hidden');
  }

  hasLocalChanges(status = {}) {
    return status?.isClean === false || Boolean(
      status && (
        status.modified?.length ||
        status.not_added?.length ||
        status.created?.length ||
        status.deleted?.length ||
        status.renamed?.length ||
        status.staged?.length ||
        status.conflicted?.length
      )
    );
  }

  blockingSummary(status = {}) {
    const files = this.blockingFiles(status);
    if (!files.length) return t('mergeWorkspace.unknownChanges');
    return files.slice(0, 4).join(', ') + (files.length > 4 ? '…' : '');
  }

  blockingFiles(status = {}) {
    const values = [
      ...(status.files || []).map(file => file.path),
      ...(status.modified || []),
      ...(status.not_added || []),
      ...(status.created || []),
      ...(status.deleted || []),
      ...(status.staged || []),
      ...(status.conflicted || []),
      ...(status.renamed || []).flatMap(file => [file.from, file.to])
    ].filter(Boolean);
    return [...new Set(values)];
  }

  esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  fmtDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}
