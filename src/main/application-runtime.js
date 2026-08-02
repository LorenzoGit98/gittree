function findDeepLink(argv) {
  return (argv || []).find(argument => (
    typeof argument === 'string' && argument.startsWith('gittree://')
  ));
}

function createApplicationRuntime({
  host,
  initialize,
  createWindow,
  getMainWindow,
  getWindowCount,
  focusMainWindow,
  handleDeepLink,
  argv,
  platform
}) {
  const pendingDeepLinks = [];
  let rendererReady = false;

  const dispatchDeepLink = url => {
    if (!url) return;
    if (!rendererReady) pendingDeepLinks.push(url);
    else handleDeepLink(url);
  };

  const attachRendererReadiness = () => {
    const window = getMainWindow();
    if (!window) return;
    rendererReady = false;
    window.webContents.once('did-finish-load', () => {
      rendererReady = true;
      for (const url of pendingDeepLinks.splice(0)) handleDeepLink(url);
    });
  };

  const start = async () => {
    if (!host.requestSingleInstanceLock()) {
      host.quit();
      return false;
    }
    host.on('second-instance', (_event, secondArgv) => {
      focusMainWindow();
      dispatchDeepLink(findDeepLink(secondArgv));
    });
    host.on('open-url', (event, url) => {
      event.preventDefault();
      dispatchDeepLink(url);
    });
    host.on('window-all-closed', () => {
      if (platform !== 'darwin') host.quit();
    });
    await host.whenReady();
    await initialize();
    createWindow();
    attachRendererReadiness();
    dispatchDeepLink(findDeepLink(argv));
    host.on('activate', () => {
      if (getWindowCount() === 0) {
        createWindow();
        attachRendererReadiness();
      }
    });
    return true;
  };

  return { start };
}

module.exports = { createApplicationRuntime };
