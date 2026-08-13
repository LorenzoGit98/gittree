const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAiOutput, buildCommitPrompt, buildPrPrompt } = require('../src/main/ai/ai-output');

test('parses the strict TITLE/BODY format from provider output', () => {
  const result = parseAiOutput(
    'TITLE: feat(auth): add refresh tokens\nBODY: - issue new tokens on login\n- store them encrypted'
  );
  assert.equal(result.summary, 'feat(auth): add refresh tokens');
  assert.match(result.body, /issue new tokens/);
});

test('parses TITLE without BODY and keeps the remainder out of the body', () => {
  const result = parseAiOutput('TITLE: fix: repair pagination');
  assert.equal(result.summary, 'fix: repair pagination');
  assert.equal(result.body, '');
});

test('falls back to the first line when no TITLE marker exists', () => {
  const result = parseAiOutput('chore: update dependencies\n\nBump versions.');
  assert.equal(result.summary, 'chore: update dependencies');
  assert.equal(result.body, 'Bump versions.');
});

test('rejects empty provider output', () => {
  assert.throws(() => parseAiOutput('   \n  '), /did not return a commit title/);
});

test('truncates long titles and strips surrounding quotes', () => {
  const result = parseAiOutput(`TITLE: "${'x'.repeat(400)}"`, { maxTitleLength: 200 });
  assert.equal(result.summary.length, 200);
  assert.match(result.summary, /x+…$/);
});

test('commit prompt carries the diff, language and optional hint', () => {
  const prompt = buildCommitPrompt({
    diff: '--- a/file\n+++ b/file',
    hint: 'mention the API',
    language: 'it'
  });
  assert.match(prompt, /Write the title and body in Italian/);
  assert.match(prompt, /Additional hint from the user: mention the API/);
  assert.match(prompt, /--- staged diff ---/);
  assert.match(prompt, /\+{3} b\/file/);
});

test('pull request prompt carries commits, diff and language', () => {
  const prompt = buildPrPrompt({
    diff: 'diff body',
    commits: ['feat: first', 'fix: second'],
    language: 'en'
  });
  assert.match(prompt, /Write the pull-request title and description in English/);
  assert.match(prompt, /- feat: first\s*\n- fix: second/);
  assert.match(prompt, /--- diff ---/);
});
