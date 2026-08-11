const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SettingsView = require(path.join(
  __dirname,
  '..',
  'src',
  'renderer',
  'components',
  'settings-view.js'
));

function createView(sectionNames) {
  const removed = [];
  const classToggles = [];
  const fullOnly = [
    { remove: () => removed.push('diagnostics-row') },
    { remove: () => removed.push('diagnostics-help') }
  ];
  const sections = sectionNames.map(name => ({
    dataset: { settingsSection: name },
    remove: () => removed.push(name)
  }));
  const view = Object.create(SettingsView.prototype);
  view.dialog = {
    classList: {
      toggle: (name, enabled) => classToggles.push([name, enabled])
    },
    querySelectorAll: selector => {
      if (selector === '[data-settings-section]') return sections;
      assert.equal(selector, '[data-settings-full-only]');
      return fullOnly;
    }
  };
  return { classToggles, removed, view };
}

test('Welcome settings keep only About and update controls', () => {
  const harness = createView(['appearance', 'repository', 'about']);

  harness.view.applyScope('about');

  assert.deepEqual(harness.removed, [
    'appearance',
    'repository',
    'diagnostics-row',
    'diagnostics-help'
  ]);
  assert.deepEqual(harness.classToggles, [['settings-dialog-about', true]]);
});

test('full settings preserve every section', () => {
  const harness = createView(['appearance', 'repository', 'about']);

  harness.view.applyScope('full');

  assert.deepEqual(harness.removed, []);
  assert.deepEqual(harness.classToggles, [['settings-dialog-about', false]]);
});
