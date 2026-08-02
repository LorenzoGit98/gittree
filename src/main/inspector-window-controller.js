function sanitizeInspectorPayload(payload) {
  return {
    title: typeof payload?.title === 'string' && payload.title.length <= 200
      ? payload.title
      : 'Inspector',
    theme: ['light', 'dark'].includes(payload?.theme) ? payload.theme : 'light',
    tone: typeof payload?.tone === 'string' && /^[a-z]{1,32}$/.test(payload.tone)
      ? payload.tone
      : '',
    mode: payload?.mode === 'split' ? 'split' : 'unified',
    html: typeof payload?.html === 'string' && payload.html.length <= 2_000_000
      ? payload.html
      : '',
    diffText: typeof payload?.diffText === 'string' && payload.diffText.length <= 10_000_000
      ? payload.diffText
      : ''
  };
}

function createInspectorWindowController({
  BrowserWindow,
  getMainWindow,
  lockDownWindow,
  iconPath,
  preloadPath,
  htmlPath,
  sendToRenderer
}) {
  let inspectorWindow = null;

  function open(payload) {
    const safePayload = sanitizeInspectorPayload(payload);
    if (inspectorWindow && !inspectorWindow.isDestroyed()) {
      inspectorWindow.focus();
      inspectorWindow.webContents.send('inspector:render', safePayload);
      return { success: true };
    }
    inspectorWindow = new BrowserWindow({
      width: 820,
      height: 620,
      minWidth: 480,
      minHeight: 360,
      parent: getMainWindow(),
      title: safePayload.title,
      icon: iconPath(),
      backgroundColor: '#f7f9fc',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    lockDownWindow(inspectorWindow);
    inspectorWindow.loadFile(htmlPath);
    inspectorWindow.webContents.once('did-finish-load', () => {
      inspectorWindow.webContents.send('inspector:render', safePayload);
    });
    inspectorWindow.on('closed', () => {
      inspectorWindow = null;
      sendToRenderer('inspector:closed');
    });
    return { success: true };
  }

  function update(payload) {
    if (!inspectorWindow || inspectorWindow.isDestroyed()) return { success: false };
    inspectorWindow.webContents.send('inspector:render', sanitizeInspectorPayload(payload));
    return { success: true };
  }

  return { open, update };
}

module.exports = { createInspectorWindowController };
