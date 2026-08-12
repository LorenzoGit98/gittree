/* global InspectorGraph */
/* exported InspectorWorkspace */
class InspectorWorkspace {
  constructor({
    container,
    graphContainer,
    filesPanel,
    fileList,
    filesToggle,
    diffContainer,
    translate,
    storage = null,
    onGraphSelect = null,
    onGraphRequestMore = null,
    onFileSelect = null,
    onFilesOpenChange = null
  }) {
    this.container = container;
    this.graphContainer = graphContainer;
    this.filesPanel = filesPanel;
    this.fileList = fileList;
    this.filesToggle = filesToggle;
    this.diffContainer = diffContainer;
    this.translate = translate;
    this.storage = storage;
    this.onGraphSelect = onGraphSelect;
    this.onGraphRequestMore = onGraphRequestMore;
    this.onFileSelect = onFileSelect;
    this.onFilesOpenChange = onFilesOpenChange;
    this.storageKey = 'gittree.inspector.files.open';
    this.files = [];
    this.selectedFile = null;
    this.fileSignature = '';
    this.filesOpen = this.restoreFilesOpen();
    this.mounted = false;

    this.fileCount = container?.querySelector('[data-inspector-file-count]') || null;
    this.handleFilesToggle = () => this.setFilesOpen(!this.filesOpen);
    this.handleFileClick = event => {
      const item = event.target.closest?.('.inspector-file-item');
      if (item?.dataset.path) this.selectFile(item.dataset.path);
    };
  }

  mount() {
    if (this.mounted || !this.container) return;
    this.mounted = true;
    this.graph = new InspectorGraph({
      container: this.graphContainer,
      translate: this.translate,
      onSelect: this.onGraphSelect,
      onRequestMore: this.onGraphRequestMore
    });
    this.graph.mount();
    this.filesToggle?.addEventListener('click', this.handleFilesToggle);
    this.fileList?.addEventListener('click', this.handleFileClick);
    this.setFilesOpen(this.filesOpen, false, false);
    this.renderFiles();
  }

  update({ graph = {}, files = [], selectedFile = null, selectedHash = null } = {}, options = {}) {
    this.graph?.update({ ...graph, selectedHash: selectedHash || graph.selectedHash || null });
    this.selectedFile = typeof selectedFile === 'string' ? selectedFile : null;
    const nextFiles = Array.isArray(files) ? files : [];
    const nextSignature = nextFiles
      .map(file => `${file.path}:${file.status}:${file.additions}:${file.deletions}`)
      .join('|');
    this.files = nextFiles;
    if (nextSignature !== this.fileSignature) {
      this.fileSignature = nextSignature;
      this.renderFiles();
    } else {
      this.updateVisibleFileSelection();
    }
    if (options.syncFilesOpen && typeof options.filesOpen === 'boolean') {
      this.setFilesOpen(options.filesOpen, false, false);
    }
  }

  refreshTranslations() {
    this.graph?.refreshTranslations();
    this.setFilesOpen(this.filesOpen, false, false);
    this.renderFiles();
  }

  restoreFilesOpen() {
    try {
      return this.storage?.getItem(this.storageKey) !== '0';
    } catch {
      return true;
    }
  }

  setFilesOpen(open, persist = true, notify = true) {
    this.filesOpen = Boolean(open);
    this.container?.classList.toggle('files-collapsed', !this.filesOpen);
    this.filesPanel?.classList.toggle('is-collapsed', !this.filesOpen);
    if (this.filesToggle) {
      const key = this.filesOpen ? 'details.filesClose' : 'details.filesOpen';
      this.filesToggle.setAttribute('aria-expanded', String(this.filesOpen));
      this.filesToggle.setAttribute('aria-label', this.translate(key));
      this.filesToggle.title = this.translate(key);
      const icon = this.filesToggle.querySelector('i');
      if (icon) icon.className = `ph ph-caret-${this.filesOpen ? 'right' : 'left'}`;
    }
    if (persist) {
      try {
        this.storage?.setItem(this.storageKey, this.filesOpen ? '1' : '0');
      } catch {
        // The panel remains usable when storage is unavailable.
      }
    }
    if (notify) this.onFilesOpenChange?.(this.filesOpen);
  }

  renderFiles() {
    if (!this.fileList) return;
    if (this.fileCount) {
      this.fileCount.textContent = this.translate('details.files', { count: this.files.length });
    }
    if (!this.files.length) {
      const empty = document.createElement('div');
      empty.className = 'inspector-side-empty';
      const icon = document.createElement('i');
      icon.className = 'ph ph-files';
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = this.translate('details.fileListEmpty');
      empty.append(icon, label);
      this.fileList.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    this.files.forEach((file, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'inspector-file-item';
      item.dataset.path = file.path;
      item.style.setProperty('--file-index', String(index));
      item.title = file.path;
      item.setAttribute('role', 'option');

      const status = document.createElement('span');
      status.className = `inspector-file-status is-${String(file.status || 'M').toLowerCase()}`;
      const statusIcon = document.createElement('i');
      statusIcon.className = `ph ${this.statusIcon(file.status)}`;
      statusIcon.setAttribute('aria-hidden', 'true');
      status.title = this.translate(this.statusLabel(file.status));
      status.appendChild(statusIcon);

      const path = document.createElement('span');
      path.className = 'inspector-file-path';
      path.textContent = file.path;

      const stats = document.createElement('span');
      stats.className = 'inspector-file-stats';
      if (file.additions) {
        const additions = document.createElement('span');
        additions.className = 'is-addition';
        additions.textContent = `+${file.additions}`;
        stats.appendChild(additions);
      }
      if (file.deletions) {
        const deletions = document.createElement('span');
        deletions.className = 'is-deletion';
        deletions.textContent = `−${file.deletions}`;
        stats.appendChild(deletions);
      }
      item.append(status, path, stats);
      fragment.appendChild(item);
    });
    this.fileList.replaceChildren(fragment);
    this.updateVisibleFileSelection();
  }

  statusIcon(status) {
    if (status === 'A') return 'ph-plus';
    if (status === 'D') return 'ph-minus';
    if (status === 'R') return 'ph-arrows-left-right';
    return 'ph-pencil-simple';
  }

  statusLabel(status) {
    if (status === 'A') return 'details.fileAdded';
    if (status === 'D') return 'details.fileDeleted';
    if (status === 'R') return 'details.fileRenamed';
    return 'details.fileModified';
  }

  selectFile(path) {
    this.selectedFile = path;
    this.updateVisibleFileSelection();
    if (this.onFileSelect) this.onFileSelect(path);
    else this.scrollToFile(path);
  }

  setSelectedFile(path) {
    this.selectedFile = typeof path === 'string' ? path : null;
    this.updateVisibleFileSelection();
  }

  updateVisibleFileSelection() {
    if (!this.fileList) return;
    for (const item of this.fileList.querySelectorAll('.inspector-file-item')) {
      const selected = item.dataset.path === this.selectedFile;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-selected', String(selected));
    }
  }

  scrollToFile(path) {
    const blocks = [...(this.diffContainer?.querySelectorAll('.diff-file-block') || [])];
    const block = blocks.find(element => element.dataset.filePath === path);
    if (!block) return false;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    block.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    block.classList.add('is-file-target');
    window.setTimeout(() => block.classList.remove('is-file-target'), 1000);
    return true;
  }

  destroy() {
    if (!this.mounted) return;
    this.mounted = false;
    this.graph?.destroy();
    this.filesToggle?.removeEventListener('click', this.handleFilesToggle);
    this.fileList?.removeEventListener('click', this.handleFileClick);
  }
}

if (typeof module !== 'undefined') module.exports = InspectorWorkspace;
