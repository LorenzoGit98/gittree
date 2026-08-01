class ChangesView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.repoPath = null;
    this.snapshot = null;
    this.identity = null;
    this.active = false;
    this.inflight = null;
    this.pollTimer = null;
    this.selected = null;
    this.diffRequest = 0;
    this.rowHeight = 38;
    this.overscan = 8;
    this.elements = {
      unstaged: document.getElementById('unstaged-files'),
      staged: document.getElementById('staged-files'),
      unstagedCount: document.getElementById('unstaged-count'),
      stagedCount: document.getElementById('staged-count'),
      modeCount: document.getElementById('workspace-changes-count'),
      stageAll: document.getElementById('btn-stage-all'),
      unstageAll: document.getElementById('btn-unstage-all'),
      discardAll: document.getElementById('btn-discard-all'),
      submoduleBar: document.getElementById('submodule-bar'),
      submodulesInit: document.getElementById('btn-submodules-init'),
      submodulesUpdate: document.getElementById('btn-submodules-update'),
      composer: document.getElementById('commit-composer'),
      summary: document.getElementById('commit-summary'),
      body: document.getElementById('commit-body'),
      amend: document.getElementById('commit-amend'),
      signoff: document.getElementById('commit-signoff'),
      signing: document.getElementById('commit-signing'),
      signingLabel: document.getElementById('commit-signing-label'),
      authorToggle: document.getElementById('commit-author-toggle'),
      authorFields: document.getElementById('commit-author-fields'),
      authorName: document.getElementById('commit-author-name'),
      authorEmail: document.getElementById('commit-author-email'),
      identityStatus: document.getElementById('commit-identity-status'),
      identityButton: document.getElementById('btn-commit-identity'),
      commitButton: document.getElementById('btn-commit')
    };
    this.bind();
  }

  bind() {
    this.elements.stageAll.onclick = () => this.mutatePaths(false, this.unstagedFiles());
    this.elements.unstageAll.onclick = () => this.mutatePaths(true, this.stagedFiles());
    this.elements.discardAll.onclick = () => this.discardPaths(this.unstagedFiles());
    this.elements.submodulesInit.onclick = () => this.runSubmoduleAction('init');
    this.elements.submodulesUpdate.onclick = () => this.runSubmoduleAction('update');
    this.elements.composer.onsubmit = event => {
      event.preventDefault();
      this.commit();
    };
    this.elements.identityButton.onclick = () => this.editIdentity();
    this.elements.authorToggle.onchange = () => {
      this.elements.authorFields.classList.toggle(
        'is-hidden',
        !this.elements.authorToggle.checked
      );
      this.persistComposer();
    };
    [
      this.elements.summary,
      this.elements.body,
      this.elements.amend,
      this.elements.signoff,
      this.elements.signing,
      this.elements.authorName,
      this.elements.authorEmail
    ].forEach(element => {
      element.addEventListener('input', () => this.persistComposer());
      element.addEventListener('change', () => this.persistComposer());
    });
    window.addEventListener('focus', () => this.syncPolling());
    window.addEventListener('blur', () => this.syncPolling());
  }

  async load(repoPath) {
    if (this.repoPath !== repoPath) {
      this.repoPath = repoPath;
      this.snapshot = null;
      this.selected = null;
      this.restoreComposer();
    }
    await Promise.all([this.refresh(true), this.refreshIdentity()]);
    this.syncPolling();
  }

  setActive(active) {
    this.active = active;
    this.root.classList.toggle('is-hidden', !active);
    this.syncPolling();
    if (active && this.repoPath) this.refresh();
  }

  syncPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.active && this.repoPath && document.hasFocus()) {
      this.pollTimer = setInterval(() => this.refresh(), 2000);
    }
  }

  async refresh(force = false) {
    if (!this.repoPath) return null;
    const pathAtStart = this.repoPath;
    if (this.inflight) return this.inflight;
    this.inflight = window.gitTree.getWorkingTree(pathAtStart)
      .then(snapshot => {
        if (pathAtStart !== this.repoPath) return null;
        if (snapshot?.error) {
          this.app.showToast(snapshot.error, 'error');
          return null;
        }
        if (force || snapshot.snapshotId !== this.snapshot?.snapshotId) {
          this.snapshot = snapshot;
          this.render();
        }
        return snapshot;
      })
      .catch(error => {
        this.app.showToast(error.message, 'error');
        return null;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  unstagedFiles() {
    return (this.snapshot?.files || []).filter(file => file.unstaged);
  }

  stagedFiles() {
    return (this.snapshot?.files || []).filter(file => file.staged);
  }

  render() {
    const unstaged = this.unstagedFiles();
    const staged = this.stagedFiles();
    const hasSubmodules = Boolean(this.snapshot?.submodules?.length);
    this.elements.submoduleBar.classList.toggle('is-hidden', !hasSubmodules);
    this.elements.unstagedCount.textContent = String(unstaged.length);
    this.elements.stagedCount.textContent = String(staged.length);
    this.elements.stageAll.disabled = unstaged.length === 0;
    this.elements.unstageAll.disabled = staged.length === 0;
    this.elements.discardAll.disabled = unstaged.length === 0;
    this.elements.commitButton.disabled =
      staged.length === 0 && !this.elements.amend.checked;
    const fileCount = this.snapshot?.files?.length || 0;
    this.elements.modeCount.textContent = String(fileCount);
    this.elements.modeCount.classList.toggle('is-hidden', fileCount === 0);
    this.renderVirtualList(this.elements.unstaged, unstaged, false);
    this.renderVirtualList(this.elements.staged, staged, true);
  }

  renderVirtualList(container, files, staged) {
    container.innerHTML = '';
    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'changes-empty';
      empty.textContent = t(staged ? 'changes.noStaged' : 'changes.noUnstaged');
      container.appendChild(empty);
      container.onscroll = null;
      return;
    }
    const spacer = document.createElement('div');
    spacer.className = 'changes-file-spacer';
    spacer.style.height = `${files.length * this.rowHeight}px`;
    container.appendChild(spacer);
    let frame = 0;
    const paint = () => {
      frame = 0;
      const visible = Math.ceil(container.clientHeight / this.rowHeight);
      const start = Math.max(
        0,
        Math.floor(container.scrollTop / this.rowHeight) - this.overscan
      );
      const end = Math.min(files.length, start + visible + this.overscan * 2);
      spacer.replaceChildren();
      const fragment = document.createDocumentFragment();
      for (let index = start; index < end; index += 1) {
        fragment.appendChild(this.createFileRow(files[index], staged, index));
      }
      spacer.appendChild(fragment);
    };
    container.onscroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
  }

  createFileRow(file, staged, index) {
    const row = document.createElement('div');
    row.className = 'changes-file-row';
    row.style.transform = `translateY(${index * this.rowHeight}px)`;
    row.setAttribute('role', 'listitem');
    row.classList.toggle(
      'selected',
      this.selected?.path === file.path && this.selected?.staged === staged
    );

    const status = document.createElement('span');
    status.className = 'changes-file-status';
    status.textContent = this.fileStatus(file, staged);

    const main = document.createElement('button');
    main.className = 'changes-file-main';
    main.type = 'button';
    main.title = file.path;
    const pathLabel = document.createElement('span');
    pathLabel.className = 'changes-file-path';
    pathLabel.textContent = file.path;
    main.appendChild(pathLabel);
    if (file.submodule) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-remote changes-submodule-badge';
      badge.textContent = t('changes.submodule');
      main.appendChild(badge);
    }
    main.onclick = () => this.selectFile(file, staged);

    const action = document.createElement('button');
    action.className = 'changes-file-action';
    action.type = 'button';
    action.title = t(staged ? 'changes.unstageFile' : 'changes.stageFile');
    action.setAttribute('aria-label', action.title);
    const icon = document.createElement('i');
    icon.className = staged ? 'ph ph-minus' : 'ph ph-plus';
    action.appendChild(icon);
    action.onclick = event => {
      event.stopPropagation();
      this.mutatePaths(staged, [file]);
    };
    if (!staged) {
      const discard = document.createElement('button');
      discard.className = 'changes-file-action changes-file-discard';
      discard.type = 'button';
      discard.title = t('changes.discardFile');
      discard.setAttribute('aria-label', discard.title);
      const discardIcon = document.createElement('i');
      discardIcon.className = 'ph ph-trash';
      discard.appendChild(discardIcon);
      discard.onclick = event => {
        event.stopPropagation();
        this.discardPaths([file]);
      };
      row.append(status, main, discard, action);
      return row;
    }
    row.append(status, main, action);
    return row;
  }

  async runSubmoduleAction(action) {
    if (!this.repoPath) return;
    const api = action === 'init'
      ? window.gitTree.initSubmodules
      : window.gitTree.updateSubmodules;
    const result = await api(this.repoPath);
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      return;
    }
    this.app.showToast(
      t(action === 'init' ? 'changes.submodulesInitialized' : 'changes.submodulesUpdated'),
      'success'
    );
    await this.refresh(true);
    this.app.components.branchList?.load(this.repoPath);
  }

  async discardPaths(files) {
    if (!this.snapshot || files.length === 0) return;
    const paths = files.map(file => file.path);
    const confirmed = await this.confirmDiscard(paths.length);
    if (!confirmed) return;
    const result = await window.gitTree.discardPaths(
      this.repoPath,
      this.snapshot.snapshotId,
      paths
    );
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      await this.refresh(true);
      return;
    }
    this.snapshot = result.snapshot;
    this.render();
    if (this.selected) {
      const file = this.snapshot.files.find(item => item.path === this.selected.path);
      if (file) await this.selectFile({ path: file.path }, Boolean(file.staged));
      else this.app.components.diffViewer.clear();
    }
    this.app.showToast(t('changes.discarded'), 'success');
  }

  confirmDiscard(count) {
    const overlay = document.getElementById('modal-overlay');
    const dialog = document.getElementById('modal-dialog');
    return new Promise(resolve => {
      dialog.innerHTML = `
        <h3>${this.esc(t('changes.discardTitle'))}</h3>
        <p>${this.esc(t('changes.discardConfirm', { count }))}</p>
        <div class="confirm-actions">
          <button class="btn" data-cancel>${this.esc(t('common.cancel'))}</button>
          <button class="btn btn-danger" data-confirm>${this.esc(t('changes.discardAction'))}</button>
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

  fileStatus(file, staged) {
    if (file.conflicted) return '!';
    if (file.untracked) return '?';
    const code = staged ? file.indexStatus : file.worktreeStatus;
    return code && code !== ' ' ? code : 'M';
  }

  async mutatePaths(unstage, files) {
    if (!this.snapshot || files.length === 0) return;
    const api = unstage ? window.gitTree.unstagePaths : window.gitTree.stagePaths;
    const result = await api(
      this.repoPath,
      this.snapshot.snapshotId,
      files.map(file => file.path)
    );
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      await this.refresh(true);
      return;
    }
    this.snapshot = result.snapshot;
    this.render();
    if (this.selected) {
      const file = this.snapshot.files.find(item => item.path === this.selected.path);
      if (file) await this.selectFile({ path: file.path }, Boolean(file.staged));
      else this.app.components.diffViewer.clear();
    }
  }

  async selectFile(file, staged) {
    this.selected = { path: file.path, staged };
    this.render();
    const request = ++this.diffRequest;
    const title = document.getElementById('detail-title');
    title.textContent = file.path.split('/').pop();
    title.title = file.path;
    const body = document.getElementById('detail-body');
    body.innerHTML = '';
    const loading = document.createElement('div');
    loading.className = 'diff-placeholder';
    loading.textContent = t('details.loading');
    body.appendChild(loading);
    const diff = await window.gitTree.getWorkingDiff(this.repoPath, file.path, staged);
    if (request !== this.diffRequest) return;
    if (diff?.error) {
      loading.textContent = diff.error;
      return;
    }
    this.renderWorkingDiff(diff, staged);
    this.app.pushInspectorPayload?.();
  }

  renderWorkingDiff(diff, staged) {
    const body = document.getElementById('detail-body');
    body.innerHTML = '';
    if (diff.noDiff) {
      const empty = document.createElement('div');
      empty.className = 'diff-placeholder';
      const icon = document.createElement('i');
      icon.className = 'ph ph-check-circle';
      const text = document.createElement('span');
      text.textContent = t('changes.noUnstagedDiff');
      empty.append(icon, text);
      body.appendChild(empty);
      this.refresh(true);
      return;
    }
    if (diff.binary || !diff.hunks?.length) {
      const empty = document.createElement('div');
      empty.className = 'diff-placeholder';
      const icon = document.createElement('i');
      icon.className = diff.binary ? 'ph ph-file-lock' : 'ph ph-file-dashed';
      const text = document.createElement('span');
      text.textContent = t(
        diff.binary ? 'changes.binaryWholeFile' : 'changes.noTextDiff'
      );
      empty.append(icon, text);
      body.appendChild(empty);
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'working-diff';
    const numberedHunks = diff.hunks.map(hunk => ({
      hunk,
      lines: DiffParser.numberHunk(hunk)
    }));
    const allLines = numberedHunks.flatMap(item => item.lines);
    wrapper.style.setProperty('--diff-gutter-digits', DiffParser.maxDigits(allLines));
    numberedHunks.forEach(({ hunk, lines }) => {
      const section = document.createElement('section');
      section.className = 'working-diff-hunk';
      const header = document.createElement('div');
      header.className = 'working-diff-hunk-header';
      const code = document.createElement('code');
      code.textContent = hunk.header;
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'btn btn-small';
      action.textContent = t(staged ? 'changes.unstageHunk' : 'changes.stageHunk');
      action.onclick = () => this.mutateHunk(diff.path, staged, hunk.id);
      header.append(code, action);
      section.appendChild(header);
      lines.forEach(line => {
        const row = document.createElement('div');
        row.className = `diff-line ${line.kind}`;
        const oldNumber = document.createElement('span');
        oldNumber.className = 'diff-line-num is-old';
        oldNumber.textContent = Number.isInteger(line.oldLine) ? String(line.oldLine) : '';
        const newNumber = document.createElement('span');
        newNumber.className = 'diff-line-num is-new';
        newNumber.textContent = Number.isInteger(line.newLine) ? String(line.newLine) : '';
        const content = document.createElement('span');
        content.className = 'diff-line-content';
        content.textContent = line.content;
        row.append(oldNumber, newNumber, content);
        section.appendChild(row);
      });
      wrapper.appendChild(section);
    });
    body.appendChild(wrapper);
  }

  async mutateHunk(filePath, staged, hunkId) {
    const api = staged ? window.gitTree.unstageHunks : window.gitTree.stageHunks;
    const result = await api(
      this.repoPath,
      this.snapshot.snapshotId,
      filePath,
      [hunkId]
    );
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      await this.refresh(true);
      return;
    }
    this.snapshot = result.snapshot;
    this.render();
    const targetStaged = !staged;
    const file = this.snapshot.files.find(item => item.path === filePath);
    if (file && (targetStaged ? file.staged : file.unstaged)) {
      await this.selectFile(file, targetStaged);
    } else {
      this.app.components.diffViewer.clear();
    }
  }

  composerKey() {
    return `gittree.commitDraft:${this.repoPath || ''}`;
  }

  persistComposer() {
    if (!this.repoPath) return;
    localStorage.setItem(this.composerKey(), JSON.stringify({
      summary: this.elements.summary.value,
      body: this.elements.body.value,
      amend: this.elements.amend.checked,
      signoff: this.elements.signoff.checked,
      signing: this.elements.signing.checked,
      authorOverride: this.elements.authorToggle.checked,
      authorName: this.elements.authorName.value,
      authorEmail: this.elements.authorEmail.value
    }));
    if (this.snapshot) {
      this.elements.commitButton.disabled =
        this.stagedFiles().length === 0 && !this.elements.amend.checked;
    }
  }

  restoreComposer() {
    let draft = {};
    try {
      draft = JSON.parse(localStorage.getItem(this.composerKey())) || {};
    } catch { /* invalid draft falls back to empty */ }
    this.elements.summary.value = draft.summary || '';
    this.elements.body.value = draft.body || '';
    this.elements.amend.checked = Boolean(draft.amend);
    this.elements.signoff.checked = Boolean(draft.signoff);
    this.elements.signing.checked = Boolean(draft.signing);
    this.elements.authorToggle.checked = Boolean(draft.authorOverride);
    this.elements.authorName.value = draft.authorName || '';
    this.elements.authorEmail.value = draft.authorEmail || '';
    this.elements.authorFields.classList.toggle(
      'is-hidden',
      !this.elements.authorToggle.checked
    );
  }

  async refreshIdentity() {
    if (!this.repoPath) return;
    const identity = await window.gitTree.getIdentity(this.repoPath);
    if (identity?.error) {
      this.elements.identityStatus.textContent = identity.error;
      return;
    }
    this.identity = identity;
    this.elements.identityStatus.textContent = identity.configured
      ? `${identity.name} <${identity.email}>`
      : t('changes.identityMissing');
    this.elements.signing.disabled = !identity.signing?.available;
    this.elements.signingLabel.title = identity.signing?.available
      ? t('changes.signingReady', { format: identity.signing.format })
      : t('changes.signingUnavailable');
    if (
      identity.signing?.enabledByDefault &&
      localStorage.getItem(this.composerKey()) == null
    ) {
      this.elements.signing.checked = true;
    }
  }

  async editIdentity() {
    const value = await this.identityDialog();
    if (!value) return false;
    const result = await window.gitTree.setIdentity(this.repoPath, value);
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      return false;
    }
    this.identity = result.identity;
    await this.refreshIdentity();
    return true;
  }

  identityDialog() {
    const overlay = document.getElementById('modal-overlay');
    const dialog = document.getElementById('modal-dialog');
    return new Promise(resolve => {
      dialog.innerHTML = `
        <form class="branch-dialog-form">
          <h3 data-i18n="changes.identityTitle">Git identity</h3>
          <p data-i18n="changes.identityHelp">Used as the author of new commits.</p>
          <label><span data-i18n="changes.authorName">Author name</span><input name="name" maxlength="200" required></label>
          <label><span data-i18n="changes.authorEmail">Author email</span><input name="email" maxlength="254" type="email" required></label>
          <label><span data-i18n="changes.identityScope">Save identity</span>
            <select name="scope">
              <option value="local" data-i18n="changes.scopeLocal">Only this repository</option>
              <option value="global" data-i18n="changes.scopeGlobal">All repositories</option>
            </select>
          </label>
          <div class="confirm-actions">
            <button class="btn" type="button" data-cancel data-i18n="common.cancel">Cancel</button>
            <button class="btn btn-primary" type="submit" data-i18n="common.continue">Continue</button>
          </div>
        </form>`;
      I18n.translateDOM(dialog);
      const form = dialog.querySelector('form');
      form.elements.name.value = this.identity?.name || '';
      form.elements.email.value = this.identity?.email || '';
      overlay.classList.remove('is-hidden');
      const finish = value => {
        overlay.classList.add('is-hidden');
        dialog.innerHTML = '';
        resolve(value);
      };
      form.querySelector('[data-cancel]').onclick = () => finish(null);
      form.onsubmit = event => {
        event.preventDefault();
        finish({
          name: form.elements.name.value.trim(),
          email: form.elements.email.value.trim(),
          scope: form.elements.scope.value
        });
      };
      form.elements.name.focus();
    });
  }

  async commit() {
    if (!this.identity?.configured && !(await this.editIdentity())) return;
    const options = {
      summary: this.elements.summary.value,
      body: this.elements.body.value,
      amend: this.elements.amend.checked,
      signoff: this.elements.signoff.checked,
      signing: this.elements.signing.checked
    };
    if (this.elements.authorToggle.checked) {
      options.authorOverride = {
        name: this.elements.authorName.value,
        email: this.elements.authorEmail.value
      };
    }
    this.elements.commitButton.disabled = true;
    const result = await window.gitTree.commitChanges(this.repoPath, options);
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      this.elements.commitButton.disabled = false;
      return;
    }
    this.elements.summary.value = '';
    this.elements.body.value = '';
    this.elements.amend.checked = false;
    this.persistComposer();
    this.app.showToast(t('changes.commitCreated'), 'success');
    this.app.components.welcome?.markStep?.('commit');
    await this.app.refresh({ selectHash: result.hash, silent: true });
  }

  esc(value) {
    const element = document.createElement('div');
    element.textContent = value ?? '';
    return element.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}

window.ChangesView = ChangesView;
