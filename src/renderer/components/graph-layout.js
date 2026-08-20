(function exposeGraphLayout(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GraphLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createGraphLayout() {
  function firstAvailableLane(lanes) {
    const empty = lanes.indexOf(null);
    return empty >= 0 ? empty : lanes.length;
  }

  function trimTrailingLanes(lanes) {
    while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();
  }

  function layoutGraph(commits, previousState = { lanes: [] }) {
    const lanes = Array.isArray(previousState?.lanes) ? [...previousState.lanes] : [];
    const rows = [];
    let laneCount = lanes.length;

    for (const commit of commits || []) {
      const parents = Array.isArray(commit.parents) ? commit.parents.filter(Boolean) : [];
      let lane = lanes.indexOf(commit.hash);
      const incoming = lane >= 0;
      if (lane < 0) {
        lane = firstAvailableLane(lanes);
        lanes[lane] = commit.hash;
      }

      const before = [...lanes];
      const parentLayouts = [];
      const firstParent = parents[0];

      if (!firstParent) {
        lanes[lane] = null;
      } else {
        const existingFirstParentLane = lanes.findIndex(
          (value, index) => index !== lane && value === firstParent
        );
        if (existingFirstParentLane >= 0) {
          lanes[lane] = null;
          parentLayouts.push({
            hash: firstParent,
            lane: existingFirstParentLane,
            kind: 'first-parent'
          });
        } else {
          lanes[lane] = firstParent;
          parentLayouts.push({ hash: firstParent, lane, kind: 'first-parent' });
        }
      }

      for (let index = 1; index < parents.length; index += 1) {
        const parentHash = parents[index];
        let parentLane = lanes.indexOf(parentHash);
        if (parentLane < 0) {
          parentLane = firstAvailableLane(lanes);
          lanes[parentLane] = parentHash;
        }
        parentLayouts.push({
          hash: parentHash,
          lane: parentLane,
          kind: 'merge-parent'
        });
      }

      trimTrailingLanes(lanes);
      laneCount = Math.max(laneCount, before.length, lanes.length, lane + 1);
      rows.push({
        commit,
        lane,
        incoming,
        before,
        parents: parentLayouts
      });
    }

    return {
      rows,
      laneCount,
      nextState: { lanes }
    };
  }

  function createGraphSegments(row, rowHeight) {
    const x = lane => 12 + lane * 18;
    const midpoint = rowHeight / 2;
    const top = -1;
    const bottom = rowHeight + 1;
    const segments = [];

    (row.before || []).forEach((hash, lane) => {
      if (!hash || lane === row.lane) return;
      segments.push({
        lane,
        path: `M ${x(lane)} ${top} L ${x(lane)} ${bottom}`
      });
    });
    if (row.incoming) {
      segments.push({
        lane: row.lane,
        path: `M ${x(row.lane)} ${top} L ${x(row.lane)} ${midpoint}`
      });
    }
    for (const parent of row.parents || []) {
      const from = x(row.lane);
      const to = x(parent.lane);
      segments.push({
        lane: parent.lane,
        path: from === to
          ? `M ${from} ${midpoint} L ${to} ${bottom}`
          : `M ${from} ${midpoint} C ${from} ${midpoint + 10}, ${to} ${bottom - 10}, ${to} ${bottom}`
      });
    }
    return segments;
  }

  return { layoutGraph, createGraphSegments };
});
