class BranchListView {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.data = null;
    this.filter = '';
    this.collapsedFolders = this.restoreSet('gittree.sidebar.branchFolders');
    this.collapsedGroups = this.restoreSet('gittree.sidebar.branchGroups');
    this.selectedBranchKey = null;
    this.selectedBranchElement = null;
    this.metadata = null;
    this.status = null;
    this.operationState = null;
    this.searchInput = document.getElementById('branch-search');
    if (this.searchInput) {
      this.searchInput.addEventListener('input', () => {
        this.filter = this.searchInput.value.toLowerCase();
        this.render();
      });
    }
    this.container.addEventListener('click', event => {
      const row = event.target.closest('.branch-item');
      if (row && this.container.contains(row)) this.selectBranchRow(row);
    });
    this.container.addEventListener('dblclick', event => {
      const row = event.target.closest('.branch-item');
      if (row && this.container.contains(row)) this.activateBranchRow(row);
    });
    this.container.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      const row = event.target.closest('.branch-item');
      if (!row || !this.container.contains(row)) return;
      event.preventDefault();
      this.activateBranchRow(row);
    });
    this.container.addEventListener('contextmenu', event => {
      const row = event.target.closest('.branch-item');
      if (!row || !this.container.contains(row)) return;
      this.selectBranchRow(row);
      const branch = this.metadata?.branches?.find(item => (
        item.kind === row.dataset.branchKind && item.name === row.dataset.branchName
      ));
      if (!branch) return;
      this.app.components.branchContextMenu.open(
        event, branch, this.metadata, this.status, this.operationState
      );
    });
  }

  async load(repoPath) {
    try {
      this.app.components.branchContextMenu?.close();
      const [result, metadata, status, operationState] = await Promise.all([
        window.gitTree.getBranches(repoPath),
        window.gitTree.getBranchMetadata(repoPath),
        window.gitTree.getStatus(repoPath),
        window.gitTree.getOperationState(repoPath)
      ]);
      if (result?.error) { this.container.innerHTML = ''; return; }
      this.data = result;
      this.metadata = metadata?.error ? null : metadata;
      this.status = status?.error ? null : status;
      this.operationState = operationState?.error ? null : operationState;
      if (this.searchInput) this.searchInput.value = '';
      this.filter = '';
      this.selectedBranchKey = null;
      this.selectedBranchElement = null;
      this.render();
    } catch { this.container.innerHTML = ''; }
  }

  render() {
    this.container.innerHTML = '';
    this.selectedBranchElement = null;
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
      this.persistSet('gittree.sidebar.branchGroups', this.collapsedGroups);
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
      const folderKey = `${groupId}:${folder}`;
      const fCollapsed = this.collapsedFolders.has(folderKey);

      const folderHeader = document.createElement('div');
      folderHeader.className = 'branch-folder-header';
      folderHeader.innerHTML = `
        <i class="ph ph-caret-down branch-folder-arrow${fCollapsed ? ' collapsed' : ''}"></i>
        <i class="ph ph-folder-simple"></i>
        <span class="branch-folder-name">${this.esc(folder)}/</span>
        <span class="branch-folder-count">${items.length}</span>
      `;
      folderHeader.onclick = () => {
        if (this.collapsedFolders.has(folderKey)) this.collapsedFolders.delete(folderKey);
        else this.collapsedFolders.add(folderKey);
        this.persistSet('gittree.sidebar.branchFolders', this.collapsedFolders);
        this.render();
      };
      frag.appendChild(folderHeader);

      if (!fCollapsed) {
        items.forEach(b => {
          const leafName = b.name.slice(folder.length + 1);
          frag.appendChild(this.branchRow(b, current, isRemote, leafName));
        });
      }
    }
  }

  branchRow(branch, current, isRemote = false, displayName = branch.name) {
    const el = document.createElement('div');
    el.className = 'branch-item';
    if (displayName !== branch.name) el.classList.add('is-nested');
    el.tabIndex = 0;
    el.dataset.branchName = branch.name;
    el.dataset.remote = String(isRemote);
    el.dataset.branchKind = isRemote ? 'remote' : 'local';
    if (!isRemote && branch.name === current) el.classList.add('active');
    const selectionKey = `${isRemote ? 'remote' : 'local'}:${branch.name}`;
    el.dataset.selectionKey = selectionKey;
    if (selectionKey === this.selectedBranchKey) {
      el.classList.add('selected');
      this.selectedBranchElement = el;
    }

    const icon = document.createElement('i');
    icon.className = `ph ${isRemote ? 'ph-cloud' : 'ph-git-branch'} branch-icon`;

    const name = document.createElement('span');
    name.className = 'branch-name';
    name.textContent = displayName;
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
    return el;
  }

  selectBranchRow(row) {
    if (this.selectedBranchElement && this.selectedBranchElement !== row) {
      this.selectedBranchElement.classList.remove('selected');
    }
    this.selectedBranchKey = row.dataset.selectionKey;
    this.selectedBranchElement = row;
    row.classList.add('selected');
  }

  activateBranchRow(row) {
    const branchName = row.dataset.branchName;
    if (!branchName) return;
    if (row.dataset.remote === 'true') {
      this.checkoutRemote(branchName.split('/').pop(), branchName);
    } else {
      this.checkout(branchName);
    }
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
    const r = await window.gitTree.checkoutTrackingBranch(repo.path, remoteName);
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

  restoreSet(storageKey) {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey));
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  }

  persistSet(storageKey, values) {
    localStorage.setItem(storageKey, JSON.stringify([...values]));
  }

  esc(value) {
    const element = document.createElement('div');
    element.textContent = value;
    return element.innerHTML;
  }
}
