/* exported StatusBar */
/* eslint-disable-next-line no-unused-vars -- script-tag global consumed by app.js */
class StatusBar {
  constructor() {
    this.repoEl = document.getElementById('status-repo');
    this.branchEl = document.getElementById('status-branch');
    this.infoEl = document.getElementById('status-info');
  }

  setRepo(name) { this.repoEl.textContent = name || ''; }
  setBranch(name) { this.branchEl.textContent = name || ''; }
  setInfo(text) { this.infoEl.textContent = text || ''; }
  clear() { this.repoEl.textContent = ''; this.branchEl.textContent = ''; this.infoEl.textContent = ''; }
}
