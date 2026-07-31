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
      if (
        this.app.isPrimaryModifier(e) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'p'
      ) {
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
    this.overlay.classList.remove('is-hidden');
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
          for (const name of Object.keys(branches.branches)) {
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

    if (this.app.components.repoTabs?.repos) {
      this.app.components.repoTabs.repos.forEach(r => {
        this.allData.push({ type: 'repo', label: r.name, subtitle: r.path, detail: 'Repository', data: { path: r.path } });
      });
    }

    this.allData.push(
      { type: 'action', label: t('actions.fetch'), subtitle: '', detail: t('actions.fetch'), data: { action: 'fetch' } },
      { type: 'action', label: t('actions.pull'), subtitle: '', detail: t('actions.pull'), data: { action: 'pull' } },
      { type: 'action', label: t('actions.push'), subtitle: '', detail: t('actions.push'), data: { action: 'push' } },
      { type: 'action', label: t('actions.createBranch'), subtitle: '', detail: t('actions.createBranch'), data: { action: 'create-branch' } }
    );

    setTimeout(() => this.input.focus(), 50);
  }

  hide() {
    this.visible = false;
    this.overlay.classList.add('is-hidden');
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
      this.results.innerHTML = `<div class="search-empty">${t('search.empty')}</div>`;
      return;
    }

    const grouped = {};
    items.forEach(i => { if (!grouped[i.type]) grouped[i.type] = []; grouped[i.type].push(i); });

    for (const [type, group] of Object.entries(grouped)) {
      const header = document.createElement('div');
      header.className = 'search-section-header';
      header.textContent = this.groupLabel(type);
      this.results.appendChild(header);

      group.forEach((item, idx) => {
        const el = document.createElement('div');
        el.className = 'search-result-item';
        el.innerHTML = `
          <span class="search-result-icon"><i class="${this.iconForType(type)}"></i></span>
          <span class="search-result-content">
            <div class="search-result-title">${this.highlight(item.label, this.input.value)}</div>
            <div class="search-result-subtitle">${this.esc(item.subtitle)}</div>
          </span>
          <span class="search-result-meta">${this.esc(item.detail)}</span>
        `;
        el.onclick = () => this.select(item);
        this.results.appendChild(el);
      });
    }
  }

  iconForType(type) {
    const icons = {
      branch: 'ph ph-git-branch',
      commit: 'ph ph-git-commit',
      file: 'ph ph-file-code',
      repo: 'ph ph-folder-simple',
      tag: 'ph ph-tag',
      action: 'ph ph-command'
    };
    return icons[type] || 'ph ph-circle';
  }

  groupLabel(type) {
    const labels = {
      branch: t('search.branches'),
      commit: t('search.commits'),
      file: t('search.files'),
      repo: t('search.repositories'),
      tag: t('sidebar.tags'),
      action: t('search.actions')
    };
    return labels[type] || type;
  }

  highlight(text, query) {
    if (!query) return this.esc(text);
    const safeQuery = this.esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${safeQuery})`, 'gi');
    return this.esc(text).replace(re, '<span class="highlight">$1</span>');
  }

  esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

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
        this.app.components.branchList.checkoutRemote(local, item.data.name.replace('remotes/', ''));
      } else {
        this.app.components.branchList.checkout(item.data.name);
      }
    } else if (item.type === 'commit') {
      this.app.emit('commit:selected', item.data.hash);
    } else if (item.type === 'action') {
      if (item.data.action === 'fetch') this.app.doFetch();
      else if (item.data.action === 'pull') this.app.doPull();
      else if (item.data.action === 'push') this.app.doPush();
      else if (item.data.action === 'create-branch') this.app.components.branchList.promptCreateBranch();
    } else if (item.type === 'repo') {
      const index = this.app.components.repoTabs.repos.findIndex(repo => repo.path === item.data.path);
      if (index >= 0) this.app.components.repoTabs.selectRepo(index);
    }
  }

  fmtDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
