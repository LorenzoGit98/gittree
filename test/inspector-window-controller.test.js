const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createInspectorWindowController
} = require('../src/main/inspector-window-controller');

test('inspector controller creates one locked-down window and reuses it', () => {
  const created = [];
  const rendererEvents = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.listeners = new Map();
      this.sent = [];
      this.webContents = {
        once: (event, listener) => this.listeners.set(event, listener),
        send: (...args) => this.sent.push(args)
      };
      created.push(this);
    }
    isDestroyed() { return false; }
    focus() { this.focused = true; }
    destroy() { this.destroyed = true; }
    loadFile(filename) { this.loaded = filename; }
    on(event, listener) { this.listeners.set(event, listener); }
  }
  const parent = {};
  const controller = createInspectorWindowController({
    BrowserWindow: FakeWindow,
    getMainWindow: () => parent,
    lockDownWindow: window => { window.locked = true; },
    iconPath: () => 'icon.png',
    preloadPath: 'preload.js',
    htmlPath: 'inspector.html',
    sendToRenderer: (...args) => rendererEvents.push(args)
  });

  assert.deepEqual(controller.update({}), { success: false });
  assert.deepEqual(controller.open({
    title: 'Commit', theme: 'dark', tone: 'blue', mode: 'split', html: '<b>x</b>', diffText: '+x'
  }), { success: true });
  assert.equal(created.length, 1);
  assert.equal(created[0].options.parent, parent);
  assert.equal(created[0].options.webPreferences.contextIsolation, true);
  assert.equal(created[0].options.webPreferences.sandbox, true);
  assert.equal(created[0].locked, true);
  assert.equal(created[0].loaded, 'inspector.html');

  created[0].listeners.get('did-finish-load')();
  assert.deepEqual(created[0].sent.at(-1), ['inspector:render', {
    title: 'Commit', theme: 'dark', tone: 'blue', mode: 'split', html: '<b>x</b>', diffText: '+x'
  }]);
  controller.open({ title: 'Next' });
  assert.equal(created.length, 1);
  assert.equal(created[0].focused, true);

  controller.destroy();
  assert.equal(created[0].destroyed, true);

  created[0].listeners.get('closed')();
  assert.deepEqual(rendererEvents, [['inspector:closed']]);
  assert.deepEqual(controller.update({}), { success: false });
});

test('inspector controller sanitizes oversized and invalid payload fields', () => {
  let window;
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.webContents = { once() {}, send: (...args) => { this.lastSend = args; } };
      window = this;
    }
    isDestroyed() { return false; }
    loadFile() {}
    on() {}
  }
  const controller = createInspectorWindowController({
    BrowserWindow: FakeWindow,
    getMainWindow: () => null,
    lockDownWindow() {},
    iconPath: () => null,
    preloadPath: '',
    htmlPath: '',
    sendToRenderer() {}
  });
  controller.open({ title: 'x'.repeat(201) });
  assert.equal(window.options.title, 'Inspector');
  assert.deepEqual(controller.update({
    title: 42,
    theme: 'black',
    tone: 'Bad Tone!',
    mode: 'other',
    html: 'x'.repeat(2_000_001),
    diffText: 'x'.repeat(10_000_001)
  }), { success: true });
  assert.deepEqual(window.lastSend, ['inspector:render', {
    title: 'Inspector', theme: 'light', tone: '', mode: 'unified', html: '', diffText: ''
  }]);
});
