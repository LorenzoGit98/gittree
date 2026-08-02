const test = require('node:test');
const assert = require('node:assert/strict');

const { createApplicationRuntime } = require('../src/main/application-runtime');

test('Application runtime stops before readiness when the single-instance lock fails', async () => {
  const calls = [];
  const runtime = createApplicationRuntime({
    host: {
      requestSingleInstanceLock() {
        calls.push('lock');
        return false;
      },
      quit() {
        calls.push('quit');
      },
      whenReady() {
        calls.push('ready');
        return Promise.resolve();
      },
      on() {}
    },
    initialize() {
      calls.push('initialize');
    },
    createWindow() {},
    getMainWindow() {},
    getWindowCount: () => 0,
    focusMainWindow() {},
    handleDeepLink() {},
    argv: [],
    platform: 'win32'
  });

  assert.equal(await runtime.start(), false);
  assert.deepEqual(calls, ['lock', 'quit']);
});

test('Application runtime dispatches startup deep links only after initialization and renderer load', async () => {
  const calls = [];
  const listeners = new Map();
  let didFinishLoad;
  const mainWindow = {
    webContents: {
      once(event, listener) {
        assert.equal(event, 'did-finish-load');
        didFinishLoad = listener;
      }
    }
  };
  const runtime = createApplicationRuntime({
    host: {
      requestSingleInstanceLock() {
        calls.push('lock');
        return true;
      },
      quit() {
        calls.push('quit');
      },
      whenReady() {
        calls.push('ready');
        return Promise.resolve();
      },
      on(event, listener) {
        listeners.set(event, listener);
      }
    },
    initialize() {
      calls.push('initialize');
    },
    createWindow() {
      calls.push('create-window');
    },
    getMainWindow: () => mainWindow,
    getWindowCount: () => 1,
    focusMainWindow() {},
    handleDeepLink(url) {
      calls.push(`deep-link:${url}`);
    },
    argv: ['electron', '.', 'gittree://open?path=C%3A%5Crepo'],
    platform: 'win32'
  });

  assert.equal(await runtime.start(), true);
  assert.deepEqual(calls, ['lock', 'ready', 'initialize', 'create-window']);
  assert.ok(listeners.has('second-instance'));
  didFinishLoad();
  assert.deepEqual(calls, [
    'lock',
    'ready',
    'initialize',
    'create-window',
    'deep-link:gittree://open?path=C%3A%5Crepo'
  ]);
});
