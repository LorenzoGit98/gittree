/* exported BranchCompare */
/* eslint-disable-next-line no-unused-vars -- script-tag global consumed by app.js */
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
            ${this.esc(t('compare.backToHistory'))}
          </button>
        </div>
        <div class="compare-summary">
          <div class="compare-stat">
            <div class="compare-stat-value">${this.data.commitsCount}</div>
            <div class="compare-stat-label">${this.esc(t('compare.commitsAhead'))}</div>
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

  esc(value) { return HtmlEncoder.encode(value); }
  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  async compareMatrix(branches) {
    const repo = this.app.state.repo;
    if (!repo || branches.length < 2) return;

    const mainView = document.getElementById('merge-workspace-overlay');
    mainView.classList.remove('is-hidden');
    mainView.innerHTML = `<div class="empty-state"><i class="ph ph-circle-notch"></i>${t('common.loading')}</div>`;

    const names = branches.map(b => b.name);
    const matrix = [];

    try {
      for (let i = 0; i < names.length; i += 1) {
        matrix[i] = [];
        for (let j = 0; j < names.length; j += 1) {
          if (i === j) { matrix[i][j] = null; continue; }
          const comparison = await window.gitTree.compareBranches(repo.path, names[i], names[j]);
          matrix[i][j] = comparison?.error ? { error: comparison.error } : {
            commits: comparison.commits?.length || 0
          };
        }
      }

      mainView.innerHTML = `
        <div class="branch-compare">
          <div class="compare-header">
            <div class="compare-selector">
              <span class="compare-label">${this.esc(t('sidebar.batchCompare'))}</span>
              <span class="badge badge-branch">${names.length} branches</span>
            </div>
            <button class="btn btn-small compare-back" id="compare-matrix-close">
              <i class="ph ph-arrow-left"></i>
              ${this.esc(t('compare.back'))}
            </button>
          </div>
          <div class="compare-body">
            <div class="compare-matrix-wrap">
              <table class="compare-matrix">
                <thead>
                  <tr>
                    <th></th>
                    ${names.map(n => `<th>${this.esc(n)}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${names.map((rowName, i) => `
                    <tr>
                      <th>${this.esc(rowName)}</th>
                      ${names.map((_, j) => {
                        if (i === j) return '<td class="compare-matrix-self">\u2014</td>';
                        const cell = matrix[i][j];
                        if (cell?.error) return `<td class="compare-matrix-error">!</td>`;
                        return `<td class="compare-matrix-cell" data-row="${i}" data-col="${j}">${cell.commits}</td>`;
                      }).join('')}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;

      document.getElementById('compare-matrix-close').onclick = () => {
        mainView.classList.add('is-hidden');
        mainView.innerHTML = '';
      };
      mainView.querySelectorAll('.compare-matrix-cell').forEach(cell => {
        cell.onclick = () => {
          const row = Number(cell.dataset.row);
          const col = Number(cell.dataset.col);
          mainView.classList.add('is-hidden');
          mainView.innerHTML = '';
          this.compare(names[col], names[row]);
        };
      });
    } catch (e) {
      this.app.showToast('Error comparing branches: ' + e.message, 'error');
      mainView.classList.add('is-hidden');
      mainView.innerHTML = '';
    }
  }
}
