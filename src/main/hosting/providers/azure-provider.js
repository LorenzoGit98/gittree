class AzureProviderAdapter {
  constructor({ api, identityMatches }) {
    this.api = api;
    this.identityMatches = identityMatches;
  }

  normalizeSummary(item, user) {
    const author = item.createdBy || {};
    return {
      provider: 'azure',
      id: item.pullRequestId,
      number: item.pullRequestId,
      title: item.title || '',
      author: {
        login: author.uniqueName || author.displayName || '',
        id: author.id || '',
        avatarUrl: author._links?.avatar?.href || ''
      },
      source: (item.sourceRefName || '').replace('refs/heads/', ''),
      target: (item.targetRefName || '').replace('refs/heads/', ''),
      headSha: item.lastMergeSourceCommit?.commitId
        || item.lastMergeCommit?.commitId
        || '',
      state: item.status === 'active' || item.status === 'open'
        ? 'open'
        : item.status === 'completed'
          ? 'merged'
          : item.status === 'abandoned'
            ? 'abandoned'
            : item.status,
      draft: Boolean(item.isDraft),
      reviewStatus: (item.reviewers || []).some(
        reviewer => reviewer.vote === 0 && this.identityMatches(user, reviewer)
      ) ? 'requested' : 'none',
      ciStatus: item.mergeStatus === 'succeeded'
        ? 'success'
        : item.mergeStatus === 'conflicts' ? 'failure' : 'unknown',
      reviewers: item.reviewers || []
    };
  }

  async listPullRequests(repo, { page, filter, search, account }) {
    const skip = (page - 1) * 50;
    const status = filter === 'all' ? 'all' : 'active';
    const result = await this.api(
      repo,
      `/pullrequests?searchCriteria.status=${status}&$top=50&$skip=${skip}`
    );
    if (!result.data || !Array.isArray(result.data.value)) {
      throw new Error('Failed to load pull requests');
    }
    let items = result.data.value.map(item => this.normalizeSummary(item, account.user));
    if (filter === 'authored') {
      items = items.filter(item => this.identityMatches(account.user, item.author));
    } else if (filter === 'review-requested') {
      items = items.filter(item => item.reviewStatus === 'requested');
    }
    if (search) {
      items = items.filter(item => (
        String(item.title || '').toLowerCase().includes(search)
        || String(item.source || '').toLowerCase().includes(search)
        || String(item.number) === search
      ));
    }
    return { items, page, hasMore: result.data.value.length >= 50 };
  }
}

module.exports = AzureProviderAdapter;
