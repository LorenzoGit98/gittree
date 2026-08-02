class GitHubProviderAdapter {
  constructor({ api }) {
    this.api = api;
  }

  normalizeSummary(item, user) {
    return {
      provider: 'github',
      id: item.id,
      number: item.number,
      title: item.title,
      author: {
        login: item.user?.login || '',
        avatarUrl: item.user?.avatar_url || ''
      },
      source: item.head?.ref || '',
      target: item.base?.ref || '',
      headSha: item.head?.sha || '',
      state: item.merged_at || item.merged ? 'merged' : item.state,
      draft: Boolean(item.draft),
      reviewStatus: (item.requested_reviewers || []).some(
        reviewer => reviewer.login === user?.login
      ) ? 'requested' : 'none',
      ciStatus: 'unknown'
    };
  }

  async listPullRequests(repo, { page, filter, search, account }) {
    const state = filter === 'all' ? 'all' : 'open';
    const result = await this.api(
      repo,
      `/repos/${encodeURIComponent(repo.ownerPath)}/${encodeURIComponent(repo.repository)}/pulls?state=${state}&per_page=50&page=${page}`
    );
    if (!Array.isArray(result.data)) throw new Error('Failed to load pull requests');
    let items = result.data.map(item => this.normalizeSummary(item, account.user));
    if (filter === 'authored') {
      items = items.filter(item => item.author?.login === account.user?.login);
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
    return {
      items,
      page,
      hasMore: /rel="next"/.test(result.headers.get('link') || '')
    };
  }
}

module.exports = GitHubProviderAdapter;
