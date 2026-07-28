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
    this.branchMetadataByKey = new Map();
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
    this.setLoading(true);
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
      this.branchMetadataByKey = new Map(
        (this.metadata?.branches || []).map(branch => [
          `${branch.kind}:${branch.name}`,
          branch
        ])
      );
      this.status = status?.error ? null : status;
      this.operationState = operationState?.error ? null : operationState;
      if (this.searchInput) this.searchInput.value = '';
      this.filter = '';
      this.selectedBranchKey = null;
      this.selectedBranchElement = null;
      this.render();
    } catch { this.container.innerHTML = ''; }
    finally { this.setLoading(false); }
  }

  setLoading(loading) {
    this.loading = loading;
    this.container.classList.toggle('is-project-loading', loading);
    if (loading) {
      this.container.innerHTML = `<div class="project-loading-inline" role="status" aria-live="polite">
        <i class="ph ph-circle-notch" aria-hidden="true"></i>
        <span>${t('common.loading')}</span>
      </div>`;
    }
  }

  setCurrentBranch(branchName) {
    if (!branchName) return;
    if (this.data) this.data.current = branchName;
    if (this.status) this.status.current = branchName;
    if (this.metadata) this.metadata.current = branchName;
    for (const branch of this.metadata?.branches || []) {
      if (branch.kind === 'local') branch.current = branch.name === branchName;
    }
    this.container.querySelectorAll('.branch-item[data-remote="false"]').forEach(row => {
      row.classList.toggle('active', row.dataset.branchName === branchName);
    });
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
    const metadata = this.branchMetadataByKey.get(
      `${isRemote ? 'remote' : 'local'}:${branch.name}`
    );
    const syncSummary = document.createElement('span');
    syncSummary.className = 'sync-indicator branch-sync-summary';
    if (!isRemote && metadata?.ahead > 0) {
      syncSummary.appendChild(this.syncBadge('ahead', metadata.ahead, metadata.upstream));
    }
    if (!isRemote && metadata?.behind > 0) {
      syncSummary.appendChild(this.syncBadge('behind', metadata.behind, metadata.upstream));
    }
    if (syncSummary.childElementCount) meta.appendChild(syncSummary);
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

  syncBadge(direction, count, upstream) {
    const label = t(`sidebar.${direction}OfUpstream`, { count, upstream });
    const badge = document.createElement('span');
    badge.className = `sync-indicator-part branch-sync-badge is-${direction}`;
    badge.title = label;
    badge.setAttribute('aria-label', label);

    const icon = document.createElement('i');
    icon.className = `ph ph-arrow-${direction === 'ahead' ? 'up' : 'down'}`;
    icon.setAttribute('aria-hidden', 'true');
    const value = document.createElement('span');
    value.textContent = String(count);

    badge.appendChild(icon);
    badge.appendChild(value);
    return badge;
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
    await this.app.afterBranchCheckout(r);
  }

  async checkoutRemote(localName, remoteName) {
    const repo = this.app.state.repo;
    if (!repo) return;
    const r = await window.gitTree.checkoutTrackingBranch(repo.path, remoteName);
    if (r.error) { this.app.showToast(r.error, 'error'); return; }
    await this.app.afterBranchCheckout(r);
  }

  async promptCreateBranch() {
    const repo = this.app.state.repo;
    if (!repo) return;
    const result = await this.quickBranchDialog(repo.path);
    if (!result?.success) return;
    this.app.showToast(t('feedback.branchCreated', { branch: result.name }), 'success');
    await this.app.refresh({ silent: true });
  }

  createBranch(repoPath, name) {
    return window.gitTree.createBranch(repoPath, name);
  }

  quickBranchDialog(repoPath) {
    const overlay = document.getElementById('modal-overlay');
    const dialog = document.getElementById('modal-dialog');
    const prefixes = {
      feature: BranchNaming.detectPrefix('feature', this.metadata),
      bugfix: BranchNaming.detectPrefix('bugfix', this.metadata)
    };
    const localNames = new Set(
      (this.metadata?.branches || [])
        .filter(branch => branch.kind === 'local')
        .map(branch => branch.name.toLowerCase())
    );

    return new Promise(resolve => {
      dialog.className = 'confirm-dialog quick-branch-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'quick-branch-title');
      dialog.innerHTML = `
        <form class="branch-dialog-form quick-branch-form">
          <div class="quick-branch-heading">
            <span class="eyebrow">${this.esc(t('sidebar.quickBranchEyebrow'))}</span>
            <h3 id="quick-branch-title">${this.esc(t('sidebar.quickBranchTitle'))}</h3>
            <p>${this.esc(t('sidebar.quickBranchHelp'))}</p>
          </div>
          <fieldset class="quick-branch-types">
            <legend>${this.esc(t('sidebar.branchType'))}</legend>
            <div class="segmented-control" role="group">
              <button class="btn active" type="button" data-branch-type="feature"
                aria-pressed="true">
                <i class="ph ph-sparkle" aria-hidden="true"></i>
                ${this.esc(t('sidebar.featureBranch'))}
              </button>
              <button class="btn" type="button" data-branch-type="bugfix"
                aria-pressed="false">
                <i class="ph ph-bug" aria-hidden="true"></i>
                ${this.esc(t('sidebar.bugfixBranch'))}
              </button>
              <button class="btn" type="button" data-branch-type="custom"
                aria-pressed="false">
                <i class="ph ph-pencil-simple" aria-hidden="true"></i>
                ${this.esc(t('sidebar.customBranch'))}
              </button>
            </div>
          </fieldset>
          <label>
            ${this.esc(t('sidebar.branchDescription'))}
            <input name="description" maxlength="160" required autofocus
              placeholder="${this.esc(t('sidebar.branchDescriptionPlaceholder'))}">
          </label>
          <div class="quick-branch-preview">
            <span>${this.esc(t('sidebar.branchPreview'))}</span>
            <code data-branch-preview>${this.esc(`${prefixes.feature}/`)}</code>
          </div>
          <p class="quick-branch-convention" data-branch-convention></p>
          <p class="quick-branch-error" data-branch-error aria-live="polite"></p>
          <div class="confirm-actions">
            <button class="btn" type="button" data-cancel>${this.esc(t('common.cancel'))}</button>
            <button class="btn btn-primary" type="submit" data-create disabled>
              <i class="ph ph-git-branch" aria-hidden="true"></i>
              ${this.esc(t('sidebar.createBranch'))}
            </button>
          </div>
        </form>`;
      overlay.classList.remove('is-hidden');

      const form = dialog.querySelector('form');
      const input = form.elements.description;
      const preview = dialog.querySelector('[data-branch-preview]');
      const convention = dialog.querySelector('[data-branch-convention]');
      const error = dialog.querySelector('[data-branch-error]');
      const create = dialog.querySelector('[data-create]');
      const cancel = dialog.querySelector('[data-cancel]');
      const typeButtons = [...dialog.querySelectorAll('[data-branch-type]')];
      let selectedType = 'feature';
      let submitting = false;

      const update = () => {
        const value = input.value;
        const name = BranchNaming.compose(selectedType, value, this.metadata);
        const exists = Boolean(name && localNames.has(name.toLowerCase()));
        preview.textContent = name || (
          selectedType === 'custom' ? t('sidebar.customBranchPlaceholder') : `${prefixes[selectedType]}/`
        );
        convention.textContent = selectedType === 'custom'
          ? t('sidebar.customConvention')
          : t('sidebar.detectedConvention', {
              prefix: `${prefixes[selectedType]}/`
            });
        input.placeholder = selectedType === 'custom'
          ? t('sidebar.customBranchPlaceholder')
          : t('sidebar.branchDescriptionPlaceholder');
        error.textContent = exists
          ? t('sidebar.branchAlreadyExists', { branch: name })
          : (value.trim() && !name ? t('sidebar.invalidBranchDescription') : '');
        create.disabled = submitting || !name || exists;
      };

      const finish = value => {
        document.removeEventListener('keydown', onKeydown);
        overlay.removeEventListener('click', onOverlayClick);
        overlay.classList.add('is-hidden');
        dialog.className = 'confirm-dialog';
        dialog.removeAttribute('role');
        dialog.removeAttribute('aria-modal');
        dialog.removeAttribute('aria-labelledby');
        dialog.innerHTML = '';
        resolve(value);
      };
      const onKeydown = event => {
        if (event.key !== 'Escape' || submitting) return;
        event.preventDefault();
        finish(null);
      };
      const onOverlayClick = event => {
        if (event.target === overlay && !submitting) finish(null);
      };

      typeButtons.forEach(button => {
        button.onclick = () => {
          selectedType = button.dataset.branchType;
          typeButtons.forEach(item => {
            const active = item === button;
            item.classList.toggle('active', active);
            item.setAttribute('aria-pressed', String(active));
          });
          update();
          input.focus();
        };
      });
      input.addEventListener('input', update);
      cancel.onclick = () => {
        if (!submitting) finish(null);
      };
      form.onsubmit = async event => {
        event.preventDefault();
        const name = BranchNaming.compose(selectedType, input.value, this.metadata);
        if (!name || localNames.has(name.toLowerCase())) return;
        submitting = true;
        form.classList.add('is-submitting');
        input.disabled = true;
        typeButtons.forEach(button => { button.disabled = true; });
        cancel.disabled = true;
        create.querySelector('i').className = 'ph ph-circle-notch';
        update();
        error.textContent = t('sidebar.creatingBranch');
        try {
          const result = await this.createBranch(repoPath, name);
          if (!result?.success || result?.error) {
            throw new Error(result?.error || t('sidebar.branchCreateFailed'));
          }
          finish({ ...result, name: result.name || name });
        } catch (branchError) {
          submitting = false;
          form.classList.remove('is-submitting');
          input.disabled = false;
          typeButtons.forEach(button => { button.disabled = false; });
          cancel.disabled = false;
          create.querySelector('i').className = 'ph ph-git-branch';
          update();
          error.textContent = branchError.message || t('sidebar.branchCreateFailed');
          input.focus();
        }
      };
      document.addEventListener('keydown', onKeydown);
      overlay.addEventListener('click', onOverlayClick);
      update();
      input.focus();
    });
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
