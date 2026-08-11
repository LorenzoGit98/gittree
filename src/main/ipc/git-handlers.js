async function runWithConflictState(git, operation) {
  try {
    return await operation();
  } catch (error) {
    let conflictState;
    try {
      conflictState = await git.getOperationState();
    } catch {
      conflictState = null;
    }
    return { error: error.message || String(error), conflictState };
  }
}

function registerGitHandlers({
  registerManagedRepoHandler,
  getGitService,
  consumeAuthorizedDirectory = directoryPath => directoryPath,
  authorizeCreatedRepository = repoPath => repoPath,
  assertWorktreeRemovable = () => true,
  sendToRenderer = () => {}
}) {
  const forwards = [
    ['git:log', 'getLog'],
    ['git:graph-page', 'getGraphPage'],
    ['git:diff', 'getDiff'],
    ['git:commit-detail', 'getCommitDetail'],
    ['git:branches', 'getBranches'],
    ['git:branch-metadata', 'getBranchMetadata'],
    ['git:branch-compare', 'getBranchComparison'],
    ['git:compare-commits', 'compareCommits'],
    ['git:commit-file-diff', 'getCommitFileDiff'],
    ['git:status', 'getStatus'],
    ['git:working-tree', 'getWorkingTree'],
    ['git:working-diff', 'getWorkingDiff'],
    ['git:stage-paths', 'stagePaths'],
    ['git:unstage-paths', 'unstagePaths'],
    ['git:discard-paths', 'discardPaths'],
    ['git:stage-hunks', 'stageHunks'],
    ['git:unstage-hunks', 'unstageHunks'],
    ['git:identity-get', 'getIdentity'],
    ['git:identity-set', 'setIdentity'],
    ['git:commit-action-preview', 'previewCommitAction'],
    ['git:stash-list', 'getStashList'],
    ['git:remotes', 'getRemotes'],
    ['git:reflog', 'getReflog'],
    ['git:worktrees', 'getWorktrees'],
    ['git:submodules', 'getSubmodules'],
    ['git:file-tree', 'getFileTree'],
    ['git:tags', 'getTags'],
    ['git:tags-at-commit', 'getTagsAtCommit'],
    ['git:operation-state', 'getOperationState'],
    ['git:merge-preview', 'previewMerge'],
    ['git:conflict-parse', 'parseConflictBlocks'],
    ['git:conflict-read', 'readConflict'],
    ['git:branch-track', 'trackBranch'],
    ['git:branch-fetch', 'fetchBranch'],
    ['git:branch-delete-remote', 'deleteRemoteBranch'],
    ['git:delete-branch', 'deleteBranch'],
    ['git:stash', 'stash'],
    ['git:stash-pop', 'stashPop'],
    ['git:stash-apply', 'stashApply'],
    ['git:stash-drop', 'stashDrop'],
    ['git:worktree-lock', 'lockWorktree'],
    ['git:worktree-unlock', 'unlockWorktree'],
    ['git:submodules-init', 'initSubmodules'],
    ['git:submodules-update', 'updateSubmodules'],
    ['git:remote-add', 'addRemote'],
    ['git:remote-rename', 'renameRemote'],
    ['git:remote-set-url', 'setRemoteUrl'],
    ['git:remote-remove', 'removeRemote'],
    ['git:restore-file-from-commit', 'restoreFileFromCommit'],
    ['git:conflict-resolve', 'resolveConflict'],
    ['git:operation-continue', 'continueOperation'],
    ['git:operation-abort', 'abortOperation'],
    ['git:operation-skip', 'skipOperation']
  ];

  for (const [channel, method] of forwards) {
    registerManagedRepoHandler(channel, (repoPath, ...args) => (
      getGitService(repoPath)[method](...args)
    ));
  }

  registerManagedRepoHandler('git:worktree-create', async (repoPath, directory, branch) => {
    const result = await getGitService(repoPath).createWorktree(
      consumeAuthorizedDirectory(directory),
      branch
    );
    authorizeCreatedRepository(result.path);
    return result;
  });

  registerManagedRepoHandler('git:worktree-create-managed', async (repoPath, directory, options) => {
    const result = await getGitService(repoPath).createManagedWorktree({
      ...(options || {}),
      directory: consumeAuthorizedDirectory(directory)
    });
    authorizeCreatedRepository(result.path);
    return result;
  });

  registerManagedRepoHandler('git:worktree-remove', async (repoPath, directory) => {
    assertWorktreeRemovable(directory);
    return getGitService(repoPath).removeWorktree(directory);
  });

  const registerLogged = (channel, method, message) => {
    registerManagedRepoHandler(channel, async (repoPath, ...args) => {
      const result = await getGitService(repoPath)[method](...args);
      sendToRenderer('operation:log', message(result, ...args));
      return result;
    });
  };

  registerLogged('git:checkout', 'checkoutBranch', (_result, branch) => (
    `Checked out ${branch}`
  ));
  registerLogged('git:checkout-tracking', 'checkoutTrackingBranch', result => (
    `Checked out ${result.branch}`
  ));
  registerLogged('git:branch-rename', 'renameBranch', (_result, branch, newName) => (
    `Renamed ${branch} to ${newName}`
  ));
  registerLogged('git:create-branch', 'createBranch', (_result, name) => (
    `Created branch ${name}`
  ));
  registerLogged('git:push', 'push', (_result, remote) => `Pushed to ${remote}`);
  registerLogged('git:pull', 'pull', (_result, remote) => `Pulled from ${remote}`);
  registerLogged('git:fetch', 'fetch', (_result, remote) => `Fetched from ${remote}`);
  registerLogged('git:commit', 'commitChanges', result => (
    `Created commit ${result.hash.slice(0, 8)}`
  ));
  registerLogged('git:create-tag', 'createTag', result => `Created tag ${result.name}`);
  registerLogged('git:delete-tag', 'deleteTag', result => `Deleted tag ${result.name}`);
  registerLogged('git:tags-push', 'pushTags', (_result, remote) => (
    `Pushed tags to ${remote}`
  ));
  registerLogged('git:remote-tag-delete', 'deleteRemoteTag', (_result, remote, name) => (
    `Deleted remote tag ${name} from ${remote}`
  ));

  registerManagedRepoHandler('git:batch-delete-branches', async (
    repoPath,
    branches,
    force
  ) => {
    if (!Array.isArray(branches) || branches.length > 500) {
      return { error: 'Invalid branch list' };
    }
    const result = await getGitService(repoPath).deleteBranches(branches, force);
    const deleted = result.results.filter(item => item.success).length;
    sendToRenderer('operation:log', `Deleted ${deleted} branch(es)`);
    return result;
  });

  const registerConflictOperation = (channel, method, logMessage) => {
    registerManagedRepoHandler(channel, async (repoPath, ...args) => {
      const git = getGitService(repoPath);
      return runWithConflictState(git, async () => {
        const result = await git[method](...args);
        sendToRenderer('operation:log', logMessage(result, ...args));
        return result;
      });
    });
  };

  registerConflictOperation('git:branch-rebase', 'rebaseOnto', (_result, branch) => (
    `Rebased onto ${branch}`
  ));
  registerConflictOperation('git:merge', 'merge', (_result, branch) => (
    `Merged ${branch}`
  ));
  registerConflictOperation('git:rebase-onto-commit', 'rebaseOntoCommit', (_result, hash) => (
    `Rebased onto ${hash.slice(0, 8)}`
  ));
  registerConflictOperation('git:cherry-pick', 'cherryPickCommits', result => (
    `Cherry-picked ${result.commits.length} commit(s)`
  ));
}

module.exports = { registerGitHandlers };
