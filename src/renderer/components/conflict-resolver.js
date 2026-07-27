class ConflictResolver {
  constructor(app) {
    this.app = app;
    this.conflicts = [];
    this.currentIdx = 0;
    this.resolved = new Set();
    this.container = null;
  }

  async open(conflictFiles) {
    this.conflicts = conflictFiles || [];
    this.currentIdx = 0;
    this.resolved.clear();
    if (!this.conflicts.length) { this.app.showToast('No conflicts detected', 'info'); return; }
    this.ensureContainer();
    this.render();
  }

  ensureContainer() {
    if (this.container) return;
    this.container = document.getElementById('merge-workspace-overlay');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'merge-workspace-overlay';
      this.container.style.cssText = 'position:fixed;inset:0;z-index:var(--z-modal);background:var(--bg-app);display:none;flex-direction:column';
      document.getElementById('app').appendChild(this.container);
    }
  }

  render() {
    this.ensureContainer();
    const total = this.conflicts.length;
    const resolved = this.resolved.size;
    const progress = total > 0 ? (resolved / total) * 100 : 0;
    const current = this.conflicts[this.currentIdx] || {};

    this.container.innerHTML = `
      <div class="conflict-workspace">
        <div class="conflict-header">
          <span style="font-size:13px;font-weight:500">Resolve Conflicts</span>
          <div class="conflict-progress">
            <span>${resolved}/${total} resolved</span>
            <div class="conflict-progress-bar"><div class="conflict-progress-fill" style="width:${progress}%"></div></div>
          </div>
          <button class="btn btn-small" onclick="window.app.emit('refresh')">Cancel</button>
        </div>

        <div class="conflict-body">
          <div class="conflict-file-list">
            ${this.conflicts.map((f, i) => `
              <div class="conflict-file-item${i === this.currentIdx ? ' active' : ''}${this.resolved.has(i) ? ' resolved' : ''}"
                   onclick="window.conflictResolver.selectFile(${i})">
                <span class="conflict-file-status ${this.resolved.has(i) ? 'resolved' : 'pending'}"></span>
                ${this.esc(f.path || f)}
              </div>
            `).join('')}
          </div>

          <div class="conflict-editor">
            <div class="conflict-editor-toolbar">
              <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary)">${this.esc(current.path || current)}</span>
              <div style="margin-left:auto;display:flex;gap:4px">
                <button class="conflict-action-btn accept-ours" id="conflict-accept-ours">Accept ours</button>
                <button class="conflict-action-btn accept-theirs" id="conflict-accept-theirs">Accept theirs</button>
                <button class="conflict-action-btn accept-both" id="conflict-accept-both">Accept both</button>
              </div>
            </div>

            <div class="conflict-panes three-pane">
              <div class="conflict-pane">
                <div class="conflict-pane-header ours">Current branch</div>
                <div class="conflict-pane-content" id="conflict-ours-content">
                  <div class="conflict-line neutral">File content from current branch</div>
                </div>
              </div>
              <div class="conflict-pane">
                <div class="conflict-pane-header theirs">Incoming branch</div>
                <div class="conflict-pane-content" id="conflict-theirs-content">
                  <div class="conflict-line neutral">File content from incoming branch</div>
                </div>
              </div>
              <div class="conflict-pane">
                <div class="conflict-pane-header result">Result</div>
                <div class="conflict-editable" contenteditable="true" id="conflict-result-editor">
                  Merge result will appear here
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="conflict-nav">
          <button class="btn btn-small" id="conflict-prev-btn" ${this.currentIdx === 0 ? 'disabled' : ''}>Previous</button>
          <button class="btn btn-small" id="conflict-next-btn" ${this.currentIdx >= total - 1 ? 'disabled' : ''}>Next</button>
          <button class="btn btn-small" id="conflict-mark-resolved">Mark resolved</button>
          <span class="conflict-stats">File ${this.currentIdx + 1} of ${total}</span>
        </div>
      </div>
    `;

    document.getElementById('conflict-prev-btn').onclick = () => this.navigate(-1);
    document.getElementById('conflict-next-btn').onclick = () => this.navigate(1);
    document.getElementById('conflict-mark-resolved').onclick = () => this.markResolved();
    document.getElementById('conflict-accept-ours').onclick = () => this.acceptOurs();
    document.getElementById('conflict-accept-theirs').onclick = () => this.acceptTheirs();
    document.getElementById('conflict-accept-both').onclick = () => this.acceptBoth();

    // Attach to window for onclick handlers
    window.conflictResolver = this;

    this.container.style.display = 'flex';
  }

  navigate(delta) {
    this.currentIdx = Math.max(0, Math.min(this.conflicts.length - 1, this.currentIdx + delta));
    this.render();
  }

  selectFile(idx) {
    this.currentIdx = idx;
    this.render();
  }

  markResolved() {
    this.resolved.add(this.currentIdx);
    if (this.resolved.size >= this.conflicts.length) {
      this.hide();
      this.app.showToast('All conflicts resolved', 'success');
      this.app.emit('refresh');
    } else {
      this.render();
    }
  }

  acceptOurs() {
    const editor = document.getElementById('conflict-result-editor');
    const ours = document.getElementById('conflict-ours-content');
    if (editor && ours) editor.textContent = '/* Current branch version accepted */';
  }

  acceptTheirs() {
    const editor = document.getElementById('conflict-result-editor');
    const theirs = document.getElementById('conflict-theirs-content');
    if (editor && theirs) editor.textContent = '/* Incoming branch version accepted */';
  }

  acceptBoth() {
    const editor = document.getElementById('conflict-result-editor');
    if (editor) editor.textContent = '/* Both versions merged */';
  }

  hide() {
    if (this.container) this.container.style.display = 'none';
    window.conflictResolver = null;
  }

  esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
}
