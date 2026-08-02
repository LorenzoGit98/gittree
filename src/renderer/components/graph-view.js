/* exported GraphView */
/* eslint-disable-next-line no-unused-vars -- script-tag global consumed by app.js */
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
    this.selectedHashes = new Set();
    this.selectionAnchor = null;
    this.searchTerm = '';
    this.filters = { query: '', author: '', ref: 'all' };
    this.sortMode = 'topology';
    this.historyStateStorageKey = 'gittree.history.view';
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
    this.columnStorageKey = 'gittree.history.columns';
    this.columnDefinitions = {
      graph: { default: 84, min: 64, max: 240 },
      message: { default: 420, min: 220, max: 900 },
      author: { default: 160, min: 110, max: 420 },
      date: { default: 136, min: 110, max: 260 },
      hash: { default: 90, min: 74, max: 180 }
    };
    const restoredColumns = this.restoreColumnWidths();
    this.columnWidths = restoredColumns.widths;
    this.hasPersistedColumnWidths = restoredColumns.persisted;
    this.columnResize = null;
    this.columnResizeRaf = 0;
    this.formatLocalizedDate = LocalizedDateFormatter.create();

    this.layer = document.createElement('div');
    this.layer.className = 'graph-virtual-layer';
    this.body.appendChild(this.layer);
    this.applyColumnWidths();
    this.setupColumnResize();
    this.setupHistoryControls();
    this.container.addEventListener('scroll', () => this.scheduleViewport());
    this.container.addEventListener('click', event => {
      const row = event.target.closest('.graph-row');
      if (row?.dataset.hash) this.selectFromEvent(row.dataset.hash, event);
    });
    this.container.addEventListener('contextmenu', event => {
      const row = event.target.closest('.graph-row');
      if (!row?.dataset.hash) return;
      event.preventDefault();
      if (!this.selectedHashes.has(row.dataset.hash)) this.select(row.dataset.hash, false);
      this.app.components.commitContextMenu?.open(event, [...this.selectedHashes]);
    });
  }

  async load(repoPath) {
    if (!this.body.contains(this.layer)) {
      this.body.replaceChildren(this.layer);
    }
    this.generation += 1;
    const generation = this.generation;
    const keepContent = this.repoPath === repoPath && this.rows.length > 0;
    this.repoPath = repoPath;
    this.restoreHistoryState();
    this.rows = [];
    this.visibleRows = [];
    this.hashes.clear();
    this.refsByHash.clear();
    this.selectedHashes.clear();
    this.selectedHash = null;
    this.selectionAnchor = null;
    this.offset = 0;
    this.hasMore = true;
    this.loading = false;
    this.layoutState = { lanes: [] };
    this.laneCount = 1;
    this.renderedRange = [-1, -1];
    if (!keepContent) {
      this.layer.replaceChildren(this.emptyState('ph-circle-notch', t('history.loading')));
    }
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
      this.updateAuthorOptions();
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
    const globalNeedle = this.searchTerm.trim().toLowerCase();
    const filterNeedle = this.filters.query.trim().toLowerCase();
    const rows = this.rows.filter(row => {
      const commit = row.commit;
      const searchable = `${commit.subject} ${commit.hash} ${commit.authorName} ${commit.authorEmail || ''}`
        .toLowerCase();
      if (globalNeedle && !searchable.includes(globalNeedle)) return false;
      if (filterNeedle && !searchable.includes(filterNeedle)) return false;
      if (
        this.filters.author &&
        (commit.authorEmail || commit.authorName) !== this.filters.author
      ) return false;
      const refs = this.refsByHash.get(commit.hash) || [];
      if (this.filters.ref === 'branches' && !refs.some(ref => ['branch', 'remote'].includes(ref.type))) {
        return false;
      }
      if (this.filters.ref === 'tags' && !refs.some(ref => ref.type === 'tag')) return false;
      if (this.filters.ref === 'head' && !refs.some(ref => ref.type === 'head')) return false;
      if (this.filters.ref === 'none' && refs.length) return false;
      return true;
    });
    this.visibleRows = this.sortRows(rows);
    const height = Math.max(this.visibleRows.length * this.rowHeight, this.container.clientHeight - 36);
    this.body.style.height = `${height}px`;
  }

  sortRows(rows) {
    if (this.sortMode === 'topology') return rows;
    const sorted = [...rows];
    const compareText = (left, right) => left.localeCompare(
      right,
      i18next.language,
      { sensitivity: 'base' }
    );
    sorted.sort((left, right) => {
      const a = left.commit;
      const b = right.commit;
      if (this.sortMode === 'date-desc') return Date.parse(b.date) - Date.parse(a.date);
      if (this.sortMode === 'date-asc') return Date.parse(a.date) - Date.parse(b.date);
      if (this.sortMode === 'author') return compareText(a.authorName, b.authorName);
      if (this.sortMode === 'subject') return compareText(a.subject, b.subject);
      return compareText(a.hash, b.hash);
    });
    return sorted;
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

    const reusableRows = new Map();
    if (!force) {
      for (const element of this.layer.children) {
        if (element.classList.contains('graph-row') && element.dataset.hash) {
          reusableRows.set(element.dataset.hash, element);
        }
      }
    }
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index += 1) {
      const layoutRow = this.visibleRows[index];
      const hash = layoutRow.commit.hash;
      const row = reusableRows.get(hash) || this.createRow(layoutRow, index);
      if (reusableRows.has(hash)) {
        const selected = this.selectedHashes.has(hash);
        row.style.transform = `translateY(${index * this.rowHeight}px)`;
        row.classList.toggle('selected', selected);
        row.setAttribute('aria-selected', String(selected));
      }
      fragment.appendChild(row);
    }
    this.layer.replaceChildren(fragment);
  }

  createRow(layoutRow, index) {
    const commit = layoutRow.commit;
    const row = document.createElement('div');
    row.className = `graph-row${this.selectedHashes.has(commit.hash) ? ' selected' : ''}`;
    row.dataset.hash = commit.hash;
    row.style.transform = `translateY(${index * this.rowHeight}px)`;

    const graph = document.createElement('div');
    graph.className = 'graph-cell';
    graph.appendChild(
      this.sortMode === 'topology'
        ? this.createGraphSvg(layoutRow)
        : this.createSortMarker()
    );

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
    date.title = date.textContent;
    const hash = document.createElement('div');
    hash.className = 'graph-commit-hash';
    hash.textContent = commit.hash.slice(0, 7);
    row.append(graph, message, author, date, hash);
    return row;
  }

  createSortMarker() {
    const marker = document.createElement('div');
    marker.className = 'graph-sort-marker';
    marker.innerHTML = '<i class="ph ph-git-commit" aria-hidden="true"></i>';
    return marker;
  }

  createGraphSvg(row) {
    const namespace = 'http://www.w3.org/2000/svg';
    const width = Math.min(240, Math.max(64, this.laneCount * 18 + 20));
    const x = lane => 12 + lane * 18;
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('class', 'graph-lanes');
    svg.setAttribute('viewBox', `0 0 ${width} ${this.rowHeight}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.style.width = `${width}px`;

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
    if (this.hasPersistedColumnWidths) return;
    const width = Math.min(240, Math.max(64, this.laneCount * 18 + 20));
    this.resizeColumn(
      'graph',
      Math.max(this.columnDefinitions.graph.default, width),
      false
    );
  }

  restoreColumnWidths() {
    const defaults = Object.fromEntries(
      Object.entries(this.columnDefinitions).map(([column, definition]) => [
        column,
        definition.default
      ])
    );
    try {
      const stored = JSON.parse(localStorage.getItem(this.columnStorageKey));
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        return { widths: defaults, persisted: false };
      }
      let restored = false;
      for (const [column, definition] of Object.entries(this.columnDefinitions)) {
        if (!Number.isFinite(stored[column])) continue;
        defaults[column] = this.clampColumnWidth(stored[column], definition);
        restored = true;
      }
      return { widths: defaults, persisted: restored };
    } catch {
      return { widths: defaults, persisted: false };
    }
  }

  setupColumnResize() {
    this.columnHandles = [
      ...this.container.querySelectorAll('.graph-column-resizer')
    ];
    for (const handle of this.columnHandles) {
      const column = handle.dataset.column;
      const definition = this.columnDefinitions[column];
      if (!definition) continue;
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        this.startColumnResize(column, handle, event.clientX);
      });
      handle.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Home') {
          this.resizeColumn(column, definition.default, true);
          return;
        }
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const step = event.shiftKey ? 24 : 8;
        this.resizeColumn(column, this.columnWidths[column] + direction * step, true);
      });
      handle.addEventListener('dblclick', () => {
        this.resizeColumn(column, definition.default, true);
      });
    }
    document.addEventListener('pointermove', event => this.previewColumnResize(event.clientX));
    document.addEventListener('pointerup', event => this.finishColumnResize(event.clientX));
    document.addEventListener('pointercancel', () => this.cancelColumnResize());
    i18next.on('languageChanged', () => this.updateColumnHandleLabels());
    this.updateColumnHandleLabels();
  }

  startColumnResize(column, handle, clientX) {
    this.cancelColumnResize();
    this.columnResize = {
      column,
      handle,
      startX: clientX,
      startWidth: this.columnWidths[column],
      delta: 0
    };
    handle.classList.add('is-resizing');
    document.documentElement.classList.add('is-resizing-history-columns');
  }

  previewColumnResize(clientX) {
    if (!this.columnResize) return;
    const { column, startX, startWidth } = this.columnResize;
    const definition = this.columnDefinitions[column];
    const nextWidth = this.clampColumnWidth(startWidth + clientX - startX, definition);
    this.columnResize.delta = nextWidth - startWidth;
    if (this.columnResizeRaf) return;
    this.columnResizeRaf = requestAnimationFrame(() => {
      this.columnResizeRaf = 0;
      if (!this.columnResize) return;
      this.columnResize.handle.style.transform =
        `translate3d(${this.columnResize.delta}px, 0, 0)`;
    });
  }

  finishColumnResize(clientX) {
    if (!this.columnResize) return;
    this.previewColumnResize(clientX);
    const { column, startWidth, delta } = this.columnResize;
    this.resizeColumn(column, startWidth + delta, true);
    this.cancelColumnResize();
  }

  cancelColumnResize() {
    if (this.columnResizeRaf) {
      cancelAnimationFrame(this.columnResizeRaf);
      this.columnResizeRaf = 0;
    }
    if (this.columnResize) {
      this.columnResize.handle.style.transform = '';
      this.columnResize.handle.classList.remove('is-resizing');
      this.columnResize = null;
    }
    document.documentElement.classList.remove('is-resizing-history-columns');
  }

  resizeColumn(column, width, persist = true) {
    const definition = this.columnDefinitions[column];
    if (!definition) return;
    this.columnWidths[column] = this.clampColumnWidth(width, definition);
    this.applyColumnWidths();
    if (persist) this.persistColumnWidths();
  }

  setColumnWidths(widths, persist = true) {
    for (const [column, definition] of Object.entries(this.columnDefinitions)) {
      if (!Number.isFinite(widths?.[column])) continue;
      this.columnWidths[column] = this.clampColumnWidth(widths[column], definition);
    }
    this.applyColumnWidths();
    if (persist) this.persistColumnWidths();
  }

  applyColumnWidths() {
    for (const [column, width] of Object.entries(this.columnWidths)) {
      this.container.style.setProperty(`--graph-column-${column}`, `${width}px`);
    }
    this.updateColumnHandleLabels();
  }

  persistColumnWidths() {
    try {
      localStorage.setItem(this.columnStorageKey, JSON.stringify(this.columnWidths));
      this.hasPersistedColumnWidths = true;
    } catch {
      // The layout remains usable when storage is unavailable.
    }
  }

  updateColumnHandleLabels() {
    if (!this.columnHandles) return;
    for (const handle of this.columnHandles) {
      const column = handle.dataset.column;
      const label = t(`history.${column}`);
      const definition = this.columnDefinitions[column];
      handle.setAttribute('aria-label', t('history.resizeColumn', { column: label }));
      handle.setAttribute('aria-valuemin', definition.min);
      handle.setAttribute('aria-valuemax', definition.max);
      handle.setAttribute('aria-valuenow', this.columnWidths[column]);
    }
  }

  setupHistoryControls() {
    this.filterQuery = document.getElementById('history-filter-query');
    this.filterAuthor = document.getElementById('history-filter-author');
    this.filterRef = document.getElementById('history-filter-ref');
    this.sortSelect = document.getElementById('history-sort');
    this.filterClear = document.getElementById('history-filter-clear');
    this.filterQuery?.addEventListener('input', () => {
      this.filters.query = this.filterQuery.value;
      this.commitHistoryState();
    });
    this.filterAuthor?.addEventListener('change', () => {
      this.filters.author = this.filterAuthor.value;
      this.commitHistoryState();
    });
    this.filterRef?.addEventListener('change', () => {
      this.filters.ref = this.filterRef.value;
      this.commitHistoryState();
    });
    this.sortSelect?.addEventListener('change', () => {
      this.sortMode = this.sortSelect.value;
      this.commitHistoryState();
    });
    this.filterClear?.addEventListener('click', () => {
      this.filters = { query: '', author: '', ref: 'all' };
      this.syncHistoryControls();
      this.commitHistoryState();
      this.filterQuery?.focus();
    });
  }

  commitHistoryState() {
    this.persistHistoryState();
    this.container.scrollTop = 0;
    this.applyFilter();
    this.renderViewport(true);
  }

  updateAuthorOptions() {
    if (!this.filterAuthor) return;
    const selected = this.filters.author;
    const authors = new Map();
    for (const row of this.rows) {
      const email = row.commit.authorEmail || row.commit.authorName;
      if (!email || authors.has(email)) continue;
      authors.set(email, row.commit.authorName || email);
    }
    const first = document.createElement('option');
    first.value = '';
    first.textContent = t('history.allAuthors');
    const options = [...authors]
      .sort((left, right) => left[1].localeCompare(right[1], i18next.language))
      .map(([email, name]) => {
        const option = document.createElement('option');
        option.value = email;
        option.textContent = name;
        return option;
      });
    this.filterAuthor.replaceChildren(first, ...options);
    this.filterAuthor.value = authors.has(selected) ? selected : '';
    if (selected && !authors.has(selected) && !this.hasMore) {
      this.filters.author = '';
      this.persistHistoryState();
    }
  }

  restoreHistoryState() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(this.historyStateStorageKey)) || {};
    } catch { /* invalid stored history state is ignored */ }
    const state = stored[this.repoPath] || {};
    this.filters = {
      query: typeof state.query === 'string' ? state.query : '',
      author: typeof state.author === 'string' ? state.author : '',
      ref: ['all', 'branches', 'tags', 'head', 'none'].includes(state.ref)
        ? state.ref
        : 'all'
    };
    this.sortMode = [
      'topology',
      'date-desc',
      'date-asc',
      'author',
      'subject',
      'hash'
    ].includes(state.sort) ? state.sort : 'topology';
    this.syncHistoryControls();
  }

  persistHistoryState() {
    if (!this.repoPath) return;
    try {
      const stored = JSON.parse(localStorage.getItem(this.historyStateStorageKey)) || {};
      stored[this.repoPath] = { ...this.filters, sort: this.sortMode };
      localStorage.setItem(this.historyStateStorageKey, JSON.stringify(stored));
    } catch {
      // Filters remain available for this session when storage is unavailable.
    }
  }

  syncHistoryControls() {
    if (this.filterQuery) this.filterQuery.value = this.filters.query;
    if (this.filterAuthor) this.filterAuthor.value = this.filters.author;
    if (this.filterRef) this.filterRef.value = this.filters.ref;
    if (this.sortSelect) this.sortSelect.value = this.sortMode;
  }

  clampColumnWidth(width, definition) {
    return Math.round(Math.min(definition.max, Math.max(definition.min, width)));
  }

  select(hash, emit = true) {
    this.selectedHash = hash;
    this.selectedHashes.clear();
    this.selectedHashes.add(hash);
    this.selectionAnchor = hash;
    this.updateVisibleSelection();
    if (emit) this.app.emit('commit:selected', hash);
  }

  selectFromEvent(hash, event) {
    const toggle = this.app.isPrimaryModifier(event);
    if (event.shiftKey && this.selectionAnchor) {
      const start = this.visibleRows.findIndex(row => row.commit.hash === this.selectionAnchor);
      const end = this.visibleRows.findIndex(row => row.commit.hash === hash);
      if (start !== -1 && end !== -1) {
        if (!toggle) this.selectedHashes.clear();
        const [from, to] = start < end ? [start, end] : [end, start];
        for (let index = from; index <= to; index += 1) {
          this.selectedHashes.add(this.visibleRows[index].commit.hash);
        }
      }
    } else if (toggle) {
      if (this.selectedHashes.has(hash)) this.selectedHashes.delete(hash);
      else this.selectedHashes.add(hash);
      this.selectionAnchor = hash;
    } else {
      this.selectedHashes.clear();
      this.selectedHashes.add(hash);
      this.selectionAnchor = hash;
    }
    if (this.selectedHashes.size === 0) {
      this.selectedHash = null;
      this.selectionAnchor = null;
    } else {
      this.selectedHash = hash;
    }
    this.updateVisibleSelection();
    if (this.selectedHash) this.app.emit('commit:selected', this.selectedHash);
  }

  updateVisibleSelection() {
    this.layer.querySelectorAll('.graph-row').forEach(row => {
      row.classList.toggle('selected', this.selectedHashes.has(row.dataset.hash));
      row.setAttribute('aria-selected', String(this.selectedHashes.has(row.dataset.hash)));
    });
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
    return this.formatLocalizedDate(value, i18next.language);
  }
}
