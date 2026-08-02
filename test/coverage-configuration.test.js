const test = require('node:test');
const assert = require('node:assert/strict');
const { SCOPES, buildC8Arguments } = require('../scripts/check-coverage-scopes');

test('coverage scopes keep explicit production denominators and target ratchets', () => {
  assert.deepEqual(SCOPES.git.target, { lines: 80, branches: 65, functions: 85 });
  assert.deepEqual(SCOPES.runtime.target, { lines: 75, branches: 60, functions: 75 });
  assert.deepEqual(SCOPES.hosting.target, { lines: 70, branches: 60, functions: 75 });
  assert.deepEqual(SCOPES.renderer.target, { lines: 70, branches: 60, functions: 70 });

  for (const [name, scope] of Object.entries(SCOPES)) {
    assert.ok(scope.include.length, `${name} must include production files explicitly`);
    for (const metric of ['lines', 'branches', 'functions']) {
      assert.ok(scope.gate[metric] <= scope.target[metric], `${name} ${metric} gate exceeds target`);
    }
    const args = buildC8Arguments(name, scope);
    assert.ok(args.includes('--all'));
    assert.ok(args.includes('--exclude-after-remap'));
    assert.ok(args.some(value => value.startsWith('--include=src/')));
  }
});

test('domains already at their target cannot regress', () => {
  assert.deepEqual(SCOPES.git.gate, SCOPES.git.target);
  assert.deepEqual(SCOPES.runtime.gate, SCOPES.runtime.target);
  assert.deepEqual(SCOPES.renderer.gate, SCOPES.renderer.target);
});
