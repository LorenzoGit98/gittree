const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadDiffViewer() {
  const filename = path.join(
    __dirname,
    '..',
    'src',
    'renderer',
    'components',
    'diff-viewer.js'
  );
  const buttons = new Map();
  const storage = new Map();
  global.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  };
  global.document = {
    getElementById(id) {
      if (!buttons.has(id)) {
        buttons.set(id, {
          classList: { toggle() {} },
          onclick: null
        });
      }
      return buttons.get(id);
    }
  };
  global.window = { gitTree: {} };
  global.t = key => key;
  global.DiffParser = require(path.join(
    __dirname, '..', 'src', 'renderer', 'components', 'diff-parser.js'
  ));
  return require(filename);
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
    left: { content: '-old one', kind: 'del', oldLine: 1, newLine: null },
    right: { content: '+new one', kind: 'add', oldLine: null, newLine: 1 }
  });
  assert.deepEqual(pairs[1], {
    type: 'pair',
    left: { content: '-old two', kind: 'del', oldLine: 2, newLine: null },
    right: { content: '', kind: 'empty', oldLine: null, newLine: null }
  });
  assert.equal(pairs[2].left.content, ' context');
  assert.equal(pairs[2].right.content, ' context');
  assert.equal(pairs[2].left.oldLine, 3);
  assert.equal(pairs[2].right.newLine, 2);
});
