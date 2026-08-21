import * as nodePath from 'node:path';
import {
  GitHubProviderAdapter,
  GitLabProviderAdapter,
  AzureProviderAdapter
} from './hosting/providers/index.mts';
import type {
  HostingProviderId,
  HostedRepositoryRef,
  HostingAccount,
  PullRequestListPage,
  PullRequestDetail,
  PullRequestDiffPage
} from '../shared/hosting.mts';

interface ProviderAdapterSurface {
  listPullRequests(
    repo: HostedRepositoryRef,
    options: { page: number; filter: string; search?: string; account: HostingAccount }
  ): Promise<PullRequestListPage>;
  pullRequestDetail(
    repo: HostedRepositoryRef,
    id: number,
    ctx: { viewer: HostingAccount['user'] }
  ): Promise<PullRequestDetail>;
  pullRequestDiff(
    repo: HostedRepositoryRef,
    id: number,
    page?: number
  ): Promise<PullRequestDiffPage>;
  resolveThread(
    repo: HostedRepositoryRef,
    id: number,
    thread: { id: string },
    resolved: boolean
  ): Promise<{ success: true; resolved: boolean }>;
  submitReview(...args: unknown[]): Promise<unknown>;
  createPullRequest(...args: unknown[]): Promise<unknown>;
}

interface LoginSession {
  controller: AbortController;
  deviceCode?: string;
  interval?: number;
  [key: string]: unknown;
}

export interface HostingAccountRecord {
  accessToken?: string;
  user?: { login?: string } | null;
  refreshToken?: string;
  expiresAt?: number | null;
  [key: string]: unknown;
}

interface ValidatedRepository {
  provider: HostingProviderId;
  host: string;
  ownerPath: string;
  repository: string;
  organization?: string;
  project?: string;
}

export class HostingService {
  private vault: {
    getAccount: (provider: string) => Promise<HostingAccountRecord | null>;
    setAccount: (provider: string, account: HostingAccountRecord) => Promise<unknown>;
    getSecurityState?: () => { warning?: string } | undefined;
    removeAccount?: (provider: string) => Promise<unknown>;
    removeProviderDrafts?: (provider: string) => Promise<unknown>;
    saveReviewDraft: (key: string, draft: unknown) => Promise<unknown>;
    getReviewDraft: (key: string) => Promise<Record<string, unknown> | null>;
    removeReviewDraft: (key: string) => Promise<unknown>;
    [key: string]: unknown;
  };

  private oauthConfig: Record<string, unknown>;

  private fetch: typeof globalThis.fetch;

  private openExternal: (url: string) => Promise<void>;

  private onAuthState: (state: unknown) => void;

  private sleep: (milliseconds: number) => Promise<void>;

  private loginSessions: Map<string, LoginSession>;

  private providerAdapters: Record<string, ProviderAdapterSurface>;

  constructor(options: {
    vault: HostingService['vault'];
    oauthConfig?: Record<string, unknown>;
    fetch?: typeof globalThis.fetch;
    openExternal?: (url: string) => Promise<void>;
    onAuthState?: (state: unknown) => void;
    sleep?: (milliseconds: number) => Promise<void>;
    providerAdapters?: Record<string, ProviderAdapterSurface>;
    loginSessions?: HostingService['loginSessions'];
  }) {
    this.vault = options.vault;
    this.oauthConfig = options.oauthConfig || {};
    this.fetch = options.fetch || global.fetch;
    this.openExternal = options.openExternal || (async () => {});
    this.onAuthState = options.onAuthState || (() => {});
    this.sleep = options.sleep || (milliseconds => new Promise(resolve => {
      setTimeout(resolve, milliseconds);
    }));
    this.loginSessions = new Map();
    this.providerAdapters = options.providerAdapters || {
      github: new GitHubProviderAdapter({
        api: (...args) => this.api(...args),
        graphql: (...args) => this.githubGraphql(...args)
      }),
      gitlab: new GitLabProviderAdapter({ api: (...args) => this.api(...args) }),
      azure: new AzureProviderAdapter({
        api: (...args) => this.api(...args),
        identityMatches: (...args) => this.azureIdentityMatches(...args),
        identitySearch: (...args) => this.azureIdentitySearch(...args)
      })
    };
  }

  async fetchWithTimeout(
    url: string,
    options: RequestInit & { timeout?: unknown } = {}
  ) {
    const controller = new AbortController();
    const timeoutMs = Number.isFinite(Number(options.timeout)) ? Number(options.timeout) : 30000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let signal = controller.signal;
    if (options.signal) signal = AbortSignal.any([options.signal, signal]);
    try {
      const response = await this.fetch(url, { ...options, signal });
      if (!String(response.url || url).startsWith('https://')) {
        throw new Error('Provider response was not delivered over HTTPS');
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  validateProvider(provider) {
    if (!['github', 'gitlab', 'azure'].includes(provider)) {
      throw new Error(`Unsupported hosting provider: ${provider}`);
    }
    return provider;
  }

  providerAdapter(provider: unknown): ProviderAdapterSurface {
    const adapter = this.providerAdapters[this.validateProvider(provider)];
    if (!adapter) throw new Error(`Unsupported hosting provider: ${provider}`);
    return adapter;
  }

  validateRepository(repository: {
    provider?: unknown;
    host?: unknown;
    ownerPath?: unknown;
    repository?: unknown;
    organization?: unknown;
    project?: unknown;
  }): ValidatedRepository {
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
    const value: ValidatedRepository = { provider, host: expectedHost, ownerPath, repository: name };
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
    const session: LoginSession = {
      controller,
      deviceCode: String(device.device_code || ''),
      expiresAt: Date.now() + Number(device.expires_in || 900) * 1000,
      interval: Math.max(5, Number(device.interval || 5))
    };
    this.loginSessions.set(provider, session);
    const verificationUri = String(
      device.verification_uri_complete
      || device.verification_uri
      || device.verification_url
      || ''
    );
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
        accessToken: String(token.access_token || ''),
        refreshToken: token.refresh_token || '',
        expiresAt: token.expires_in
          ? Date.now() + Number(token.expires_in) * 1000
          : null,
        user: await this.fetchCurrentUser(provider, String(token.access_token || ''))
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

  destroy() {
    for (const session of this.loginSessions.values()) session.controller.abort();
    this.loginSessions.clear();
  }

  async logout(provider) {
    await this.cancelLogin(provider);
    await this.vault.removeAccount(provider);
    await this.vault.removeProviderDrafts(provider);
    return { success: true, provider };
  }

  async requestForm(
    url: string,
    values: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(
        Object.entries(values).map(([key, value]) => [key, String(value)])
      ).toString(),
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

  async fetchCurrentUser(
    provider: unknown,
    token: unknown,
    organization?: unknown
  ) {
    let url;
    if (provider === 'azure') {
      url = organization
        ? `https://dev.azure.com/${encodeURIComponent(String(organization))}/_apis/connectionData?api-version=7.1-preview`
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
    const response = await this.fetchWithTimeout(url, { headers });
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
    const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error('Provider response is too large');
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error('Provider response is too large');
    }
    let value;
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

  async api(
    repository: HostedRepositoryRef,
    endpoint: string,
    options: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}
  ) {
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
    const response = await this.fetchWithTimeout(url, {
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
      accessToken: String(token.access_token || ''),
      refreshToken: String(token.refresh_token || account.refreshToken || ''),
      expiresAt: token.expires_in
        ? Date.now() + Number(token.expires_in) * 1000
        : account.expiresAt
    };
    await this.vault.setAccount(provider, refreshed);
    return refreshed;
  }

  async listPullRequests(
    repository: unknown,
    options: { page?: unknown; filter?: unknown; search?: unknown } = {}
  ) {
    const repo = this.validateRepository(repository);
    const page = Math.max(1, Math.min(10000, Number(options.page) || 1));
    const filter = typeof options.filter === 'string'
      && ['open', 'review-requested', 'authored', 'all'].includes(options.filter)
      ? options.filter
      : 'open';
    const search = String(options.search || '').trim().slice(0, 200).toLowerCase();
    const account = await this.vault.getAccount(repo.provider);
    if (!account?.accessToken) throw new Error(`Connect ${repo.provider} first`);
    return this.providerAdapter(repo.provider).listPullRequests(repo, {
      page,
      filter,
      search,
      account
    });
  }

  async pullRequestDetail(repository, id) {
    const repo = this.validateRepository(repository);
    const pullRequestId = this.validatePullRequestId(id);
    const viewer = (await this.vault.getAccount(repo.provider))?.user;
    return this.providerAdapter(repo.provider).pullRequestDetail(repo, pullRequestId, {
      viewer
    });
  }

  async pullRequestDiff(repository, id, page = 1) {
    const repo = this.validateRepository(repository);
    const pullRequestId = this.validatePullRequestId(id);
    const safePage = Math.max(1, Math.min(10000, Number(page) || 1));
    return this.providerAdapter(repo.provider).pullRequestDiff(repo, pullRequestId, safePage);
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
    const response = await this.fetchWithTimeout('https://api.github.com/graphql', {
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
    return this.providerAdapter(repo.provider).resolveThread(
      repo,
      pullRequestId,
      { ...thread, id: threadId },
      Boolean(resolved)
    );
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
      const normalized = nodePath.posix.normalize(filePath);
      if (
        !filePath ||
        filePath.length > 1000 ||
        normalized !== filePath ||
        normalized.startsWith('../') ||
        nodePath.posix.isAbsolute(filePath)
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

  async saveReviewDraft(repository: unknown, id: unknown, draft: unknown) {
    const safeDraft = this.validateReviewDraft(draft);
    await this.vault.saveReviewDraft(this.draftKey(repository, id), safeDraft);
    return { success: true };
  }

  async getReviewDraft(repository: unknown, id: unknown, headSha: unknown) {
    if (typeof headSha !== 'string' || !/^[a-f0-9]{7,64}$/i.test(headSha)) {
      return null;
    }
    const draft = await this.vault.getReviewDraft(this.draftKey(repository, id));
    return draft ? { ...draft, stale: draft.headSha !== headSha } : null;
  }

  async submitReview(repository: unknown, id: unknown, draft: unknown) {
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
          ...((storedDraft.completedOperations as string[]) || [])
        ])
      ];
    }
    const completed = new Set(safeDraft.completedOperations);
    const markCompleted = async operation => {
      completed.add(operation);
      await this.vault.saveReviewDraft(this.draftKey(repo, id), {
        ...safeDraft,
        completedOperations: [...completed]
      });
    };
    const viewer = (await this.vault.getAccount(repo.provider))?.user;
    const result = await this.providerAdapter(repo.provider).submitReview(
      repo,
      pullRequestId,
      safeDraft,
      {
        viewer,
        markCompleted,
        validateThreadId: value => this.validateThreadId(value)
      }
    );
    await this.vault.removeReviewDraft(this.draftKey(repo, pullRequestId));
    return result;
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

  validateCreatePullRequestInput(input: Record<string, unknown> = {}) {
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
      workItems: this.parseWorkItemIds(input.workItems),
      removeSourceBranch: Boolean(input.removeSourceBranch)
    };
  }

  async azureIdentitySearch(organization, query) {
    const account = await this.getAccessAccount('azure');
    if (!account?.accessToken) throw new Error('Connect azure first');
    const url =
      `https://vssps.dev.azure.com/${encodeURIComponent(organization)}/_apis/identities`
      + `?searchFilter=General&filterValue=${encodeURIComponent(query)}`
      + '&queryMembership=None&api-version=7.1-preview.1';
    const response = await this.fetchWithTimeout(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`:${account.accessToken}`).toString('base64')}`,
        'User-Agent': 'GitTree'
      }
    });
    const data = await this.readResponse(response);
    return data.value || [];
  }

  async createPullRequest(repository, input = {}) {
    const repo = this.validateRepository(repository);
    const options = this.validateCreatePullRequestInput(input);
    const account = await this.vault.getAccount(repo.provider);
    if (!account?.accessToken) throw new Error(`Connect ${repo.provider} first`);
    return this.providerAdapter(repo.provider).createPullRequest(repo, options, {
      viewer: account.user
    });
  }
}

