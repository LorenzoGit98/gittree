class GraphView {
  constructor(container, body, app) {
    this.container = container;
    this.body = body;
    this.app = app;
    this.repoPath = null;
    this.rows = [];
    this.visibleRows = [];
    this.hashes = new Set();
    this.refsByHash = new Map();
    this.selectedHash = null;
    this.searchTerm = '';
    this.offset = 0;
    this.hasMore = false;
    this.loading = false;
    this.layoutState = { lanes: [] };
    this.laneCount = 1;
    this.generation = 0;
    this.rowHeight = 38;
    this.overscan = 20;
    this.raf = 0;
    this.renderedRange = [-1, -1];

    this.layer = document.createElement('div');
    this.layer.className = 'graph-virtual-layer';
    this.body.appendChild(this.layer);
    this.container.addEventListener('scroll', () => this.scheduleViewport());
    this.container.addEventListener('click', event => {
      const row = event.target.closest('.graph-row');
      if (row?.dataset.hash) this.select(row.dataset.hash);
    });
  }

  async load(repoPath) {
    if (!this.body.contains(this.layer)) {
      this.body.replaceChildren(this.layer);
    }
    this.generation += 1;
    const generation = this.generation;
    this.repoPath = repoPath;
    this.rows = [];
    this.visibleRows = [];
    this.hashes.clear();
    this.refsByHash.clear();
    this.offset = 0;
    this.hasMore = true;
    this.loading = false;
    this.layoutState = { lanes: [] };
    this.laneCount = 1;
    this.renderedRange = [-1, -1];
    this.container.style.setProperty('--graph-width', '64px');
    this.layer.replaceChildren(this.emptyState('ph-circle-notch', t('history.loading')));
    this.body.style.height = '100%';
    await this.loadNextPage(generation);
  }

  async loadNextPage(generation = this.generation) {
    if (!this.repoPath || !this.hasMore || this.loading) return;
    this.loading = true;
    try {
      const page = await window.gitTree.getGraphPage(this.repoPath, {
        offset: this.offset,
        limit: 500
      });
      if (generation !== this.generation) return;
      if (page?.error) throw new Error(page.error);

      for (const ref of page.refs || []) {
        if (!this.refsByHash.has(ref.commit)) this.refsByHash.set(ref.commit, []);
        const bucket = this.refsByHash.get(ref.commit);
        if (!bucket.some(existing => existing.fullName === ref.fullName)) bucket.push(ref);
      }

      const commits = (page.commits || []).filter(commit => {
        if (this.hashes.has(commit.hash)) return false;
        this.hashes.add(commit.hash);
        return true;
      });
      const layout = window.GraphLayout.layoutGraph(commits, this.layoutState);
      this.rows.push(...layout.rows);
      this.layoutState = layout.nextState;
      this.laneCount = Math.max(this.laneCount, layout.laneCount);
      this.offset = page.nextOffset;
      this.hasMore = Boolean(page.hasMore);
      this.applyFilter();
      this.updateGraphWidth();
      this.renderViewport(true);
    } catch (error) {
      if (generation === this.generation) {
        this.body.style.height = '100%';
        this.layer.replaceChildren(this.emptyState('ph-warning-circle', error.message));
      }
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  applyFilter() {
    const needle = this.searchTerm.trim().toLowerCase();
    this.visibleRows = needle
      ? this.rows.filter(row => {
          const commit = row.commit;
          return commit.subject.toLowerCase().includes(needle)
            || commit.hash.startsWith(needle)
            || commit.authorName.toLowerCase().includes(needle);
        })
      : this.rows;
    const height = Math.max(this.visibleRows.length * this.rowHeight, this.container.clientHeight - 36);
    this.body.style.height = `${height}px`;
  }

  scheduleViewport() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.renderViewport();
      const available = Math.max(1, this.container.scrollHeight - this.container.clientHeight);
      if (this.container.scrollTop / available >= 0.85) this.loadNextPage();
    });
  }

  renderViewport(force = false) {
    if (!this.visibleRows.length) {
      this.body.style.height = '100%';
      this.layer.replaceChildren(this.emptyState('ph-git-commit', t('history.empty')));
      this.renderedRange = [0, 0];
      return;
    }

    const viewportTop = Math.max(0, this.container.scrollTop - 36);
    const start = Math.max(0, Math.floor(viewportTop / this.rowHeight) - this.overscan);
    const count = Math.ceil(this.container.clientHeight / this.rowHeight) + this.overscan * 2;
    const end = Math.min(this.visibleRows.length, start + count);
    if (!force && start === this.renderedRange[0] && end === this.renderedRange[1]) return;
    this.renderedRange = [start, end];

    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index += 1) {
      fragment.appendChild(this.createRow(this.visibleRows[index], index));
    }
    this.layer.replaceChildren(fragment);
  }

  createRow(layoutRow, index) {
    const commit = layoutRow.commit;
    const row = document.createElement('div');
    row.className = `graph-row${commit.hash === this.selectedHash ? ' selected' : ''}`;
    row.dataset.hash = commit.hash;
    row.style.transform = `translateY(${index * this.rowHeight}px)`;

    const graph = document.createElement('div');
    graph.className = 'graph-cell';
    graph.appendChild(this.createGraphSvg(layoutRow));

    const message = document.createElement('div');
    message.className = 'graph-commit-message';
    const refs = document.createElement('div');
    refs.className = 'graph-refs';
    for (const ref of this.refsByHash.get(commit.hash) || []) {
      const badge = document.createElement('span');
      badge.className = `badge badge-${ref.type}`;
      badge.textContent = ref.shortName;
      refs.appendChild(badge);
    }
    const subject = document.createElement('span');
    subject.className = 'truncate';
    subject.textContent = commit.subject;
    message.append(refs, subject);

    const author = document.createElement('div');
    author.className = 'graph-commit-author';
    author.textContent = commit.authorName;
    const date = document.createElement('div');
    date.className = 'graph-commit-date';
    date.textContent = this.fmtDate(commit.date);
    const hash = document.createElement('div');
    hash.className = 'graph-commit-hash';
    hash.textContent = commit.hash.slice(0, 7);
    row.append(graph, message, author, date, hash);
    return row;
  }

  createGraphSvg(row) {
    const namespace = 'http://www.w3.org/2000/svg';
    const width = Math.min(240, Math.max(64, this.laneCount * 18 + 20));
    const x = lane => 12 + lane * 18;
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('class', 'graph-lanes');
    svg.setAttribute('viewBox', `0 0 ${width} ${this.rowHeight}`);
    svg.setAttribute('aria-hidden', 'true');

    row.before.forEach((hash, lane) => {
      if (!hash || lane === row.lane) return;
      svg.appendChild(this.svgPath(`M ${x(lane)} 0 L ${x(lane)} ${this.rowHeight}`, lane));
    });
    if (row.incoming) {
      svg.appendChild(this.svgPath(`M ${x(row.lane)} 0 L ${x(row.lane)} 19`, row.lane));
    }
    for (const parent of row.parents) {
      const from = x(row.lane);
      const to = x(parent.lane);
      const path = from === to
        ? `M ${from} 19 L ${to} ${this.rowHeight}`
        : `M ${from} 19 C ${from} 29, ${to} 28, ${to} ${this.rowHeight}`;
      svg.appendChild(this.svgPath(path, parent.lane));
    }

    const circle = document.createElementNS(namespace, 'circle');
    circle.setAttribute('cx', x(row.lane));
    circle.setAttribute('cy', 19);
    circle.setAttribute('r', row.parents.length > 1 ? 5 : 4);
    circle.setAttribute('class', `graph-lane-node graph-lane-${row.lane % 8}${row.parents.length > 1 ? ' is-merge' : ''}`);
    svg.appendChild(circle);
    if ((this.refsByHash.get(row.commit.hash) || []).some(ref => ref.type === 'head')) {
      const head = document.createElementNS(namespace, 'circle');
      head.setAttribute('cx', x(row.lane));
      head.setAttribute('cy', 19);
      head.setAttribute('r', 8);
      head.setAttribute('class', 'graph-head-indicator');
      svg.appendChild(head);
    }
    return svg;
  }

  svgPath(data, lane) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', data);
    path.setAttribute('class', `graph-lane-path graph-lane-${lane % 8}`);
    return path;
  }

  updateGraphWidth() {
    const width = Math.min(240, Math.max(64, this.laneCount * 18 + 20));
    this.container.style.setProperty('--graph-width', `${width}px`);
  }

  select(hash) {
    this.selectedHash = hash;
    const current = this.layer.querySelector('.graph-row.selected');
    if (current?.dataset.hash !== hash) current?.classList.remove('selected');
    this.layer.querySelector(`.graph-row[data-hash="${CSS.escape(hash)}"]`)?.classList.add('selected');
    this.app.emit('commit:selected', hash);
  }

  setSearch(term) {
    this.searchTerm = term || '';
    this.applyFilter();
    this.renderViewport(true);
  }

  render() {
    this.applyFilter();
    this.renderViewport(true);
  }

  emptyState(icon, text) {
    const element = document.createElement('div');
    element.className = 'empty-state';
    element.innerHTML = `<i class="ph ${icon}"></i>`;
    element.append(document.createTextNode(text));
    return element;
  }

  fmtDate(value) {
    if (!value) return '';
    const date = new Date(value);
    const diff = Date.now() - date.getTime();
    const day = 86400000;
    if (diff < day) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff < 7 * day) return t('history.daysAgo', { count: Math.floor(diff / day) });
    if (diff < 365 * day) return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
