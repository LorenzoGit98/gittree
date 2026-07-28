class BranchCompare {
  constructor(app) {
    this.app = app;
    this.sourceBranch = null;
    this.targetBranch = null;
    this.data = null;
  }

  async compare(source, target) {
    this.sourceBranch = source;
    this.targetBranch = target;
    const repo = this.app.state.repo;
    if (!repo) return;

    try {
      const comparison = await window.gitTree.compareBranches(repo.path, target, source);
      if (comparison?.error) throw new Error(comparison.error);

      this.data = {
        source, target,
        commitsCount: comparison.commits?.length || 0,
        commits: comparison.commits || [],
        diff: comparison.diff || ''
      };

      this.showCompareView();
    } catch (e) {
      this.app.showToast('Error comparing branches: ' + e.message, 'error');
    }
  }

  showCompareView() {
    if (!this.data) return;

    const mainView = document.getElementById('merge-workspace-overlay');
    mainView.innerHTML = `
      <div class="branch-compare">
        <div class="compare-header">
          <div class="compare-selector">
            <span class="badge badge-branch">${this.esc(this.data.source)}</span>
            <i class="ph ph-arrow-right compare-arrow"></i>
            <span class="badge badge-remote">${this.esc(this.data.target)}</span>
          </div>
          <button class="btn btn-small compare-back" id="compare-close">
            <i class="ph ph-arrow-left"></i>
            Back to history
          </button>
        </div>
        <div class="compare-summary">
          <div class="compare-stat">
            <div class="compare-stat-value">${this.data.commitsCount}</div>
            <div class="compare-stat-label">Commits ahead</div>
          </div>
        </div>
        <div class="compare-body">
          <div class="compare-commits-list">
            ${this.data.commits.map(c => `
              <div class="compare-commit-item" data-hash="${this.esc(c.hash)}">
                <span class="compare-commit-hash">${c.hash.substring(0,7)}</span>
                <span class="compare-commit-message">${this.esc(c.message.split('\n')[0])}</span>
                <span class="compare-commit-author">${this.esc(c.author_name)}</span>
                <span class="compare-commit-date">${this.fmtDate(c.date)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    mainView.classList.remove('is-hidden');
    document.getElementById('compare-close').onclick = () => {
      mainView.classList.add('is-hidden');
      mainView.innerHTML = '';
    };
    mainView.querySelectorAll('.compare-commit-item[data-hash]').forEach(item => {
      item.onclick = () => this.app.emit('commit:selected', item.dataset.hash);
    });
  }

  esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}
