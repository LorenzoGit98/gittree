const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function loadDiffViewer() {
  const filename = path.join(
    __dirname,
    '..',
    'src',
    'renderer',
    'components',
    'diff-viewer.js'
  );
  const source = fs.readFileSync(filename, 'utf8');
  const buttons = new Map();
  const storage = new Map();
  const context = {
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    document: {
      getElementById(id) {
        if (!buttons.has(id)) {
          buttons.set(id, {
            classList: { toggle() {} },
            onclick: null
          });
        }
        return buttons.get(id);
      }
    },
    window: { gitTree: {} },
    t: key => key
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.DiffViewerUnderTest = DiffViewer;`, context);
  return context.DiffViewerUnderTest;
}

test('maximizing the inspector temporarily selects the side-by-side diff', () => {
  const DiffViewer = loadDiffViewer();
  const viewer = new DiffViewer({ innerHTML: '' }, {});

  assert.equal(viewer.mode, 'unified');
  viewer.setInspectorExpanded(true);
  assert.equal(viewer.mode, 'split');
  viewer.setInspectorExpanded(false);
  assert.equal(viewer.mode, 'unified');
});

test('split diff pairs deletions and additions on the same visual rows', () => {
  const DiffViewer = loadDiffViewer();
  const viewer = new DiffViewer({ innerHTML: '' }, {});
  const rows = JSON.parse(JSON.stringify(viewer.parseSplitRows([
    'diff --git a/file.js b/file.js',
    'index 111..222 100644',
    '--- a/file.js',
    '+++ b/file.js',
    '@@ -1,2 +1 @@',
    '-old one',
    '-old two',
    '+new one',
    ' context'
  ].join('\n'))));
  const pairs = rows.filter(row => row.type === 'pair');

  assert.deepEqual(pairs[0], {
    type: 'pair',
    left: { text: '-old one', kind: 'del' },
    right: { text: '+new one', kind: 'add' }
  });
  assert.deepEqual(pairs[1], {
    type: 'pair',
    left: { text: '-old two', kind: 'del' },
    right: { text: '', kind: 'context' }
  });
  assert.equal(pairs[2].left.text, ' context');
  assert.equal(pairs[2].right.text, ' context');
});
