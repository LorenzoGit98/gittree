const test = require('node:test');
const assert = require('node:assert/strict');
const GraphView = require('../src/renderer/components/graph-view');

function createView(scrollTop) {
  const view = Object.create(GraphView.prototype);
  view.container = { scrollTop };
  view.rowHeight = 38;
  view.visibleRows = Array.from({ length: 10 }, (_, index) => ({
    commit: { hash: `commit-${index}` }
  }));
  view.hashes = new Set(view.visibleRows.map(row => row.commit.hash));
  view.selectedHashes = new Set();
  view.selectedHash = null;
  view.selectionAnchor = null;
  return view;
}

test('remote refresh preserves the exact top of the commit history viewport', () => {
  const view = createView(0);
  const state = view.captureViewportState();

  view.container.scrollTop = 36;
  view.restoreViewportState(state);

  assert.equal(view.container.scrollTop, 0);
});

test('remote refresh keeps the visible commit anchored away from the top', () => {
  const view = createView(131);
  const state = view.captureViewportState();

  view.visibleRows.unshift({ commit: { hash: 'new-remote-commit' } });
  view.hashes.add('new-remote-commit');
  view.restoreViewportState(state);

  assert.equal(view.container.scrollTop, 169);
});
