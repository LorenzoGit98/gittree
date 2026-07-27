class CommitLogView {
  constructor(container, app) {
    this.container = container;
    this.body = container.querySelector('#commit-list-body');
    this.app = app;
    this.commits = [];
    this.selectedCommit = null;
    this.branchRefs = new Map();
  }

  async load(repoPath, searchTerm = '') {
    this.body.innerHTML = '<div class="commit-log-loading">Loading commits...</div>';

    try {
      const log = await window.gitTree.getLog(repoPath, 200);
      if (log && log.error) {
        this.body.innerHTML = `<div class="commit-log-empty">Error: ${log.error}</div>`;
        return;
      }
      this.commits = log.all || [];

      const branches = await window.gitTree.getBranches(repoPath);
      this.buildRefMap(branches);

      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        this.commits = this.commits.filter(c =>
          c.message.toLowerCase().includes(term) ||
          c.hash.toLowerCase().includes(term) ||
          c.author_name.toLowerCase().includes(term)
        );
      }

      this.render();
    } catch (err) {
      this.body.innerHTML = `<div class="commit-log-empty">Error: ${err.message}</div>`;
    }
  }

  buildRefMap(branchesData) {
    this.branchRefs.clear();
    if (!branchesData || branchesData.error) return;

    const branches = branchesData.branches || {};
    for (const [name, info] of Object.entries(branches)) {
      const hash = typeof info === 'object' ? info.commit : info;
      if (!hash) continue;
      if (!this.branchRefs.has(hash)) {
        this.branchRefs.set(hash, []);
      }
      const refs = this.branchRefs.get(hash);

      if (name === branchesData.current) {
        refs.push({ name, type: 'head' });
      } else if (name.startsWith('remotes/')) {
        refs.push({ name: name.replace('remotes/', ''), type: 'remote' });
      } else {
        refs.push({ name, type: 'branch' });
      }
    }
  }

  render() {
    this.body.innerHTML = '';

    if (this.commits.length === 0) {
      this.body.innerHTML = '<div class="commit-log-empty">No commits found</div>';
      return;
    }

    this.commits.forEach(commit => {
      const row = document.createElement('div');
      row.className = 'commit-row';
      row.dataset.hash = commit.hash;

      if (this.selectedCommit === commit.hash) {
        row.classList.add('selected');
      }

      const graph = document.createElement('div');
      graph.className = 'col-graph';
      graph.innerHTML = '<span class="graph-dot"></span>';

      const refs = this.branchRefs.get(commit.hash);
      const refsEl = document.createElement('div');
      refsEl.className = 'commit-refs';
      if (refs) {
        refs.forEach(ref => {
          const span = document.createElement('span');
          span.className = `commit-ref ${ref.type}`;
          span.textContent = ref.name;
          refsEl.appendChild(span);
        });
      }

      const message = document.createElement('div');
      message.className = 'col-message';
      message.textContent = commit.message.split('\n')[0];

      const author = document.createElement('div');
      author.className = 'col-author';
      author.textContent = commit.author_name;

      const date = document.createElement('div');
      date.className = 'col-date';
      date.textContent = this.formatDate(commit.date);

      const hash = document.createElement('div');
      hash.className = 'col-hash';
      hash.textContent = commit.hash.substring(0, 7);

      row.appendChild(graph);
      row.appendChild(refsEl);
      row.appendChild(message);
      row.appendChild(author);
      row.appendChild(date);
      row.appendChild(hash);

      row.onclick = () => {
        this.selectCommit(commit.hash);
      };

      this.body.appendChild(row);
    });
  }

  selectCommit(hash) {
    this.selectedCommit = hash;
    this.render();
    this.app.emit('commit:selected', hash);
  }

  formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const dayMs = 86400000;

    if (diff < dayMs) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diff < 7 * dayMs) {
      const days = Math.floor(diff / dayMs);
      return `${days}d ago`;
    } else if (diff < 365 * dayMs) {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
