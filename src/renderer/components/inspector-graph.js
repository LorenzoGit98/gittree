/* exported InspectorGraph */
class InspectorGraph {
  constructor({ container, translate, onSelect = null, onRequestMore = null }) {
    this.container = container;
    this.translate = translate;
    this.onSelect = onSelect;
    this.onRequestMore = onRequestMore;
    this.rows = [];
    this.rowsByHash = new Map();
    this.laneCount = 1;
    this.selectedHash = null;
    this.revision = -1;
    this.rowHeight = 40;
    this.overscan = 12;
    this.renderedRange = [-1, -1];
    this.raf = 0;
    this.mounted = false;

    this.layer = document.createElement('div');
    this.layer.className = 'inspector-graph-layer';
    this.tooltip = this.createTooltip();

    this.handleScroll = () => {
      this.hideTooltip();
      this.scheduleViewport();
    };
    this.handleClick = event => {
      const row = event.target.closest?.('.inspector-graph-row');
      if (row?.dataset.hash && this.onSelect) this.select(row.dataset.hash);
    };
    this.handleKeydown = event => {
      const row = event.target.closest?.('.inspector-graph-row');
      if (!row?.dataset.hash) return;
      if ((event.key === 'Enter' || event.key === ' ') && this.onSelect) {
        event.preventDefault();
        this.select(row.dataset.hash);
      } else if (event.key === 'Escape') {
        this.hideTooltip();
      }
    };
    this.handlePointerOver = event => {
      const row = event.target.closest?.('.inspector-graph-row');
      if (!row?.dataset.hash || row.contains(event.relatedTarget)) return;
      this.showTooltip(row.dataset.hash, row);
    };
    this.handlePointerOut = event => {
      const row = event.target.closest?.('.inspector-graph-row');
      if (row && !row.contains(event.relatedTarget)) this.hideTooltip();
    };
    this.handleFocusIn = event => {
      const row = event.target.closest?.('.inspector-graph-row');
      if (row?.dataset.hash) this.showTooltip(row.dataset.hash, row);
    };
    this.handleFocusOut = event => {
      const row = event.target.closest?.('.inspector-graph-row');
      if (row && !row.contains(event.relatedTarget)) this.hideTooltip();
    };
  }

  mount() {
    if (this.mounted || !this.container) return;
    this.mounted = true;
    this.container.replaceChildren(this.layer);
    document.body.appendChild(this.tooltip);
    this.container.addEventListener('scroll', this.handleScroll, { passive: true });
    this.container.addEventListener('click', this.handleClick);
    this.container.addEventListener('keydown', this.handleKeydown);
    this.container.addEventListener('pointerover', this.handlePointerOver);
    this.container.addEventListener('pointerout', this.handlePointerOut);
    this.container.addEventListener('focusin', this.handleFocusIn);
    this.container.addEventListener('focusout', this.handleFocusOut);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.renderViewport(true));
      this.resizeObserver.observe(this.container);
    }
  }

  update(snapshot = {}) {
    this.refreshTranslations();
    const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    const revision = Number.isInteger(snapshot.revision) ? snapshot.revision : 0;
    const firstHash = rows[0]?.hash || '';
    const lastHash = rows.at(-1)?.hash || '';
    const dataChanged = revision !== this.revision || rows.length !== this.rows.length ||
      firstHash !== this.rows[0]?.hash || lastHash !== this.rows.at(-1)?.hash;

    this.selectedHash = typeof snapshot.selectedHash === 'string'
      ? snapshot.selectedHash
      : null;
    this.laneCount = Math.max(1, Number(snapshot.laneCount) || 1);

    if (!dataChanged) {
      this.updateVisibleSelection();
      return;
    }

    this.revision = revision;
    this.rows = rows;
    this.rowsByHash = new Map(rows.map(row => [row.hash, row]));
    this.renderedRange = [-1, -1];
    this.layer.style.height = rows.length ? `${rows.length * this.rowHeight}px` : '100%';
    this.renderViewport(true);
  }

  select(hash) {
    if (!this.rowsByHash.has(hash)) return;
    this.selectedHash = hash;
    this.updateVisibleSelection();
    this.onSelect?.(hash);
  }

  scheduleViewport() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.renderViewport();
      const available = Math.max(1, this.container.scrollHeight - this.container.clientHeight);
      if (this.container.scrollTop / available >= 0.85) this.onRequestMore?.();
    });
  }

  renderViewport(force = false) {
    if (!this.mounted) return;
    if (!this.rows.length) {
      const empty = document.createElement('div');
      empty.className = 'inspector-side-empty';
      const icon = document.createElement('i');
      icon.className = 'ph ph-git-commit';
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = this.translate('details.graphEmpty');
      empty.append(icon, label);
      this.layer.replaceChildren(empty);
      this.renderedRange = [0, 0];
      return;
    }

    const start = Math.max(
      0,
      Math.floor(this.container.scrollTop / this.rowHeight) - this.overscan
    );
    const visibleCount = Math.ceil(
      Math.max(this.rowHeight, this.container.clientHeight) / this.rowHeight
    );
    const end = Math.min(this.rows.length, start + visibleCount + (this.overscan * 2));
    if (!force && start === this.renderedRange[0] && end === this.renderedRange[1]) return;
    this.renderedRange = [start, end];

    const reusable = new Map();
    const spare = [];
    if (!force) {
      for (const element of this.layer.children) {
        if (element.classList.contains('inspector-graph-row') && element.dataset.hash) {
          reusable.set(element.dataset.hash, element);
        }
      }
      const visibleHashes = new Set(this.rows.slice(start, end).map(row => row.hash));
      for (const [hash, element] of reusable) {
        if (!visibleHashes.has(hash)) spare.push(element);
      }
    }

    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index += 1) {
      const data = this.rows[index];
      const existing = reusable.get(data.hash);
      const row = existing || spare.pop() || this.createRow();
      if (!existing || row.dataset.hash !== data.hash) this.updateRow(row, data, index);
      else this.updateRowPosition(row, data, index);
      fragment.appendChild(row);
    }
    this.layer.replaceChildren(fragment);
  }

  createRow() {
    const row = document.createElement('div');
    row.className = 'inspector-graph-row';
    row.setAttribute('role', 'listitem');
    row.tabIndex = 0;
    return row;
  }

  updateRow(row, data, index) {
    row.dataset.hash = data.hash;
    row.replaceChildren(this.createGraphSvg(data));
    const branches = this.branchNames(data);
    row.setAttribute(
      'aria-label',
      `${branches.join(', ') || this.translate('details.graphNoBranch')}: ${data.subject}`
    );
    this.updateRowPosition(row, data, index);
  }

  updateRowPosition(row, data, index) {
    const selected = data.hash === this.selectedHash;
    row.style.transform = `translate3d(0, ${index * this.rowHeight}px, 0)`;
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-selected', String(selected));
  }

  updateVisibleSelection() {
    for (const row of this.layer.querySelectorAll('.inspector-graph-row')) {
      const selected = row.dataset.hash === this.selectedHash;
      row.classList.toggle('selected', selected);
      row.setAttribute('aria-selected', String(selected));
    }
  }

  createGraphSvg(row) {
    const namespace = 'http://www.w3.org/2000/svg';
    const width = Math.min(190, Math.max(48, this.laneCount * 18 + 20));
    const x = lane => 12 + lane * 18;
    const midpoint = this.rowHeight / 2;
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('class', 'inspector-graph-svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${this.rowHeight}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.style.width = `${width}px`;

    for (const [lane, hash] of (row.before || []).entries()) {
      if (!hash || lane === row.lane) continue;
      svg.appendChild(this.svgPath(
        `M ${x(lane)} 0 L ${x(lane)} ${this.rowHeight}`,
        lane
      ));
    }
    if (row.incoming) {
      svg.appendChild(this.svgPath(`M ${x(row.lane)} 0 L ${x(row.lane)} ${midpoint}`, row.lane));
    }
    for (const parent of row.parents || []) {
      const from = x(row.lane);
      const to = x(parent.lane);
      const path = from === to
        ? `M ${from} ${midpoint} L ${to} ${this.rowHeight}`
        : `M ${from} ${midpoint} C ${from} 30, ${to} 29, ${to} ${this.rowHeight}`;
      svg.appendChild(this.svgPath(path, parent.lane));
    }

    const circle = document.createElementNS(namespace, 'circle');
    circle.setAttribute('cx', x(row.lane));
    circle.setAttribute('cy', midpoint);
    circle.setAttribute('r', (row.parents || []).length > 1 ? 5 : 4);
    circle.setAttribute(
      'class',
      `graph-lane-node graph-lane-${row.lane % 8}${(row.parents || []).length > 1 ? ' is-merge' : ''}`
    );
    svg.appendChild(circle);

    if ((row.refs || []).some(ref => ref.type === 'head')) {
      const head = document.createElementNS(namespace, 'circle');
      head.setAttribute('cx', x(row.lane));
      head.setAttribute('cy', midpoint);
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

  branchNames(row) {
    return [...new Set((row.refs || [])
      .filter(ref => ref && ['branch', 'remote'].includes(ref.type) && ref.shortName)
      .map(ref => ref.shortName))];
  }

  createTooltip() {
    const tooltip = document.createElement('div');
    tooltip.id = 'inspector-commit-tooltip';
    tooltip.className = 'inspector-commit-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('aria-hidden', 'true');

    const top = document.createElement('div');
    top.className = 'inspector-tooltip-top';
    const icon = document.createElement('i');
    icon.className = 'ph ph-git-commit';
    icon.setAttribute('aria-hidden', 'true');
    this.tooltipHash = document.createElement('span');
    this.tooltipHash.className = 'inspector-tooltip-hash';
    top.append(icon, this.tooltipHash);

    this.tooltipBranchLabel = document.createElement('span');
    this.tooltipBranchLabel.className = 'inspector-tooltip-label';
    this.tooltipBranchLabel.textContent = this.translate('details.graphBranch');
    this.tooltipBranch = document.createElement('strong');
    this.tooltipBranch.className = 'inspector-tooltip-branch';

    this.tooltipMessageLabel = document.createElement('span');
    this.tooltipMessageLabel.className = 'inspector-tooltip-label';
    this.tooltipMessageLabel.textContent = this.translate('details.graphMessage');
    this.tooltipMessage = document.createElement('span');
    this.tooltipMessage.className = 'inspector-tooltip-message';
    tooltip.append(
      top,
      this.tooltipBranchLabel,
      this.tooltipBranch,
      this.tooltipMessageLabel,
      this.tooltipMessage
    );
    return tooltip;
  }

  refreshTranslations() {
    if (this.tooltipBranchLabel) {
      this.tooltipBranchLabel.textContent = this.translate('details.graphBranch');
    }
    if (this.tooltipMessageLabel) {
      this.tooltipMessageLabel.textContent = this.translate('details.graphMessage');
    }
  }

  showTooltip(hash, anchor) {
    const row = this.rowsByHash.get(hash);
    if (!row) return;
    const branches = this.branchNames(row);
    this.tooltipHash.textContent = hash.slice(0, 7);
    this.tooltipBranch.textContent = branches.join(', ') || this.translate('details.graphNoBranch');
    this.tooltipMessage.textContent = row.subject || hash;
    this.tooltip.classList.add('is-visible');
    this.tooltip.setAttribute('aria-hidden', 'false');
    anchor.setAttribute('aria-describedby', this.tooltip.id);

    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = this.tooltip.getBoundingClientRect();
    const inset = 10;
    let left = anchorRect.right + inset;
    if (left + tooltipRect.width > window.innerWidth - inset) {
      left = Math.max(inset, anchorRect.left - tooltipRect.width - inset);
    }
    const top = Math.min(
      window.innerHeight - tooltipRect.height - inset,
      Math.max(inset, anchorRect.top + ((anchorRect.height - tooltipRect.height) / 2))
    );
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  hideTooltip() {
    this.tooltip.classList.remove('is-visible');
    this.tooltip.setAttribute('aria-hidden', 'true');
    for (const row of this.layer.querySelectorAll('[aria-describedby]')) {
      row.removeAttribute('aria-describedby');
    }
  }

  destroy() {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.container.removeEventListener('scroll', this.handleScroll);
    this.container.removeEventListener('click', this.handleClick);
    this.container.removeEventListener('keydown', this.handleKeydown);
    this.container.removeEventListener('pointerover', this.handlePointerOver);
    this.container.removeEventListener('pointerout', this.handlePointerOut);
    this.container.removeEventListener('focusin', this.handleFocusIn);
    this.container.removeEventListener('focusout', this.handleFocusOut);
    this.tooltip.remove();
    this.container.replaceChildren();
  }
}

if (typeof module !== 'undefined') module.exports = InspectorGraph;
