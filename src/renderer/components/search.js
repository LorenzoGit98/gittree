class GlobalSearch {
  constructor(app) {
    this.app = app;
    this.overlay = document.getElementById('search-overlay');
    this.input = document.getElementById('search-input');
    this.results = document.getElementById('search-results');
    this.filters = document.getElementById('search-filters');
    this.allData = [];
    this.selectedIdx = -1;
    this.visible = false;
  }

  init() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.visible) { this.hide(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        this.toggle();
        return;
      }
    });

    document.getElementById('global-search').addEventListener('click', () => this.show());
    document.getElementById('global-search').addEventListener('focus', () => this.show());

    this.input.addEventListener('input', () => this.search());
    this.input.addEventListener('keydown', e => this.handleKey(e));

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  async show() {
    this.visible = true;
    this.overlay.style.display = 'flex';
    this.input.value = '';
    this.selectedIdx = -1;
    this.allData = [];
    this.results.innerHTML = '';
    this.filters.innerHTML = '';

    if (this.app.state.repo) {
      try {
        const [branches, log, status] = await Promise.all([
          window.gitTree.getBranches(this.app.state.repo.path),
          window.gitTree.getLog(this.app.state.repo.path, 50),
          window.gitTree.getStatus(this.app.state.repo.path)
        ]);
        if (branches?.branches) {
          for (const [name, info] of Object.entries(branches.branches)) {
            this.allData.push({
              type: 'branch', label: name, subtitle: name.startsWith('remotes/') ? 'remote' : 'local',
              detail: name.startsWith('remotes/') ? 'Remote branch' : (name === branches.current ? 'Current branch' : 'Local branch'),
              data: { name, remote: name.startsWith('remotes/') }
            });
          }
        }
        if (log?.all) {
          log.all.forEach(c => {
            this.allData.push({
              type: 'commit', label: c.message.split('\n')[0], subtitle: c.hash.substring(0, 7),
              detail: `${c.author_name} — ${this.fmtDate(c.date)}`, data: { hash: c.hash }
            });
          });
        }
        if (status?.files) {
          status.files.forEach(f => {
            this.allData.push({
              type: 'file', label: f.path, subtitle: f.working_dir || f.index, detail: 'Modified',
              data: { path: f.path }
            });
          });
        }
      } catch {}
    }

    if (this.app.repoTabs?.repos) {
      this.app.repoTabs.repos.forEach(r => {
        this.allData.push({ type: 'repo', label: r.name, subtitle: r.path, detail: 'Repository', data: { path: r.path } });
      });
    }

    this.allData.push(
      { type: 'action', label: 'Fetch', subtitle: '', detail: 'Fetch from remote', data: { action: 'fetch' } },
      { type: 'action', label: 'Pull', subtitle: '', detail: 'Pull from remote', data: { action: 'pull' } },
      { type: 'action', label: 'Push', subtitle: '', detail: 'Push to remote', data: { action: 'push' } },
      { type: 'action', label: 'Create branch', subtitle: '', detail: 'Create a new branch', data: { action: 'create-branch' } }
    );

    setTimeout(() => this.input.focus(), 50);
  }

  hide() {
    this.visible = false;
    this.overlay.style.display = 'none';
  }

  toggle() {
    this.visible ? this.hide() : this.show();
  }

  search() {
    const q = this.input.value.trim().toLowerCase();
    this.selectedIdx = -1;
    if (!q) { this.renderResults([]); return; }

    let filtered = this.allData.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.detail.toLowerCase().includes(q)
    );

    // Filter syntax: branch:, author:, file:, message:
    const m = q.match(/^(branch|author|file|message|type):(.+)/);
    if (m) {
      const [, key, val] = m;
      const v = val.toLowerCase().trim();
      if (key === 'branch') filtered = this.allData.filter(i => i.type === 'branch' && i.label.toLowerCase().includes(v));
      else if (key === 'author') filtered = this.allData.filter(i => i.type === 'commit' && i.detail.toLowerCase().includes(v));
      else if (key === 'file') filtered = this.allData.filter(i => i.type === 'file' && i.label.toLowerCase().includes(v));
      else if (key === 'message') filtered = this.allData.filter(i => i.type === 'commit' && i.label.toLowerCase().includes(v));
      else if (key === 'type') filtered = this.allData.filter(i => i.type === v);
    }

    this.renderResults(filtered);
  }

  renderResults(items) {
    this.results.innerHTML = '';
    if (!items.length && this.input.value.trim()) {
      this.results.innerHTML = '<div class="search-empty">No results found</div>';
      return;
    }

    const grouped = {};
    items.forEach(i => { if (!grouped[i.type]) grouped[i.type] = []; grouped[i.type].push(i); });

    for (const [type, group] of Object.entries(grouped)) {
      const header = document.createElement('div');
      header.className = 'search-section-header';
      header.textContent = type.charAt(0).toUpperCase() + type.slice(1) + 's';
      this.results.appendChild(header);

      group.forEach((item, idx) => {
        const el = document.createElement('div');
        el.className = 'search-result-item';
        el.innerHTML = `
          <span class="search-result-icon">${this.iconForType(type)}</span>
          <span class="search-result-content">
            <div class="search-result-title">${this.highlight(item.label, this.input.value)}</div>
            <div class="search-result-subtitle">${item.subtitle}</div>
          </span>
          <span class="search-result-meta">${item.detail}</span>
        `;
        el.onclick = () => this.select(item);
        this.results.appendChild(el);
      });
    }
  }

  iconForType(type) {
    const m = { branch: '⎇', commit: '●', file: '□', repo: '📁', tag: '🏷', action: '>' };
    return m[type] || '·';
  }

  highlight(text, query) {
    if (!query) return this.esc(text);
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return this.esc(text).replace(re, '<span class="highlight">$1</span>');
  }

  esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  handleKey(e) {
    const items = this.results.querySelectorAll('.search-result-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); this.selectedIdx = Math.min(this.selectedIdx + 1, items.length - 1); this.updateSelection(items); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.selectedIdx = Math.max(this.selectedIdx - 1, 0); this.updateSelection(items); }
    else if (e.key === 'Enter' && this.selectedIdx >= 0) { e.preventDefault(); items[this.selectedIdx]?.click(); this.hide(); }
  }

  updateSelection(items) {
    items.forEach((el, i) => el.classList.toggle('selected', i === this.selectedIdx));
    const sel = items[this.selectedIdx];
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  select(item) {
    this.hide();
    if (item.type === 'branch') {
      if (item.data.name.startsWith('remotes/')) {
        const local = item.data.name.replace('remotes/', '').split('/').pop();
        this.app.branchList.checkoutRemote(local, item.data.name.replace('remotes/', ''));
      } else {
        this.app.branchList.checkout(item.data.name);
      }
    } else if (item.type === 'commit') {
      this.app.emit('commit:selected', item.data.hash);
    } else if (item.type === 'action') {
      if (item.data.action === 'fetch') this.app.doFetch();
      else if (item.data.action === 'pull') this.app.doPull();
      else if (item.data.action === 'push') this.app.doPush();
      else if (item.data.action === 'create-branch') this.app.branchList.promptCreateBranch();
    } else if (item.type === 'repo') {
      this.app.repoTabs.addRepo(item.data.path);
    }
  }

  fmtDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
