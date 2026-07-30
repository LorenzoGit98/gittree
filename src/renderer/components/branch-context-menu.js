class BranchContextMenu {
  constructor(app) {
    this.app = app;
    this.branch = null;
    this.metadata = null;
    this.status = null;
    this.operationState = null;
    this.element = document.createElement('div');
    this.element.className = 'branch-context-menu is-hidden';
    this.element.setAttribute('role', 'menu');
    document.body.appendChild(this.element);

    this.onDocumentPointer = event => {
      if (!this.element.contains(event.target)) this.close();
    };
    this.onDocumentClick = event => {
      if (!this.element.contains(event.target)) this.close();
    };
    this.onScroll = event => {
      if (!this.element.contains(event.target)) this.close();
    };
    this.onKeyDown = event => this.handleKeyDown(event);
    document.addEventListener('pointerdown', this.onDocumentPointer, true);
    document.addEventListener('click', this.onDocumentClick, true);
    document.addEventListener('scroll', this.onScroll, true);
    document.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', () => this.close());
    window.addEventListener('blur', () => this.close());
  }

  open(event, branch, metadata, status, operationState, selectedBranches = []) {
    event.preventDefault();
    this.branch = branch;
    this.metadata = metadata || { branches: [], remotes: [] };
    this.status = status || {};
    this.operationState = operationState || {};
    this.selectedBranches = selectedBranches.length > 1 ? selectedBranches : [];
    this.render();
    this.element.classList.remove('is-hidden');
    this.place(event.clientX, event.clientY);
    requestAnimationFrame(() => this.focusFirst());
  }

  close() {
    if (this.element.classList.contains('is-hidden')) return;
    this.element.classList.add('is-hidden');
    this.element.innerHTML = '';
    this.branch = null;
  }

  render() {
    const b = this.branch;
    const current = this.metadata.current || this.app.state.currentBranch;
    const pending = Boolean(this.operationState?.type);
    const dirty = this.status && this.status.isClean === false;
    const isLocal = b.kind === 'local';
    const isCurrent = isLocal && b.current;
    const remoteParts = b.kind === 'remote' ? this.splitRemote(b.name) : null;
    const upstreamParts = b.upstream ? this.splitRemote(b.upstream) : null;
    const currentMetadata = (this.metadata.branches || []).find(item => item.current);
    const pullUpstream = isLocal
      ? (isCurrent ? b.upstream : '')
      : (currentMetadata?.upstream === b.name ? b.name : '');
    const sourceRef = b.name;
    const mutationReason = pending
      ? t('branchMenu.pendingOperation', { operation: this.operationState.type })
      : '';
    const blockingFiles = [
      ...(this.status?.modified || []),
      ...(this.status?.not_added || []),
      ...(this.status?.created || []),
      ...(this.status?.deleted || [])
    ];
    const cleanReason = dirty
      ? `${t('branchMenu.cleanRequired')}${blockingFiles.length ? `: ${blockingFiles.slice(0, 3).join(', ')}${blockingFiles.length > 3 ? '…' : ''}` : ''}`
      : mutationReason;
    const remotes = this.metadata.remotes || [];
    const remoteBranches = (this.metadata.branches || []).filter(item => item.kind === 'remote');

    const isMulti = this.selectedBranches.length > 1;

    if (isMulti) {
      const localSelected = this.selectedBranches.filter(br => br.kind === 'local');
      const actions = [
        this.item('ph-trash', t('branchMenu.deleteMultiple', { count: localSelected.length }), 'batch-delete',
          !localSelected.length || pending, mutationReason, true),
        this.item('ph-arrows-left-right', t('branchMenu.compareMultiple', { count: this.selectedBranches.length }), 'batch-compare',
          this.selectedBranches.length < 2, '')
      ].filter(Boolean);

      this.element.innerHTML = actions.map(action => this.renderItem(action)).join('');
      this.element.querySelectorAll('[data-action]:not([aria-disabled="true"])').forEach(item => {
        item.addEventListener('click', event => {
          event.stopPropagation();
          const action = item.dataset.action;
          if (action) this.execute(action);
        });
      });
      return;
    }

    const actions = [
      this.item('ph-arrow-circle-right', t('branchMenu.checkout', { branch: b.name }), 'checkout',
        isCurrent || pending, isCurrent ? t('branchMenu.alreadyCurrent') : mutationReason),
      this.item('ph-git-merge', t('branchMenu.mergeIntoCurrent', {
        branch: b.name,
        target: current
      }), 'merge',
        b.name === current || pending,
        b.name === current ? t('branchMenu.sameBranch') : cleanReason),
      this.item('ph-git-branch', t('branchMenu.rebaseOnto', { branch: b.name }), 'rebase',
        b.name === current || dirty || pending,
        b.name === current ? t('branchMenu.sameBranch') : cleanReason),
      { separator: true },
      this.item('ph-cloud-arrow-down', t('branchMenu.fetch', { branch: b.name }), 'fetch',
        (!remoteParts && !upstreamParts) || pending,
        mutationReason || t('branchMenu.noUpstream')),
      this.item('ph-download-simple', t('branchMenu.pullTracked'), 'pull',
        !pullUpstream || pending,
        !pullUpstream ? t('branchMenu.currentOnly') : mutationReason),
      isLocal
        ? this.submenu('ph-upload-simple', b.upstream ? t('branchMenu.pushTracked') : t('branchMenu.pushTo'), [
            ...(b.upstream ? [this.item('ph-arrow-up', b.upstream, 'push-tracked', pending, mutationReason)] : []),
            ...remotes.map(remote => this.item('ph-cloud', remote.name, `push:${remote.name}`, pending, mutationReason))
          ], remotes.length === 0, t('branchMenu.noRemotes'))
        : null,
      isLocal
        ? this.submenu('ph-link', t('branchMenu.trackRemote'), remoteBranches.map(remoteBranch =>
            this.item('ph-cloud', remoteBranch.name, `track:${remoteBranch.name}`, pending, mutationReason)
          ), remoteBranches.length === 0, t('branchMenu.noRemoteBranches'))
        : null,
      dirty && isLocal
        ? this.item('ph-archive', t('branchMenu.stashChanges'), 'stash', pending, mutationReason)
        : null,
      { separator: true },
      this.item('ph-arrows-left-right', t('branchMenu.diffAgainstCurrent'), 'diff',
        b.name === current, t('branchMenu.sameBranch')),
      { separator: true },
      isLocal
        ? this.item('ph-pencil-simple', t('branchMenu.rename', { branch: b.name }), 'rename',
            pending, mutationReason)
        : this.item('ph-pencil-simple', t('branchMenu.renameUnavailable'), null, true,
            t('branchMenu.localOnly')),
      this.item('ph-trash', t('branchMenu.delete', { branch: b.name }), 'delete',
        isCurrent || pending, isCurrent ? t('branchMenu.deleteCurrent') : mutationReason, true),
      { separator: true },
      this.item('ph-git-pull-request', t('branchMenu.createPullRequest'), 'pull-request',
        !this.hasSupportedProvider() || pending,
        mutationReason || t('branchMenu.unsupportedProvider'))
    ].filter(Boolean);

    this.element.innerHTML = actions.map(action => this.renderItem(action)).join('');
    this.element.querySelectorAll('[data-action]:not([aria-disabled="true"])').forEach(item => {
      item.addEventListener('click', event => {
        event.stopPropagation();
        const action = item.dataset.action;
        if (action) this.execute(action);
      });
    });
  }

  item(icon, label, action, disabled = false, reason = '', danger = false) {
    return { icon, label, action, disabled, reason, danger };
  }

  submenu(icon, label, children, disabled = false, reason = '') {
    return { icon, label, children, disabled, reason };
  }

  renderItem(item) {
    if (item.separator) return '<div class="branch-menu-separator" role="separator"></div>';
    const disabled = item.disabled ? ' aria-disabled="true"' : '';
    const action = item.action ? ` data-action="${this.esc(item.action)}"` : '';
    const title = item.reason ? ` title="${this.esc(item.reason)}"` : '';
    const danger = item.danger ? ' danger' : '';
    const submenu = item.children ? ' has-submenu' : '';
    const childHtml = item.children
      ? `<div class="branch-context-submenu" role="menu">${item.children.map(child => this.renderItem(child)).join('')}</div>`
      : '';
    return `<div class="branch-menu-item${danger}${submenu}" role="menuitem" tabindex="-1"${action}${disabled}${title}>
      <i class="ph ${item.icon}" aria-hidden="true"></i>
      <span>${this.esc(item.label)}</span>
      ${item.children ? '<i class="ph ph-caret-right branch-menu-caret" aria-hidden="true"></i>' : ''}
      ${childHtml}
    </div>`;
  }

  async execute(action) {
    const repo = this.app.state.repo;
    const b = this.branch;
    if (!repo || !b) return;
    this.close();

    if (action === 'batch-delete') {
      this.app.components.branchList.batchDelete();
      return;
    }
    if (action === 'batch-compare') {
      this.app.components.branchList.batchCompare();
      return;
    }

    let result;
    try {
      if (action === 'checkout') {
        result = b.kind === 'remote'
          ? await window.gitTree.checkoutTrackingBranch(repo.path, b.name)
          : await window.gitTree.checkoutBranch(repo.path, b.name);
      } else if (action === 'merge') {
        this.app.components.merge.open(
          b.name,
          this.metadata.current || this.app.state.currentBranch
        );
        return;
      } else if (action === 'rebase') {
        result = await window.gitTree.rebaseBranch(repo.path, b.name);
      } else if (action === 'fetch') {
        const parts = b.kind === 'remote' ? this.splitRemote(b.name) : this.splitRemote(b.upstream);
        result = await window.gitTree.fetchBranch(repo.path, parts.remote, parts.branch);
      } else if (action === 'pull') {
        const parts = this.splitRemote(b.kind === 'remote' ? b.name : b.upstream);
        result = await window.gitTree.pull(repo.path, parts.remote, parts.branch);
      } else if (action === 'push-tracked') {
        const parts = this.splitRemote(b.upstream);
        result = await window.gitTree.push(repo.path, parts.remote, b.name);
      } else if (action.startsWith('push:')) {
        result = await window.gitTree.push(repo.path, action.slice(5), b.name, !b.upstream);
      } else if (action.startsWith('track:')) {
        result = await window.gitTree.trackBranch(repo.path, b.name, action.slice(6));
      } else if (action === 'stash') {
        result = await window.gitTree.stash(repo.path, `GitTree: before branch operation on ${b.name}`);
      } else if (action === 'diff') {
        await this.app.components.compare.compare(b.name, this.metadata.current);
        return;
      } else if (action === 'rename') {
        const nextName = await this.promptText(t('branchMenu.renameTitle'), b.name);
        if (!nextName || nextName === b.name) return;
        result = await window.gitTree.renameBranch(repo.path, b.name, nextName);
      } else if (action === 'delete') {
        result = await this.deleteBranch(repo.path, b);
        if (!result) return;
      } else if (action === 'pull-request') {
        await this.openPullRequest(repo.path, b);
        return;
      }

      if (result?.error) {
        if (result.conflictState?.type) await this.app.components.conflict.open(result.conflictState);
        this.app.showToast(result.error, 'error');
        return;
      }
      if (action === 'checkout') {
        await this.app.afterBranchCheckout(result);
        this.app.showToast(t('branchMenu.operationComplete'), 'success');
        return;
      }
      this.app.showToast(t('branchMenu.operationComplete'), 'success');
      this.app.emit('refresh');
    } catch (error) {
      this.app.showToast(error.message, 'error');
    }
  }

  async deleteBranch(repoPath, branch) {
    const confirmed = await this.confirm(
      t('branchMenu.deleteTitle'),
      t('branchMenu.deleteConfirm', { branch: branch.name }),
      t('branchMenu.deleteAction')
    );
    if (!confirmed) return null;
    if (branch.kind === 'remote') {
      const parts = this.splitRemote(branch.name);
      return window.gitTree.deleteRemoteBranch(repoPath, parts.remote, parts.branch);
    }
    const safe = await window.gitTree.deleteBranch(repoPath, branch.name, false);
    if (!safe?.error) return safe;
    const force = await this.confirm(
      t('branchMenu.forceDeleteTitle'),
      t('branchMenu.forceDeleteConfirm', { branch: branch.name }),
      t('branchMenu.forceDeleteAction'),
      true
    );
    return force ? window.gitTree.deleteBranch(repoPath, branch.name, true) : null;
  }

  async openPullRequest(repoPath, branch) {
    const supported = (this.metadata.remotes || []).filter(remote => remote.provider?.provider);
    if (!supported.length) return;
    const upstream = branch.upstream ? this.splitRemote(branch.upstream) : null;
    const defaultRemote = supported.find(remote => remote.name === upstream?.remote) || supported[0];
    const provider = defaultRemote.provider?.provider;
    const canApi = ['github', 'gitlab', 'azure'].includes(provider)
      && (await window.gitTree.getProviderStatus(provider))?.connected;
    if (canApi && this.app.components.pullRequests) {
      const view = this.app.components.pullRequests;
      const source = branch.kind === 'remote'
        ? this.splitRemote(branch.name).branch
        : branch.name;
      this.app.setWorkspaceMode('pullRequests');
      await view.setProvider(provider);
      await view.openCreateDialog({ source, force: true });
      return;
    }
    const values = await this.pullRequestDialog(defaultRemote.name, this.metadata.defaultBranch);
    if (!values) return;
    let source = branch.kind === 'remote' ? this.splitRemote(branch.name).branch : branch.name;
    if (branch.kind === 'local' && (!branch.upstream || upstream.remote !== values.remote)) {
      const pushed = await window.gitTree.push(repoPath, values.remote, branch.name, true);
      if (pushed?.error) {
        this.app.showToast(pushed.error, 'error');
        return;
      }
    }
    const result = await window.gitTree.openPullRequest(
      repoPath, values.remote, source, values.target
    );
    if (result?.error) this.app.showToast(result.error, 'error');
  }

  pullRequestDialog(remote, target) {
    return this.formDialog(t('branchMenu.prTitle'), `
      <label>${this.esc(t('branchMenu.remoteLabel'))}
        <select name="remote">${(this.metadata.remotes || []).filter(item => item.provider?.provider)
          .map(item => `<option value="${this.esc(item.name)}"${item.name === remote ? ' selected' : ''}>${this.esc(item.name)}</option>`)
          .join('')}</select>
      </label>
      <label>${this.esc(t('branchMenu.targetLabel'))}
        <input name="target" value="${this.esc(target || '')}" required>
      </label>
    `, form => ({ remote: form.elements.remote.value, target: form.elements.target.value.trim() }));
  }

  promptText(title, value = '') {
    return this.formDialog(title, `<label>${this.esc(t('branchMenu.branchNameLabel'))}<input name="value" value="${this.esc(value)}" required autofocus></label>`,
      form => form.elements.value.value.trim());
  }

  formDialog(title, fields, extract) {
    const overlay = document.getElementById('modal-overlay');
    const dialog = document.getElementById('modal-dialog');
    return new Promise(resolve => {
      dialog.innerHTML = `<form class="branch-dialog-form">
        <h3>${this.esc(title)}</h3>${fields}
        <div class="confirm-actions">
          <button class="btn" type="button" data-cancel>${this.esc(t('common.cancel'))}</button>
          <button class="btn btn-primary" type="submit">${this.esc(t('common.continue'))}</button>
        </div>
      </form>`;
      overlay.classList.remove('is-hidden');
      const finish = value => {
        overlay.classList.add('is-hidden');
        dialog.innerHTML = '';
        resolve(value);
      };
      dialog.querySelector('[data-cancel]').onclick = () => finish(null);
      dialog.querySelector('form').onsubmit = event => {
        event.preventDefault();
        finish(extract(event.currentTarget));
      };
      dialog.querySelector('input,select')?.focus();
    });
  }

  confirm(title, message, actionLabel, danger = false) {
    const overlay = document.getElementById('modal-overlay');
    const dialog = document.getElementById('modal-dialog');
    return new Promise(resolve => {
      dialog.innerHTML = `<h3>${this.esc(title)}</h3><p>${this.esc(message)}</p>
        <div class="confirm-actions">
          <button class="btn" data-cancel>${this.esc(t('common.cancel'))}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${this.esc(actionLabel)}</button>
        </div>`;
      overlay.classList.remove('is-hidden');
      const finish = value => {
        overlay.classList.add('is-hidden');
        dialog.innerHTML = '';
        resolve(value);
      };
      dialog.querySelector('[data-cancel]').onclick = () => finish(false);
      dialog.querySelector('[data-confirm]').onclick = () => finish(true);
    });
  }

  place(x, y) {
    this.element.classList.toggle('open-left', x > window.innerWidth - 620);
    this.element.classList.toggle('open-up', y > window.innerHeight - 440);
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
    const rect = this.element.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin));
    const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));
    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
  }

  focusFirst() {
    this.element.querySelector('.branch-menu-item:not([aria-disabled="true"])')?.focus();
  }

  handleKeyDown(event) {
    if (this.element.classList.contains('is-hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    const active = document.activeElement;
    const items = [...(active?.parentElement || this.element).children]
      .filter(item => item.classList?.contains('branch-menu-item') && item.getAttribute('aria-disabled') !== 'true');
    const index = items.indexOf(active);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + delta + items.length) % items.length]?.focus();
    } else if (event.key === 'ArrowRight') {
      const child = active?.querySelector('.branch-context-submenu .branch-menu-item:not([aria-disabled="true"])');
      if (child) { event.preventDefault(); child.focus(); }
    } else if (event.key === 'ArrowLeft' && active?.closest('.branch-context-submenu')) {
      event.preventDefault();
      active.closest('.has-submenu')?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      active?.click();
    }
  }

  splitRemote(value = '') {
    const index = value.indexOf('/');
    return { remote: value.slice(0, index), branch: value.slice(index + 1) };
  }

  hasSupportedProvider() {
    return (this.metadata.remotes || []).some(remote => remote.provider?.provider);
  }

  esc(value) {
    const element = document.createElement('div');
    element.textContent = value ?? '';
    return element.innerHTML;
  }
}
