const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitTree', {
  setTheme: (theme) =>
    ipcRenderer.invoke('app:set-theme', theme),

  getLog: (repoPath, maxCount, branch) =>
    ipcRenderer.invoke('git:log', repoPath, maxCount, branch),

  getDiff: (repoPath, commitHash, file) =>
    ipcRenderer.invoke('git:diff', repoPath, commitHash, file),

  getCommitDetail: (repoPath, hash) =>
    ipcRenderer.invoke('git:commit-detail', repoPath, hash),

  getBranches: (repoPath) =>
    ipcRenderer.invoke('git:branches', repoPath),

  checkoutBranch: (repoPath, branch) =>
    ipcRenderer.invoke('git:checkout', repoPath, branch),

  createBranch: (repoPath, name, startPoint) =>
    ipcRenderer.invoke('git:create-branch', repoPath, name, startPoint),

  merge: (repoPath, branch) =>
    ipcRenderer.invoke('git:merge', repoPath, branch),

  deleteBranch: (repoPath, branch, force) =>
    ipcRenderer.invoke('git:delete-branch', repoPath, branch, force),

  push: (repoPath, remote, branch) =>
    ipcRenderer.invoke('git:push', repoPath, remote, branch),

  pull: (repoPath, remote, branch) =>
    ipcRenderer.invoke('git:pull', repoPath, remote, branch),

  fetch: (repoPath, remote) =>
    ipcRenderer.invoke('git:fetch', repoPath, remote),

  getStatus: (repoPath) =>
    ipcRenderer.invoke('git:status', repoPath),

  getStashList: (repoPath) =>
    ipcRenderer.invoke('git:stash-list', repoPath),

  stash: (repoPath, message) =>
    ipcRenderer.invoke('git:stash', repoPath, message),

  stashPop: (repoPath, index) =>
    ipcRenderer.invoke('git:stash-pop', repoPath, index),

  getRemotes: (repoPath) =>
    ipcRenderer.invoke('git:remotes', repoPath),

  getFileTree: (repoPath, commitHash) =>
    ipcRenderer.invoke('git:file-tree', repoPath, commitHash),

  getTags: (repoPath) =>
    ipcRenderer.invoke('git:tags', repoPath),

  selectDirectory: () =>
    ipcRenderer.invoke('dialog:select-directory'),

  getRepos: () =>
    ipcRenderer.invoke('repo:list'),

  addRepo: (repoPath) =>
    ipcRenderer.invoke('repo:add', repoPath),

  removeRepo: (repoPath) =>
    ipcRenderer.invoke('repo:remove', repoPath),

  setActiveRepo: (index) =>
    ipcRenderer.invoke('repo:set-active', index),

  getActiveRepo: () =>
    ipcRenderer.invoke('repo:active'),

  checkIsGitRepo: (repoPath) =>
    ipcRenderer.invoke('git:is-repo', repoPath),

  onOperationLog: (callback) => {
    ipcRenderer.on('operation:log', (_event, message) => callback(message));
  }
});
