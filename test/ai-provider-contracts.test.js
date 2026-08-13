const test = require('node:test');
const assert = require('node:assert/strict');

const {
  requestOpenAiCompatible,
  requestAnthropic
} = require('../src/main/ai/ai-providers');
const { generateWithOpencode, collectOpencodeText } = require('../src/main/ai/ai-opencode');

test('openai-compatible request posts chat completions and returns the content', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'TITLE: feat: test\nBODY: details' } }]
      })
    };
  };
  const content = await requestOpenAiCompatible({
    fetch,
    baseUrl: 'https://api.deepseek.com/v1/',
    apiKey: 'sk-test',
    model: 'deepseek-chat',
    prompt: 'write a commit message',
    timeoutMs: 5000
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(body.messages[0].content, 'write a commit message');
  assert.equal(content, 'TITLE: feat: test\nBODY: details');
});

test('openai-compatible request surfaces provider error messages', async () => {
  const fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: 'Invalid API key' } })
  });
  await assert.rejects(
    () => requestOpenAiCompatible({
      fetch, baseUrl: 'https://api.example.test', apiKey: 'sk-x',
      model: 'm', prompt: 'p', timeoutMs: 5000
    }),
    /Invalid API key/
  );
});

test('openai-compatible request rejects empty content', async () => {
  const fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [] })
  });
  await assert.rejects(
    () => requestOpenAiCompatible({
      fetch, baseUrl: 'https://api.example.test', apiKey: 'sk-x',
      model: 'm', prompt: 'p', timeoutMs: 5000
    }),
    /empty response/
  );
});

test('anthropic request uses x-api-key and joins content blocks', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'TITLE: feat: ' },
          { type: 'text', text: 'done\nBODY: ' },
          { type: 'text', text: 'summary' }
        ]
      })
    };
  };
  const content = await requestAnthropic({
    fetch,
    apiKey: 'sk-ant-test',
    model: 'claude-sonnet',
    prompt: 'write',
    timeoutMs: 5000
  });
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].options.headers['x-api-key'], 'sk-ant-test');
  assert.equal(calls[0].options.headers['anthropic-version'], '2023-06-01');
  assert.equal(content, 'TITLE: feat: done\nBODY: summary');
});

test('anthropic request surfaces error body messages', async () => {
  const fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: 'Bad model' } })
  });
  await assert.rejects(
    () => requestAnthropic({
      fetch, apiKey: 'sk-ant', model: 'm', prompt: 'p', timeoutMs: 5000
    }),
    /Bad model/
  );
});

test('opencode generation collects text parts from JSON events', async () => {
  const execute = (executable, args, options, callback) => {
    assert.equal(executable, 'opencode.exe');
    assert.deepEqual(args, ['run', 'write a message', '--format', 'json']);
    const events = [
      JSON.stringify({ type: 'message', part: { type: 'text', text: 'TITLE: feat: x' } }),
      JSON.stringify({ type: 'message', part: { type: 'text', text: 'BODY: y' } }),
      JSON.stringify({ type: 'done' })
    ].join('\n');
    callback(null, events);
  };
  const content = await generateWithOpencode({
    execute, executable: 'opencode.exe', prompt: 'write a message', timeoutMs: 5000
  });
  assert.equal(content, 'TITLE: feat: x\nBODY: y');
});

test('opencode generation surfaces provider API errors', async () => {
  const execute = (_executable, _args, _options, callback) => {
    callback(null, JSON.stringify({
      type: 'error',
      error: { name: 'APIError', data: { message: 'Model unavailable' } }
    }));
  };
  await assert.rejects(
    () => generateWithOpencode({ execute, executable: 'opencode', prompt: 'p', timeoutMs: 5000 }),
    /Model unavailable/
  );
});

test('opencode generation normalizes timeouts and missing text', async () => {
  const timeoutExecute = (_e, _a, _o, callback) => {
    const error = new Error('killed');
    error.code = 'ETIMEDOUT';
    callback(error);
  };
  await assert.rejects(
    () => generateWithOpencode({ execute: timeoutExecute, executable: 'opencode', prompt: 'p' }),
    /timed out/
  );
  const emptyExecute = (_e, _a, _o, callback) => callback(null, 'not json at all');
  await assert.rejects(
    () => generateWithOpencode({ execute: emptyExecute, executable: 'opencode', prompt: 'p' }),
    /did not return any text/
  );
});

test('opencode event collection tolerates malformed lines', () => {
  const output = [
    'garbage line',
    JSON.stringify({ type: 'message', part: { type: 'text', text: 'hello' } }),
    ''
  ].join('\n');
  assert.equal(collectOpencodeText(output), 'hello');
});
