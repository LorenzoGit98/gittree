const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutGraph } = require('../src/renderer/components/graph-layout');

const commit = (hash, parents = []) => ({ hash, parents });

test('a linear history remains on one lane', () => {
  const result = layoutGraph([
    commit('c3', ['c2']),
    commit('c2', ['c1']),
    commit('c1')
  ]);

  assert.deepEqual(result.rows.map(row => row.lane), [0, 0, 0]);
  assert.equal(result.laneCount, 1);
  assert.deepEqual(result.nextState.lanes, []);
});

test('a merge opens a secondary lane and joins it back to the first parent', () => {
  const result = layoutGraph([
    commit('merge', ['main-1', 'topic-1']),
    commit('main-1', ['base']),
    commit('topic-1', ['base']),
    commit('base')
  ]);

  assert.deepEqual(result.rows[0].parents, [
    { hash: 'main-1', lane: 0, kind: 'first-parent' },
    { hash: 'topic-1', lane: 1, kind: 'merge-parent' }
  ]);
  assert.equal(result.rows[2].lane, 1);
  assert.equal(result.rows[2].parents[0].lane, 0);
  assert.equal(result.laneCount, 2);
});

test('octopus merges allocate one lane per additional parent', () => {
  const result = layoutGraph([
    commit('merge', ['p1', 'p2', 'p3'])
  ]);

  assert.deepEqual(result.rows[0].parents.map(parent => parent.lane), [0, 1, 2]);
  assert.equal(result.laneCount, 3);
});

test('disconnected tips receive separate active lanes', () => {
  const result = layoutGraph([
    commit('tip-a', ['a1']),
    commit('tip-b', ['b1'])
  ]);

  assert.deepEqual(result.rows.map(row => row.lane), [0, 1]);
  assert.deepEqual(result.nextState.lanes, ['a1', 'b1']);
});

test('lane state continues across progressively loaded pages', () => {
  const firstPage = layoutGraph([
    commit('merge', ['main-1', 'topic-1']),
    commit('main-1', ['base'])
  ]);
  const secondPage = layoutGraph([
    commit('topic-1', ['base']),
    commit('base')
  ], firstPage.nextState);

  assert.equal(secondPage.rows[0].lane, 1);
  assert.equal(secondPage.rows[0].parents[0].lane, 0);
  assert.deepEqual(secondPage.nextState.lanes, []);
  assert.equal(Math.max(firstPage.laneCount, secondPage.laneCount), 2);
});
