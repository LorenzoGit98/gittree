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

  normalizeFile(file) {
    return {
      path: file.new_path,
      oldPath: file.old_path !== file.new_path ? file.old_path : null,
      status: file.new_file ? 'added' : file.deleted_file ? 'removed' : file.renamed_file
        ? 'renamed'
        : 'modified',
      additions: null,
      deletions: null,
      binary: false,
      patch: file.diff || ''
    };
  }

  async pullRequestDetail(repo, id, { viewer }) {
    const project = encodeURIComponent(`${repo.ownerPath}/${repo.repository}`);
    const prefix = `/projects/${project}/merge_requests/${id}`;
    const [mergeRequest, approvals, pipelines, changes, discussions] = await Promise.all([
      this.api(repo, prefix),
      this.api(repo, `${prefix}/approvals`),
      this.api(repo, `${prefix}/pipelines?per_page=50`),
      this.api(repo, `${prefix}/changes`),
      this.api(repo, `${prefix}/discussions?per_page=100`)
    ]);
    return {
      summary: this.normalizeSummary(mergeRequest.data, viewer),
      permissions: {
        review: true,
        requestChanges: false,
        resolveThreads: true,
        checkout: true
      },
      reviewers: [
        ...(mergeRequest.data.reviewers || []).map(reviewer => ({
          login: reviewer.username,
          state: 'requested'
        })),
        ...(approvals.data.approved_by || []).map(entry => ({
          login: entry.user?.username || '',
          state: 'APPROVED'
        }))
      ],
      checks: pipelines.data.map(pipeline => ({
        id: pipeline.id,
        name: `Pipeline #${pipeline.id}`,
        status: pipeline.status,
        conclusion: pipeline.status,
        url: pipeline.web_url
      })),
      files: (changes.data.changes || []).map(file => this.normalizeFile(file)),
      threads: discussions.data.map(discussion => ({
        id: discussion.id,
        resolved: (discussion.notes || []).every(note => (
          note.resolvable ? note.resolved : true
        )),
        notes: (discussion.notes || []).map(note => ({
          id: note.id,
          author: note.author?.username || '',
          body: note.body || '',
          resolved: Boolean(note.resolved),
          resolvable: Boolean(note.resolvable),
          createdAt: note.created_at
        }))
      })),
      headSha: mergeRequest.data.diff_refs?.head_sha || mergeRequest.data.sha,
      mergeability: mergeRequest.data.detailed_merge_status
        || mergeRequest.data.merge_status
        || 'unknown'
    };
  }

  async pullRequestDiff(repo, id) {
    const project = encodeURIComponent(`${repo.ownerPath}/${repo.repository}`);
    const result = await this.api(
      repo,
      `/projects/${project}/merge_requests/${id}/changes`
    );
    return {
      files: (result.data.changes || []).map(file => this.normalizeFile(file)),
      page: 1,
      hasMore: false
    };
  }
}

module.exports = GitLabProviderAdapter;
