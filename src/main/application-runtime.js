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
  platform,
  teardown = () => {}
}) {
  const pendingDeepLinks = [];
  const hostListeners = [];
  let rendererReady = false;
  let rendererReadiness = null;
  let started = false;

  const listen = (event, listener) => {
    host.on(event, listener);
    hostListeners.push([event, listener]);
  };

  const dispatchDeepLink = url => {
    if (!url) return;
    if (!rendererReady) pendingDeepLinks.push(url);
    else handleDeepLink(url);
  };

  const attachRendererReadiness = () => {
    const window = getMainWindow();
    if (!window) return;
    if (rendererReadiness) {
      rendererReadiness.webContents.removeListener?.(
        'did-finish-load',
        rendererReadiness.listener
      );
    }
    rendererReady = false;
    const listener = () => {
      rendererReady = true;
      rendererReadiness = null;
      for (const url of pendingDeepLinks.splice(0)) handleDeepLink(url);
    };
    rendererReadiness = { webContents: window.webContents, listener };
    window.webContents.once('did-finish-load', listener);
  };

  const start = async () => {
    if (started) return true;
    if (!host.requestSingleInstanceLock()) {
      host.quit();
      return false;
    }
    started = true;
    listen('second-instance', (_event, secondArgv) => {
      focusMainWindow();
      dispatchDeepLink(findDeepLink(secondArgv));
    });
    listen('open-url', (event, url) => {
      event.preventDefault();
      dispatchDeepLink(url);
    });
    listen('window-all-closed', () => {
      if (platform !== 'darwin') host.quit();
    });
    try {
      await host.whenReady();
      await initialize();
      createWindow();
      attachRendererReadiness();
      dispatchDeepLink(findDeepLink(argv));
      listen('activate', () => {
        if (getWindowCount() === 0) {
          createWindow();
          attachRendererReadiness();
        }
      });
      return true;
    } catch (error) {
      await stop();
      throw error;
    }
  };

  const stop = async () => {
    if (!started) return;
    started = false;
    if (rendererReadiness) {
      rendererReadiness.webContents.removeListener?.(
        'did-finish-load',
        rendererReadiness.listener
      );
      rendererReadiness = null;
    }
    for (const [event, listener] of hostListeners.splice(0)) {
      host.removeListener?.(event, listener);
    }
    pendingDeepLinks.splice(0);
    rendererReady = false;
    await teardown();
  };

  return { start, stop };
}

module.exports = { createApplicationRuntime };
