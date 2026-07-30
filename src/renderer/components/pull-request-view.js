class PullRequestView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.repoPath = null;
    this.provider = localStorage.getItem('gittree.pr.provider') || 'github';
    this.filter = 'open';
    this.search = '';
    this.items = [];
    this.hashes = new Set();
    this.page = 1;
    this.hasMore = false;
    this.loading = false;
    this.active = false;
    this.selected = null;
    this.detail = null;
    this.draft = null;
    this.rowHeight = 72;
    this.overscan = 10;
    this.generation = 0;
    this.elements = {
      list: document.getElementById('pr-list'),
      notice: document.getElementById('pr-notice'),
      search: document.getElementById('pr-search'),
      auth: document.getElementById('btn-pr-auth'),
      create: document.getElementById('btn-pr-create')
    };
    this.bind();
  }

  bind() {
    document.querySelectorAll('[data-pr-provider]').forEach(button => {
      button.onclick = () => this.setProvider(button.dataset.prProvider);
    });
    document.querySelectorAll('[data-pr-filter]').forEach(button => {
      button.onclick = () => {
        this.filter = button.dataset.prFilter;
        document.querySelectorAll('[data-pr-filter]').forEach(item => {
          item.classList.toggle('active', item === button);
        });
        this.reload();
      };
    });
    let searchTimer = 0;
    this.elements.search.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        this.search = this.elements.search.value.trim();
        this.reload();
      }, 250);
    };
    this.elements.auth.onclick = () => this.toggleAuthentication();
    this.elements.create.onclick = () => this.openCreateDialog();
    let frame = 0;
    this.elements.list.onscroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        this.renderViewport();
        const available = Math.max(
          1,
          this.elements.list.scrollHeight - this.elements.list.clientHeight
        );
        if (this.elements.list.scrollTop / available >= 0.85) this.loadNextPage();
      });
    };
    window.gitTree.onProviderState(state => {
      if (state.provider !== this.provider) return;
      if (state.phase === 'connected') {
        this.showNotice(t('pullRequests.connected'), '');
        this.refreshStatus().then(() => this.reload());
      } else if (state.phase === 'error') {
        this.showNotice(state.error, 'warning');
      }
    });
  }

  async load(repoPath) {
    this.repoPath = repoPath;
    const metadata = await window.gitTree.getBranchMetadata(repoPath);
    this.availableProviders = new Set(
      (metadata?.remotes || [])
        .map(remote => remote.provider)
        .filter(remote => (
          remote?.host === 'github.com' || remote?.host === 'gitlab.com' || remote?.host === 'dev.azure.com'
        ))
        .map(remote => remote.provider)
    );
    if (!this.availableProviders.has(this.provider) && this.availableProviders.size) {
      this.provider = [...this.availableProviders][0];
    }
    this.syncProviderControls();
    if (this.active) {
      await this.refreshStatus();
      await this.reload();
    }
  }

  setActive(active) {
    this.active = active;
    this.root.classList.toggle('is-hidden', !active);
    if (active && this.repoPath) {
      this.refreshStatus().then(() => this.reload());
    }
  }

  async setProvider(provider) {
    if (!['github', 'gitlab', 'azure'].includes(provider)) return;
    this.provider = provider;
    localStorage.setItem('gittree.pr.provider', provider);
    this.syncProviderControls();
    await this.refreshStatus();
    await this.reload();
  }

  syncProviderControls() {
    document.querySelectorAll('[data-pr-provider]').forEach(button => {
      const active = button.dataset.prProvider === this.provider;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.disabled = this.availableProviders?.size
        ? !this.availableProviders.has(button.dataset.prProvider)
        : false;
    });
  }

  async refreshStatus() {
    this.status = await window.gitTree.getProviderStatus(this.provider);
    if (this.status?.error) {
      this.showNotice(this.status.error, 'warning');
      this.elements.create.disabled = true;
      return;
    }
    const label = this.elements.auth.querySelector('span');
    const icon = this.elements.auth.querySelector('i');
    if (this.status.connected) {
      label.textContent = this.status.user?.login || t('pullRequests.disconnect');
      icon.className = 'ph ph-user-circle-check';
      this.elements.auth.title = t('pullRequests.disconnect');
    } else {
      label.textContent = t('pullRequests.connect');
      icon.className = 'ph ph-plugs-connected';
      this.elements.auth.title = '';
    }
    this.elements.create.disabled = !(
      this.status.connected
      && this.availableProviders?.has(this.provider)
    );
    if (this.status.warning) this.showNotice(this.status.warning, 'warning');
    else if (!this.availableProviders?.has(this.provider)) {
      this.showNotice(t('pullRequests.noRemote', { provider: this.provider }), 'warning');
    } else if (!this.status.configured) {
      this.showNotice(t('pullRequests.notConfigured'), 'warning');
    } else {
      this.hideNotice();
    }
  }

  async toggleAuthentication() {
    if (this.status?.connected) {
      if (!await this.confirm(
        t('pullRequests.disconnectTitle'),
        t('pullRequests.disconnectConfirm')
      )) return;
      const result = await window.gitTree.logoutProvider(this.provider);
      if (result?.error) this.app.showToast(result.error, 'error');
      await this.refreshStatus();
      await this.reload();
      return;
    }
    if (this.provider === 'azure') {
      const token = await this.promptPat();
      if (!token) return;
      const result = await window.gitTree.setPat(this.provider, token, this.repoPath);
      if (result?.error) {
        this.showNotice(result.error, 'warning');
        return;
      }
      await this.refreshStatus();
      await this.reload();
      return;
    }
    const result = await window.gitTree.loginProvider(this.provider);
    if (result?.error) {
      this.showNotice(result.error, 'warning');
      return;
    }
    this.showNotice(
      t('pullRequests.deviceCode', { code: result.userCode }),
      ''
    );
  }

  async reload() {
    this.generation += 1;
    this.loading = false;
    this.items = [];
    this.hashes.clear();
    this.page = 1;
    this.hasMore = false;
    this.selected = null;
    this.detail = null;
    this.renderViewport(true);
    if (
      !this.active ||
      !this.repoPath ||
      !this.status?.connected ||
      !this.availableProviders?.has(this.provider)
    ) return;
    await this.loadNextPage(true);
  }

  async loadNextPage(reset = false) {
    if ((!reset && this.loading) || (!reset && !this.hasMore)) return;
    this.loading = true;
    this.renderViewport(true);
    const generation = this.generation;
    const page = reset ? 1 : this.page;
    try {
      const result = await window.gitTree.getPullRequests(
        this.repoPath,
        this.provider,
        { filter: this.filter, search: this.search, page }
      );
      if (generation !== this.generation) return;
      if (result?.error) throw new Error(result.error);
      for (const item of result.items || []) {
        const key = `${item.provider}:${item.id}`;
        if (this.hashes.has(key)) continue;
        this.hashes.add(key);
        this.items.push(item);
      }
      this.page = page + 1;
      this.hasMore = Boolean(result.hasMore);
      this.renderViewport(true);
    } catch (error) {
      if (generation === this.generation) this.showNotice(error.message, 'warning');
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.renderViewport(true);
      }
    }
  }

  renderViewport(force = false) {
    const list = this.elements.list;
    if (!this.items.length) {
      list.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const icon = document.createElement('i');
      icon.className = this.loading
        ? 'ph ph-circle-notch'
        : 'ph ph-git-pull-request';
      const text = document.createElement('span');
      text.textContent = this.loading
        ? t('common.loading')
        : t('pullRequests.empty');
      empty.append(icon, text);
      list.appendChild(empty);
      return;
    }
    let spacer = list.querySelector('.pr-list-spacer');
    if (!spacer) {
      list.innerHTML = '';
      spacer = document.createElement('div');
      spacer.className = 'pr-list-spacer';
      list.appendChild(spacer);
    }
    spacer.style.height = `${this.items.length * this.rowHeight + 12}px`;
    const visible = Math.ceil(list.clientHeight / this.rowHeight);
    const start = Math.max(
      0,
      Math.floor(list.scrollTop / this.rowHeight) - this.overscan
    );
    const end = Math.min(
      this.items.length,
      start + visible + this.overscan * 2
    );
    if (!force && this.renderedRange?.[0] === start && this.renderedRange?.[1] === end) return;
    this.renderedRange = [start, end];
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index += 1) {
      fragment.appendChild(this.createRow(this.items[index], index));
    }
    spacer.replaceChildren(fragment);
  }

  createRow(item, index) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'pr-row';
    row.classList.toggle('selected', this.selected?.id === item.id);
    row.style.transform = `translateY(${index * this.rowHeight + 6}px)`;
    row.onclick = () => this.select(item);

    const avatar = document.createElement('span');
    avatar.className = 'pr-avatar-fallback';
    avatar.textContent = (item.author?.login || '?').slice(0, 1).toUpperCase();
    const copy = document.createElement('span');
    copy.className = 'pr-row-copy';
    const title = document.createElement('span');
    title.className = 'pr-row-title';
    title.textContent = `#${item.number} ${item.title || ''}`;
    const meta = document.createElement('span');
    meta.className = 'pr-row-meta';
    meta.textContent = t('pullRequests.rowMeta', {
      author: item.author?.login || '',
      source: item.source,
      target: item.target
    });
    copy.append(title, meta);
    const badges = document.createElement('span');
    badges.className = 'pr-row-badges';
    badges.appendChild(this.statusBadge(item));
    if (item.reviewStatus === 'requested') {
      badges.appendChild(this.badge(t('pullRequests.reviewRequested'), 'badge badge-head'));
    }
    row.append(avatar, copy, badges);
    return row;
  }

  statusKey(item) {
    const state = String(item?.state || '').toLowerCase();
    const mergeability = String(item?.mergeability || item?.ciStatus || '').toLowerCase();
    if (item?.draft) return 'draft';
    if (mergeability.includes('conflict')) return 'conflict';
    if (state === 'merged' || state === 'completed') return 'merged';
    if (state === 'closed' || state === 'abandoned') {
      return state === 'abandoned' ? 'abandoned' : 'closed';
    }
    return 'open';
  }

  statusLabel(key) {
    if (key === 'draft') return t('pullRequests.draft');
    if (key === 'merged') return t('pullRequests.statusMerged');
    if (key === 'closed') return t('pullRequests.statusClosed');
    if (key === 'abandoned') return t('pullRequests.statusAbandoned');
    if (key === 'conflict') return t('pullRequests.statusConflict');
    return t('pullRequests.statusOpen');
  }

  statusBadge(item, mergeability) {
    const provider = item?.provider || this.provider || 'github';
    const key = mergeability?.toLowerCase?.().includes('conflict')
      ? 'conflict'
      : this.statusKey({ ...item, mergeability: mergeability || item?.mergeability });
    const tone = key === 'abandoned' ? 'closed' : key;
    return this.badge(
      this.statusLabel(key),
      `pr-status is-${provider} is-${tone}`
    );
  }

  badge(text, className) {
    const badge = document.createElement('span');
    badge.className = className;
    badge.textContent = text;
    return badge;
  }

  async select(item) {
    this.selected = item;
    this.renderViewport(true);
    const title = document.getElementById('detail-title');
    title.textContent = `#${item.number} ${item.title || ''}`;
    title.title = item.title || '';
    const body = document.getElementById('detail-body');
    body.innerHTML = `<div class="diff-placeholder">${this.esc(t('common.loading'))}</div>`;
    try {
      const detail = await window.gitTree.getPullRequestDetail(
        this.repoPath,
        this.provider,
        item.number
      );
      if (this.selected?.id !== item.id) return;
      if (detail?.error) {
        body.textContent = detail.error;
        return;
      }
      this.detail = {
        ...detail,
        summary: detail.summary || item,
        checks: detail.checks || [],
        files: detail.files || [],
        threads: detail.threads || [],
        permissions: detail.permissions || {}
      };
      this.draft = detail.reviewDraft || {
        headSha: detail.headSha || '',
        body: '',
        event: 'COMMENT',
        inlineComments: [],
        replies: [],
        stale: false
      };
      this.renderDetail();
    } catch (error) {
      if (this.selected?.id !== item.id) return;
      body.textContent = error.message || String(error);
    }
  }

  renderDetail() {
    const body = document.getElementById('detail-body');
    body.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'pr-detail';
    const summary = document.createElement('section');
    summary.className = 'pr-detail-summary';
    const heading = document.createElement('h3');
    heading.textContent = this.detail.summary?.title || '';
    const facts = document.createElement('div');
    facts.className = 'pr-detail-facts';
    facts.append(
      this.statusBadge(this.detail.summary || this.selected, this.detail.mergeability),
      this.badge(t('pullRequests.branchRoute', {
        source: this.detail.summary?.source || '',
        target: this.detail.summary?.target || ''
      }), 'badge badge-branch'),
      this.badge(this.detail.mergeability || 'unknown', 'badge'),
      this.badge(
        t('pullRequests.checksCount', { count: this.detail.checks?.length || 0 }),
        'badge'
      )
    );
    summary.append(heading, facts);
    if (this.detail.permissions?.checkout !== false) {
      const checkout = document.createElement('button');
      checkout.type = 'button';
      checkout.className = 'btn btn-small';
      checkout.innerHTML = `<i class="ph ph-git-branch"></i>${this.esc(t('pullRequests.checkoutSource'))}`;
      checkout.onclick = () => this.checkoutSource().catch(error => {
        this.app.showToast(error.message || String(error), 'error');
      });
      summary.appendChild(checkout);
    }
    wrapper.appendChild(summary);

    if (this.draft?.stale) wrapper.appendChild(this.createStaleNotice());
    wrapper.appendChild(this.createFileSection());
    wrapper.appendChild(this.createThreadSection());
    wrapper.appendChild(this.createReviewComposer());
    body.appendChild(wrapper);
  }

  createStaleNotice() {
    const notice = document.createElement('div');
    notice.className = 'pr-stale';
    const text = document.createElement('p');
    text.textContent = t('pullRequests.staleDraft');
    const button = document.createElement('button');
    button.className = 'btn btn-small';
    button.type = 'button';
    button.textContent = t('pullRequests.reviewAgain');
    button.onclick = async () => {
      this.draft.headSha = this.detail.headSha;
      this.draft.stale = false;
      await this.saveDraft();
      this.renderDetail();
    };
    notice.append(text, button);
    return notice;
  }

  createFileSection() {
    const section = document.createElement('section');
    section.className = 'pr-detail-section';
    const heading = document.createElement('h3');
    heading.textContent = t('pullRequests.filesCount', {
      count: this.detail.files?.length || 0
    });
    section.appendChild(heading);
    const files = document.createElement('div');
    files.className = 'pr-detail-facts';
    (this.detail.files || []).slice(0, 100).forEach((file, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.title = file.path;
      button.textContent = file.path;
      button.onclick = () => {
        files.querySelectorAll('.chip').forEach(item => item.classList.remove('active'));
        button.classList.add('active');
        this.renderPatch(file, patch);
      };
      files.appendChild(button);
      if (index === 0) button.classList.add('active');
    });
    const patch = document.createElement('div');
    section.append(files, patch);
    if (this.detail.files?.[0]) this.renderPatch(this.detail.files[0], patch);
    return section;
  }

  renderPatch(file, container) {
    container.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'pr-file';
    const header = document.createElement('div');
    header.className = 'pr-file-header';
    const pathLabel = document.createElement('code');
    pathLabel.textContent = file.path;
    header.appendChild(pathLabel);
    const viewport = document.createElement('div');
    viewport.className = 'pr-patch';
    card.append(header, viewport);
    container.appendChild(card);
    if (!file.patch) {
      viewport.textContent = t('pullRequests.binaryOrLarge');
      return;
    }
    const lines = this.parsePatchLines(file.patch);
    viewport.style.setProperty('--diff-gutter-digits', DiffParser.maxDigits(lines));
    const rowHeight = 22;
    const spacer = document.createElement('div');
    spacer.className = 'changes-file-spacer';
    spacer.style.height = `${lines.length * rowHeight}px`;
    viewport.appendChild(spacer);
    let frame = 0;
    const paint = () => {
      frame = 0;
      const start = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - 8);
      const end = Math.min(
        lines.length,
        start + Math.ceil(viewport.clientHeight / rowHeight) + 16
      );
      const fragment = document.createDocumentFragment();
      for (let index = start; index < end; index += 1) {
        const line = lines[index];
        const row = document.createElement('div');
        row.className = `diff-line ${line.type}`;
        row.style.position = 'absolute';
        row.style.top = `${index * rowHeight}px`;
        row.style.left = '0';
        row.style.right = '0';
        const oldNumber = document.createElement('span');
        oldNumber.className = 'diff-line-num is-old';
        oldNumber.textContent = Number.isInteger(line.oldLine) ? String(line.oldLine) : '';
        const number = document.createElement('button');
        number.className = 'diff-line-num is-new';
        number.type = 'button';
        number.textContent = Number.isInteger(line.newLine) ? String(line.newLine) : '';
        number.disabled = !Number.isInteger(line.newLine);
        number.title = Number.isInteger(line.newLine) ? t('pullRequests.addInline') : '';
        if (Number.isInteger(line.newLine)) {
          number.onclick = () => this.addInlineComment(file.path, line.newLine);
        }
        const content = document.createElement('span');
        content.className = 'diff-line-content';
        content.textContent = line.content;
        row.append(oldNumber, number, content);
        fragment.appendChild(row);
      }
      spacer.replaceChildren(fragment);
    };
    viewport.onscroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
  }

  parsePatchLines(patch) {
    return DiffParser.parseUnified(patch).map(line => ({
      ...line,
      type: ['file', 'header', 'no-newline'].includes(line.kind)
        ? 'header'
        : line.kind
    }));
  }

  async addInlineComment(filePath, line) {
    const body = await this.commentDialog(filePath, line);
    if (!body) return;
    this.draft.inlineComments.push({
      path: filePath,
      line,
      side: 'RIGHT',
      body
    });
    await this.saveDraft();
    this.app.showToast(t('pullRequests.draftSaved'), 'success');
  }

  createThreadSection() {
    const section = document.createElement('section');
    section.className = 'pr-detail-section';
    const heading = document.createElement('h3');
    heading.textContent = t('pullRequests.discussionsCount', {
      count: this.detail.threads?.length || 0
    });
    section.appendChild(heading);
    (this.detail.threads || []).slice(0, 50).forEach(thread => {
      const item = document.createElement('article');
      item.className = 'pr-thread';
      const content = document.createElement('p');
      if (thread.notes) {
        content.textContent = thread.notes.map(note => (
          `${note.author}: ${note.body}`
        )).join('\n');
      } else {
        content.textContent = `${thread.author}: ${thread.body}`;
      }
      item.appendChild(content);
      const actions = document.createElement('div');
      actions.className = 'pr-thread-actions';
      const reply = document.createElement('button');
      reply.type = 'button';
      reply.className = 'btn btn-small';
      reply.textContent = t('pullRequests.reply');
      reply.onclick = () => this.replyThread(thread);
      actions.appendChild(reply);
      if (this.detail.permissions?.resolveThreads) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-small';
        button.textContent = t(
          thread.resolved ? 'pullRequests.reopen' : 'pullRequests.resolve'
        );
        button.onclick = () => this.resolveThread(thread, !thread.resolved);
        actions.appendChild(button);
      }
      item.appendChild(actions);
      section.appendChild(item);
    });
    return section;
  }

  createReviewComposer() {
    const section = document.createElement('section');
    section.className = 'pr-review-composer';
    const heading = document.createElement('h3');
    heading.textContent = t('pullRequests.review');
    const body = document.createElement('textarea');
    body.placeholder = t('pullRequests.reviewPlaceholder');
    body.value = this.draft.body || '';
    const event = document.createElement('select');
    [
      ['COMMENT', t('pullRequests.comment')],
      ['APPROVE', t('pullRequests.approve')],
      ['REQUEST_CHANGES', t('pullRequests.requestChanges')]
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      if (value === 'REQUEST_CHANGES' && this.provider === 'gitlab') {
        option.disabled = true;
        option.title = t('pullRequests.gitlabRequestChanges');
      }
      event.appendChild(option);
    });
    event.value = this.provider === 'gitlab' && this.draft.event === 'REQUEST_CHANGES'
      ? 'COMMENT'
      : this.draft.event;
    let timer = 0;
    const persist = () => {
      this.draft.body = body.value;
      this.draft.event = event.value;
      clearTimeout(timer);
      timer = setTimeout(() => this.saveDraft(), 400);
    };
    body.oninput = persist;
    event.onchange = persist;
    const actions = document.createElement('div');
    actions.className = 'pr-review-actions';
    if (this.provider === 'gitlab') {
      const browser = document.createElement('button');
      browser.type = 'button';
      browser.className = 'btn btn-small';
      browser.title = t('pullRequests.gitlabRequestChanges');
      browser.textContent = t('pullRequests.openInBrowser');
      browser.onclick = () => window.gitTree.openReviewInBrowser(
        this.repoPath,
        this.provider,
        this.selected.number
      );
      actions.appendChild(browser);
    }
    const count = document.createElement('span');
    count.className = 'text-secondary';
    count.textContent = t('pullRequests.inlineCount', {
      count: this.draft.inlineComments.length
    });
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'btn btn-primary';
    submit.disabled = Boolean(this.draft.stale);
    submit.textContent = t('pullRequests.submitReview');
    submit.onclick = () => this.submitReview();
    actions.append(count, submit);
    section.append(heading, body, event, actions);
    return section;
  }

  async saveDraft() {
    if (!this.selected || !this.draft) return;
    if (!/^[a-f0-9]{7,64}$/i.test(this.draft.headSha || '')) return;
    const result = await window.gitTree.saveReviewDraft(
      this.repoPath,
      this.provider,
      this.selected.number,
      {
        headSha: this.draft.headSha,
        body: this.draft.body || '',
        event: this.draft.event || 'COMMENT',
        inlineComments: this.draft.inlineComments || [],
        replies: this.draft.replies || []
      }
    );
    if (result?.error) this.app.showToast(result.error, 'error');
  }

  async submitReview() {
    if (this.draft.stale) return;
    const result = await window.gitTree.submitReview(
      this.repoPath,
      this.provider,
      this.selected.number,
      this.draft
    );
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      return;
    }
    this.app.showToast(t('pullRequests.reviewSubmitted'), 'success');
    await this.select(this.selected);
  }

  async resolveThread(thread, resolved) {
    let noteId = null;
    if (thread.notes) {
      noteId = [...thread.notes].reverse().find(note => note.resolvable)?.id;
    }
    const result = await window.gitTree.resolveReviewThread(
      this.repoPath,
      this.provider,
      this.selected.number,
      { id: thread.id, noteId },
      resolved
    );
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      return;
    }
    await this.select(this.selected);
  }

  async replyThread(thread) {
    const body = await this.commentDialog(
      t('pullRequests.reply'),
      thread.id
    );
    if (!body) return;
    this.draft.replies.push({
      threadId: thread.id,
      commentId: thread.commentId || null,
      body
    });
    await this.saveDraft();
    this.app.showToast(t('pullRequests.draftSaved'), 'success');
  }

  async checkoutSource() {
    const request = {
      number: this.detail.summary.number,
      source: this.detail.summary.source,
      headSha: this.detail.headSha,
      localBranch: this.detail.summary.source
    };
    const preview = await window.gitTree.checkoutPullRequestSource(
      this.repoPath,
      this.provider,
      request,
      false
    );
    if (preview?.error) {
      this.app.showToast(preview.error, 'error');
      return;
    }
    const message = preview.allowed
      ? t('pullRequests.checkoutPreview', {
          source: preview.source,
          branch: preview.localBranch
        })
      : preview.reason;
    if (!preview.allowed || !await this.confirm(t('pullRequests.checkoutTitle'), message)) {
      if (!preview.allowed) this.app.showToast(preview.reason, 'error');
      return;
    }
    const result = await window.gitTree.checkoutPullRequestSource(
      this.repoPath,
      this.provider,
      request,
      true
    );
    if (result?.error) {
      this.app.showToast(result.error, 'error');
      return;
    }
    await this.app.refresh({ silent: true });
  }

  commentDialog(filePath, line) {
    const overlay = document.getElementById('modal-overlay');
    const dialog = document.getElementById('modal-dialog');
    return new Promise(resolve => {
      dialog.innerHTML = `
        <form class="branch-dialog-form">
          <h3>${this.esc(t('pullRequests.inlineTitle'))}</h3>
          <p>${this.esc(`${filePath}:${line}`)}</p>
          <label>${this.esc(t('pullRequests.comment'))}<textarea name="body" class="pr-inline-comment" maxlength="65536" required></textarea></label>
          <div class="confirm-actions">
            <button class="btn" type="button" data-cancel>${this.esc(t('common.cancel'))}</button>
            <button class="btn btn-primary" type="submit">${this.esc(t('pullRequests.saveDraft'))}</button>
          </div>
        </form>`;
      overlay.classList.remove('is-hidden');
      const form = dialog.querySelector('form');
      const finish = value => {
        overlay.classList.add('is-hidden');
        dialog.innerHTML = '';
        resolve(value);
      };
      form.querySelector('[data-cancel]').onclick = () => finish('');
      form.onsubmit = event => {
        event.preventDefault();
        finish(form.elements.body.value.trim());
      };
      form.elements.body.focus();
    });
  }

  confirm(title, message) {
    const overlay = document.getElementById('modal-overlay');
    const dialog = document.getElementById('modal-dialog');
    return new Promise(resolve => {
      dialog.innerHTML = `<h3>${this.esc(title)}</h3><p>${this.esc(message)}</p>
        <div class="confirm-actions">
          <button class="btn" data-cancel>${this.esc(t('common.cancel'))}</button>
          <button class="btn btn-danger" data-confirm>${this.esc(t('common.continue'))}</button>
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

  showNotice(message, type) {
    this.elements.notice.textContent = message;
    this.elements.notice.className = `pr-notice${type ? ` ${type}` : ''}`;
  }

  hideNotice() {
    this.elements.notice.className = 'pr-notice is-hidden';
    this.elements.notice.textContent = '';
  }

  async promptPat() {
    const overlay = document.getElementById('modal-overlay');
    const dialog = document.getElementById('modal-dialog');
    return new Promise(resolve => {
      dialog.innerHTML = `<h3>${this.esc(t('pullRequests.azurePatPrompt') || 'Azure DevOps PAT')}</h3>
        <p>${this.esc(t('pullRequests.azurePatHint') || 'Create a PAT at https://dev.azure.com with Code (Read & Write) scope.')}</p>
        <input id="pat-input" class="commit-input pat-input" type="password" maxlength="200" placeholder="PAT">
        <div class="confirm-actions">
          <button class="btn" data-cancel>${this.esc(t('common.cancel'))}</button>
          <button class="btn btn-primary" data-confirm>${this.esc(t('pullRequests.connect'))}</button>
        </div>`;
      overlay.classList.remove('is-hidden');
      const input = dialog.querySelector('#pat-input');
      input.focus();
      const finish = value => {
        overlay.classList.add('is-hidden');
        dialog.innerHTML = '';
        resolve(value);
      };
      dialog.querySelector('[data-cancel]').onclick = () => finish(null);
      dialog.querySelector('[data-confirm]').onclick = () => finish(input.value.trim() || null);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(input.value.trim() || null); });
    });
  }

  branchOptions(metadata) {
    const names = new Set();
    for (const branch of metadata?.branches || []) {
      if (branch.kind === 'local' && branch.name) {
        names.add(branch.name);
        continue;
      }
      if (branch.kind === 'remote' && branch.name) {
        const index = branch.name.indexOf('/');
        const short = index >= 0 ? branch.name.slice(index + 1) : branch.name;
        if (short) names.add(short);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  async openCreateDialog(defaults = {}) {
    if (this.elements.create.disabled && !defaults.force) {
      if (!this.status?.connected) {
        this.app.showToast(t('pullRequests.connect'), 'warning');
        return;
      }
    }
    const metadata = await window.gitTree.getBranchMetadata(this.repoPath);
    if (metadata?.error) {
      this.app.showToast(metadata.error, 'error');
      return;
    }
    const branches = this.branchOptions(metadata);
    const preferredSource = defaults.source && branches.includes(defaults.source)
      ? defaults.source
      : null;
    const source = preferredSource
      || (metadata.current && branches.includes(metadata.current) ? metadata.current : null)
      || branches[0]
      || '';
    const preferredTarget = defaults.target && branches.includes(defaults.target)
      ? defaults.target
      : null;
    const target = preferredTarget
      || (metadata.defaultBranch && branches.includes(metadata.defaultBranch)
        ? metadata.defaultBranch
        : null)
      || (branches.find(name => name !== source) || branches[0] || '');
    const remote = (metadata.remotes || []).find(item => (
      item.provider?.provider === this.provider
    ));
    const values = await this.createPullRequestDialog({
      source,
      target,
      branches,
      title: defaults.title || ''
    });
    if (!values) return;
    this.elements.create.disabled = true;
    try {
      if (values.pushSource && remote?.name) {
        const pushed = await window.gitTree.push(
          this.repoPath,
          remote.name,
          values.source,
          true
        );
        if (pushed?.error) {
          this.app.showToast(pushed.error, 'error');
          return;
        }
      }
      const result = await window.gitTree.createPullRequest(
        this.repoPath,
        this.provider,
        values
      );
      if (result?.error) {
        this.app.showToast(result.error, 'error');
        return;
      }
      this.app.showToast(t('pullRequests.createSuccess', {
        number: result.pullRequest?.number || ''
      }), 'success');
      for (const warning of result.warnings || []) {
        this.app.showToast(warning, 'warning');
      }
      this.filter = 'authored';
      document.querySelectorAll('[data-pr-filter]').forEach(item => {
        item.classList.toggle('active', item.dataset.prFilter === 'authored');
      });
      await this.reload();
      const created = this.items.find(item => (
        item.number === result.pullRequest?.number
        || item.id === result.pullRequest?.id
      ));
      if (created) await this.select(created);
    } finally {
      await this.refreshStatus();
    }
  }

  createPullRequestDialog({ source, target, branches, title = '' }) {
    const overlay = document.getElementById('modal-overlay');
    const dialog = document.getElementById('modal-dialog');
    const options = branches.map(name => (
      `<option value="${this.esc(name)}">${this.esc(name)}</option>`
    )).join('');
    const showAssignees = this.provider !== 'azure';
    const showMaintainer = this.provider === 'github';
    const showWorkItems = this.provider === 'azure';
    const showRemoveSource = this.provider === 'gitlab';
    return new Promise(resolve => {
      dialog.classList.add('pr-create-dialog');
      dialog.innerHTML = `
        <form class="branch-dialog-form pr-create-form">
          <h3>${this.esc(t('pullRequests.createTitle'))}</h3>
          <label>${this.esc(t('pullRequests.createTitleField'))}
            <input name="title" maxlength="256" required autofocus value="${this.esc(title)}">
          </label>
          <label>${this.esc(t('pullRequests.createBodyField'))}
            <textarea name="body" class="pr-create-body" maxlength="65536" rows="5" placeholder="${this.esc(t('pullRequests.createBodyPlaceholder'))}"></textarea>
          </label>
          <div class="pr-create-grid">
            <label>${this.esc(t('pullRequests.createSource'))}
              <select name="source">${options}</select>
            </label>
            <label>${this.esc(t('pullRequests.createTarget'))}
              <select name="target">${options}</select>
            </label>
          </div>
          <label>${this.esc(t('pullRequests.createReviewers'))}
            <input name="reviewers" maxlength="1000" placeholder="${this.esc(t('pullRequests.createReviewersHint'))}">
          </label>
          ${showAssignees ? `<label>${this.esc(t('pullRequests.createAssignees'))}
            <input name="assignees" maxlength="1000" placeholder="${this.esc(t('pullRequests.createAssigneesHint'))}">
          </label>` : ''}
          <label>${this.esc(t('pullRequests.createLabels'))}
            <input name="labels" maxlength="1000" placeholder="${this.esc(t('pullRequests.createLabelsHint'))}">
          </label>
          ${showWorkItems ? `<label>${this.esc(t('pullRequests.createWorkItems'))}
            <input name="workItems" maxlength="200" placeholder="${this.esc(t('pullRequests.createWorkItemsHint'))}">
          </label>` : ''}
          <div class="pr-create-flags">
            <label class="pr-create-check"><input name="draft" type="checkbox"> ${this.esc(t('pullRequests.createDraft'))}</label>
            <label class="pr-create-check"><input name="pushSource" type="checkbox" checked> ${this.esc(t('pullRequests.createPush'))}</label>
            ${showMaintainer ? `<label class="pr-create-check"><input name="maintainerCanModify" type="checkbox" checked> ${this.esc(t('pullRequests.createMaintainer'))}</label>` : ''}
            ${showRemoveSource ? `<label class="pr-create-check"><input name="removeSourceBranch" type="checkbox"> ${this.esc(t('pullRequests.createRemoveSource'))}</label>` : ''}
          </div>
          <div class="confirm-actions">
            <button class="btn" type="button" data-cancel>${this.esc(t('common.cancel'))}</button>
            <button class="btn btn-primary" type="submit">${this.esc(t('pullRequests.createSubmit'))}</button>
          </div>
        </form>`;
      overlay.classList.remove('is-hidden');
      const form = dialog.querySelector('form');
      form.elements.source.value = source;
      form.elements.target.value = target;
      const finish = value => {
        dialog.classList.remove('pr-create-dialog');
        overlay.classList.add('is-hidden');
        dialog.innerHTML = '';
        resolve(value);
      };
      form.querySelector('[data-cancel]').onclick = () => finish(null);
      form.onsubmit = event => {
        event.preventDefault();
        const nextTitle = form.elements.title.value.trim();
        if (!nextTitle) return;
        finish({
          title: nextTitle,
          body: form.elements.body.value,
          source: form.elements.source.value,
          target: form.elements.target.value,
          reviewers: form.elements.reviewers.value,
          assignees: form.elements.assignees?.value || '',
          labels: form.elements.labels.value,
          workItems: form.elements.workItems?.value || '',
          draft: form.elements.draft.checked,
          pushSource: form.elements.pushSource.checked,
          maintainerCanModify: form.elements.maintainerCanModify?.checked !== false,
          removeSourceBranch: Boolean(form.elements.removeSourceBranch?.checked)
        });
      };
      form.elements.title.focus();
    });
  }

  esc(value) {
    const element = document.createElement('div');
    element.textContent = value ?? '';
    return element.innerHTML;
  }
}

window.PullRequestView = PullRequestView;
