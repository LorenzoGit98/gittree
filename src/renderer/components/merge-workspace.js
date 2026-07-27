class MergeWorkspace {
  constructor(app) {
    this.app = app;
    this.sourceBranch = null;
    this.targetBranch = null;
    this.mergeData = null;
    this.container = null;
  }

  async open(source, target) {
    this.sourceBranch = source;
    this.targetBranch = target;
    const repo = this.app.state.repo;
    if (!repo) return;

    this.showLoading();

    try {
      const [diff, logSrc, logTgt, status] = await Promise.all([
        window.gitTree.getDiff(repo.path, `${target}..${source}`),
        window.gitTree.getLog(repo.path, 100, `${target}..${source}`),
        window.gitTree.getLog(repo.path, 1, target),
        window.gitTree.getStatus(repo.path)
      ]);

      this.mergeData = {
        source, target,
        commitsCount: logSrc.all?.length || 0,
        commits: logSrc.all || [],
        targetCommit: logTgt.latest,
        diff: diff || '',
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
    this.container.style.display = 'flex';
    this.container.innerHTML = '<div class="empty-state">Loading merge preview...</div>';
  }

  ensureContainer() {
    if (this.container) return;
    this.container = document.getElementById('merge-workspace-overlay');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'merge-workspace-overlay';
      this.container.style.cssText = 'position:fixed;inset:0;z-index:var(--z-modal);background:var(--bg-app);display:none;flex-direction:column';
      document.getElementById('app').appendChild(this.container);
    }
  }

  renderMerge() {
    this.ensureContainer();
    if (!this.mergeData) return;

    const d = this.mergeData;
    const hasLocalChanges = d.status && (d.status.modified?.length || d.status.not_added?.length || d.status.created?.length);

    this.container.innerHTML = `
      <div class="merge-workspace">
        <div class="merge-header">
          <div class="merge-direction">
            <span style="color:var(--text-secondary);font-size:12px">Merge</span>
            <span class="merge-source">${this.esc(d.source)}</span>
            <span class="merge-arrow">→</span>
            <span class="merge-target">${this.esc(d.target)}</span>
          </div>
          <div style="margin-left:auto;display:flex;gap:8px">
            <button id="merge-cancel-btn" class="btn">Close</button>
          </div>
        </div>

        <div class="merge-body">
          <div class="merge-section">
            <div class="merge-section-header">Summary</div>
            <div class="merge-summary">
              <div class="merge-stat"><div class="merge-stat-label">Commits to merge</div><div class="merge-stat-value">${d.commitsCount}</div></div>
              <div class="merge-stat"><div class="merge-stat-label">Source branch</div><div class="merge-stat-value" style="font-size:14px;font-family:var(--font-mono)">${this.esc(d.source)}</div></div>
              <div class="merge-stat"><div class="merge-stat-label">Target branch</div><div class="merge-stat-value" style="font-size:14px;font-family:var(--font-mono)">${this.esc(d.target)}</div></div>
            </div>
          </div>

          <div class="merge-section">
            <div class="merge-section-header">Risk Assessment</div>
            <div class="merge-risk-list">
              ${hasLocalChanges ? `
                <div class="merge-risk-item">
                  <span class="merge-risk-icon warning">⚠</span>
                  <div class="merge-risk-content">
                    <div class="merge-risk-title">Local changes detected</div>
                    <div class="merge-risk-detail">You have uncommitted changes that may interfere with the merge.</div>
                  </div>
                  <div class="merge-risk-action">
                    <button class="btn btn-small" onclick="window.app.emit('refresh')">View status</button>
                  </div>
                </div>
              ` : ''}
              <div class="merge-risk-item">
                <span class="merge-risk-icon info">ℹ</span>
                <div class="merge-risk-content">
                  <div class="merge-risk-title">${d.commitsCount} commit${d.commitsCount !== 1 ? 's' : ''} from ${this.esc(d.source)} will be merged</div>
                  <div class="merge-risk-detail">Commits made by ${[...new Set(d.commits.map(c => c.author_name))].slice(0, 3).join(', ')}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="merge-section">
            <div class="merge-section-header">Commits (${d.commitsCount})</div>
            <div style="max-height:200px;overflow-y:auto">
              ${d.commits.slice(0, 30).map(c => `
                <div class="compare-commit-item">
                  <span class="compare-commit-hash">${c.hash.substring(0,7)}</span>
                  <span class="compare-commit-message">${this.esc(c.message.split('\n')[0])}</span>
                  <span class="compare-commit-author">${this.esc(c.author_name)}</span>
                  <span class="compare-commit-date">${this.fmtDate(c.date)}</span>
                </div>
              `).join('')}
              ${d.commitsCount > 30 ? `<div style="padding:8px;text-align:center;color:var(--text-tertiary)">...and ${d.commitsCount - 30} more</div>` : ''}
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
          <span style="font-size:11px;color:var(--text-secondary)">
            You are about to merge <strong style="color:var(--accent)">${this.esc(d.source)}</strong> into <strong style="color:var(--text-primary)">${this.esc(d.target)}</strong>
          </span>
          <button id="merge-confirm-btn" class="btn btn-primary" style="margin-left:auto">
            Merge ${this.esc(d.source)} into ${this.esc(d.target)}
          </button>
        </div>
      </div>
    `;

    document.getElementById('merge-cancel-btn').onclick = () => this.hide();
    document.getElementById('merge-confirm-btn').onclick = () => this.executeMerge();

    document.getElementById('merge-opt-ff').onclick = function() {
      document.querySelectorAll('.merge-option').forEach(el => el.classList.remove('selected'));
      this.classList.add('selected');
    };
    document.getElementById('merge-opt-noff').onclick = function() {
      document.querySelectorAll('.merge-option').forEach(el => el.classList.remove('selected'));
      this.classList.add('selected');
    };
    document.getElementById('merge-opt-squash').onclick = function() {
      document.querySelectorAll('.merge-option').forEach(el => el.classList.remove('selected'));
      this.classList.add('selected');
    };

    this.container.style.display = 'flex';
  }

  async executeMerge() {
    const repo = this.app.state.repo;
    if (!repo) return;
    this.app.showToast('Merging...');

    const result = await window.gitTree.merge(repo.path, this.mergeData.source);
    if (result.error) {
      this.app.showToast(result.error, 'error');
      return;
    }
    this.hide();
    this.app.showToast('Merge completed', 'success');
    this.app.emit('refresh');
  }

  hide() {
    if (this.container) this.container.style.display = 'none';
  }

  esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
  fmtDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}
