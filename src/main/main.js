const {
  app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, safeStorage, session, shell
} = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const GitService = require('./git-service');
const RepoManager = require('./repo-manager');
const RepositoryWorkspace = require('./repository-workspace');
const { scanRepositories } = require('./repository-scanner');
const UpdateService = require('./update-service');
const CredentialVault = require('./credential-vault');
const HostingService = require('./hosting-service');
const { loadOAuthConfig } = require('./oauth-config');
const { buildPullRequestUrl } = require('./provider-links');
const { getGitVersion } = require('./git-version');
const { Logger } = require('./logger');
const { parseDeepLink } = require('./deep-link');
const { createHandlerRegistry } = require('./ipc/handler-registry');
const { registerGitHandlers } = require('./ipc/git-handlers');
const { registerHostingHandlers } = require('./ipc/hosting-handlers');
const { registerRepositoryHandlers } = require('./ipc/repository-handlers');
const { registerWindowApplicationHandlers } = require('./ipc/window-application-handlers');
const { createInspectorWindowController } = require('./inspector-window-controller');
const { createApplicationRuntime } = require('./application-runtime');
const { DiagnosticsExporter } = require('./diagnostics-exporter');
const { isWorkingTreeRepository } = require('./working-tree-repository');
let mainWindow;
let repoManager;
let repositoryWorkspace;
let updateService;
let hostingService;
let credentialVault;
let logger;
function assertManagedRepo(repoPath) {
  repositoryWorkspace.assertManaged(repoPath);
}

function getGitService(repoPath) {
  return repositoryWorkspace.getGitService(repoPath);
}

async function getHostingRepository(repoPath, provider) {
  const metadata = await getGitService(repoPath).getBranchMetadata();
  const remote = metadata.remotes.find(item => (
    item.provider?.provider === provider &&
    (
      (provider === 'github' && item.provider.host === 'github.com') ||
      (provider === 'gitlab' && item.provider.host === 'gitlab.com') ||
      provider === 'azure'
    )
  ));
  if (!remote?.provider) {
    throw new Error(`No supported ${provider} remote was found in this repository`);
  }
  const repository = { ...remote.provider, remoteName: remote.name };
  if (provider === 'azure') {
    const organization = remote.provider.organization || '';
    const project = remote.provider.project || '';
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(organization)) {
      throw new Error('Unsupported Azure organization in remote URL');
    }
    if (!/^[^/\\:#%?&<>]{1,128}$/.test(project)) {
      throw new Error('Unsupported Azure project in remote URL');
    }
    repository.host = 'dev.azure.com';
  }
  return repository;
}

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(app.getAppPath(), 'icon.png')
    : path.join(__dirname, '..', '..', 'icon.png');
  const windowOptions = {
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f7f9fc',
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  };
  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 18, y: 18 };
  } else {
    windowOptions.frame = false;
  }
  mainWindow = new BrowserWindow(windowOptions);
  lockDownWindow(mainWindow);
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger?.error('Renderer process gone', details);
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (updateService) updateService.setWindow(mainWindow);
  else updateService = new UpdateService(mainWindow);
  mainWindow.webContents.once('did-finish-load', () => {
    updateService.initialize();
    sendWindowState();
  });
  ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach(event => {
    mainWindow.on(event, sendWindowState);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function getWindowState() {
  return {
    isMaximized: Boolean(mainWindow?.isMaximized()),
    isFullScreen: Boolean(mainWindow?.isFullScreen())
  };
}

function sendWindowState() {
  sendToRenderer('window:state', getWindowState());
}

function buildMenu() {
  Menu.setApplicationMenu(null);
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function handleDeepLink(url) {
  const repoPath = parseDeepLink(url);
  if (!repoPath) return;
  isWorkingTreeRepository(repoPath).then(isRepo => {
    if (!isRepo) return;
    const repo = repositoryWorkspace.addTrustedRepository(repoPath);
    if (repo) {
      logger?.info('Repository opened via deep link', { path: repoPath });
      sendToRenderer('deep-link:open-repo', repo);
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    }
  });
}

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'gitlab.com',
  'www.gitlab.com',
  'dev.azure.com',
  'bitbucket.org',
  'www.bitbucket.org'
]);

function isSafeExternalUrl(url) {
  if (typeof url !== 'string' || url.length > 8192) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname);
}

function lockDownWindow(win) {
  const rendererDirUrl = pathToFileURL(path.join(__dirname, '..', 'renderer')).toString();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(rendererDirUrl)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
}

function registerIpcHandlers() {
  const { registerHandler, registerManagedRepoHandler } = createHandlerRegistry({
    handle: ipcMain.handle.bind(ipcMain),
    assertManagedRepo
  });
  const inspectorController = createInspectorWindowController({
    BrowserWindow,
    getMainWindow: () => mainWindow,
    lockDownWindow,
    iconPath: () => app.isPackaged
      ? path.join(app.getAppPath(), 'icon.png')
      : path.join(__dirname, '..', '..', 'icon.png'),
    preloadPath: path.join(__dirname, '..', 'preload-inspector.js'),
    htmlPath: path.join(__dirname, '..', 'renderer', 'inspector-window.html'),
    sendToRenderer
  });
  const diagnosticsExporter = new DiagnosticsExporter({
    app, logger, getGitVersion,
    showSaveDialog: options => dialog.showSaveDialog(mainWindow, options),
    getUpdateState: () => updateService?.getState() || { status: 'not-ready' },
    getRepositories: () => repositoryWorkspace.list()
  });
  registerWindowApplicationHandlers({
    registerHandler,
    registerManagedRepoHandler,
    getMainWindow: () => mainWindow,
    getWindowState,
    setTheme(theme, background) {
      const safeTheme = theme === 'dark' ? 'dark' : 'light';
      nativeTheme.themeSource = safeTheme;
      if (mainWindow) {
        const safeBackground = /^#[0-9a-f]{6}$/i.test(background || '')
          ? background
          : (safeTheme === 'dark' ? '#000000' : '#f7f9fc');
        mainWindow.setBackgroundColor(safeBackground);
      }
      return safeTheme;
    },
    openExternal(url) {
      if (isSafeExternalUrl(url)) shell.openExternal(url);
    },
    openPath: repoPath => shell.openPath(repoPath),
    platform: process.platform,
    getAppVersion: () => app.getVersion(),
    getGitVersion,
    exportDiagnostics: () => diagnosticsExporter.export(),
    getUpdateService: () => updateService,
    isPackaged: app.isPackaged,
    showOpenDialog: (...args) => dialog.showOpenDialog(...args),
    authorizeDirectory: directoryPath => repositoryWorkspace.authorizeDirectory(directoryPath),
    openInspector: payload => inspectorController.open(payload),
    updateInspector: payload => inspectorController.update(payload)
  });

  registerGitHandlers({
    registerManagedRepoHandler,
    getGitService,
    consumeAuthorizedDirectory: directoryPath => (
      repositoryWorkspace.consumeAuthorizedDirectory(directoryPath)
    ),
    authorizeCreatedRepository: repoPath => repositoryWorkspace.authorizeDirectory(repoPath),
    sendToRenderer
  });
  registerHostingHandlers({
    registerHandler,
    registerManagedRepoHandler,
    assertManagedRepo,
    getHostingRepository,
    getGitService,
    hostingService,
    credentialVault,
    buildPullRequestUrl,
    isSafeExternalUrl,
    openExternal: url => shell.openExternal(url)
  });
  registerRepositoryHandlers({
    registerHandler,
    repositoryWorkspace,
    isWorkingTreeRepository,
    createGitService: repoPath => new GitService(repoPath),
    scanRepositories,
    sendToRenderer,
    logger
  });
}

process.on('unhandledRejection', error => {
  const message = error instanceof Error ? (error.stack || error.message) : String(error);
  console.error('[GitTree] Unhandled rejection:', message);
  logger?.error('Unhandled rejection', { message });
});

process.on('uncaughtException', error => {
  console.error('[GitTree] Uncaught exception:', error);
  logger?.error('Uncaught exception', { message: error instanceof Error ? error.message : String(error) });
});

createApplicationRuntime({
  host: app,
  argv: process.argv,
  platform: process.platform,
  async initialize() {
    app.setName('GitTree');
    app.setAppUserModelId('com.lorenzogit.gittree');
    nativeTheme.themeSource = 'light';
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(path.join(__dirname, '..', '..', 'icon.png'));
    }
    repoManager = new RepoManager();
    repositoryWorkspace = new RepositoryWorkspace({ repoStore: repoManager });
    logger = new Logger(path.join(app.getPath('userData'), 'logs'));
    const logLevelArg = process.argv.find(arg => arg.startsWith('--log-level='));
    if (logLevelArg) {
      const levels = { debug: 0, info: 1, warn: 2, error: 3 };
      const requested = levels[logLevelArg.slice('--log-level='.length)];
      if (requested !== undefined) logger.setLevel(requested);
    }
    logger.info('GitTree started', { version: app.getVersion(), platform: process.platform });
    credentialVault = new CredentialVault({
      storagePath: path.join(app.getPath('userData'), 'hosting-vault.bin'),
      safeStorage,
      platform: process.platform
    });
    hostingService = new HostingService({
      vault: credentialVault,
      oauthConfig: loadOAuthConfig(app),
      openExternal: url => shell.openExternal(url),
      onAuthState: state => sendToRenderer('auth:provider-state', state)
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler(() => false);
    registerIpcHandlers();
    buildMenu();
  },
  createWindow,
  getMainWindow: () => mainWindow,
  getWindowCount: () => BrowserWindow.getAllWindows().length,
  focusMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  },
  handleDeepLink
}).start();
