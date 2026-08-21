import type {
  ProviderPayload,
  HostingApiResult,
  PullRequestSummary,
  PullRequestFile,
  PullRequestDetail,
  PullRequestListPage,
  PullRequestDiffPage,
  HostedRepositoryRef,
  HostingAccount
} from '../../../shared/hosting.mts';

export class GitLabProviderAdapter {
  private api: (
    repo: HostedRepositoryRef,
    path: string,
    options?: Record<string, unknown>
  ) => Promise<HostingApiResult>;

  constructor({ api }: {
    api: (repo: HostedRepositoryRef, path: string, options?: Record<string, unknown>) => Promise<HostingApiResult>;
  }) {
    this.api = api;
  }

  normalizeSummary(item: ProviderPayload, user: HostingAccount['user']): PullRequestSummary {
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

  async listPullRequests(
    repo: HostedRepositoryRef,
    { page, filter, search, account }: {
      page: number;
      filter: string;
      search?: string;
      account: HostingAccount;
    }
  ): Promise<PullRequestListPage> {
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

  normalizeFile(file: ProviderPayload): PullRequestFile {
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

  async pullRequestDetail(
    repo: HostedRepositoryRef,
    id: number,
    { viewer }: { viewer: HostingAccount['user'] }
  ): Promise<PullRequestDetail> {
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

  async pullRequestDiff(repo: HostedRepositoryRef, id: number): Promise<PullRequestDiffPage> {
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

  async resolveThread(
    repo: HostedRepositoryRef,
    id: number,
    thread: { id: string; noteId?: number | string },
    resolved: boolean
  ): Promise<{ success: true; resolved: boolean }> {
    const noteId = Number(thread.noteId);
    if (!Number.isSafeInteger(noteId) || noteId <= 0) {
      throw new Error('Invalid GitLab discussion note');
    }
    const project = encodeURIComponent(`${repo.ownerPath}/${repo.repository}`);
    await this.api(
      repo,
      `/projects/${project}/merge_requests/${id}/discussions/${encodeURIComponent(thread.id)}/notes/${noteId}`,
      { method: 'PUT', body: { resolved: Boolean(resolved) } }
    );
    return { success: true, resolved: Boolean(resolved) };
  }

  async submitReview(
    repo: HostedRepositoryRef,
    id: number,
    draft: {
      headSha: string;
      body?: string;
      event: string;
      inlineComments: Array<{ body: string; path: string; line: number | null }>;
      replies: Array<{ threadId: unknown; body: string }>;
      completedOperations?: string[];
    },
    { markCompleted, validateThreadId }: {
      markCompleted: (operation: string) => Promise<void> | void;
      validateThreadId: (threadId: unknown) => string;
    }
  ): Promise<{ success: true }> {
    if (draft.event === 'REQUEST_CHANGES') {
      throw new Error('GitLab does not support Request changes in GitTree');
    }
    const project = encodeURIComponent(`${repo.ownerPath}/${repo.repository}`);
    const completed = new Set(draft.completedOperations);
    const perform = async (operation, action) => {
      if (completed.has(operation)) return;
      await action();
      completed.add(operation);
      await markCompleted(operation);
    };
    for (let index = 0; index < draft.inlineComments.length; index += 1) {
      const comment = draft.inlineComments[index];
      await perform(`inline:${index}`, () => this.api(
        repo,
        `/projects/${project}/merge_requests/${id}/discussions`,
        {
          method: 'POST',
          body: {
            body: comment.body,
            position: {
              position_type: 'text',
              head_sha: draft.headSha,
              new_path: comment.path,
              new_line: comment.line
            }
          }
        }
      ));
    }
    for (let index = 0; index < draft.replies.length; index += 1) {
      const reply = draft.replies[index];
      const threadId = validateThreadId(reply.threadId);
      await perform(`reply:${index}`, () => this.api(
        repo,
        `/projects/${project}/merge_requests/${id}/discussions/${encodeURIComponent(threadId)}/notes`,
        { method: 'POST', body: { body: reply.body } }
      ));
    }
    if (draft.body) {
      await perform('summary', () => this.api(
        repo,
        `/projects/${project}/merge_requests/${id}/notes`,
        { method: 'POST', body: { body: draft.body } }
      ));
    }
    if (draft.event === 'APPROVE') {
      await perform('approve', () => this.api(
        repo,
        `/projects/${project}/merge_requests/${id}/approve`,
        { method: 'POST', body: { sha: draft.headSha } }
      ));
    }
    return { success: true };
  }

  async resolveUserIds(repo: HostedRepositoryRef, names: string[]): Promise<number[]> {
    const ids = [];
    for (const name of names) {
      const byUsername = await this.api(
        repo,
        `/users?username=${encodeURIComponent(name)}`
      ).catch(() => ({ data: [] }));
      let user = Array.isArray(byUsername.data) ? byUsername.data[0] : null;
      if (!user) {
        const search = await this.api(
          repo,
          `/users?search=${encodeURIComponent(name)}&per_page=5`
        );
        user = (search.data || []).find(item => (
          item.username?.toLowerCase() === name.toLowerCase()
          || item.name?.toLowerCase() === name.toLowerCase()
        )) || search.data?.[0];
      }
      if (!user?.id) throw new Error(`GitLab user not found: ${name}`);
      ids.push(user.id);
    }
    return ids;
  }

  async createPullRequest(
    repo: HostedRepositoryRef,
    options: {
      title: string;
      source: string;
      target: string;
      body?: string;
      draft?: boolean;
      reviewers?: string[];
      assignees?: string[];
      labels?: string[];
      removeSourceBranch?: boolean;
    },
    { viewer }: { viewer: HostingAccount['user'] }
  ) {
    const project = encodeURIComponent(`${repo.ownerPath}/${repo.repository}`);
    const warnings = [];
    let reviewerIds = [];
    let assigneeIds = [];
    if (options.reviewers.length) {
      try {
        reviewerIds = await this.resolveUserIds(repo, options.reviewers);
      } catch (error) {
        warnings.push(error.message);
      }
    }
    if (options.assignees.length) {
      try {
        assigneeIds = await this.resolveUserIds(repo, options.assignees);
      } catch (error) {
        warnings.push(error.message);
      }
    }
    const created = await this.api(repo, `/projects/${project}/merge_requests`, {
      method: 'POST',
      body: {
        source_branch: options.source,
        target_branch: options.target,
        title: options.draft && !/^draft:/i.test(options.title)
          ? `Draft: ${options.title}`
          : options.title,
        description: options.body,
        draft: options.draft,
        labels: options.labels.join(',') || undefined,
        reviewer_ids: reviewerIds.length ? reviewerIds : undefined,
        assignee_ids: assigneeIds.length ? assigneeIds : undefined,
        remove_source_branch: options.removeSourceBranch
      }
    });
    return {
      success: true,
      pullRequest: this.normalizeSummary(created.data, viewer),
      url: created.data.web_url || '',
      warnings
    };
  }
}

