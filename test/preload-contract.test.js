const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function loadBridge() {
  const invokes = [];
  const listeners = new Map();
  const removed = [];
  let bridge;
  const ipcRenderer = {
    invoke(channel, ...args) {
      invokes.push({ channel, args });
      return Promise.resolve({ channel, args });
    },
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    removeListener(channel, listener) {
      removed.push({ channel, listener });
    }
  };
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'preload.js'),
    'utf8'
  );
  vm.runInNewContext(source, {
    require(moduleName) {
      assert.equal(moduleName, 'electron');
      return {
        ipcRenderer,
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, 'gitTree');
            bridge = value;
          }
        }
      };
    },
    process: { platform: 'win32' }
  });
  return { bridge, invokes, listeners, removed };
}

test('preload exposes only the frozen named GitTree Interface', async () => {
  const { bridge, invokes } = loadBridge();

  assert.equal(Object.keys(bridge).length, 157);
  assert.equal(bridge.platform, 'win32');
  assert.equal('invoke' in bridge, false);
  assert.equal(typeof bridge.exportDiagnostics, 'function');
  await bridge.getStatus('C:\\managed-repo');
  assert.deepEqual(invokes.at(-1), {
    channel: 'git:status',
    args: ['C:\\managed-repo']
  });
});

test('preload subscriptions forward one payload and dispose the exact listener', () => {
  const { bridge, listeners, removed } = loadBridge();
  const received = [];
  const dispose = bridge.onWindowState(state => received.push(state));
  const listener = listeners.get('window:state');

  listener({ sender: 'main' }, { isMaximized: true });
  dispose();

  assert.deepEqual(received, [{ isMaximized: true }]);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].channel, 'window:state');
  assert.equal(removed[0].listener, listener);
});

test('preload preserves observable defaults', async () => {
  const { bridge, invokes } = loadBridge();

  await bridge.getGraphPage('repo');
  await bridge.merge('repo', 'feature');
  await bridge.push('repo', 'origin', 'main');
  await bridge.getWorkingDiff('repo', 'file.txt');
  await bridge.createTag('repo', 'v1', 'abc123');
  await bridge.getPullRequestDiff('repo', 'github', 42);
  await bridge.checkoutPullRequestSource('repo', 'github', { id: 42 });

  assert.deepEqual(invokes.map(call => call.args), [
    ['repo', 0, 500],
    ['repo', 'feature', 'ff'],
    ['repo', 'origin', 'main', false],
    ['repo', 'file.txt', false],
    ['repo', 'v1', 'abc123', ''],
    ['repo', 'github', 42, 1],
    ['repo', 'github', { id: 42 }, false]
  ]);
});
