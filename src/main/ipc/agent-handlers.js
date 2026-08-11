function registerAgentHandlers({
  registerHandler,
  registerManagedRepoHandler,
  agentSessionService,
  repositoryWorkspace,
  consumeAuthorizedDirectory = value => value,
  showOpenDialog,
  getMainWindow
}) {
  registerHandler('agent:settings', () => agentSessionService.getSettings());
  registerHandler('agent:root-select', async () => {
    const result = await showOpenDialog(getMainWindow(), {
      title: 'Choose agent worktree root',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    return agentSessionService.setWorktreeRoot(result.filePaths[0]);
  });
  registerHandler('agent:concurrency-set', value => (
    agentSessionService.setConcurrency(value)
  ));
  registerHandler('agent:enabled-set', enabled => (
    agentSessionService.setAgentsEnabled(enabled)
  ));
  registerHandler('agent:adapters-detect', () => agentSessionService.detectAdapters());
  registerHandler('agent:adapters-set', adapterIds => (
    agentSessionService.setEnabledAdapters(adapterIds)
  ));

  registerManagedRepoHandler('agent:tasks', repoPath => (
    agentSessionService.listTasks(repoPath)
  ));
  registerManagedRepoHandler('agent:task-create', (repoPath, options = {}) => {
    const safeOptions = { ...options };
    delete safeOptions.authorizedDestination;
    if (safeOptions.destinationPath) {
      safeOptions.authorizedDestination = consumeAuthorizedDirectory(safeOptions.destinationPath);
    }
    delete safeOptions.destinationPath;
    return agentSessionService.createTask(repoPath, safeOptions);
  });
  registerManagedRepoHandler('agent:task-create-worktree', (repoPath, worktreePath, options) => (
    agentSessionService.createTaskForWorktree(repoPath, worktreePath, options)
  ));
  registerManagedRepoHandler('agent:worktree-open', async (repoPath, worktreePath) => {
    const worktrees = await repositoryWorkspace.getGitService(repoPath).getWorktrees();
    const resolved = repositoryWorkspace.resolvePath(worktreePath);
    const belongs = worktrees.some(worktree => (
      repositoryWorkspace.pathKey(worktree.path) === repositoryWorkspace.pathKey(resolved)
    ));
    if (!belongs) throw new Error('Worktree does not belong to the registered repository');
    return repositoryWorkspace.addTrustedRepository(resolved);
  });

  registerHandler('agent:task-stop', taskId => agentSessionService.stopTask(taskId));
  registerHandler('agent:task-resume', taskId => agentSessionService.resumeTask(taskId));
  registerHandler('agent:task-archive', taskId => agentSessionService.archiveTask(taskId));
  registerHandler('agent:terminal-write', (taskId, data) => (
    agentSessionService.writeTerminal(taskId, data)
  ));
  registerHandler('agent:terminal-resize', (taskId, cols, rows) => (
    agentSessionService.resizeTerminal(taskId, cols, rows)
  ));
  registerHandler('agent:attention-ack', taskId => (
    agentSessionService.acknowledgeAttention(taskId)
  ));
}

module.exports = { registerAgentHandlers };
