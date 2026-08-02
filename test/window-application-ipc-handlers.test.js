const test = require('node:test');
const assert = require('node:assert/strict');

const {
  registerWindowApplicationHandlers
} = require('../src/main/ipc/window-application-handlers');

test('terminal and explorer actions require a managed repository registrar', () => {
  const managedChannels = [];
  registerWindowApplicationHandlers({
    registerHandler() {},
    registerManagedRepoHandler(channel) {
      managedChannels.push(channel);
    },
    getMainWindow() {},
    getWindowState() {},
    getUpdateService() {},
    getAppVersion() {},
    getGitVersion() {},
    openExternal() {},
    showOpenDialog() {},
    setTheme() {},
    sendToRenderer() {},
    createInspectorWindow() {}
  });

  assert.deepEqual(managedChannels.sort(), [
    'app:open-explorer',
    'app:open-terminal'
  ]);
});
