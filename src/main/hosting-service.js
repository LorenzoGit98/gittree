const path = require('node:path');

class HostingService {
  constructor(options) {
    this.vault = options.vault;
    this.oauthConfig = options.oauthConfig || {};
    this.fetch = options.fetch || global.fetch;
    this.openExternal = options.openExternal || (async () => {});
    this.onAuthState = options.onAuthState || (() => {});
    this.sleep = options.sleep || (milliseconds => new Promise(resolve => {
      setTimeout(resolve, milliseconds);
    }));
    this.loginSessions = new Map();
  }

  validateProvider(provider) {
    if (!['github', 'gitlab', 'azure'].includes(provider)) {
      throw new Error(`Unsupported hosting provider: ${provider}`);
    }
    return provider;
  }

  validateRepository(repository) {
    const provider = this.validateProvider(repository?.provider);
    const expectedHost = provider === 'github' ? 'github.com'
      : provider === 'gitlab' ? 'gitlab.com'
      : 'dev.azure.com';
    if (repository.host !== expectedHost) {
      throw new Error(`${provider} review is available only for ${expectedHost}`);
    }
    const ownerPath = String(repository.ownerPath || '');
    const name = String(repository.repository || '');
    const segment = /^[A-Za-z0-9_.-]+$/;
    if (
      !ownerPath ||
      ownerPath.length > 500 ||
      !ownerPath.split('/').every(part => segment.test(part)) ||
      !segment.test(name)
    ) {
      throw new Error('Invalid hosting repository');
    }
    const value = { provider, host: expectedHost, ownerPath, repository: name };
    if (provider === 'azure') {
      const [organization, project] = ownerPath.split('/');
      value.organization = String(repository.organization || organization || '');
      value.project = String(repository.project || project || '');
    }
    return value;
  }

  validatePullRequestId(id) {
    const value = Number(id);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error('Invalid pull request ID');
    }
    return value;
  }

  repositoryKey(repository) {
    const value = this.validateRepository(repository);
    return `${value.provider}:${value.ownerPath}/${value.repository}`;
  }

  draftKey(repository, id) {
    return `${this.repositoryKey(repository)}:${this.validatePullRequestId(id)}`;
  }

  async providerStatus(provider) {
    this.validateProvider(provider);
    const account = await this.vault.getAccount(provider);
    const security = this.vault.getSecurityState();
    return {
      provider,
      configured: provider === 'azure' ? true : Boolean(this.oauthConfig[provider]),
      connected: Boolean(account?.accessToken),
      user: account?.user || null,
      phase: this.loginSessions.has(provider) ? 'authorizing' : 'idle',
      warning: security.warning || ''
    };
  }

  async setPat(provider, token, organization) {
    this.validateProvider(provider);
    if (!token || typeof token !== 'string' || token.length < 20 || token.length > 200) {
      throw new Error('Invalid Personal Access Token');
    }
    const user = await this.fetchCurrentUser(provider, token, organization);
    const account = {
      accessToken: token,
      refreshToken: '',
      expiresAt: null,
      user
    };
    await this.vault.setAccount(provider, account);
    this.onAuthState({
      provider,
      phase: 'connected',
      status: await this.providerStatus(provider)
    });
    return { success: true, provider, user, phase: 'connected' };
  }

  async login(provider) {
    this.validateProvider(provider);
    if (provider === 'azure') {
      throw new Error('Azure DevOps uses a Personal Access Token. Use setPat to configure it.');
    }
    const clientId = this.oauthConfig[provider];
    if (!clientId) throw new Error(`${provider} OAuth is not configured in this build`);
    await this.cancelLogin(provider);
    const controller = new AbortController();
    const device = provider === 'github'
      ? await this.requestForm(
          'https://github.com/login/device/code',
          {
            client_id: clientId
          },
          controller.signal
        )
      : await this.requestForm(
          'https://gitlab.com/oauth/authorize_device',
          {
            client_id: clientId,
            scope: 'api'
          },
          controller.signal
        );
    const session = {
      controller,
      deviceCode: device.device_code,
      expiresAt: Date.now() + Number(device.expires_in || 900) * 1000,
      interval: Math.max(5, Number(device.interval || 5))
    };
    this.loginSessions.set(provider, session);
    const verificationUri = device.verification_uri_complete
      || device.verification_uri
      || device.verification_url;
    if (verificationUri) {
      const parsed = new URL(verificationUri);
      const expectedHost = provider === 'github' ? 'github.com' : 'gitlab.com';
      if (parsed.protocol !== 'https:' || parsed.hostname !== expectedHost) {
        throw new Error('Provider returned an unsafe verification URL');
      }
      await this.openExternal(verificationUri);
    }
    this.pollDeviceToken(provider, clientId, session).catch(error => {
      if (error.name !== 'AbortError') {
        this.onAuthState({ provider, phase: 'error', error: error.message });
      }
    });
    return {
      success: true,
      provider,
      userCode: device.user_code,
      verificationUri,
      expiresIn: Number(device.expires_in || 900),
      interval: session.interval
    };
  }

  async pollDeviceToken(provider, clientId, session) {
    while (Date.now() < session.expiresAt && !session.controller.signal.aborted) {
      await this.sleep(session.interval * 1000);
      let token;
      if (provider === 'github') {
        token = await this.requestForm(
          'https://github.com/login/oauth/access_token',
          {
            client_id: clientId,
            device_code: session.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          },
          session.controller.signal
        );
      } else {
        token = await this.requestForm(
          'https://gitlab.com/oauth/token',
          {
            client_id: clientId,
            device_code: session.deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          },
          session.controller.signal
        );
      }
      if (token.error === 'authorization_pending') continue;
      if (token.error === 'slow_down') {
        session.interval += 5;
        continue;
      }
      if (token.error) throw new Error(token.error_description || token.error);
      if (!token.access_token) throw new Error('Provider did not return an access token');
      const account = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token || '',
        expiresAt: token.expires_in
          ? Date.now() + Number(token.expires_in) * 1000
          : null,
        user: await this.fetchCurrentUser(provider, token.access_token)
      };
      await this.vault.setAccount(provider, account);
      this.loginSessions.delete(provider);
      this.onAuthState({
        provider,
        phase: 'connected',
        status: await this.providerStatus(provider)
      });
      return;
    }
    this.loginSessions.delete(provider);
    if (!session.controller.signal.aborted) {
      throw new Error('Device authorization expired');
    }
  }

  async cancelLogin(provider) {
    this.validateProvider(provider);
    const session = this.loginSessions.get(provider);
    if (session) session.controller.abort();
    this.loginSessions.delete(provider);
    return { success: true };
  }

  async logout(provider) {
    await this.cancelLogin(provider);
    await this.vault.removeAccount(provider);
    return { success: true, provider };
  }

  async requestForm(url, values, signal) {
    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(values).toString(),
      signal
    });
    return this.readResponse(response);
  }

  withAzureApiVersion(endpoint) {
    const value = String(endpoint || '');
    return value.includes('api-version=')
      ? value
      : `${value}${value.includes('?') ? '&' : '?'}api-version=7.1-preview`;
  }

  azureIdentityMatches(user, identity) {
    if (!user || !identity) return false;
    const candidates = [user.login, user.name, user.id]
      .filter(Boolean)
      .map(value => String(value).toLowerCase());
    const theirs = [identity.uniqueName, identity.displayName, identity.id, identity.login]
      .filter(Boolean)
      .map(value => String(value).toLowerCase());
    return theirs.some(value => candidates.includes(value));
  }

  async fetchCurrentUser(provider, token, organization) {
    let url;
    if (provider === 'azure') {
      url = organization
        ? `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/connectionData?api-version=7.1-preview`
        : 'https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1-preview';
    } else {
      url = provider === 'github'
        ? 'https://api.github.com/user'
        : 'https://gitlab.com/api/v4/user';
    }
    const headers = provider === 'azure'
      ? {
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}`,
          'User-Agent': 'GitTree'
        }
      : {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'GitTree'
        };
    const response = await this.fetch(url, { headers });
    const user = await this.readResponse(response);
    if (provider === 'azure') {
      const identity = user.authenticatedUser || user;
      return {
        id: identity.id,
        login: identity.providerDisplayName || identity.customDisplayName
          || user.emailAddress || user.displayName || '',
        name: identity.customDisplayName || identity.providerDisplayName
          || user.displayName || '',
        avatarUrl: user.avatarUrl || ''
      };
    }
    return provider === 'github'
      ? { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatar_url }
      : {
          id: user.id,
          login: user.username,
          name: user.name,
          avatarUrl: user.avatar_url
        };
  }

  async readResponse(response) {
    const text = await response.text();
    let value = {};
    try {
      value = text ? JSON.parse(text) : {};
    } catch {
      value = { message: text };
    }
    if (!response.ok) {
      const rateLimit = response.headers.get('x-ratelimit-remaining') === '0'
        ? ' Provider rate limit reached.'
        : '';
      throw new Error(`${value.message || value.error_description || `HTTP ${response.status}`}${rateLimit}`);
    }
    return value;
  }

  async api(repository, endpoint, options = {}) {
    const repo = this.validateRepository(repository);
    const account = await this.getAccessAccount(repo.provider);
    if (!account?.accessToken) throw new Error(`Connect ${repo.provider} first`);
    let url;
    if (repo.provider === 'azure') {
      url = `https://dev.azure.com/${encodeURIComponent(repo.organization)}/${encodeURIComponent(repo.project)}/_apis/git/repositories/${encodeURIComponent(repo.repository)}${this.withAzureApiVersion(endpoint)}`;
    } else {
      url = repo.provider === 'github'
        ? `https://api.github.com${endpoint}`
        : `https://gitlab.com/api/v4${endpoint}`;
    }
    const authHeader = repo.provider === 'azure'
      ? `Basic ${Buffer.from(`:${account.accessToken}`).toString('base64')}`
      : `Bearer ${account.accessToken}`;
    const response = await this.fetch(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: authHeader,
        'User-Agent': 'GitTree',
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await this.readResponse(response);
    return { data, headers: response.headers };
  }

  async getAccessAccount(provider) {
    const account = await this.vault.getAccount(provider);
    if (!account?.accessToken) return account;
    if (
      provider === 'azure' ||
      !account.refreshToken ||
      !account.expiresAt ||
      account.expiresAt > Date.now() + 60000
    ) {
      return account;
    }
    const clientId = this.oauthConfig[provider];
    if (!clientId) throw new Error(`${provider} OAuth is not configured in this build`);
    const token = await this.requestForm(
      provider === 'github'
        ? 'https://github.com/login/oauth/access_token'
        : 'https://gitlab.com/oauth/token',
      {
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken
      }
    );
    if (!token.access_token) throw new Error('Provider token refresh failed');
    const refreshed = {
      ...account,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || account.refreshToken,
      expiresAt: token.expires_in
        ? Date.now() + Number(token.expires_in) * 1000
        : account.expiresAt
    };
    await this.vault.setAccount(provider, refreshed);
    return refreshed;
  }

  async listPullRequests(repository, options = {}) {
    const repo = this.validateRepository(repository);
    const page = Math.max(1, Math.min(10000, Number(options.page) || 1));
    const filter = ['open', 'review-requested', 'authored', 'all'].includes(options.filter)
      ? options.filter
      : 'open';
    const search = String(options.search || '').trim().slice(0, 200).toLowerCase();
    const account = await this.vault.getAccount(repo.provider);
    if (!account?.accessToken) throw new Error(`Connect ${repo.provider} first`);
    let result;
    if (repo.provider === 'github') {
      const state = filter === 'all' ? 'all' : 'open';
      result = await this.api(
        repo,
        `/repos/${encodeURIComponent(repo.ownerPath)}/${encodeURIComponent(repo.repository)}/pulls?state=${state}&per_page=50&page=${page}`
      );
      let items = result.data.map(item => this.normalizeGitHubSummary(item, account.user));
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

    if (repo.provider === 'azure') {
      const skip = (page - 1) * 50;
      const status = filter === 'all' ? 'all' : 'active';
      result = await this.api(
        repo,
        `/pullrequests?searchCriteria.status=${status}&$top=50&$skip=${skip}`
      );
      if (!result.data || !Array.isArray(result.data.value)) {
        throw new Error('Failed to load pull requests');
      }
      let items = result.data.value.map(item => this.normalizeAzureSummary(item, account.user));
      if (filter === 'authored') {
        items = items.filter(item => this.azureIdentityMatches(account.user, item.author));
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
        hasMore: result.data.value.length >= 50
      };
    }

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
    result = await this.api(repo, `/projects/${project}/merge_requests?${query}`);
    return {
      items: result.data.map(item => this.normalizeGitLabSummary(item, account.user)),
      page,
      hasMore: Boolean(result.headers.get('x-next-page'))
    };
  }

  normalizeGitHubSummary(item, user) {
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
      state: item.state,
      draft: Boolean(item.draft),
      reviewStatus: (item.requested_reviewers || []).some(
        reviewer => reviewer.login === user?.login
      ) ? 'requested' : 'none',
      ciStatus: 'unknown'
    };
  }

  normalizeGitLabSummary(item, user) {
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

  normalizeAzureSummary(item, user) {
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
      state: item.status === 'active' || item.status === 'open' ? 'open' : item.status === 'completed' ? 'closed' : item.status,
      draft: Boolean(item.isDraft),
      reviewStatus: (item.reviewers || []).some(
        reviewer => reviewer.vote === 0 && this.azureIdentityMatches(user, reviewer)
      ) ? 'requested' : 'none',
      ciStatus: item.mergeStatus === 'succeeded' ? 'success' : item.mergeStatus === 'conflicts' ? 'failure' : 'unknown',
      reviewers: item.reviewers || []
    };
  }

  async pullRequestDetail(repository, id) {
    const repo = this.validateRepository(repository);
    const pullRequestId = this.validatePullRequestId(id);
    if (repo.provider === 'github') {
      const prefix =
        `/repos/${encodeURIComponent(repo.ownerPath)}/${encodeURIComponent(repo.repository)}`;
      const pull = await this.api(repo, `${prefix}/pulls/${pullRequestId}`);
      const headSha = pull.data.head?.sha;
      if (!headSha) throw new Error('Pull request head SHA is unavailable');
      const [reviews, checks, files, threadResult] = await Promise.all([
        this.api(repo, `${prefix}/pulls/${pullRequestId}/reviews?per_page=100`),
        this.api(repo, `${prefix}/commits/${headSha}/check-runs?per_page=100`).catch(() => ({
          data: { check_runs: [] }
        })),
        this.api(repo, `${prefix}/pulls/${pullRequestId}/files?per_page=100`),
        this.githubGraphql(
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
          {
            owner: repo.ownerPath,
            name: repo.repository,
            number: pullRequestId
          }
        ).catch(() => ({ data: null }))
      ]);
      const account = await this.vault.getAccount('github');
      const summary = this.normalizeGitHubSummary(pull.data, account?.user);
      const latestReviews = new Map();
      reviews.data.forEach(review => {
        latestReviews.set(review.user?.login || '', {
          login: review.user?.login || '',
          state: review.state,
          submittedAt: review.submitted_at
        });
      });
      return {
        summary,
        permissions: {
          review: true,
          resolveThreads: true,
          checkout: true
        },
        reviewers: [...latestReviews.values()],
        checks: (checks.data.check_runs || []).map(check => ({
          id: check.id,
          name: check.name,
          status: check.status,
          conclusion: check.conclusion,
          url: check.html_url
        })),
        files: (files.data || []).map(file => this.normalizeGitHubFile(file)),
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

    if (repo.provider === 'azure') {
      const result = await this.api(repo, `/pullrequests/${pullRequestId}`);
      const pr = result.data;
      const [threadsResult, fileResult] = await Promise.all([
        this.api(repo, `/pullrequests/${pullRequestId}/threads`).catch(() => ({ data: { value: [] } })),
        this.listAzurePullRequestFiles(repo, pullRequestId)
      ]);
      const account = await this.vault.getAccount('azure');
      const summary = this.normalizeAzureSummary(pr, account?.user);
      const headSha = summary.headSha
        || fileResult.headSha
        || pr.lastMergeSourceCommit?.commitId
        || '';
      return {
        summary: { ...summary, headSha },
        permissions: {
          review: true,
          resolveThreads: true,
          checkout: false
        },
        reviewers: (pr.reviewers || []).map(reviewer => ({
          login: reviewer.uniqueName || reviewer.displayName || '',
          state: reviewer.vote === 10 ? 'APPROVED' : reviewer.vote === -10 ? 'CHANGES_REQUESTED' : reviewer.vote === 5 ? 'APPROVED' : reviewer.vote === 0 ? 'requested' : 'none',
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
        mergeability: pr.mergeStatus || 'unknown'
      };
    }

    const project = encodeURIComponent(`${repo.ownerPath}/${repo.repository}`);
    const prefix = `/projects/${project}/merge_requests/${pullRequestId}`;
    const [mergeRequest, approvals, pipelines, changes, discussions] = await Promise.all([
      this.api(repo, prefix),
      this.api(repo, `${prefix}/approvals`),
      this.api(repo, `${prefix}/pipelines?per_page=50`),
      this.api(repo, `${prefix}/changes`),
      this.api(repo, `${prefix}/discussions?per_page=100`)
    ]);
    const account = await this.vault.getAccount('gitlab');
    const summary = this.normalizeGitLabSummary(mergeRequest.data, account?.user);
    return {
      summary,
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
      files: (changes.data.changes || []).map(file => this.normalizeGitLabFile(file)),
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

  normalizeGitHubFile(file) {
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

  normalizeGitLabFile(file) {
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

  normalizeAzureFile(entry) {
    const filePath = String(entry?.item?.path || '').replace(/^\//, '');
    if (!filePath) return null;
    const changeType = String(entry.changeType || '').toLowerCase();
    let status = 'modified';
    if (changeType.includes('add')) status = 'added';
    else if (changeType.includes('delete')) status = 'removed';
    else if (changeType.includes('rename') || changeType.includes('sourceRename')) status = 'renamed';
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
      // ponytail: Azure iteration changes have no unified patch; add diffs/commits later if needed
      patch: ''
    };
  }

  async listAzurePullRequestFiles(repo, pullRequestId) {
    try {
      const iterations = await this.api(repo, `/pullrequests/${pullRequestId}/iterations`);
      const list = iterations.data.value || [];
      if (!list.length) return { files: [], headSha: '' };
      const latest = list[list.length - 1];
      const headSha = latest.sourceRefCommit?.commitId
        || latest.commonRefCommit?.commitId
        || '';
      const changes = await this.api(
        repo,
        `/pullrequests/${pullRequestId}/iterations/${latest.id}/changes?$top=100`
      );
      return {
        files: (changes.data.changeEntries || [])
          .map(entry => this.normalizeAzureFile(entry))
          .filter(Boolean),
        headSha
      };
    } catch {
      return { files: [], headSha: '' };
    }
  }

  async pullRequestDiff(repository, id, page = 1) {
    const repo = this.validateRepository(repository);
    const pullRequestId = this.validatePullRequestId(id);
    const safePage = Math.max(1, Math.min(10000, Number(page) || 1));
    if (repo.provider === 'github') {
      const result = await this.api(
        repo,
        `/repos/${encodeURIComponent(repo.ownerPath)}/${encodeURIComponent(repo.repository)}/pulls/${pullRequestId}/files?per_page=50&page=${safePage}`
      );
      return {
        files: result.data.map(file => this.normalizeGitHubFile(file)),
        page: safePage,
        hasMore: /rel="next"/.test(result.headers.get('link') || '')
      };
    }

    if (repo.provider === 'azure') {
      const { files } = await this.listAzurePullRequestFiles(repo, pullRequestId);
      return { files, page: 1, hasMore: false };
    }

    const project = encodeURIComponent(`${repo.ownerPath}/${repo.repository}`);
    const result = await this.api(
      repo,
      `/projects/${project}/merge_requests/${pullRequestId}/changes`
    );
    return {
      files: (result.data.changes || []).map(file => this.normalizeGitLabFile(file)),
      page: 1,
      hasMore: false
    };
  }

  validateThreadId(value) {
    const id = String(value || '');
    if (!id || id.length > 200 || !/^[A-Za-z0-9_:/+=-]+$/.test(id)) {
      throw new Error('Invalid review thread ID');
    }
    return id;
  }

  async githubGraphql(query, variables) {
    const account = await this.getAccessAccount('github');
    if (!account?.accessToken) throw new Error('Connect github first');
    const response = await this.fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'GitTree'
      },
      body: JSON.stringify({ query, variables })
    });
    const result = await this.readResponse(response);
    if (result.errors?.length) throw new Error(result.errors[0].message);
    return result;
  }

  async resolveThread(repository, id, thread, resolved) {
    const repo = this.validateRepository(repository);
    const pullRequestId = this.validatePullRequestId(id);
    const threadId = this.validateThreadId(thread?.id);
    if (repo.provider === 'github') {
      const mutation = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
      const result = await this.githubGraphql(
        `mutation($threadId: ID!) { ${mutation}(input: {threadId: $threadId}) { thread { id isResolved } } }`,
        { threadId }
      );
      const updated = result.data?.[mutation]?.thread;
      return { success: true, resolved: Boolean(updated?.isResolved) };
    }
    if (repo.provider === 'azure') {
      await this.api(
        repo,
        `/pullrequests/${pullRequestId}/threads/${threadId}`,
        { method: 'PATCH', body: { status: resolved ? 'closed' : 'active' } }
      );
      return { success: true, resolved: Boolean(resolved) };
    }
    const noteId = Number(thread?.noteId);
    if (!Number.isSafeInteger(noteId) || noteId <= 0) {
      throw new Error('Invalid GitLab discussion note');
    }
    const project = encodeURIComponent(`${repo.ownerPath}/${repo.repository}`);
    await this.api(
      repo,
      `/projects/${project}/merge_requests/${pullRequestId}/discussions/${encodeURIComponent(threadId)}/notes/${noteId}`,
      { method: 'PUT', body: { resolved: Boolean(resolved) } }
    );
    return { success: true, resolved: Boolean(resolved) };
  }

  validateReviewDraft(draft) {
    if (!draft || typeof draft !== 'object') throw new Error('Invalid review draft');
    if (typeof draft.headSha !== 'string' || !/^[a-f0-9]{7,64}$/i.test(draft.headSha)) {
      throw new Error('Invalid review head SHA');
    }
    if (!['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(draft.event)) {
      throw new Error('Invalid review event');
    }
    const body = typeof draft.body === 'string' ? draft.body : '';
    if (body.length > 65536 || /\0/.test(body)) throw new Error('Review body is too long');
    const inlineComments = Array.isArray(draft.inlineComments) ? draft.inlineComments : [];
    if (inlineComments.length > 500) throw new Error('Too many inline comments');
    const comments = inlineComments.map(comment => {
      const filePath = String(comment.path || '');
      const normalized = path.posix.normalize(filePath);
      if (
        !filePath ||
        filePath.length > 1000 ||
        normalized !== filePath ||
        normalized.startsWith('../') ||
        path.posix.isAbsolute(filePath)
      ) {
        throw new Error('Invalid review comment path');
      }
      const line = Number(comment.line);
      if (!Number.isSafeInteger(line) || line <= 0 || line > 10000000) {
        throw new Error('Invalid review line');
      }
      const commentBody = String(comment.body || '');
      if (!commentBody.trim() || commentBody.length > 65536 || /\0/.test(commentBody)) {
        throw new Error('Invalid review comment');
      }
      const side = comment.side === 'LEFT' ? 'LEFT' : 'RIGHT';
      return { path: filePath, line, side, body: commentBody };
    });
    const replies = (Array.isArray(draft.replies) ? draft.replies : []).map(reply => {
      const threadId = String(reply.threadId || '');
      const commentId = Number(reply.commentId);
      const replyBody = String(reply.body || '');
      if (
        (!threadId && !Number.isSafeInteger(commentId)) ||
        threadId.length > 200 ||
        !replyBody.trim() ||
        replyBody.length > 65536 ||
        /\0/.test(replyBody)
      ) {
        throw new Error('Invalid review reply');
      }
      return {
        threadId,
        commentId: Number.isSafeInteger(commentId) ? commentId : null,
        body: replyBody
      };
    });
    return {
      headSha: draft.headSha,
      body,
      event: draft.event,
      inlineComments: comments,
      replies,
      completedOperations: Array.isArray(draft.completedOperations)
        ? draft.completedOperations
        : []
    };
  }

  async saveReviewDraft(repository, id, draft) {
    const safeDraft = this.validateReviewDraft(draft);
    await this.vault.saveReviewDraft(this.draftKey(repository, id), safeDraft);
    return { success: true };
  }

  async getReviewDraft(repository, id, headSha) {
    if (typeof headSha !== 'string' || !/^[a-f0-9]{7,64}$/i.test(headSha)) {
      return null;
    }
    const draft = await this.vault.getReviewDraft(this.draftKey(repository, id));
    return draft ? { ...draft, stale: draft.headSha !== headSha } : null;
  }

  async submitReview(repository, id, draft) {
    const repo = this.validateRepository(repository);
    const pullRequestId = this.validatePullRequestId(id);
    const safeDraft = this.validateReviewDraft(draft);
    const storedDraft = await this.vault.getReviewDraft(
      this.draftKey(repo, pullRequestId)
    );
    if (storedDraft?.headSha === safeDraft.headSha) {
      safeDraft.completedOperations = [
        ...new Set([
          ...safeDraft.completedOperations,
          ...(storedDraft.completedOperations || [])
        ])
      ];
    }
    if (repo.provider === 'github') {
      const result = await this.api(
        repo,
        `/repos/${encodeURIComponent(repo.ownerPath)}/${encodeURIComponent(repo.repository)}/pulls/${pullRequestId}/reviews`,
        {
          method: 'POST',
          body: {
            commit_id: safeDraft.headSha,
            body: safeDraft.body,
            event: safeDraft.event,
            comments: safeDraft.inlineComments
          }
        }
      );
      for (const reply of safeDraft.replies) {
        if (!reply.commentId) throw new Error('GitHub reply is missing its comment ID');
        await this.api(
          repo,
          `/repos/${encodeURIComponent(repo.ownerPath)}/${encodeURIComponent(repo.repository)}/pulls/${pullRequestId}/comments/${reply.commentId}/replies`,
          { method: 'POST', body: { body: reply.body } }
        );
      }
      await this.vault.removeReviewDraft(this.draftKey(repo, pullRequestId));
      return { success: true, review: { id: result.data.id, state: result.data.state } };
    }
    if (repo.provider === 'azure') {
      return this.submitAzureReview(repo, pullRequestId, safeDraft);
    }
    if (safeDraft.event === 'REQUEST_CHANGES') {
      throw new Error('GitLab does not support Request changes in GitTree');
    }
    return this.submitGitLabReview(repo, pullRequestId, safeDraft);
  }

  async submitGitLabReview(repo, id, draft) {
    const project = encodeURIComponent(`${repo.ownerPath}/${repo.repository}`);
    const completed = new Set(draft.completedOperations);
    const persist = async operation => {
      completed.add(operation);
      await this.vault.saveReviewDraft(this.draftKey(repo, id), {
        ...draft,
        completedOperations: [...completed]
      });
    };
    for (let index = 0; index < draft.inlineComments.length; index += 1) {
      const operation = `inline:${index}`;
      if (completed.has(operation)) continue;
      const comment = draft.inlineComments[index];
      await this.api(repo, `/projects/${project}/merge_requests/${id}/discussions`, {
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
      });
      await persist(operation);
    }
    for (let index = 0; index < draft.replies.length; index += 1) {
      const operation = `reply:${index}`;
      if (completed.has(operation)) continue;
      const reply = draft.replies[index];
      const threadId = this.validateThreadId(reply.threadId);
      await this.api(
        repo,
        `/projects/${project}/merge_requests/${id}/discussions/${encodeURIComponent(threadId)}/notes`,
        { method: 'POST', body: { body: reply.body } }
      );
      await persist(operation);
    }
    if (draft.body && !completed.has('summary')) {
      await this.api(repo, `/projects/${project}/merge_requests/${id}/notes`, {
        method: 'POST',
        body: { body: draft.body }
      });
      await persist('summary');
    }
    if (draft.event === 'APPROVE' && !completed.has('approve')) {
      await this.api(repo, `/projects/${project}/merge_requests/${id}/approve`, {
        method: 'POST',
        body: { sha: draft.headSha }
      });
      await persist('approve');
    }
    await this.vault.removeReviewDraft(this.draftKey(repo, id));
    return { success: true };
  }

  async submitAzureReview(repo, id, draft) {
    const completed = new Set(draft.completedOperations);
    const persist = async operation => {
      completed.add(operation);
      await this.vault.saveReviewDraft(this.draftKey(repo, id), {
        ...draft,
        completedOperations: [...completed]
      });
    };
    for (let index = 0; index < draft.inlineComments.length; index += 1) {
      const operation = `inline:${index}`;
      if (completed.has(operation)) continue;
      const comment = draft.inlineComments[index];
      await this.api(repo, `/pullrequests/${id}/threads`, {
        method: 'POST',
        body: {
          comments: [{ parentCommentId: 0, content: comment.body, commentType: 'text' }],
          status: 'active',
          threadContext: { filePath: comment.path, rightFileEnd: { line: comment.line, offset: 1 } }
        }
      });
      await persist(operation);
    }
    if (draft.body && !completed.has('summary')) {
      await this.api(repo, `/pullrequests/${id}/threads`, {
        method: 'POST',
        body: {
          comments: [{ parentCommentId: 0, content: draft.body, commentType: 'text' }],
          status: 'active'
        }
      });
      await persist('summary');
    }
    if (draft.event === 'APPROVE' && !completed.has('approve')) {
      const reviewersResult = await this.api(repo, `/pullrequests/${id}/reviewers`);
      const account = await this.vault.getAccount('azure');
      const reviewer = (reviewersResult.data.value || []).find(
        r => this.azureIdentityMatches(account.user, r)
      );
      if (reviewer) {
        await this.api(repo, `/pullrequests/${id}/reviewers/${reviewer.id}`, {
          method: 'PUT',
          body: { vote: 10 }
        });
      }
      await persist('approve');
    }
    if (draft.event === 'REQUEST_CHANGES' && !completed.has('request-changes')) {
      const reviewersResult = await this.api(repo, `/pullrequests/${id}/reviewers`);
      const account = await this.vault.getAccount('azure');
      const reviewer = (reviewersResult.data.value || []).find(
        r => this.azureIdentityMatches(account.user, r)
      );
      if (reviewer) {
        await this.api(repo, `/pullrequests/${id}/reviewers/${reviewer.id}`, {
          method: 'PUT',
          body: { vote: -10 }
        });
      }
      await persist('request-changes');
    }
    await this.vault.removeReviewDraft(this.draftKey(repo, id));
    return { success: true };
  }

  validateBranchName(value, label) {
    const name = String(value || '').trim().replace(/^refs\/heads\//, '');
    if (
      !name ||
      name.length > 255 ||
      name.includes('..') ||
      name.startsWith('/') ||
      name.endsWith('/') ||
      !/^[A-Za-z0-9._/-]+$/.test(name)
    ) {
      throw new Error(`Invalid ${label} branch`);
    }
    return name;
  }

  parseNameList(value, label, limit = 20) {
    const list = Array.isArray(value)
      ? value
      : String(value || '').split(/[,;\n]/);
    const names = [...new Set(
      list.map(item => String(item || '').trim()).filter(Boolean)
    )];
    if (names.length > limit) throw new Error(`Too many ${label}`);
    for (const name of names) {
      if (name.length > 100 || /\0/.test(name)) throw new Error(`Invalid ${label}`);
    }
    return names;
  }

  parseWorkItemIds(value) {
    const list = Array.isArray(value)
      ? value
      : String(value || '').split(/[,;\s]+/);
    const ids = [...new Set(
      list.map(item => Number(String(item || '').replace(/^#/, '').trim()))
        .filter(id => Number.isSafeInteger(id) && id > 0)
    )];
    if (ids.length > 20) throw new Error('Too many work items');
    return ids;
  }

  validateCreatePullRequestInput(input = {}) {
    const title = String(input.title || '').trim();
    if (!title || title.length > 256 || /\0/.test(title)) {
      throw new Error('Pull request title is required');
    }
    const body = String(input.body || '');
    if (body.length > 65536 || /\0/.test(body)) {
      throw new Error('Pull request description is too long');
    }
    const source = this.validateBranchName(input.source, 'source');
    const target = this.validateBranchName(input.target, 'target');
    if (source === target) throw new Error('Source and target branches must differ');
    return {
      title,
      body,
      source,
      target,
      draft: Boolean(input.draft),
      maintainerCanModify: input.maintainerCanModify !== false,
      reviewers: this.parseNameList(input.reviewers, 'reviewers'),
      assignees: this.parseNameList(input.assignees, 'assignees'),
      labels: this.parseNameList(input.labels, 'labels'),
      workItems: this.parseWorkItemIds(input.workItems)
    };
  }

  async azureIdentitySearch(organization, query) {
    const account = await this.getAccessAccount('azure');
    if (!account?.accessToken) throw new Error('Connect azure first');
    const url =
      `https://vssps.dev.azure.com/${encodeURIComponent(organization)}/_apis/identities`
      + `?searchFilter=General&filterValue=${encodeURIComponent(query)}`
      + '&queryMembership=None&api-version=7.1-preview.1';
    const response = await this.fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`:${account.accessToken}`).toString('base64')}`,
        'User-Agent': 'GitTree'
      }
    });
    const data = await this.readResponse(response);
    return data.value || [];
  }

  async resolveAzureReviewers(repo, names) {
    const reviewers = [];
    for (const name of names) {
      const matches = await this.azureIdentitySearch(repo.organization, name);
      const exact = matches.find(item => this.azureIdentityMatches(
        { login: name, name, id: name },
        {
          id: item.id,
          uniqueName: item.properties?.Account?.$value || item.properties?.Mail?.$value,
          displayName: item.providerDisplayName || item.customDisplayName,
          login: item.properties?.Account?.$value
        }
      )) || matches.find(item => {
        const hay = [
          item.providerDisplayName,
          item.customDisplayName,
          item.properties?.Account?.$value,
          item.properties?.Mail?.$value
        ].filter(Boolean).map(value => String(value).toLowerCase());
        return hay.includes(name.toLowerCase());
      }) || matches[0];
      if (!exact?.id) throw new Error(`Azure reviewer not found: ${name}`);
      reviewers.push({ id: exact.id });
    }
    return reviewers;
  }

  async resolveGitLabUserIds(repo, names) {
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

  async createPullRequest(repository, input = {}) {
    const repo = this.validateRepository(repository);
    const options = this.validateCreatePullRequestInput(input);
    const account = await this.vault.getAccount(repo.provider);
    if (!account?.accessToken) throw new Error(`Connect ${repo.provider} first`);

    if (repo.provider === 'github') {
      const prefix =
        `/repos/${encodeURIComponent(repo.ownerPath)}/${encodeURIComponent(repo.repository)}`;
      const created = await this.api(repo, `${prefix}/pulls`, {
        method: 'POST',
        body: {
          title: options.title,
          head: options.source,
          base: options.target,
          body: options.body,
          draft: options.draft,
          maintainer_can_modify: options.maintainerCanModify
        }
      });
      const number = created.data.number;
      const warnings = [];
      if (options.reviewers.length) {
        try {
          await this.api(repo, `${prefix}/pulls/${number}/requested_reviewers`, {
            method: 'POST',
            body: { reviewers: options.reviewers }
          });
        } catch (error) {
          warnings.push(error.message);
        }
      }
      if (options.assignees.length) {
        try {
          await this.api(repo, `${prefix}/issues/${number}/assignees`, {
            method: 'POST',
            body: { assignees: options.assignees }
          });
        } catch (error) {
          warnings.push(error.message);
        }
      }
      if (options.labels.length) {
        try {
          await this.api(repo, `${prefix}/issues/${number}/labels`, {
            method: 'POST',
            body: { labels: options.labels }
          });
        } catch (error) {
          warnings.push(error.message);
        }
      }
      return {
        success: true,
        pullRequest: this.normalizeGitHubSummary(created.data, account.user),
        url: created.data.html_url || '',
        warnings
      };
    }

    if (repo.provider === 'azure') {
      const body = {
        sourceRefName: `refs/heads/${options.source}`,
        targetRefName: `refs/heads/${options.target}`,
        title: options.title,
        description: options.body,
        isDraft: options.draft
      };
      if (options.reviewers.length) {
        body.reviewers = await this.resolveAzureReviewers(repo, options.reviewers);
      }
      if (options.workItems.length) {
        body.workItemRefs = options.workItems.map(id => ({ id: String(id) }));
      }
      const created = await this.api(repo, '/pullrequests', { method: 'POST', body });
      const warnings = [];
      if (options.labels.length) {
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
      }
      const summary = this.normalizeAzureSummary(created.data, account.user);
      return {
        success: true,
        pullRequest: summary,
        url: `https://dev.azure.com/${encodeURIComponent(repo.organization)}/${encodeURIComponent(repo.project)}/_git/${encodeURIComponent(repo.repository)}/pullrequest/${summary.number}`,
        warnings
      };
    }

    const project = encodeURIComponent(`${repo.ownerPath}/${repo.repository}`);
    const warnings = [];
    let reviewerIds = [];
    let assigneeIds = [];
    if (options.reviewers.length) {
      try {
        reviewerIds = await this.resolveGitLabUserIds(repo, options.reviewers);
      } catch (error) {
        warnings.push(error.message);
      }
    }
    if (options.assignees.length) {
      try {
        assigneeIds = await this.resolveGitLabUserIds(repo, options.assignees);
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
        remove_source_branch: Boolean(input.removeSourceBranch)
      }
    });
    return {
      success: true,
      pullRequest: this.normalizeGitLabSummary(created.data, account.user),
      url: created.data.web_url || '',
      warnings
    };
  }
}

module.exports = HostingService;
