const { EventEmitter } = require('node:events');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMainApplication,
  isSafeExternalUrl
} = require('../src/main/main-application');

function createHarness() {
  const calls = [];
  const handlers = new Map();
  const removedHandlers = [];
  const windows = [];

  class FakeWebContents extends EventEmitter {
    constructor() {
      super();
      this.messages = [];
    }

    send(channel, payload) {
      this.messages.push([channel, payload]);
    }

    setWindowOpenHandler(handler) {
      this.windowOpenHandler = handler;
    }
  }

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new FakeWebContents();
      this.destroyed = false;
      this.minimized = false;
      windows.push(this);
      calls.push('window');
    }

    static getAllWindows() {
      return windows.filter(window => !window.destroyed);
    }

    loadFile(filePath) {
      this.loadedFile = filePath;
    }

    isDestroyed() { return this.destroyed; }
    isMinimized() { return this.minimized; }
    isMaximized() { return false; }
    isFullScreen() { return false; }
    restore() { this.minimized = false; }
    focus() { calls.push('focus'); }
    setBackgroundColor(color) { this.backgroundColor = color; }
    minimize() {}
    maximize() {}
    unmaximize() {}
    close() { this.destroy(); }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('closed');
    }
  }

  class FakeRepoManager {
    constructor() {
      calls.push('repo-store');
    }
  }

  class FakeRepositoryWorkspace {
    constructor({ repoStore }) {
      assert.ok(repoStore instanceof FakeRepoManager);
      calls.push('workspace');
      this.repositories = [];
    }

    assertManaged() {}
    getGitService() {
      return {
        getStatus: async () => ({ clean: true })
      };
    }
    list() { return [...this.repositories]; }
    active() { return null; }
    setActive() { return null; }
    remove() { return false; }
    canInspect() { return false; }
    canAdd() { return false; }
    authorizeDirectory(value) { return value; }
    consumeAuthorizedDirectory(value) { return value; }
    beginScan(value) { return value; }
    authorizeScanResults() {}

    addTrustedRepository(repoPath) {
      const repository = { path: repoPath, name: 'repo' };
      this.repositories.push(repository);
      calls.push(`deep-link:${repoPath}`);
      return repository;
    }
  }

  class FakeUpdateService {
    constructor(window) {
      this.window = window;
      calls.push('update');
    }

    setWindow(window) { this.window = window; }
    initialize() { calls.push('update-initialize'); }
    getState() { return { status: 'idle' }; }
    destroy() { calls.push('update-destroy'); }
  }

  class FakeCredentialVault {
    constructor() { calls.push('vault'); }
  }

  class FakeHostingService {
    constructor() { calls.push('hosting'); }
    destroy() { calls.push('hosting-destroy'); }
  }

  class FakeLogger {
    constructor() { calls.push('logger'); }
    setLevel(level) { calls.push(`log-level:${level}`); }
    info(message) { calls.push(`log:${message}`); }
    error(message) { calls.push(`error:${message}`); }
  }

  class FakeDiagnosticsExporter {
    export() { return { canceled: true }; }
  }

  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    whenReady: async () => { calls.push('ready'); },
    quit: () => calls.push('quit'),
    setName: name => calls.push(`name:${name}`),
    setAppUserModelId: id => calls.push(`app-id:${id}`),
    getPath: () => 'C:\\user-data',
    getVersion: () => '1.2.3',
    getAppPath: () => 'C:\\app'
  });
  const processHost = new EventEmitter();
  const electron = {
    app,
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
      handle(channel, implementation) {
        assert.equal(handlers.has(channel), false, `duplicate channel ${channel}`);
        handlers.set(channel, implementation);
      },
      removeHandler(channel) {
        removedHandlers.push(channel);
        handlers.delete(channel);
      }
    },
    dialog: {
      showSaveDialog: async () => ({ canceled: true }),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] })
    },
    Menu: { setApplicationMenu: value => calls.push(`menu:${value}`) },
    nativeTheme: { themeSource: 'system' },
    safeStorage: {},
    session: {
      defaultSession: {
        setPermissionRequestHandler(handler) { this.permissionRequest = handler; },
        setPermissionCheckHandler(handler) { this.permissionCheck = handler; }
      }
    },
    shell: {
      openExternal: value => calls.push(`external:${value}`),
      openPath: async () => ''
    }
  };
  const inspector = {
    open: () => ({ success: true }),
    update: () => ({ success: true }),
    destroy: () => calls.push('inspector-destroy')
  };
  const application = createMainApplication({
    electron,
    argv: ['electron', '.', '--log-level=debug', 'gittree://open?path=fixture'],
    platform: 'win32',
    processHost,
    dependencies: {
      RepoManager: FakeRepoManager,
      RepositoryWorkspace: FakeRepositoryWorkspace,
      UpdateService: FakeUpdateService,
      CredentialVault: FakeCredentialVault,
      HostingService: FakeHostingService,
      Logger: FakeLogger,
      DiagnosticsExporter: FakeDiagnosticsExporter,
      loadOAuthConfig: () => ({}),
      getGitVersion: async () => '2.50.0',
      parseDeepLink: url => url.startsWith('gittree://') ? 'C:\\repo' : null,
      isWorkingTreeRepository: async () => true,
      createInspectorWindowController: () => inspector,
      scanRepositories: async () => ({ repositories: [] })
    }
  });
  return {
    application,
    app,
    calls,
    electron,
    handlers,
    processHost,
    removedHandlers,
    windows
  };
}

test('Main application composes Electron once and tears down every owned resource', async () => {
  const harness = createHarness();

  assert.equal(await harness.application.start(), true);
  assert.equal(harness.windows.length, 1);
  assert.equal(harness.handlers.size, 114);
  assert.equal(harness.processHost.listenerCount('unhandledRejection'), 1);
  assert.equal(harness.app.listenerCount('activate'), 1);
  assert.equal(
    await harness.handlers.get('app:version')({ sender: 'renderer' }),
    '1.2.3'
  );
  assert.equal(await harness.handlers.get('app:set-theme')({}, 'dark', '#101010'), 'dark');
  assert.equal(harness.electron.nativeTheme.themeSource, 'dark');
  assert.equal(harness.windows[0].backgroundColor, '#101010');
  await harness.handlers.get('app:open-external')({}, 'https://github.com/open/repo');
  await harness.handlers.get('app:open-external')({}, 'https://evil.example/repo');
  assert.equal(
    harness.calls.filter(call => call.startsWith('external:')).length,
    1
  );
  assert.deepEqual(await harness.handlers.get('app:open-explorer')({}, 'C:\\repo'), {
    ok: true
  });
  assert.deepEqual(await harness.handlers.get('app:export-diagnostics')({}), {
    canceled: true
  });
  assert.deepEqual(await harness.handlers.get('update:get-state')({}), {
    status: 'idle'
  });
  assert.equal(await harness.handlers.get('dialog:select-directory')({}), null);
  assert.deepEqual(await harness.handlers.get('window:open-inspector')({}, {}), {
    success: true
  });
  assert.deepEqual(await harness.handlers.get('window:update-inspector')({}, {}), {
    success: true
  });
  assert.deepEqual(await harness.handlers.get('repo:list')({}), []);
  assert.deepEqual(await harness.handlers.get('git:status')({}, 'C:\\repo'), {
    clean: true
  });
  let permissionAllowed = true;
  harness.electron.session.defaultSession.permissionRequest(null, null, allowed => {
    permissionAllowed = allowed;
  });
  assert.equal(permissionAllowed, false);
  assert.equal(harness.electron.session.defaultSession.permissionCheck(), false);

  harness.windows[0].webContents.emit('did-finish-load');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(harness.calls.includes('update-initialize'));
  assert.ok(harness.calls.includes('deep-link:C:\\repo'));
  assert.deepEqual(
    harness.windows[0].webContents.messages.find(([channel]) => (
      channel === 'deep-link:open-repo'
    )),
    ['deep-link:open-repo', { path: 'C:\\repo', name: 'repo' }]
  );
  harness.app.emit('activate');
  harness.app.emit('second-instance', {}, ['gittree://open?path=second']);
  await new Promise(resolve => setImmediate(resolve));
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    harness.processHost.emit('unhandledRejection', new Error('rejected'));
    harness.processHost.emit('uncaughtException', new Error('uncaught'));
  } finally {
    console.error = originalConsoleError;
  }
  assert.ok(harness.calls.includes('error:Unhandled rejection'));
  assert.ok(harness.calls.includes('error:Uncaught exception'));

  await harness.application.stop();
  await harness.application.stop();

  assert.equal(harness.handlers.size, 0);
  assert.equal(new Set(harness.removedHandlers).size, 114);
  assert.equal(harness.windows[0].isDestroyed(), true);
  assert.equal(harness.processHost.listenerCount('unhandledRejection'), 0);
  assert.equal(harness.app.listenerCount('activate'), 0);
  assert.ok(harness.calls.includes('update-destroy'));
  assert.ok(harness.calls.includes('hosting-destroy'));
  assert.ok(harness.calls.includes('inspector-destroy'));
});

test('external navigation accepts only the explicit HTTPS host allowlist', () => {
  assert.equal(isSafeExternalUrl('https://github.com/open/repo'), true);
  assert.equal(isSafeExternalUrl('https://dev.azure.com/org/project'), true);
  assert.equal(isSafeExternalUrl('http://github.com/open/repo'), false);
  assert.equal(isSafeExternalUrl('https://github.com.evil.example/repo'), false);
  assert.equal(isSafeExternalUrl('not a URL'), false);
});
