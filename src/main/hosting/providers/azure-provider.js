class AzureProviderAdapter {
  constructor({ api, identityMatches, identitySearch }) {
    this.api = api;
    this.identityMatches = identityMatches;
    this.identitySearch = identitySearch;
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

  async resolveThread(repo, id, thread, resolved) {
    await this.api(
      repo,
      `/pullrequests/${id}/threads/${thread.id}`,
      { method: 'PATCH', body: { status: resolved ? 'closed' : 'active' } }
    );
    return { success: true, resolved: Boolean(resolved) };
  }

  async submitReview(repo, id, draft, {
    viewer,
    markCompleted,
    validateThreadId
  }) {
    const completed = new Set(draft.completedOperations);
    const perform = async (operation, action) => {
      if (completed.has(operation)) return;
      await action();
      completed.add(operation);
      await markCompleted(operation);
    };
    for (let index = 0; index < draft.inlineComments.length; index += 1) {
      const comment = draft.inlineComments[index];
      await perform(`inline:${index}`, () => this.api(repo, `/pullrequests/${id}/threads`, {
        method: 'POST',
        body: {
          comments: [{ parentCommentId: 0, content: comment.body, commentType: 'text' }],
          status: 'active',
          threadContext: {
            filePath: comment.path,
            rightFileEnd: { line: comment.line, offset: 1 }
          }
        }
      }));
    }
    for (let index = 0; index < draft.replies.length; index += 1) {
      const reply = draft.replies[index];
      const threadId = validateThreadId(reply.threadId);
      await perform(`reply:${index}`, () => this.api(
        repo,
        `/pullrequests/${id}/threads/${encodeURIComponent(threadId)}/comments`,
        {
          method: 'POST',
          body: {
            parentCommentId: Number.isSafeInteger(reply.commentId) ? reply.commentId : 0,
            content: reply.body,
            commentType: 'text'
          }
        }
      ));
    }
    if (draft.body) {
      await perform('summary', () => this.api(repo, `/pullrequests/${id}/threads`, {
        method: 'POST',
        body: {
          comments: [{ parentCommentId: 0, content: draft.body, commentType: 'text' }],
          status: 'active'
        }
      }));
    }
    const votes = { APPROVE: ['approve', 10], REQUEST_CHANGES: ['request-changes', -10] };
    const vote = votes[draft.event];
    if (vote) {
      await perform(vote[0], async () => {
        const reviewersResult = await this.api(repo, `/pullrequests/${id}/reviewers`);
        const reviewer = (reviewersResult.data.value || []).find(
          item => this.identityMatches(viewer, item)
        );
        if (reviewer) {
          await this.api(repo, `/pullrequests/${id}/reviewers/${reviewer.id}`, {
            method: 'PUT',
            body: { vote: vote[1] }
          });
        }
      });
    }
    return { success: true };
  }

  async resolveReviewers(repo, names) {
    const reviewers = [];
    for (const name of names) {
      const matches = await this.identitySearch(repo.organization, name);
      const exact = matches.find(item => this.identityMatches(
        { login: name, name, id: name },
        {
          id: item.id,
          uniqueName: item.properties?.Account?.$value || item.properties?.Mail?.$value,
          displayName: item.providerDisplayName || item.customDisplayName,
          login: item.properties?.Account?.$value
        }
      )) || matches.find(item => {
        const haystack = [
          item.providerDisplayName,
          item.customDisplayName,
          item.uniqueName,
          item.properties?.Account?.$value,
          item.properties?.Mail?.$value
        ].filter(Boolean).map(value => String(value).toLowerCase());
        return haystack.includes(name.toLowerCase());
      }) || matches[0];
      if (!exact?.id) throw new Error(`Azure reviewer not found: ${name}`);
      reviewers.push({ id: exact.id });
    }
    return reviewers;
  }

  async createPullRequest(repo, options, { viewer }) {
    const body = {
      sourceRefName: `refs/heads/${options.source}`,
      targetRefName: `refs/heads/${options.target}`,
      title: options.title,
      description: options.body,
      isDraft: options.draft
    };
    if (options.reviewers.length) {
      body.reviewers = await this.resolveReviewers(repo, options.reviewers);
    }
    if (options.workItems.length) {
      body.workItemRefs = options.workItems.map(id => ({ id: String(id) }));
    }
    const created = await this.api(repo, '/pullrequests', { method: 'POST', body });
    const warnings = [];
    for (const label of options.labels) {
      try {
        await this.api(repo, `/pullrequests/${created.data.pullRequestId}/labels`, {
          method: 'POST',
          body: { name: label }
        });
      } catch (error) {
        warnings.push(error.message);
      }
    }
    const summary = this.normalizeSummary(created.data, viewer);
    return {
      success: true,
      pullRequest: summary,
      url: `https://dev.azure.com/${encodeURIComponent(repo.organization)}/${encodeURIComponent(repo.project)}/_git/${encodeURIComponent(repo.repository)}/pullrequest/${summary.number}`,
      warnings
    };
  }
}

module.exports = AzureProviderAdapter;
