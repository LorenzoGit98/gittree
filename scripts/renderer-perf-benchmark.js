/* global cancelAnimationFrame, document, getComputedStyle, MutationObserver, PointerEvent, requestAnimationFrame, window */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { _electron: electron } = require('playwright');
const { createElectronFixture } = require('../test/helpers/electron-fixture');

const projectRoot = path.resolve(__dirname, '..');

function readArgument(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.find(value => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

function summarize(values) {
  const safeValues = values.filter(Number.isFinite);
  if (!safeValues.length) return null;
  const total = safeValues.reduce((sum, value) => sum + value, 0);
  return {
    average: total / safeValues.length,
    p50: percentile(safeValues, 0.5),
    p95: percentile(safeValues, 0.95),
    max: Math.max(...safeValues),
    samples: safeValues.length
  };
}

async function measureRenderer(page) {
  return page.evaluate(async () => {
    const percentile = (values, ratio) => {
      const sorted = [...values].sort((left, right) => left - right);
      const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
      return sorted[index] || 0;
    };
    const summarize = values => {
      const total = values.reduce((sum, value) => sum + value, 0);
      return {
        averageMs: total / values.length,
        p50Ms: percentile(values, 0.5),
        p95Ms: percentile(values, 0.95),
        maxMs: Math.max(...values),
        over8ms: values.filter(value => value > 8).length,
        over16ms: values.filter(value => value > 16.7).length,
        samples: values.length
      };
    };
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const measureMutations = (iterations, mutate, forceLayout) => {
      const samples = [];
      for (let index = 0; index < iterations; index += 1) {
        const startedAt = performance.now();
        mutate(index);
        forceLayout();
        samples.push(performance.now() - startedAt);
      }
      return summarize(samples);
    };

    const graph = document.querySelector('.graph-view');
    const graphView = window.app?.components?.graphView;
    const workspace = document.getElementById('workspace-body');
    const leftHandle = document.getElementById('resize-handle-left');
    const historyHandle = document.querySelector(
      '.graph-column-resizer[data-column="message"]'
    );
    if (!graph || !graphView || !workspace || !leftHandle || !historyHandle) {
      throw new Error('Required GitTree performance surfaces are missing');
    }

    const original = {
      rows: graphView.rows,
      visibleRows: graphView.visibleRows,
      hasMore: graphView.hasMore,
      selectedHash: graphView.selectedHash,
      selectedHashes: [...graphView.selectedHashes],
      selectionAnchor: graphView.selectionAnchor,
      scrollTop: graph.scrollTop,
      leftPanel: workspace.style.getPropertyValue('--left-panel'),
      storedLeftPanel: localStorage.getItem('gittree.panel.left'),
      columnWidths: { ...graphView.columnWidths },
      hasPersistedColumnWidths: graphView.hasPersistedColumnWidths,
      storedColumnWidths: localStorage.getItem('gittree.history.columns')
    };

    let metrics;
    try {
      const syntheticRows = Array.from({ length: 10000 }, (_, index) => ({
        lane: 0,
        incoming: index > 0,
        before: index ? ['synthetic'] : [],
        after: index < 9999 ? ['synthetic'] : [],
        parents: index < 9999
          ? [{ hash: `synthetic-${index + 1}`, lane: 0, kind: 'first-parent' }]
          : [],
        commit: {
          hash: `synthetic-${String(index).padStart(10, '0')}`,
          subject: `Synthetic performance commit ${index}`,
          authorName: 'Performance fixture',
          authorEmail: 'fixture@example.com',
          date: '2026-01-01T00:00:00.000Z'
        }
      }));

      graphView.rows = syntheticRows;
      graphView.visibleRows = syntheticRows;
      graphView.hasMore = false;
      graphView.selectedHash = null;
      graphView.selectedHashes.clear();
      graphView.selectionAnchor = null;
      graph.scrollTop = 0;

      const initialRenderStartedAt = performance.now();
      graphView.applyFilter();
      graphView.renderViewport(true);
      graphView.layer.getBoundingClientRect();
      const initialRenderMs = performance.now() - initialRenderStartedAt;
      await nextFrame();

      const renderedRows = [...graphView.layer.querySelectorAll('.graph-row')];
      const maxScroll = Math.max(0, graph.scrollHeight - graph.clientHeight);
      const jumpViewportRender = measureMutations(200, index => {
        graph.scrollTop = maxScroll * (index / 199);
        graphView.renderViewport();
      }, () => graphView.layer.getBoundingClientRect().height);

      graph.scrollTop = 0;
      graphView.renderViewport(true);
      const rowsBeforeProgressiveScroll = new Map(
        [...graphView.layer.querySelectorAll('.graph-row')].map(row => [
          row.dataset.hash,
          row
        ])
      );
      graph.scrollTop = graphView.rowHeight * 3;
      graphView.renderViewport();
      const overlappingRows = [...graphView.layer.querySelectorAll('.graph-row')].filter(row =>
        rowsBeforeProgressiveScroll.has(row.dataset.hash)
      );
      const progressiveScrollReusesRows = overlappingRows.length > 0 && overlappingRows.every(row =>
        rowsBeforeProgressiveScroll.get(row.dataset.hash) === row
      );
      graph.scrollTop = 0;
      graphView.renderViewport(true);
      const smoothViewportRender = measureMutations(200, index => {
        graph.scrollTop = index * graphView.rowHeight * 3;
        graphView.renderViewport();
      }, () => graphView.layer.getBoundingClientRect().height);

      const jumpScrollFrames = [];
      for (let index = 0; index < 60; index += 1) {
        const startedAt = performance.now();
        graph.scrollTop = maxScroll * (index / 59);
        graphView.scheduleViewport();
        await nextFrame();
        jumpScrollFrames.push(performance.now() - startedAt);
      }

      graph.scrollTop = 0;
      graphView.renderViewport(true);
      const smoothScrollFrames = [];
      for (let index = 0; index < 120; index += 1) {
        const startedAt = performance.now();
        graph.scrollTop = index * graphView.rowHeight * 3;
        graphView.scheduleViewport();
        await nextFrame();
        smoothScrollFrames.push(performance.now() - startedAt);
      }

      graph.scrollTop = 0;
      graphView.renderViewport(true);
      const selectionRows = [...graphView.layer.querySelectorAll('.graph-row')];
      const selectionHashes = selectionRows.slice(0, 20).map(row => row.dataset.hash);
      const selectionObserver = new MutationObserver(() => {});
      selectionObserver.observe(graphView.layer, { childList: true, subtree: true });
      const selection = measureMutations(500, index => {
        graphView.select(selectionHashes[index % selectionHashes.length], false);
      }, () => graphView.layer.offsetWidth);
      const selectionMutations = selectionObserver.takeRecords().filter(record =>
        record.addedNodes.length || record.removedNodes.length
      ).length;
      selectionObserver.disconnect();
      const selectionPreservedRows = selectionRows.every((row, index) =>
        graphView.layer.querySelectorAll('.graph-row')[index] === row
      );

      const resizePreview = measureMutations(500, index => {
        leftHandle.style.transform = `translate3d(${160 * (index / 499)}px, 0, 0)`;
      }, () => leftHandle.getBoundingClientRect().left);
      leftHandle.style.removeProperty('transform');

      const historyResizePreview = measureMutations(500, index => {
        historyHandle.style.transform = `translate3d(${160 * (index / 499)}px, 0, 0)`;
      }, () => historyHandle.getBoundingClientRect().left);
      historyHandle.style.removeProperty('transform');

      workspace.style.setProperty('--left-panel', '260px');
      await nextFrame();
      const contractStart = leftHandle.getBoundingClientRect();
      const contractDelta = 48;
      const pointerX = contractStart.left + (contractStart.width / 2);
      const startWidth = document.getElementById('sidebar').getBoundingClientRect().width;
      const expectedWidth = Math.min(380, Math.max(220, startWidth + contractDelta));
      const widthBeforeMove = workspace.style.getPropertyValue('--left-panel');
      leftHandle.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: pointerX,
        clientY: contractStart.top + 10
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        clientX: pointerX + contractDelta,
        clientY: contractStart.top + 10
      }));
      await nextFrame();
      const widthDuringMove = workspace.style.getPropertyValue('--left-panel');
      const previewTransform = getComputedStyle(leftHandle).transform;
      document.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        clientX: pointerX + contractDelta,
        clientY: contractStart.top + 10
      }));
      const widthAfterRelease = workspace.style.getPropertyValue('--left-panel');
      const storedWidth = Number(localStorage.getItem('gittree.panel.left'));

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
        clientX: historyStart.left + contractDelta,
        clientY: historyStart.top + 10
      }));
      const historyWidthDuring = graphView.columnWidths.message;
      await nextFrame();
      const historyTransform = getComputedStyle(historyHandle).transform;
      document.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        clientX: historyStart.left + contractDelta,
        clientY: historyStart.top + 10
      }));
      const historyWidthAfter = graphView.columnWidths.message;
      const persistedHistoryWidth = JSON.parse(
        localStorage.getItem('gittree.history.columns')
      ).message;

      metrics = {
        syntheticCommits: syntheticRows.length,
        initialRenderMs,
        renderedRows: renderedRows.length,
        scrollRange: maxScroll,
        jumpViewportRender,
        smoothViewportRender,
        jumpScrollFrame: summarize(jumpScrollFrames),
        smoothScrollFrame: summarize(smoothScrollFrames),
        selection,
        resizePreview,
        historyResizePreview,
        jsHeapUsedMb: performance.memory
          ? performance.memory.usedJSHeapSize / (1024 * 1024)
          : null,
        contracts: {
          virtualizesHistory: renderedRows.length < 100,
          progressiveScrollReusesRows,
          selectionPreservesRows: selectionPreservedRows && selectionMutations === 0,
          resizeAvoidsLiveLayout: widthDuringMove === widthBeforeMove,
          resizePreviewsWithTransform: previewTransform !== 'none',
          resizeCommitsOnRelease:
            widthAfterRelease === `${Math.round(expectedWidth)}px` &&
            storedWidth === Math.round(expectedWidth),
          historyResizeAvoidsLiveLayout: historyWidthDuring === historyWidthBefore,
          historyResizePreviewsWithTransform: historyTransform !== 'none',
          historyResizeCommitsOnRelease: historyWidthAfter === historyWidthBefore + contractDelta,
          historyResizePersistsOnRelease: persistedHistoryWidth === historyWidthAfter
        }
      };
    } finally {
      if (graphView.raf) {
        cancelAnimationFrame(graphView.raf);
        graphView.raf = 0;
      }
      graphView.rows = original.rows;
      graphView.visibleRows = original.visibleRows;
      graphView.hasMore = original.hasMore;
      graphView.selectedHash = original.selectedHash;
      graphView.selectedHashes = new Set(original.selectedHashes);
      graphView.selectionAnchor = original.selectionAnchor;
      graphView.setColumnWidths(original.columnWidths, false);
      graphView.hasPersistedColumnWidths = original.hasPersistedColumnWidths;
      if (original.storedColumnWidths == null) {
        localStorage.removeItem('gittree.history.columns');
      } else {
        localStorage.setItem('gittree.history.columns', original.storedColumnWidths);
      }
      if (original.leftPanel) {
        workspace.style.setProperty('--left-panel', original.leftPanel);
      } else {
        workspace.style.removeProperty('--left-panel');
      }
      if (original.storedLeftPanel == null) {
        localStorage.removeItem('gittree.panel.left');
      } else {
        localStorage.setItem('gittree.panel.left', original.storedLeftPanel);
      }
      graph.scrollTop = original.scrollTop;
      graphView.applyFilter();
      graphView.renderViewport(true);
    }
    return metrics;
  });
}

async function runBenchmark() {
  const fixture = createElectronFixture();
  let application;
  const startedAt = performance.now();
  try {
    application = await electron.launch({
      args: [
        projectRoot,
        `--user-data-dir=${fixture.userData}`,
        fixture.deepLink
      ],
      cwd: projectRoot
    });
    const launchedMs = performance.now() - startedAt;
    const page = await application.firstWindow();
    const firstWindowMs = performance.now() - startedAt;
    await page.locator('.repo-tab.active').waitFor();
    await page.locator('.graph-row').first().waitFor();
    const repositoryReadyMs = performance.now() - startedAt;
    const renderer = await measureRenderer(page);
    const runtime = await application.evaluate(({ app }) => {
      const processes = app.getAppMetrics();
      return {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        totalWorkingSetMb: processes.reduce(
          (total, metric) => total + (metric.memory?.workingSetSize || 0),
          0
        ) / 1024,
        processCount: processes.length
      };
    });
    return {
      startup: { launchedMs, firstWindowMs, repositoryReadyMs },
      runtime,
      renderer
    };
  } finally {
    if (application) await application.close().catch(() => {});
    fixture.cleanup();
  }
}

async function main() {
  const runs = Math.max(1, Math.min(
    10,
    Number(readArgument('runs', process.env.GITTREE_PERF_RUNS || '1')) || 1
  ));
  const results = [];
  for (let index = 0; index < runs; index += 1) {
    results.push(await runBenchmark());
  }

  const report = {
    schemaVersion: 2,
    recordedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.versions.node,
      cpu: os.cpus()[0]?.model || 'unknown',
      logicalCpus: os.cpus().length,
      totalMemoryMb: os.totalmem() / (1024 * 1024)
    },
    summary: {
      repositoryReadyMs: summarize(results.map(result => result.startup.repositoryReadyMs)),
      workingSetMb: summarize(results.map(result => result.runtime.totalWorkingSetMb)),
      initialRenderMs: summarize(results.map(result => result.renderer.initialRenderMs)),
      jumpViewportRenderP95Ms: summarize(
        results.map(result => result.renderer.jumpViewportRender.p95Ms)
      ),
      smoothViewportRenderP95Ms: summarize(
        results.map(result => result.renderer.smoothViewportRender.p95Ms)
      ),
      jumpScrollFrameP95Ms: summarize(
        results.map(result => result.renderer.jumpScrollFrame.p95Ms)
      ),
      smoothScrollFrameP95Ms: summarize(
        results.map(result => result.renderer.smoothScrollFrame.p95Ms)
      ),
      selectionP95Ms: summarize(results.map(result => result.renderer.selection.p95Ms))
    },
    runs: results
  };

  const output = readArgument('output', process.env.GITTREE_PERF_OUTPUT || '');
  if (output) {
    const outputPath = path.resolve(projectRoot, output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));

  const contractsPass = results.every(result =>
    Object.values(result.renderer.contracts).every(Boolean)
  );
  if (!contractsPass) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
