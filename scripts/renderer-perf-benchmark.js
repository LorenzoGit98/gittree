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
(() => {
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
  const workspace = document.getElementById('workspace-body');
  if (!graph || !workspace) throw new Error('Required GitTree performance surfaces are missing');

  const originalScrollTop = graph.scrollTop;
  const maxScroll = Math.max(0, graph.scrollHeight - graph.clientHeight);
  const scroll = measureMutations(progress => {
    graph.scrollTop = maxScroll * progress;
  }, () => graph.scrollTop, 1000);
  graph.scrollTop = originalScrollTop;

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
  const contractStart = leftHandle.getBoundingClientRect();
  const widthBeforePointerMove = workspace.style.getPropertyValue('--left-panel');
  leftHandle.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    clientX: contractStart.left + (contractStart.width / 2),
    clientY: contractStart.top + 10
  }));
  document.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    clientX: contractStart.left + 60,
    clientY: contractStart.top + 10
  }));
  const widthDuringPointerMove = workspace.style.getPropertyValue('--left-panel');
  document.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    clientX: contractStart.left + 60,
    clientY: contractStart.top + 10
  }));
  const widthAfterPointerUp = workspace.style.getPropertyValue('--left-panel');

  if (originalLeft) workspace.style.setProperty('--left-panel', originalLeft);
  else workspace.style.removeProperty('--left-panel');
  if (storedLeft == null) localStorage.removeItem('gittree.panel.left');
  else localStorage.setItem('gittree.panel.left', storedLeft);

  return {
    rows: document.querySelectorAll('.graph-row').length,
    scrollRange: maxScroll,
    scroll,
    resizePreview,
    resizeCommit,
    resizeContract: {
      avoidsLiveLayout: widthDuringPointerMove === widthBeforePointerMove,
      commitsOnRelease: widthAfterPointerUp !== widthBeforePointerMove
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
        metrics.scroll.averageMs > 1 ||
        metrics.resizePreview.averageMs > 1) {
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
