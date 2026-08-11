function sanitizeInspectorPayload(payload) {
  return {
    title: typeof payload?.title === 'string' && payload.title.length <= 200
      ? payload.title
      : 'Inspector',
    meta: typeof payload?.meta === 'string' && payload.meta.length <= 400
      ? payload.meta
      : '',
    theme: ['light', 'dark'].includes(payload?.theme) ? payload.theme : 'light',
    tone: typeof payload?.tone === 'string' && /^[a-z]{1,32}$/.test(payload.tone)
      ? payload.tone
      : '',
    mode: payload?.mode === 'split' ? 'split' : 'unified',
    eyebrow: typeof payload?.eyebrow === 'string' && payload.eyebrow.length <= 80
      ? payload.eyebrow
      : 'Inspector',
    modeLabel: typeof payload?.modeLabel === 'string' && payload.modeLabel.length <= 80
      ? payload.modeLabel
      : (payload?.mode === 'split' ? 'Split' : 'Unified'),
    wordLevel: payload?.wordLevel === true,
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
      width: 1040,
      height: 760,
      minWidth: 620,
      minHeight: 440,
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

  function destroy() {
    if (inspectorWindow && !inspectorWindow.isDestroyed()) inspectorWindow.destroy();
    inspectorWindow = null;
  }

  return { open, update, destroy };
}

module.exports = { createInspectorWindowController };
