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

  normalizeFile(entry) {
    const filePath = String(entry?.item?.path || '').replace(/^\//, '');
    if (!filePath) return null;
    const changeType = String(entry.changeType || '').toLowerCase();
    let status = 'modified';
    if (changeType.includes('add')) status = 'added';
    else if (changeType.includes('delete')) status = 'removed';
    else if (changeType.includes('rename') || changeType.includes('sourceRename')) {
      status = 'renamed';
    }
    const oldPath = entry.originalPath
      ? String(entry.originalPath).replace(/^\//, '')
      : null;
    return {
      path: filePath,
      oldPath: oldPath && oldPath !== filePath ? oldPath : null,
      status,
      additions: null,
      deletions: null,
      binary: Boolean(entry.item?.isFolder),
      patch: ''
    };
  }

  async listPullRequestFiles(repo, id) {
    try {
      const iterations = await this.api(repo, `/pullrequests/${id}/iterations`);
      const list = iterations.data.value || [];
      if (!list.length) return { files: [], headSha: '' };
      const latest = list[list.length - 1];
      const headSha = latest.sourceRefCommit?.commitId
        || latest.commonRefCommit?.commitId
        || '';
      const changes = await this.api(
        repo,
        `/pullrequests/${id}/iterations/${latest.id}/changes?$top=100`
      );
      return {
        files: (changes.data.changeEntries || [])
          .map(entry => this.normalizeFile(entry))
          .filter(Boolean),
        headSha
      };
    } catch {
      return { files: [], headSha: '' };
    }
  }

  async pullRequestDetail(repo, id, { viewer }) {
    const result = await this.api(repo, `/pullrequests/${id}`);
    const pullRequest = result.data;
    const [threadsResult, fileResult] = await Promise.all([
      this.api(repo, `/pullrequests/${id}/threads`).catch(() => ({ data: { value: [] } })),
      this.listPullRequestFiles(repo, id)
    ]);
    const summary = this.normalizeSummary(pullRequest, viewer);
    const headSha = summary.headSha
      || fileResult.headSha
      || pullRequest.lastMergeSourceCommit?.commitId
      || '';
    return {
      summary: { ...summary, headSha },
      permissions: { review: true, resolveThreads: true, checkout: false },
      reviewers: (pullRequest.reviewers || []).map(reviewer => ({
        login: reviewer.uniqueName || reviewer.displayName || '',
        state: reviewer.vote === 10
          ? 'APPROVED'
          : reviewer.vote === -10
            ? 'CHANGES_REQUESTED'
            : reviewer.vote === 5
              ? 'APPROVED'
              : reviewer.vote === 0 ? 'requested' : 'none',
        vote: reviewer.vote
      })),
      checks: [],
      files: fileResult.files,
      threads: (threadsResult.data.value || []).map(thread => ({
        id: String(thread.id),
        resolved: thread.status === 'closed' || thread.status === 'fixed',
        path: thread.threadContext?.filePath || '',
        line: thread.threadContext?.rightFileEnd?.line || null,
        side: 'RIGHT',
        author: thread.comments?.[0]?.author?.uniqueName || '',
        body: thread.comments?.[0]?.content || '',
        createdAt: thread.comments?.[0]?.publishedDate,
        notes: (thread.comments || []).map(comment => ({
          id: comment.id,
          author: comment.author?.uniqueName || '',
          body: comment.content || '',
          createdAt: comment.publishedDate
        }))
      })),
      headSha,
      mergeability: pullRequest.mergeStatus || 'unknown'
    };
  }

  async pullRequestDiff(repo, id) {
    const { files } = await this.listPullRequestFiles(repo, id);
    return { files, page: 1, hasMore: false };
  }
}

module.exports = AzureProviderAdapter;
