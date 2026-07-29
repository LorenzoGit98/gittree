const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitTree', {
  platform: process.platform,

  minimizeWindow: () =>
    ipcRenderer.invoke('window:minimize'),

  toggleMaximizeWindow: () =>
    ipcRenderer.invoke('window:toggle-maximize'),

  getWindowState: () =>
    ipcRenderer.invoke('window:get-state'),

  onWindowState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('window:state', listener);
    return () => ipcRenderer.removeListener('window:state', listener);
  },

  closeWindow: () =>
    ipcRenderer.invoke('window:close'),

  setTheme: (theme, background) =>
    ipcRenderer.invoke('app:set-theme', theme, background),

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

  compareCommits: (repoPath, hashA, hashB) =>
    ipcRenderer.invoke('git:compare-commits', repoPath, hashA, hashB),

  getCommitFileDiff: (repoPath, hashA, hashB, filePath) =>
    ipcRenderer.invoke('git:commit-file-diff', repoPath, hashA, hashB, filePath),

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

  batchDeleteBranches: (repoPath, branches, force) =>
    ipcRenderer.invoke('git:batch-delete-branches', repoPath, branches, force),

  push: (repoPath, remote, branch, setUpstream = false) =>
    ipcRenderer.invoke('git:push', repoPath, remote, branch, setUpstream),

  pull: (repoPath, remote, branch) =>
    ipcRenderer.invoke('git:pull', repoPath, remote, branch),

  fetch: (repoPath, remote) =>
    ipcRenderer.invoke('git:fetch', repoPath, remote),

  getStatus: (repoPath) =>
    ipcRenderer.invoke('git:status', repoPath),

  getWorkingTree: (repoPath) =>
    ipcRenderer.invoke('git:working-tree', repoPath),

  getWorkingDiff: (repoPath, filePath, staged = false) =>
    ipcRenderer.invoke('git:working-diff', repoPath, filePath, staged),

  stagePaths: (repoPath, snapshotId, paths) =>
    ipcRenderer.invoke('git:stage-paths', repoPath, snapshotId, paths),

  unstagePaths: (repoPath, snapshotId, paths) =>
    ipcRenderer.invoke('git:unstage-paths', repoPath, snapshotId, paths),

  stageHunks: (repoPath, snapshotId, filePath, hunkIds) =>
    ipcRenderer.invoke('git:stage-hunks', repoPath, snapshotId, filePath, hunkIds),

  unstageHunks: (repoPath, snapshotId, filePath, hunkIds) =>
    ipcRenderer.invoke('git:unstage-hunks', repoPath, snapshotId, filePath, hunkIds),

  getIdentity: (repoPath) =>
    ipcRenderer.invoke('git:identity-get', repoPath),

  setIdentity: (repoPath, identity) =>
    ipcRenderer.invoke('git:identity-set', repoPath, identity),

  commitChanges: (repoPath, options) =>
    ipcRenderer.invoke('git:commit', repoPath, options),

  previewCommitAction: (repoPath, action, hashes) =>
    ipcRenderer.invoke('git:commit-action-preview', repoPath, action, hashes),

  rebaseOntoCommit: (repoPath, hash) =>
    ipcRenderer.invoke('git:rebase-onto-commit', repoPath, hash),

  cherryPick: (repoPath, hashes) =>
    ipcRenderer.invoke('git:cherry-pick', repoPath, hashes),

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

  createTag: (repoPath, name, commitHash, message = '') =>
    ipcRenderer.invoke('git:create-tag', repoPath, name, commitHash, message),

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

  skipOperation: (repoPath) =>
    ipcRenderer.invoke('git:operation-skip', repoPath),

  openPullRequest: (repoPath, remoteName, sourceBranch, targetBranch) =>
    ipcRenderer.invoke('app:open-pull-request', repoPath, remoteName, sourceBranch, targetBranch),

  getProviderStatus: (provider) =>
    ipcRenderer.invoke('auth:provider-status', provider),

  loginProvider: (provider) =>
    ipcRenderer.invoke('auth:provider-login', provider),

  cancelProviderLogin: (provider) =>
    ipcRenderer.invoke('auth:provider-cancel', provider),

  logoutProvider: (provider) =>
    ipcRenderer.invoke('auth:provider-logout', provider),

  onProviderState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('auth:provider-state', listener);
    return () => ipcRenderer.removeListener('auth:provider-state', listener);
  },

  getPullRequests: (repoPath, provider, options) =>
    ipcRenderer.invoke('hosting:pull-requests', repoPath, provider, options),

  getPullRequestDetail: (repoPath, provider, id) =>
    ipcRenderer.invoke('hosting:pull-request-detail', repoPath, provider, id),

  getPullRequestDiff: (repoPath, provider, id, page = 1) =>
    ipcRenderer.invoke('hosting:pull-request-diff', repoPath, provider, id, page),

  saveReviewDraft: (repoPath, provider, id, draft) =>
    ipcRenderer.invoke('hosting:review-draft-save', repoPath, provider, id, draft),

  submitReview: (repoPath, provider, id, draft) =>
    ipcRenderer.invoke('hosting:review-submit', repoPath, provider, id, draft),

  resolveReviewThread: (repoPath, provider, id, thread, resolved) =>
    ipcRenderer.invoke(
      'hosting:thread-resolve',
      repoPath,
      provider,
      id,
      thread,
      resolved
    ),

  checkoutPullRequestSource: (repoPath, provider, pullRequest, confirmed = false) =>
    ipcRenderer.invoke(
      'hosting:checkout-source',
      repoPath,
      provider,
      pullRequest,
      confirmed
    ),

  openReviewInBrowser: (repoPath, provider, id) =>
    ipcRenderer.invoke('hosting:open-review-browser', repoPath, provider, id),

  selectDirectory: () =>
    ipcRenderer.invoke('dialog:select-directory'),

  getRepos: () =>
    ipcRenderer.invoke('repo:list'),

  addRepo: (repoPath) =>
    ipcRenderer.invoke('repo:add', repoPath),

  addRepos: (repoPaths) =>
    ipcRenderer.invoke('repo:add-many', repoPaths),

  startRepositoryScan: (rootPath) =>
    ipcRenderer.invoke('repo:scan-start', rootPath),

  cancelRepositoryScan: (scanId) =>
    ipcRenderer.invoke('repo:scan-cancel', scanId),

  onRepositoryScanProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('repo:scan-progress', listener);
    return () => ipcRenderer.removeListener('repo:scan-progress', listener);
  },

  onRepositoryScanComplete: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('repo:scan-complete', listener);
    return () => ipcRenderer.removeListener('repo:scan-complete', listener);
  },

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
  },

  openExternal: (url) =>
    ipcRenderer.invoke('app:open-external', url),

  openTerminal: (repoPath) =>
    ipcRenderer.invoke('app:open-terminal', repoPath),

  openExplorer: (repoPath) =>
    ipcRenderer.invoke('app:open-explorer', repoPath),

  getAppVersion: () =>
    ipcRenderer.invoke('app:version'),

  openInspectorWindow: (payload) =>
    ipcRenderer.invoke('window:open-inspector', payload),

  onInspectorRender: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('inspector:render', listener);
    return () => ipcRenderer.removeListener('inspector:render', listener);
  }
});
