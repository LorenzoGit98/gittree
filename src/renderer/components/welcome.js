class WelcomeScreen {
  constructor() {
    this.screen = document.getElementById('welcome-screen');
    this.recentList = document.getElementById('recent-repos');
  }

  async init(app) {
    this.app = app;
    document.getElementById('btn-open-repo').onclick = () => this.openRepo();
    document.getElementById('btn-clone-repo').onclick = () => this.cloneRepo();
    await this.loadRecent();
  }

  async openRepo() {
    try {
      if (!window.gitTree) return;
      const dir = await window.gitTree.selectDirectory();
      if (!dir) return;
      const isRepo = await window.gitTree.checkIsGitRepo(dir);
      if (!isRepo) { this.app.showToast(t('feedback.notRepo'), 'error'); return; }
      await this.app.components.repoTabs.addRepo(dir);
    } catch (e) { this.app.showToast('Error: ' + e.message, 'error'); }
  }

  async cloneRepo() {
    const url = prompt('Repository URL to clone:');
    if (!url) return;
    this.app.showToast(t('feedback.cloneSoon'), 'warning');
  }

  async loadRecent() {
    try {
      const repos = await window.gitTree.getRepos();
      if (!repos || !repos.length) { this.recentList.innerHTML = ''; return; }
      this.recentList.innerHTML = `<div class="welcome-recent-title">${t('welcome.recent')}</div>`;
      repos.slice(0, 5).forEach(repo => {
        const el = document.createElement('div');
        el.className = 'welcome-recent-item';
        el.innerHTML = `<div class="recent-name">${this.esc(repo.name)}</div><div class="recent-path">${this.esc(repo.path)}</div>`;
        el.addEventListener('click', () => {
          this.app.components.repoTabs.addRepo(repo.path);
        });
        this.recentList.appendChild(el);
      });
    } catch (e) { console.error('loadRecent:', e); }
  }

  show() {
    this.screen.classList.remove('is-hidden');
    document.getElementById('workspace').classList.add('is-hidden');
  }

  hide() {
    this.screen.classList.add('is-hidden');
    document.getElementById('workspace').classList.remove('is-hidden');
  }

  esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
}
