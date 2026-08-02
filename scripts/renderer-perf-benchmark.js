const endpoint = process.env.GITTREE_CDP_ENDPOINT || 'http://127.0.0.1:9222/json';

async function connect() {
  const targets = await fetch(endpoint).then(response => response.json());
  const target = targets.find(item => item.type === 'page' && item.title === 'GitTree');
  if (!target) throw new Error(`GitTree renderer not found at ${endpoint}`);

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  return {
    async call(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
      return new Promise(resolve => {
        socket.addEventListener('close', resolve, { once: true });
        socket.close();
      });
    }
  };
}

const expression = `
(async () => {
  const percentile = (values, ratio) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
  };

  const measureMutations = (mutate, forceLayout, iterations) => {
    const samples = [];
    const totalStart = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      const start = performance.now();
      mutate(index / iterations);
      forceLayout();
      samples.push(performance.now() - start);
    }
    const totalMs = performance.now() - totalStart;
    return {
      totalMs,
      averageMs: totalMs / iterations,
      p95Ms: percentile(samples, 0.95),
      maxMs: Math.max(...samples),
      over2ms: samples.filter(value => value > 2).length,
      over8ms: samples.filter(value => value > 8).length,
      samples: samples.length
    };
  };

  const graph = document.querySelector('.graph-view');
  const graphView = window.app?.components?.graphView;
  const workspace = document.getElementById('workspace-body');
  if (!graph || !graphView || !workspace) throw new Error('Required GitTree performance surfaces are missing');

  const originalRows = graphView.rows;
  const originalVisibleRows = graphView.visibleRows;
  const originalHasMore = graphView.hasMore;
  graphView.rows = Array.from({ length: 10000 }, (_, index) => ({
    lane: 0,
    incoming: index > 0,
    before: index ? ['synthetic'] : [],
    after: index < 9999 ? ['synthetic'] : [],
    parents: index < 9999 ? [{ hash: 's' + (index + 1), lane: 0, kind: 'first-parent' }] : [],
    commit: {
      hash: 'synthetic-' + String(index).padStart(10, '0'),
      subject: 'Synthetic performance commit ' + index,
      authorName: 'Performance fixture',
      authorEmail: 'fixture@example.com',
      date: '2026-01-01T00:00:00.000Z'
    }
  }));
  graphView.visibleRows = graphView.rows;
  graphView.hasMore = false;
  graphView.body.style.height = (10000 * graphView.rowHeight) + 'px';
  graphView.renderViewport(true);

  const originalScrollTop = graph.scrollTop;
  const maxScroll = Math.max(0, graph.scrollHeight - graph.clientHeight);
  const scroll = measureMutations(progress => {
    graph.scrollTop = maxScroll * progress;
  }, () => graph.scrollTop, 1000);
  graph.scrollTop = originalScrollTop;
  const virtualRows = document.querySelectorAll('.graph-row').length;

  const originalLeft = workspace.style.getPropertyValue('--left-panel');
  const leftHandle = document.getElementById('resize-handle-left');
  const mainPanel = document.querySelector('.main');
  const resizePreview = measureMutations(progress => {
    leftHandle.style.transform = 'translate3d(' + (160 * progress) + 'px, 0, 0)';
  }, () => leftHandle.getBoundingClientRect().left, 1000);
  leftHandle.style.removeProperty('transform');

  const resizeCommit = measureMutations(progress => {
    workspace.style.setProperty('--left-panel', (progress < 0.5 ? 260 : 320) + 'px');
  }, () => mainPanel.getBoundingClientRect().width, 20);

  const storedLeft = localStorage.getItem('gittree.panel.left');
  workspace.style.setProperty('--left-panel', '260px');
  await new Promise(resolve => requestAnimationFrame(resolve));
  const contractStart = leftHandle.getBoundingClientRect();
  const contractDelta = 48;
  const contractPointerX = contractStart.left + (contractStart.width / 2);
  const contractStartWidth = document.getElementById('sidebar').getBoundingClientRect().width;
  const contractExpectedWidth = Math.min(380, Math.max(220, contractStartWidth + contractDelta));
  const widthBeforePointerMove = workspace.style.getPropertyValue('--left-panel');
  leftHandle.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    clientX: contractPointerX,
    clientY: contractStart.top + 10
  }));
  document.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    clientX: contractPointerX + contractDelta,
    clientY: contractStart.top + 10
  }));
  await new Promise(resolve => requestAnimationFrame(resolve));
  const widthDuringPointerMove = workspace.style.getPropertyValue('--left-panel');
  const resizePreviewTransform = getComputedStyle(leftHandle).transform;
  document.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    clientX: contractPointerX + contractDelta,
    clientY: contractStart.top + 10
  }));
  const widthAfterPointerUp = workspace.style.getPropertyValue('--left-panel');
  const storedWidthAfterPointerUp = Number(localStorage.getItem('gittree.panel.left'));

  const historyHandle = document.querySelector(
    '.graph-column-resizer[data-column="message"]'
  );
  const originalHistoryWidths = { ...graphView.columnWidths };
  const originalHistoryPersistedState = graphView.hasPersistedColumnWidths;
  const originalHistoryStorage = localStorage.getItem('gittree.history.columns');
  const historyResizePreview = measureMutations(progress => {
    historyHandle.style.transform =
      'translate3d(' + (160 * progress) + 'px, 0, 0)';
  }, () => historyHandle.getBoundingClientRect().left, 1000);
  historyHandle.style.removeProperty('transform');

  const historyStart = historyHandle.getBoundingClientRect();
  const historyWidthBefore = graphView.columnWidths.message;
  historyHandle.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    button: 0,
    clientX: historyStart.left,
    clientY: historyStart.top + 10
  }));
  document.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    clientX: historyStart.left + 48,
    clientY: historyStart.top + 10
  }));
  const historyWidthDuring = graphView.columnWidths.message;
  await new Promise(resolve => requestAnimationFrame(resolve));
  const historyPreviewTransform = getComputedStyle(historyHandle).transform;
  document.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    clientX: historyStart.left + 48,
    clientY: historyStart.top + 10
  }));
  const historyWidthAfter = graphView.columnWidths.message;
  const historyPersistedWidth =
    JSON.parse(localStorage.getItem('gittree.history.columns')).message;

  graphView.setColumnWidths(originalHistoryWidths, false);
  graphView.hasPersistedColumnWidths = originalHistoryPersistedState;
  if (originalHistoryStorage == null) localStorage.removeItem('gittree.history.columns');
  else localStorage.setItem('gittree.history.columns', originalHistoryStorage);

  if (originalLeft) workspace.style.setProperty('--left-panel', originalLeft);
  else workspace.style.removeProperty('--left-panel');
  if (storedLeft == null) localStorage.removeItem('gittree.panel.left');
  else localStorage.setItem('gittree.panel.left', storedLeft);
  graphView.rows = originalRows;
  graphView.visibleRows = originalVisibleRows;
  graphView.hasMore = originalHasMore;
  graphView.applyFilter();
  graphView.renderViewport(true);

  return {
    syntheticCommits: 10000,
    rows: virtualRows,
    scrollRange: maxScroll,
    scroll,
    resizePreview,
    resizeCommit,
    resizeContract: {
      avoidsLiveLayout: widthDuringPointerMove === widthBeforePointerMove,
      previewsWithTransform: resizePreviewTransform !== 'none',
      commitsOnRelease:
        widthAfterPointerUp === Math.round(contractExpectedWidth) + 'px' &&
        storedWidthAfterPointerUp === Math.round(contractExpectedWidth)
    },
    historyColumnResizePreview: historyResizePreview,
    historyColumnResizeContract: {
      avoidsLiveLayout: historyWidthDuring === historyWidthBefore,
      previewsWithTransform: historyPreviewTransform !== 'none',
      commitsOnRelease: historyWidthAfter === historyWidthBefore + 48,
      persistsOnRelease: historyPersistedWidth === historyWidthAfter
    }
  };
})()
`;

async function main() {
  const client = await connect();
  try {
    const result = await client.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    const metrics = result.result.value;
    console.log(JSON.stringify(metrics, null, 2));
    if (!metrics.resizeContract.avoidsLiveLayout ||
        !metrics.resizeContract.commitsOnRelease ||
        !Object.values(metrics.historyColumnResizeContract).every(Boolean) ||
        metrics.rows >= 100 ||
        metrics.scroll.averageMs > 1 ||
        metrics.scroll.p95Ms > 1 ||
        metrics.scroll.over8ms > 0 ||
        metrics.resizePreview.averageMs > 1 ||
        metrics.historyColumnResizePreview.averageMs > 1 ||
        metrics.historyColumnResizePreview.p95Ms > 1) {
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
