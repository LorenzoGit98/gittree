class RemotePanel {
  constructor(container, app) {
    this.container = container;
    this.app = app;
  }

  async load(repoPath) {
    try {
      const remotes = await window.gitTree.getRemotes(repoPath);
      if (remotes && remotes.error) {
        this.container.innerHTML = '';
        return;
      }

      this.render(remotes);
    } catch {
      this.container.innerHTML = '';
    }
  }

  render(remotes) {
    this.container.innerHTML = '';

    if (!remotes || remotes.length === 0) {
      this.container.innerHTML = '<div class="remote-item"><span style="color:var(--text-muted)">No remotes</span></div>';
      return;
    }

    remotes.forEach(remote => {
      const item = document.createElement('div');
      item.className = 'remote-item';
      item.innerHTML = `
        <span class="remote-name">${this.escapeHtml(remote.name)}</span>
        <span class="remote-url">${this.escapeHtml(remote.refs.fetch || '')}</span>
      `;
      this.container.appendChild(item);
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
