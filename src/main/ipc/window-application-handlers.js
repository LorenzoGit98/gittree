const { spawn } = require('node:child_process');

function launchTerminal(repoPath, platform) {
  const launch = (command, args) => {
    const child = spawn(command, args, {
      cwd: repoPath,
      detached: true,
      stdio: 'ignore'
    });
    child.on('error', () => {});
    child.unref();
  };
  if (platform === 'win32') {
    launch('cmd.exe', ['/d', '/c', 'start', 'cmd.exe', '/d', '/k']);
  } else if (platform === 'darwin') {
    launch('open', ['-a', 'Terminal', repoPath]);
  } else {
    launch('sh', [
      '-c',
      'x-terminal-emulator --working-directory "$1" || ' +
        'gnome-terminal --working-directory "$1" || ' +
        'konsole --workdir "$1" || ' +
        'xterm -e \'cd "$1" && exec "$SHELL"\' gittree-term "$1"',
      'gittree-terminal',
      repoPath
    ]);
  }
  return { ok: true };
}

function registerWindowHandlers({ registerHandler, getMainWindow, getWindowState }) {
  registerHandler('window:minimize', () => getMainWindow()?.minimize());
  registerHandler('window:toggle-maximize', () => {
    const window = getMainWindow();
    if (!window) return getWindowState();
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return getWindowState();
  });
  registerHandler('window:get-state', () => getWindowState());
  registerHandler('window:close', () => getMainWindow()?.close());
}

function registerUpdateHandlers({ registerHandler, getUpdateService, getAppVersion, isPackaged }) {
  registerHandler('update:get-state', () => (
    getUpdateService()?.getState() || {
      status: isPackaged ? 'idle' : 'disabled',
      currentVersion: getAppVersion()
    }
  ));
  registerHandler('update:check', () => (
    getUpdateService()?.check(true) || { success: false, error: 'Updater is not ready' }
  ));
  registerHandler('update:download', () => (
    getUpdateService()?.download() || { success: false, error: 'Updater is not ready' }
  ));
  registerHandler('update:install', () => (
    getUpdateService()?.install() || { success: false, error: 'Updater is not ready' }
  ));
}

function registerWindowApplicationHandlers(dependencies) {
  const {
    registerHandler,
    registerManagedRepoHandler,
    getMainWindow,
    setTheme,
    openExternal,
    openPath,
    platform,
    getAppVersion,
    getGitVersion,
    exportDiagnostics,
    showOpenDialog,
    authorizeDirectory = directoryPath => directoryPath,
    openInspector,
    updateInspector
  } = dependencies;
  registerWindowHandlers(dependencies);
  registerUpdateHandlers(dependencies);
  registerHandler('app:set-theme', (theme, background) => setTheme(theme, background));
  registerHandler('app:open-external', url => openExternal(url));
  registerManagedRepoHandler('app:open-explorer', async repoPath => {
    const error = await openPath(repoPath);
    return error ? { error } : { ok: true };
  });
  registerManagedRepoHandler('app:open-terminal', repoPath => (
    launchTerminal(repoPath, platform)
  ));
  registerHandler('app:version', () => getAppVersion());
  registerHandler('app:git-version', () => getGitVersion());
  registerHandler('app:export-diagnostics', () => exportDiagnostics());
  registerHandler('window:open-inspector', payload => openInspector(payload));
  registerHandler('window:update-inspector', payload => updateInspector(payload));
  registerHandler('dialog:select-directory', async () => {
    const result = await showOpenDialog(getMainWindow(), { properties: ['openDirectory'] });
    return !result.canceled && result.filePaths.length
      ? authorizeDirectory(result.filePaths[0])
      : null;
  });
}

module.exports = { registerWindowApplicationHandlers };
