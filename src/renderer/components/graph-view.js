class GraphView {
  constructor(container, body, app) {
    this.container = container;
    this.body = body;
    this.app = app;
    this.commits = [];
    this.selectedHash = null;
    this.branchRefs = new Map();
    this.searchTerm = '';
  }

  async load(repoPath) {
    this.body.innerHTML = '<div class="empty-state"><span class="empty-state-icon">~</span>Loading commits...</div>';
    try {
      const log = await window.gitTree.getLog(repoPath, 300);
      if (log?.error) { this.body.innerHTML = `<div class="empty-state">Error: ${log.error}</div>`; return; }
      let commits = log.all || [];
      if (this.searchTerm) {
        const t = this.searchTerm.toLowerCase();
        commits = commits.filter(c => c.message.toLowerCase().includes(t) || c.hash.startsWith(t) || c.author_name.toLowerCase().includes(t));
      }
      this.commits = commits;
      await this.loadRefs(repoPath);
      this.render();
    } catch (e) { this.body.innerHTML = `<div class="empty-state">Error: ${e.message}</div>`; }
  }

  async loadRefs(repoPath) {
    this.branchRefs.clear();
    try {
      const branches = await window.gitTree.getBranches(repoPath);
      if (branches?.error) return;
      const bmap = branches.branches || {};
      for (const [name, info] of Object.entries(bmap)) {
        const hash = typeof info === 'object' ? info.commit : info;
        if (!hash) continue;
        if (!this.branchRefs.has(hash)) this.branchRefs.set(hash, []);
        const refs = this.branchRefs.get(hash);
        if (name === branches.current) refs.push({ name, type: 'head' });
        else if (name.startsWith('remotes/')) refs.push({ name: name.replace('remotes/', ''), type: 'remote' });
        else refs.push({ name, type: 'branch' });
      }
    } catch {}
  }

  render() {
    this.body.innerHTML = '';
    if (!this.commits.length) {
      this.body.innerHTML = '<div class="empty-state">No commits found</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    this.commits.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'graph-row';
      if (c.hash === this.selectedHash) row.classList.add('selected');

      const cell = document.createElement('div');
      cell.className = 'graph-cell';
      cell.innerHTML = '<span class="graph-node"></span>';
      if (i < this.commits.length - 1) {
        const line = document.createElement('div');
        line.className = 'graph-line-v';
        line.style.top = '50%';
        cell.appendChild(line);
      }

      const refs = this.branchRefs.get(c.hash);
      const refsEl = document.createElement('div');
      refsEl.className = 'graph-refs';
      if (refs) {
        refs.forEach(r => {
          const b = document.createElement('span');
          b.className = `badge badge-${r.type}`;
          b.textContent = r.name;
          refsEl.appendChild(b);
        });
      }

      const msg = document.createElement('div');
      msg.className = 'graph-commit-message';
      msg.textContent = c.message.split('\n')[0];

      const auth = document.createElement('div');
      auth.className = 'graph-commit-author';
      auth.textContent = c.author_name;

      const date = document.createElement('div');
      date.className = 'graph-commit-date';
      date.textContent = this.fmtDate(c.date);

      const hash = document.createElement('div');
      hash.className = 'graph-commit-hash';
      hash.textContent = c.hash.substring(0, 7);

      row.appendChild(cell);
      row.appendChild(refsEl);
      row.appendChild(msg);
      row.appendChild(auth);
      row.appendChild(date);
      row.appendChild(hash);

      row.onclick = () => this.select(c.hash);
      frag.appendChild(row);
    });

    this.body.appendChild(frag);
  }

  select(hash) {
    this.selectedHash = hash;
    this.render();
    this.app.emit('commit:selected', hash);
  }

  setSearch(term) { this.searchTerm = term; }

  fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    const now = new Date();
    const diff = now - dt;
    const day = 86400000;
    if (diff < day) return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
    if (diff < 365 * day) return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return dt.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
