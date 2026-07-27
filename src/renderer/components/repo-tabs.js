class RepoTabs {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.repos = [];
  }

  async init() {
    try { this.repos = await window.gitTree.getRepos(); } catch(e) {}
    this.render();
  }

  render() {
    this.container.innerHTML = '';
    this.repos.forEach((repo, i) => {
      const el = document.createElement('div');
      el.className = 'repo-tab';
      if (i === this.app.state.activeRepoIndex) el.classList.add('active');

      const name = document.createElement('span');
      name.className = 'repo-tab-name';
      name.textContent = repo.name;
      name.title = repo.path;

      const close = document.createElement('span');
      close.className = 'repo-tab-close';
      close.textContent = '×';
      close.onclick = e => { e.stopPropagation(); this.removeRepo(repo.path); };

      el.appendChild(name);
      el.appendChild(close);
      el.onclick = () => this.selectRepo(i);
      this.container.appendChild(el);
    });
  }

  async selectRepo(index) {
    const repo = await window.gitTree.setActiveRepo(index);
    if (repo) {
      this.app.state.activeRepoIndex = index;
      this.render();
      this.app.emit('repo:changed', repo);
    }
  }

  async removeRepo(repoPath) {
    const active = await window.gitTree.removeRepo(repoPath);
    this.repos = await window.gitTree.getRepos();
    this.render();
    if (active) this.app.emit('repo:changed', active);
    else this.app.emit('repo:cleared');
  }

  async addRepo(repoPath) {
    try {
      const result = await window.gitTree.addRepo(repoPath);
      if (result && !result.error) {
        this.repos = await window.gitTree.getRepos();
        this.app.state.activeRepoIndex = this.repos.findIndex(r => r.path === result.path);
        this.render();
        this.app.emit('repo:changed', result);
      } else if (result && result.error) {
        this.app.showToast(result.error, 'error');
      }
    } catch (e) {
      this.app.showToast('Error: ' + e.message, 'error');
    }
  }
}
