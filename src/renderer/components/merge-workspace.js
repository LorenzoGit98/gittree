class MergeWorkspace {
  constructor(app) {
    this.app = app;
    this.sourceBranch = null;
    this.targetBranch = null;
    this.mergeData = null;
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
      const [comparison, logTgt, status] = await Promise.all([
        window.gitTree.compareBranches(repo.path, target, source),
        window.gitTree.getLog(repo.path, 1, target),
        window.gitTree.getStatus(repo.path)
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

      this.renderMerge();
    } catch (e) {
      this.app.showToast('Error: ' + e.message, 'error');
      this.hide();
    }
  }

  showLoading() {
    this.ensureContainer();
    this.container.classList.remove('is-hidden');
    this.container.innerHTML = '<div class="empty-state">Loading merge preview...</div>';
  }

  ensureContainer() {
    if (this.container) return;
    this.container = document.getElementById('merge-preview-overlay');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'merge-preview-overlay';
      this.container.className = 'merge-overlay is-hidden';
      document.getElementById('app').appendChild(this.container);
    }
  }

  renderMerge() {
    this.ensureContainer();
    if (!this.mergeData) return;

    const d = this.mergeData;
    const hasLocalChanges = d.status?.isClean === false || Boolean(
      d.status && (
        d.status.modified?.length ||
        d.status.not_added?.length ||
        d.status.created?.length ||
        d.status.deleted?.length ||
        d.status.renamed?.length ||
        d.status.staged?.length ||
        d.status.conflicted?.length
      )
    );
    const blockingFiles = this.blockingFiles(d.status);
    const blockingSummary = blockingFiles.length
      ? blockingFiles.slice(0, 4).join(', ') + (blockingFiles.length > 4 ? '…' : '')
      : t('mergeWorkspace.unknownChanges');

    this.container.innerHTML = `
      <div class="merge-workspace">
        <div class="merge-header">
          <div class="merge-direction">
            <span class="merge-direction-label">Merge</span>
            <span class="merge-source">${this.esc(d.source)}</span>
            <i class="ph ph-arrow-right merge-arrow"></i>
            <span class="merge-target">${this.esc(d.target)}</span>
          </div>
          <div class="merge-header-actions">
            <button id="merge-cancel-btn" class="btn"><i class="ph ph-x"></i>Close</button>
          </div>
        </div>

        <div class="merge-body">
          <div class="merge-section">
            <div class="merge-section-header">Summary</div>
            <div class="merge-summary">
              <div class="merge-stat"><div class="merge-stat-label">Commits to merge</div><div class="merge-stat-value">${d.commitsCount}</div></div>
              <div class="merge-stat"><div class="merge-stat-label">Source branch</div><div class="merge-stat-value merge-branch-value">${this.esc(d.source)}</div></div>
              <div class="merge-stat"><div class="merge-stat-label">Target branch</div><div class="merge-stat-value merge-branch-value">${this.esc(d.target)}</div></div>
            </div>
          </div>

          <div class="merge-section">
            <div class="merge-section-header">Risk Assessment</div>
            <div class="merge-risk-list">
              ${hasLocalChanges ? `
                <div class="merge-risk-item">
                  <i class="ph ph-warning merge-risk-icon warning"></i>
                  <div class="merge-risk-content">
                    <div class="merge-risk-title">${this.esc(t('mergeWorkspace.localChangesTitle'))}</div>
                    <div class="merge-risk-detail">${this.esc(t('mergeWorkspace.localChangesDetail', {
                      files: blockingSummary
                    }))}</div>
                  </div>
                  <div class="merge-risk-action">
                    <button id="merge-view-changes-btn" class="btn btn-small">
                      ${this.esc(t('mergeWorkspace.viewChanges'))}
                    </button>
                    <button id="merge-stash-btn" class="btn btn-small">
                      <i class="ph ph-archive" aria-hidden="true"></i>
                      ${this.esc(t('mergeWorkspace.stashAndContinue'))}
                    </button>
                  </div>
                </div>
              ` : ''}
              <div class="merge-risk-item">
                <i class="ph ph-info merge-risk-icon info"></i>
                <div class="merge-risk-content">
                  <div class="merge-risk-title">${d.commitsCount} commit${d.commitsCount !== 1 ? 's' : ''} from ${this.esc(d.source)} will be merged</div>
                  <div class="merge-risk-detail">Commits made by ${[...new Set(d.commits.map(c => c.author_name))].slice(0, 3).join(', ')}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="merge-section">
            <div class="merge-section-header">Commits (${d.commitsCount})</div>
            <div class="merge-commit-scroll">
              ${d.commits.slice(0, 30).map(c => `
                <div class="compare-commit-item">
                  <span class="compare-commit-hash">${c.hash.substring(0,7)}</span>
                  <span class="compare-commit-message">${this.esc(c.message.split('\n')[0])}</span>
                  <span class="compare-commit-author">${this.esc(c.author_name)}</span>
                  <span class="compare-commit-date">${this.fmtDate(c.date)}</span>
                </div>
              `).join('')}
              ${d.commitsCount > 30 ? `<div class="merge-overflow-note">…and ${d.commitsCount - 30} more</div>` : ''}
            </div>
          </div>

          <div class="merge-section">
            <div class="merge-section-header">Advanced Options</div>
            <div class="merge-advanced">
              <div class="merge-advanced-options">
                <div class="merge-option" id="merge-opt-ff">
                  <div><div class="merge-option-label">Fast-forward</div><div class="merge-option-desc">No merge commit if possible</div></div>
                </div>
                <div class="merge-option selected" id="merge-opt-noff">
                  <div><div class="merge-option-label">No fast-forward</div><div class="merge-option-desc">Always create merge commit</div></div>
                </div>
                <div class="merge-option" id="merge-opt-squash">
                  <div><div class="merge-option-label">Squash</div><div class="merge-option-desc">Squash all commits into one</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="merge-actions">
          <span class="merge-action-summary">
            You are about to merge <strong>${this.esc(d.source)}</strong> into <strong>${this.esc(d.target)}</strong>
          </span>
          <button id="merge-only-btn" class="btn btn-primary merge-confirm"
            ${hasLocalChanges ? `disabled title="${this.esc(t('mergeWorkspace.mergeBlocked'))}"` : ''}>
            <i class="ph ph-git-merge"></i>
            Merge ${this.esc(d.source)} into ${this.esc(d.target)}
          </button>
          <button id="merge-push-btn" class="btn merge-confirm"
            ${hasLocalChanges ? `disabled title="${this.esc(t('mergeWorkspace.mergeBlocked'))}"` : ''}>
            <i class="ph ph-git-merge"></i>
            Merge &amp; Push
          </button>
        </div>
      </div>
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

    document.getElementById('merge-opt-ff').onclick = () => {
      document.querySelectorAll('.merge-option').forEach(el => el.classList.remove('selected'));
      document.getElementById('merge-opt-ff').classList.add('selected');
      this.strategy = 'ff';
    };
    document.getElementById('merge-opt-noff').onclick = () => {
      document.querySelectorAll('.merge-option').forEach(el => el.classList.remove('selected'));
      document.getElementById('merge-opt-noff').classList.add('selected');
      this.strategy = 'noff';
    };
    document.getElementById('merge-opt-squash').onclick = () => {
      document.querySelectorAll('.merge-option').forEach(el => el.classList.remove('selected'));
      document.getElementById('merge-opt-squash').classList.add('selected');
      this.strategy = 'squash';
    };

    this.container.classList.remove('is-hidden');
  }

  async executeMerge(andPush = false) {
    const repo = this.app.state.repo;
    if (!repo) return;
    if (this.mergeData?.status?.isClean === false) {
      this.app.showToast(t('mergeWorkspace.mergeBlocked'), 'error');
      return;
    }
    this.app.showToast('Merging...');

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
      this.app.showToast('Merge completed', 'success');
      this.app.emit('refresh');
      return;
    }

    this.setPushing(true);
    const pushResult = await window.gitTree.push(repo.path, 'origin', this.mergeData.target);
    this.setPushing(false);
    this.hide();
    if (pushResult.error) {
      this.app.showToast('Merge done, but push failed: ' + pushResult.error, 'error');
    } else {
      this.app.showToast('Merge & Push complete', 'success');
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
      pushButton.innerHTML = `<i class="ph ph-circle-notch merge-pushing-spinner"></i> ${this.esc(t('mergeWorkspace.pushing'))}`;
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

  esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
  fmtDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}
