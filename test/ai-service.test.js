const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AiService = require('../src/main/ai/ai-service');
const {
  validateSettingsInput,
  validateKey,
  validateBaseUrl
} = AiService;

function createVault() {
  const state = { accounts: {} };
  return {
    state,
    getAccount: async provider => state.accounts[provider] || null,
    setAccount: async (provider, account) => { state.accounts[provider] = account; },
    removeAccount: async provider => { delete state.accounts[provider]; }
  };
}

function createFakePty(outputText) {
  const handlers = { data: [], exit: [] };
  const emit = () => {
    for (const listener of handlers.data) listener(outputText);
    for (const listener of handlers.exit) listener({ exitCode: 0 });
  };
  return {
    onData(listener) { handlers.data.push(listener); return { dispose() {} }; },
    onExit(listener) { handlers.exit.push(listener); return { dispose() {} }; },
    kill() {},
    emit
  };
}

function openCodeEvents(lines) {
  return lines.map(text => JSON.stringify({
    type: 'text', part: { type: 'text', text }
  })).join('\n');
}

function spawnOpenCode(received, lines) {
  return (_executable, args) => {
    received.args = args;
    const pty = createFakePty(openCodeEvents(lines));
    setImmediate(() => pty.emit());
    return pty;
  };
}

function createService(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gittree-ai-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const vault = createVault();
  const service = new AiService({
    storagePath: path.join(directory, 'ai-settings.json'),
    vault,
    fetch: overrides.fetch || (async () => {
      throw new Error('fetch should not be called');
    }),
    spawn: overrides.spawn || (() => { throw new Error('spawn should not be called'); }),
    resolveExecutable: overrides.resolveExecutable || (command => `${command}.exe`),
    getStagedDiff: overrides.getStagedDiff || (async () => 'diff --git a/x b/x'),
    getBranchComparison: overrides.getBranchComparison
      || (async () => ({ commits: [{ subject: 'feat: first' }], diff: 'diff body' }))
  });
  return { directory, vault, service };
}

test('settings validation enforces provider fields and secure base URLs', () => {
  assert.deepEqual(validateSettingsInput({
    provider: 'opencode', language: 'it'
  }), { provider: 'opencode', baseUrl: '', model: '', language: 'it' });
  assert.deepEqual(validateSettingsInput({
    provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat'
  }).provider, 'openai');
  assert.throws(
    () => validateSettingsInput({ provider: 'openai', baseUrl: '', model: 'm' }),
    /base URL is required/
  );
  assert.throws(
    () => validateSettingsInput({ provider: 'openai', baseUrl: 'https://x', model: '' }),
    /model is required/
  );
  assert.throws(
    () => validateSettingsInput({ provider: 'openai', baseUrl: 'http://api.example.com', model: 'm' }),
    /HTTPS/
  );
  assert.throws(() => validateSettingsInput({ provider: 'gemini' }), /Unsupported AI provider/);
  assert.doesNotThrow(() => validateBaseUrl('http://127.0.0.1:11434/v1'));
  assert.doesNotThrow(() => validateBaseUrl('http://localhost:1234/v1'));
});

test('key validation rejects short, oversized and multi-line values', () => {
  assert.equal(validateKey('  sk-abc123  '), 'sk-abc123');
  assert.throws(() => validateKey('abc'), /Invalid API key/);
  assert.throws(() => validateKey(`a${'x'.repeat(401)}`), /Invalid API key/);
  assert.throws(() => validateKey('sk-line\nbreak'), /Invalid API key/);
});

test('service stores the key in the vault and never returns it', async t => {
  const { vault, service } = createService(t);
  await service.initialize();
  assert.equal((await service.getSettings()).keyConfigured, false);

  await service.setKey('sk-secret-key');
  assert.equal(vault.state.accounts.ai.apiKey, 'sk-secret-key');
  const settings = await service.getSettings();
  assert.equal(settings.keyConfigured, true);
  assert.equal('apiKey' in settings, false);

  await service.clearKey();
  assert.equal((await service.getSettings()).keyConfigured, false);
});

test('service generates commit messages through the openai-compatible provider', async t => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'TITLE: feat(ai): generate messages\nBODY: powered by the configured provider' } }]
      })
    };
  };
  const { service } = createService(t, { fetch });
  await service.initialize();
  await service.setSettings({
    provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', language: 'en'
  });
  await service.setKey('sk-test');

  const result = await service.generateCommitMessage('C:\\repo', { language: 'it' });
  assert.equal(result.summary, 'feat(ai): generate messages');
  assert.match(result.body, /configured provider/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/chat/completions');
});

test('service rejects generation without a key for HTTP providers', async t => {
  const { service } = createService(t);
  await service.initialize();
  await service.setSettings({
    provider: 'anthropic', baseUrl: '', model: 'claude-sonnet'
  });
  await assert.rejects(
    () => service.generateCommitMessage('C:\\repo'),
    /API key in Settings/
  );
});

test('service rejects generation without staged changes', async t => {
  const { service } = createService(t, { getStagedDiff: async () => '' });
  await service.initialize();
  await service.setKey('sk-test');
  await service.setSettings({
    provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'm'
  });
  await assert.rejects(
    () => service.generateCommitMessage('C:\\repo'),
    /Stage changes/
  );
});

test('service generates through the opencode CLI and uses its own config', async t => {
  const received = {};
  const { service } = createService(t, {
    spawn: spawnOpenCode(received, ['TITLE: feat: cli', 'BODY: from opencode'])
  });
  await service.initialize();
  assert.equal((await service.getSettings()).provider, 'opencode');

  const result = await service.generateCommitMessage('C:\\repo');
  assert.equal(result.summary, 'feat: cli');
  assert.equal(received.args.includes('--model'), false);
});

test('service passes an explicit model override to the opencode CLI', async t => {
  const received = {};
  const { service } = createService(t, {
    spawn: spawnOpenCode(received, ['TITLE: feat: model', 'BODY: done'])
  });
  await service.initialize();
  await service.setSettings({
    provider: 'opencode', baseUrl: '', model: 'opencode-go/deepseek-v4-pro', language: 'auto'
  });

  await service.generateCommitMessage('C:\\repo');
  assert.equal(received.args.includes('--model'), true);
  assert.equal(
    received.args[received.args.indexOf('--model') + 1],
    'opencode-go/deepseek-v4-pro'
  );
});

test('service reports missing opencode executable', async t => {
  const { service } = createService(t, { resolveExecutable: () => null });
  await service.initialize();
  await assert.rejects(
    () => service.generateCommitMessage('C:\\repo'),
    /OpenCode CLI not found/
  );
});

test('service builds pull request descriptions from the branch comparison', async t => {
  const fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'TITLE: Add branch compare\nBODY: compares feature against main' } }]
    })
  });
  const { service } = createService(t, { fetch });
  await service.initialize();
  await service.setKey('sk-test');
  await service.setSettings({
    provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'm'
  });

  const result = await service.generatePrDescription('C:\\repo', {
    source: 'feature', target: 'main', language: 'en'
  });
  assert.equal(result.summary, 'Add branch compare');
  await assert.rejects(
    () => service.generatePrDescription('C:\\repo', { source: 'main', target: 'main' }),
    /Invalid source and target branches/
  );
});

test('service exports the configured key as agent CLI environment', async t => {
  const { service } = createService(t);
  await service.initialize();
  await service.setSettings({
    provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'm'
  });
  await service.setKey('sk-deep');
  assert.deepEqual(service.getAgentEnvironment(), { DEEPSEEK_API_KEY: 'sk-deep' });

  await service.setSettings({
    provider: 'anthropic', baseUrl: '', model: 'claude-sonnet'
  });
  assert.deepEqual(service.getAgentEnvironment(), { ANTHROPIC_API_KEY: 'sk-deep' });

  await service.clearKey();
  assert.deepEqual(service.getAgentEnvironment(), {});
});

test('service caps oversized diffs in the prompt', async t => {
  let prompt = '';
  const fetch = async (_url, options) => {
    prompt = JSON.parse(options.body).messages[0].content;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'TITLE: t\nBODY: b' } }] }) };
  };
  const bigDiff = 'x'.repeat(30 * 1024);
  const { service } = createService(t, { fetch, getStagedDiff: async () => bigDiff });
  await service.initialize();
  await service.setKey('sk-test');
  await service.setSettings({ provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'm' });

  await service.generateCommitMessage('C:\\repo');
  assert.ok(prompt.length < 24 * 1024 + 2048);
  assert.match(prompt, /diff truncated/);
});
