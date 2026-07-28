const test = require('node:test');
const assert = require('node:assert/strict');
const HostingService = require('../src/main/hosting-service');

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function memoryVault(account) {
  const drafts = new Map();
  return {
    getSecurityState: () => ({ memoryOnly: false, warning: '' }),
    getAccount: async () => account,
    setAccount: async () => {},
    removeAccount: async () => {},
    getReviewDraft: async key => drafts.get(key) || null,
    saveReviewDraft: async (key, value) => drafts.set(key, value),
    removeReviewDraft: async key => drafts.delete(key)
  };
}

test('normalizes GitHub pull requests and keeps authorization data out of results', async () => {
  const requests = [];
  const service = new HostingService({
    vault: memoryVault({
      accessToken: 'top-secret',
      user: { login: 'octocat' }
    }),
    oauthConfig: { github: 'client-id' },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse([
        {
          id: 91,
          number: 7,
          title: 'Improve graph',
          user: { login: 'alice', avatar_url: 'https://example.test/a.png' },
          head: { ref: 'feature/graph', sha: 'abc' },
          base: { ref: 'main' },
          state: 'open',
          draft: false,
          requested_reviewers: [{ login: 'octocat' }]
        }
      ], 200, { link: '<next>; rel="next"' });
    }
  });

  const result = await service.listPullRequests(
    { provider: 'github', host: 'github.com', ownerPath: 'owner', repository: 'repo' },
    { filter: 'review-requested', page: 1, search: 'graph' }
  );

  assert.equal(result.items[0].number, 7);
  assert.equal(result.items[0].source, 'feature/graph');
  assert.equal(result.items[0].reviewStatus, 'requested');
  assert.equal(result.hasMore, true);
  assert.equal(JSON.stringify(result).includes('top-secret'), false);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer top-secret');
});

test('encrypted review drafts become stale when the provider head SHA changes', async () => {
  const vault = memoryVault({ accessToken: 'token', user: { login: 'me' } });
  const service = new HostingService({
    vault,
    oauthConfig: { github: 'client-id' },
    fetch: async () => jsonResponse({})
  });
  const repository = {
    provider: 'github',
    host: 'github.com',
    ownerPath: 'owner',
    repository: 'repo'
  };
  await service.saveReviewDraft(repository, 7, {
    headSha: 'a'.repeat(40),
    event: 'COMMENT',
    inlineComments: [],
    replies: []
  });

  const draft = await service.getReviewDraft(repository, 7, 'b'.repeat(40));
  assert.equal(draft.stale, true);
  assert.equal(draft.headSha, 'a'.repeat(40));
});

test('submits one atomic GitHub review with validated inline comments', async () => {
  const requests = [];
  const vault = memoryVault({ accessToken: 'token', user: { login: 'me' } });
  const service = new HostingService({
    vault,
    oauthConfig: { github: 'client-id' },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ id: 123, state: 'APPROVED' });
    }
  });
  const repository = {
    provider: 'github',
    host: 'github.com',
    ownerPath: 'owner',
    repository: 'repo'
  };

  const result = await service.submitReview(repository, 7, {
    headSha: 'a'.repeat(40),
    body: 'Looks good',
    event: 'APPROVE',
    inlineComments: [{
      path: 'src/app.js',
      line: 10,
      side: 'RIGHT',
      body: 'Clear implementation'
    }],
    replies: []
  });

  assert.equal(result.success, true);
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.event, 'APPROVE');
  assert.equal(payload.comments[0].line, 10);
  assert.equal(requests.length, 1);
});

test('GitLab partial review retries do not duplicate completed discussions', async () => {
  const requests = [];
  let secondFailures = 0;
  const vault = memoryVault({ accessToken: 'token', user: { login: 'me' } });
  const service = new HostingService({
    vault,
    oauthConfig: { gitlab: 'client-id' },
    fetch: async (url, options) => {
      const payload = options.body ? JSON.parse(options.body) : {};
      requests.push({ url, payload });
      if (payload.body === 'second' && secondFailures++ === 0) {
        return jsonResponse({ message: 'temporary failure' }, 500);
      }
      return jsonResponse({ id: requests.length });
    }
  });
  const repository = {
    provider: 'gitlab',
    host: 'gitlab.com',
    ownerPath: 'group',
    repository: 'repo'
  };
  const draft = {
    headSha: 'a'.repeat(40),
    body: '',
    event: 'COMMENT',
    inlineComments: [
      { path: 'one.js', line: 1, side: 'RIGHT', body: 'first' },
      { path: 'two.js', line: 2, side: 'RIGHT', body: 'second' }
    ],
    replies: []
  };

  await assert.rejects(service.submitReview(repository, 4, draft), /temporary failure/);
  const result = await service.submitReview(repository, 4, draft);

  assert.equal(result.success, true);
  assert.equal(requests.filter(request => request.payload.body === 'first').length, 1);
  assert.equal(requests.filter(request => request.payload.body === 'second').length, 2);
});
