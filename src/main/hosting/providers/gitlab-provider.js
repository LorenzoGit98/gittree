class GitLabProviderAdapter {
  constructor({ api }) {
    this.api = api;
  }

  normalizeSummary(item, user) {
    return {
      provider: 'gitlab',
      id: item.id,
      number: item.iid,
      title: item.title,
      author: {
        login: item.author?.username || '',
        avatarUrl: item.author?.avatar_url || ''
      },
      source: item.source_branch || '',
      target: item.target_branch || '',
      headSha: item.sha || item.diff_refs?.head_sha || '',
      state: item.state,
      draft: Boolean(item.draft || /^draft:/i.test(item.title || '')),
      reviewStatus: (item.reviewers || []).some(
        reviewer => reviewer.username === user?.login
      ) ? 'requested' : 'none',
      ciStatus: item.head_pipeline?.status || 'unknown'
    };
  }

  async listPullRequests(repo, { page, filter, search, account }) {
    const project = encodeURIComponent(`${repo.ownerPath}/${repo.repository}`);
    const query = new URLSearchParams({
      state: filter === 'all' ? 'all' : 'opened',
      scope: 'all',
      per_page: '50',
      page: String(page),
      ...(search ? { search } : {}),
      ...(filter === 'authored' && account.user?.login
        ? { author_username: account.user.login }
        : {}),
      ...(filter === 'review-requested' && account.user?.login
        ? { reviewer_username: account.user.login }
        : {})
    });
    const result = await this.api(repo, `/projects/${project}/merge_requests?${query}`);
    if (!Array.isArray(result.data)) throw new Error('Failed to load pull requests');
    return {
      items: result.data.map(item => this.normalizeSummary(item, account.user)),
      page,
      hasMore: Boolean(result.headers.get('x-next-page'))
    };
  }
}

module.exports = GitLabProviderAdapter;
