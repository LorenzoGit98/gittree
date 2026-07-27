class BranchListView {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.data = null;
    this.filter = '';
    this.collapsedFolders = new Set();
    this.collapsedGroups = new Set();
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
      remotes = remotes.filter(b => b.name.toLowerCase().includes(f));
    }

    if (!locals.length && !remotes.length) {
      this.container.innerHTML = `<div class="branch-empty">${f ? t('sidebar.noMatch') : t('sidebar.noBranches')}</div>`;
      return;
    }

    const frag = document.createDocumentFragment();

    if (locals.length) {
      this.renderCollapsibleGroup(frag, t('sidebar.local'), 'local', locals, current, false);
    }

    if (remotes.length) {
      this.renderCollapsibleGroup(frag, t('sidebar.remote'), 'remote', remotes, current, true);
    }

    this.container.appendChild(frag);
  }

  renderCollapsibleGroup(frag, label, groupId, branches, current, isRemote) {
    const collapsed = this.collapsedGroups.has(groupId);

    const header = document.createElement('div');
    header.className = 'branch-group-header';
    header.innerHTML = `
      <i class="ph ph-caret-down branch-group-arrow${collapsed ? ' collapsed' : ''}"></i>
      <span>${label}</span>
    `;
    header.onclick = () => {
      if (this.collapsedGroups.has(groupId)) this.collapsedGroups.delete(groupId);
      else this.collapsedGroups.add(groupId);
      this.render();
    };
    frag.appendChild(header);

    if (collapsed) return;

    const folders = new Map();
    const root = [];

    branches.forEach(b => {
      const idx = b.name.lastIndexOf('/');
      if (idx > 0) {
        const folder = b.name.substring(0, idx);
        if (!folders.has(folder)) folders.set(folder, []);
        folders.get(folder).push(b);
      } else {
        root.push(b);
      }
    });

    root.forEach(b => frag.appendChild(this.branchRow(b, current, isRemote)));

    for (const [folder, items] of folders) {
      const fCollapsed = this.collapsedFolders.has(folder);

      const folderHeader = document.createElement('div');
      folderHeader.className = 'branch-folder-header';
      folderHeader.innerHTML = `
        <i class="ph ph-caret-down branch-folder-arrow${fCollapsed ? ' collapsed' : ''}"></i>
        <i class="ph ph-folder-simple"></i>
        <span class="branch-folder-name">${this.esc(folder)}/</span>
        <span class="branch-folder-count">${items.length}</span>
      `;
      folderHeader.onclick = () => {
        if (this.collapsedFolders.has(folder)) this.collapsedFolders.delete(folder);
        else this.collapsedFolders.add(folder);
        this.render();
      };
      frag.appendChild(folderHeader);

      if (!fCollapsed) {
        items.forEach(b => frag.appendChild(this.branchRow(b, current, isRemote)));
      }
    }
  }

  branchRow(branch, current, isRemote = false) {
    const el = document.createElement('div');
    el.className = 'branch-item';
    if (!isRemote && branch.name === current) el.classList.add('active');

    const icon = document.createElement('i');
    icon.className = `ph ${isRemote ? 'ph-cloud' : 'ph-git-branch'} branch-icon`;

    const name = document.createElement('span');
    name.className = 'branch-name';
    name.textContent = branch.name;
    name.title = isRemote ? `remotes/${branch.name}` : branch.name;

    const meta = document.createElement('span');
    meta.className = 'branch-meta';
    if (isRemote) {
      const bdg = document.createElement('span');
      bdg.className = 'badge badge-remote';
      bdg.textContent = t('sidebar.remote');
      meta.appendChild(bdg);
    }

    el.appendChild(icon);
    el.appendChild(name);
    el.appendChild(meta);
    el.onclick = () => {
      if (isRemote) {
        this.checkoutRemote(branch.name.split('/').pop(), branch.name);
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

  esc(value) {
    const element = document.createElement('div');
    element.textContent = value;
    return element.innerHTML;
  }
}
