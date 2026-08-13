function registerAiHandlers({ registerHandler, registerManagedRepoHandler, aiService }) {
  registerHandler('ai:settings-get', () => aiService.getSettings());
  registerHandler('ai:settings-set', input => aiService.setSettings(input));
  registerHandler('ai:key-set', key => aiService.setKey(key));
  registerHandler('ai:key-clear', () => aiService.clearKey());
  registerHandler('ai:test-connection', () => aiService.testConnection());
  registerManagedRepoHandler('ai:commit-message', (repoPath, options = {}) => (
    aiService.generateCommitMessage(repoPath, options)
  ));
  registerManagedRepoHandler('ai:explain-changes', (repoPath, options = {}) => (
    aiService.explainChanges(repoPath, options)
  ));
  registerManagedRepoHandler('ai:explain-conflict', (repoPath, options = {}) => (
    aiService.explainConflict(repoPath, options)
  ));
  registerManagedRepoHandler('ai:explain-commit', (repoPath, options = {}) => (
    aiService.explainCommit(repoPath, options)
  ));
  registerManagedRepoHandler('ai:pr-description', (repoPath, options = {}) => (
    aiService.generatePrDescription(repoPath, options)
  ));
}

module.exports = { registerAiHandlers };
