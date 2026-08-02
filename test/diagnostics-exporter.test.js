const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDiagnosticsData } = require('../src/main/diagnostics-exporter');

test('diagnostics redact credentials, remote URLs and absolute repository paths', () => {
  const repositoryPath = 'C:\\Users\\person\\secret-repository';
  const diagnostics = buildDiagnosticsData({
    versions: {
      app: '0.8.0',
      electron: '43.2.0',
      node: '22.23.0',
      git: '2.51.0'
    },
    system: { platform: 'win32', release: 'test', arch: 'x64' },
    updateState: { status: 'idle' },
    repositories: [{ path: repositoryPath }],
    logs: [
      `opened ${repositoryPath}`,
      'remote https://github.com/private/secret.git',
      'authorization=Bearer ghp_abcdefghijklmnopqrstuvwxyz'
    ].join('\n'),
    checks: { quality: 'passed' }
  });
  const serialized = JSON.stringify(diagnostics);

  assert.doesNotMatch(serialized, /secret-repository/i);
  assert.doesNotMatch(serialized, /github\.com/i);
  assert.doesNotMatch(serialized, /ghp_/i);
  assert.doesNotMatch(serialized, /Users\\person/i);
  assert.match(diagnostics.logs, /\[REDACTED_PATH\]/);
  assert.match(diagnostics.logs, /\[REDACTED_URL\]/);
  assert.equal(diagnostics.summary.repositories.length, 1);
  assert.match(diagnostics.summary.repositories[0].id, /^[a-f0-9]{16}$/);
});
