function registerAuthHandlers({
  registerHandler,
  assertManagedRepo,
  getHostingRepository,
  hostingService,
  credentialVault
}) {
  const forwards = [
    ['auth:provider-status', 'providerStatus'],
    ['auth:provider-login', 'login'],
    ['auth:provider-cancel', 'cancelLogin'],
    ['auth:provider-logout', 'logout']
  ];
  for (const [channel, method] of forwards) {
    registerHandler(channel, (...args) => hostingService[method](...args));
  }
  registerHandler('auth:vault-reset', () => credentialVault.reset());
  registerHandler('auth:set-pat', async (provider, token, repoPath) => {
    if (repoPath) assertManagedRepo(repoPath);
    let organization;
    if (provider === 'azure' && repoPath) {
      try {
        const repository = await getHostingRepository(repoPath, provider);
        organization = repository.organization;
      } catch {
        organization = undefined;
      }
    }
    return hostingService.setPat(provider, token, organization);
  });
}

function registerPullRequestHandlers({
  registerManagedRepoHandler,
  getHostingRepository,
  getGitService,
  hostingService,
  isSafeExternalUrl,
  openExternal
}) {
  const withRepository = implementation => async (repoPath, provider, ...args) => {
    const repository = await getHostingRepository(repoPath, provider);
    return implementation(repository, provider, repoPath, ...args);
  };
  registerManagedRepoHandler(
    'hosting:pull-request-create',
    withRepository((repository, _provider, _repoPath, input) => (
      hostingService.createPullRequest(repository, input)
    ))
  );
  registerManagedRepoHandler(
    'hosting:pull-requests',
    withRepository((repository, _provider, _repoPath, options) => (
      hostingService.listPullRequests(repository, options)
    ))
  );
  registerManagedRepoHandler(
    'hosting:pull-request-detail',
    withRepository(async (repository, _provider, _repoPath, id) => {
      const detail = await hostingService.pullRequestDetail(repository, id);
      let reviewDraft;
      try {
        reviewDraft = await hostingService.getReviewDraft(repository, id, detail.headSha || '');
      } catch {
        reviewDraft = null;
      }
      return { ...detail, reviewDraft };
    })
  );
  registerManagedRepoHandler(
    'hosting:pull-request-diff',
    withRepository((repository, _provider, _repoPath, id, page) => (
      hostingService.pullRequestDiff(repository, id, page)
    ))
  );
  registerManagedRepoHandler(
    'hosting:review-draft-save',
    withRepository((repository, _provider, _repoPath, id, draft) => (
      hostingService.saveReviewDraft(repository, id, draft)
    ))
  );
  registerManagedRepoHandler(
    'hosting:review-submit',
    withRepository((repository, _provider, _repoPath, id, draft) => (
      hostingService.submitReview(repository, id, draft)
    ))
  );
  registerManagedRepoHandler(
    'hosting:thread-resolve',
    withRepository((repository, _provider, _repoPath, id, thread, resolved) => (
      hostingService.resolveThread(repository, id, thread, resolved)
    ))
  );
  registerManagedRepoHandler(
    'hosting:checkout-source',
    withRepository((repository, provider, repoPath, pullRequest, confirmed) => (
      getGitService(repoPath).checkoutPullRequestSource({
        provider,
        remote: repository.remoteName,
        number: pullRequest?.number,
        source: pullRequest?.source,
        headSha: pullRequest?.headSha,
        localBranch: pullRequest?.localBranch,
        confirmed: Boolean(confirmed)
      })
    ))
  );
  registerManagedRepoHandler(
    'hosting:open-review-browser',
    withRepository(async (repository, provider, _repoPath, id) => {
      const safeId = Number(id);
      if (!Number.isSafeInteger(safeId) || safeId <= 0) {
        throw new Error('Invalid pull request ID');
      }
      const url = provider === 'github'
        ? `${repository.webBase}/pull/${safeId}`
        : provider === 'azure'
          ? `${repository.webBase}/pullrequest/${safeId}`
          : `${repository.webBase}/-/merge_requests/${safeId}`;
      if (!isSafeExternalUrl(url)) throw new Error('Unsafe review URL');
      await openExternal(url);
      return { success: true };
    })
  );
}

function registerOpenPullRequest({
  registerManagedRepoHandler,
  getGitService,
  buildPullRequestUrl,
  isSafeExternalUrl,
  openExternal
}) {
  registerManagedRepoHandler(
    'app:open-pull-request',
    async (repoPath, remoteName, sourceBranch, targetBranch) => {
      const git = getGitService(repoPath);
      await git.assertValidBranchName(sourceBranch);
      await git.assertValidBranchName(targetBranch);
      const metadata = await git.getBranchMetadata();
      const remote = metadata.remotes.find(item => item.name === remoteName);
      if (!remote) return { error: 'Remote not found' };
      const url = buildPullRequestUrl(remote.provider, sourceBranch, targetBranch);
      if (!url) return { error: 'Pull requests are not supported for this remote provider' };
      if (!isSafeExternalUrl(url)) return { error: 'Unsafe pull request URL' };
      await openExternal(url);
      return { success: true, url };
    }
  );
}

function registerHostingHandlers(dependencies) {
  registerAuthHandlers(dependencies);
  registerPullRequestHandlers(dependencies);
  registerOpenPullRequest(dependencies);
}

module.exports = { registerHostingHandlers };
