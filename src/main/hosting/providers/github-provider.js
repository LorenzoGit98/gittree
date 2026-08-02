class GitHubProviderAdapter {
  constructor({ api, graphql }) {
    this.api = api;
    this.graphql = graphql;
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

  normalizeFile(file) {
    return {
      path: file.filename,
      oldPath: file.previous_filename || null,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      binary: !file.patch,
      patch: file.patch || ''
    };
  }

  async pullRequestDetail(repo, id, { viewer }) {
    const prefix =
      `/repos/${encodeURIComponent(repo.ownerPath)}/${encodeURIComponent(repo.repository)}`;
    const pull = await this.api(repo, `${prefix}/pulls/${id}`);
    const headSha = pull.data.head?.sha;
    if (!headSha) throw new Error('Pull request head SHA is unavailable');
    const [reviews, checks, files, threadResult] = await Promise.all([
      this.api(repo, `${prefix}/pulls/${id}/reviews?per_page=100`),
      this.api(repo, `${prefix}/commits/${headSha}/check-runs?per_page=100`).catch(() => ({
        data: { check_runs: [] }
      })),
      this.api(repo, `${prefix}/pulls/${id}/files?per_page=100`),
      this.graphql(
        `query($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              reviewThreads(first: 100) {
                nodes {
                  id
                  isResolved
                  comments(first: 100) {
                    nodes {
                      id
                      databaseId
                      body
                      path
                      line
                      originalLine
                      diffSide
                      createdAt
                      author { login }
                    }
                  }
                }
              }
            }
          }
        }`,
        { owner: repo.ownerPath, name: repo.repository, number: id }
      ).catch(() => ({ data: null }))
    ]);
    const latestReviews = new Map();
    reviews.data.forEach(review => {
      latestReviews.set(review.user?.login || '', {
        login: review.user?.login || '',
        state: review.state,
        submittedAt: review.submitted_at
      });
    });
    return {
      summary: this.normalizeSummary(pull.data, viewer),
      permissions: { review: true, resolveThreads: true, checkout: true },
      reviewers: [...latestReviews.values()],
      checks: (checks.data.check_runs || []).map(check => ({
        id: check.id,
        name: check.name,
        status: check.status,
        conclusion: check.conclusion,
        url: check.html_url
      })),
      files: (files.data || []).map(file => this.normalizeFile(file)),
      threads: (
        threadResult.data?.repository?.pullRequest?.reviewThreads?.nodes || []
      ).map(thread => {
        const comments = thread.comments?.nodes || [];
        const first = comments[0] || {};
        return {
          id: thread.id,
          commentId: first.databaseId || null,
          path: first.path || '',
          line: first.line || first.originalLine || null,
          side: first.diffSide || 'RIGHT',
          resolved: Boolean(thread.isResolved),
          author: first.author?.login || '',
          body: first.body || '',
          createdAt: first.createdAt,
          notes: comments.map(comment => ({
            id: comment.databaseId,
            author: comment.author?.login || '',
            body: comment.body || '',
            createdAt: comment.createdAt
          }))
        };
      }),
      headSha,
      mergeability: pull.data.mergeable_state || (
        pull.data.mergeable === true ? 'mergeable' : 'unknown'
      )
    };
  }

  async pullRequestDiff(repo, id, page) {
    const result = await this.api(
      repo,
      `/repos/${encodeURIComponent(repo.ownerPath)}/${encodeURIComponent(repo.repository)}/pulls/${id}/files?per_page=50&page=${page}`
    );
    return {
      files: result.data.map(file => this.normalizeFile(file)),
      page,
      hasMore: /rel="next"/.test(result.headers.get('link') || '')
    };
  }
}

module.exports = GitHubProviderAdapter;
