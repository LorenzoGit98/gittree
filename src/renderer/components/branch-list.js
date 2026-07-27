class BranchListView {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.data = null;
    this.filter = '';
    this.searchInput = document.getElementById('branch-search');
    if (this.searchInput) {
      this.searchInput.addEventListener('input', () => {
        this.filter = this.searchInput.value.toLowerCase();
        this.render();
      });
    }
  }

  async load(repoPath) {
    try {
      const result = await window.gitTree.getBranches(repoPath);
      if (result?.error) { this.container.innerHTML = ''; return; }
      this.data = result;
      if (this.searchInput) this.searchInput.value = '';
      this.filter = '';
      this.render();
    } catch { this.container.innerHTML = ''; }
  }

  render() {
    this.container.innerHTML = '';
    if (!this.data) return;
    const branches = this.data.branches || {};
    const current = this.data.current;
    const f = this.filter;

    let locals = [], remotes = [];
    for (const [name, info] of Object.entries(branches)) {
      if (name.startsWith('remotes/')) {
        remotes.push({ name: name.replace('remotes/', ''), full: name, info });
      } else {
        locals.push({ name, info });
      }
    }

    if (f) {
      locals = locals.filter(b => b.name.toLowerCase().includes(f));
      remotes = remotes.filter(b => b.name.toLowerCase().includes(f) || b.full.toLowerCase().includes(f));
    }

    const hasLocals = locals.length > 0;
    const hasRemotes = remotes.length > 0;

    if (!hasLocals && !hasRemotes) {
      this.container.innerHTML = f
        ? '<div style="padding:8px;text-align:center;color:var(--text-tertiary);font-size:11px">No branches match</div>'
        : '<div style="padding:8px;text-align:center;color:var(--text-tertiary);font-size:11px">No branches</div>';
      return;
    }

    const frag = document.createDocumentFragment();

    if (hasLocals) {
      frag.appendChild(this.groupHeader(`Local${f ? ' (' + locals.length + ')' : ''}`));
      locals.forEach(b => frag.appendChild(this.branchRow(b, current)));
    }

    if (hasRemotes) {
      frag.appendChild(this.groupHeader(`Remote${f ? ' (' + remotes.length + ')' : ''}`));
      remotes.forEach(b => frag.appendChild(this.branchRow(b, current, true)));
    }

    const addRow = document.createElement('div');
    addRow.className = 'create-branch-row';
    addRow.textContent = '+ Create branch';
    addRow.onclick = () => this.promptCreateBranch();
    frag.appendChild(addRow);

    this.container.appendChild(frag);
  }

  groupHeader(label) {
    const h = document.createElement('div');
    h.className = 'branch-group-header';
    h.textContent = label;
    return h;
  }

  branchRow(branch, current, isRemote = false) {
    const el = document.createElement('div');
    el.className = 'branch-item';
    if (!isRemote && branch.name === current) el.classList.add('active');

    const icon = document.createElement('span');
    icon.className = 'branch-icon';
    icon.textContent = branch.name === current && !isRemote ? '●' : '○';

    const name = document.createElement('span');
    name.className = 'branch-name';
    name.textContent = branch.name;
    name.title = isRemote ? `remotes/${branch.name}` : branch.name;

    const meta = document.createElement('span');
    meta.className = 'branch-meta';

    if (isRemote) {
      const bdg = document.createElement('span');
      bdg.className = 'badge badge-remote';
      bdg.textContent = 'remote';
      meta.appendChild(bdg);
    }

    el.appendChild(icon);
    el.appendChild(name);
    el.appendChild(meta);

    el.onclick = () => {
      if (isRemote) {
        const localName = branch.name.split('/').pop();
        this.checkoutRemote(localName, branch.name);
      } else {
        this.checkout(branch.name);
      }
    };

    return el;
  }

  async checkout(name) {
    const repo = this.app.state.repo;
    if (!repo) return;
    const r = await window.gitTree.checkoutBranch(repo.path, name);
    if (r.error) { this.app.showToast(r.error, 'error'); return; }
    this.app.emit('refresh');
  }

  async checkoutRemote(localName, remoteName) {
    const repo = this.app.state.repo;
    if (!repo) return;
    const r = await window.gitTree.createBranch(repo.path, localName, `origin/${remoteName}`);
    if (r.error) { this.app.showToast(r.error, 'error'); return; }
    this.app.emit('refresh');
  }

  async promptCreateBranch() {
    const name = prompt('Branch name:');
    if (!name) return;
    const repo = this.app.state.repo;
    if (!repo) return;
    const r = await window.gitTree.createBranch(repo.path, name);
    if (r.error) this.app.showToast(r.error, 'error');
    else this.app.emit('refresh');
  }

  get current() { return this.data?.current; }
}
