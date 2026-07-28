const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitTree', {
  minimizeWindow: () =>
    ipcRenderer.invoke('window:minimize'),

  toggleMaximizeWindow: () =>
    ipcRenderer.invoke('window:toggle-maximize'),

  closeWindow: () =>
    ipcRenderer.invoke('window:close'),

  setTheme: (theme) =>
    ipcRenderer.invoke('app:set-theme', theme),

  getUpdateState: () =>
    ipcRenderer.invoke('update:get-state'),

  checkForUpdates: () =>
    ipcRenderer.invoke('update:check'),

  downloadUpdate: () =>
    ipcRenderer.invoke('update:download'),

  installUpdate: () =>
    ipcRenderer.invoke('update:install'),

  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },

  getLog: (repoPath, maxCount, branch) =>
    ipcRenderer.invoke('git:log', repoPath, maxCount, branch),

  getGraphPage: (repoPath, options = {}) =>
    ipcRenderer.invoke('git:graph-page', repoPath, options.offset || 0, options.limit || 500),

  getDiff: (repoPath, commitHash, file) =>
    ipcRenderer.invoke('git:diff', repoPath, commitHash, file),

  getCommitDetail: (repoPath, hash) =>
    ipcRenderer.invoke('git:commit-detail', repoPath, hash),

  getBranches: (repoPath) =>
    ipcRenderer.invoke('git:branches', repoPath),

  getBranchMetadata: (repoPath) =>
    ipcRenderer.invoke('git:branch-metadata', repoPath),

  compareBranches: (repoPath, baseBranch, compareBranch) =>
    ipcRenderer.invoke('git:branch-compare', repoPath, baseBranch, compareBranch),

  checkoutBranch: (repoPath, branch) =>
    ipcRenderer.invoke('git:checkout', repoPath, branch),

  checkoutTrackingBranch: (repoPath, remoteRef) =>
    ipcRenderer.invoke('git:checkout-tracking', repoPath, remoteRef),

  createBranch: (repoPath, name, startPoint) =>
    ipcRenderer.invoke('git:create-branch', repoPath, name, startPoint),

  merge: (repoPath, branch, strategy = 'ff') =>
    ipcRenderer.invoke('git:merge', repoPath, branch, strategy),

  renameBranch: (repoPath, branch, newName) =>
    ipcRenderer.invoke('git:branch-rename', repoPath, branch, newName),

  rebaseBranch: (repoPath, branch) =>
    ipcRenderer.invoke('git:branch-rebase', repoPath, branch),

  trackBranch: (repoPath, branch, remoteRef) =>
    ipcRenderer.invoke('git:branch-track', repoPath, branch, remoteRef),

  fetchBranch: (repoPath, remote, branch) =>
    ipcRenderer.invoke('git:branch-fetch', repoPath, remote, branch),

  deleteRemoteBranch: (repoPath, remote, branch) =>
    ipcRenderer.invoke('git:branch-delete-remote', repoPath, remote, branch),

  deleteBranch: (repoPath, branch, force) =>
    ipcRenderer.invoke('git:delete-branch', repoPath, branch, force),

  push: (repoPath, remote, branch, setUpstream = false) =>
    ipcRenderer.invoke('git:push', repoPath, remote, branch, setUpstream),

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

  getOperationState: (repoPath) =>
    ipcRenderer.invoke('git:operation-state', repoPath),

  readConflict: (repoPath, filePath) =>
    ipcRenderer.invoke('git:conflict-read', repoPath, filePath),

  resolveConflict: (repoPath, filePath, resolution) =>
    ipcRenderer.invoke('git:conflict-resolve', repoPath, filePath, resolution),

  continueOperation: (repoPath) =>
    ipcRenderer.invoke('git:operation-continue', repoPath),

  abortOperation: (repoPath) =>
    ipcRenderer.invoke('git:operation-abort', repoPath),

  openPullRequest: (repoPath, remoteName, sourceBranch, targetBranch) =>
    ipcRenderer.invoke('app:open-pull-request', repoPath, remoteName, sourceBranch, targetBranch),

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
