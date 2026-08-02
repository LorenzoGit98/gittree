/* global document, MutationObserver, requestAnimationFrame, requestIdleCallback, window */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance: nodePerformance } = require('node:perf_hooks');
const { _electron: electron } = require('playwright');
const { createElectronFixture } = require('../test/helpers/electron-fixture');
const { createRepository } = require('../test/helpers/git-repository');

const projectRoot = path.resolve(__dirname, '..');

function readArgument(name, fallback = '') {
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
  return {
    averageMs: safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length,
    p50Ms: percentile(safeValues, 0.5),
    p95Ms: percentile(safeValues, 0.95),
    maxMs: Math.max(...safeValues),
    samples: safeValues.length
  };
}

function prepareRepository(repository, subject) {
  repository.write('README.md', `# ${subject}\n`);
  repository.git('add', 'README.md');
  repository.git('commit', '-m', subject);
  repository.git('branch', 'feature/performance');
  repository.git('tag', 'v0.1.0');
}

async function readMemory(application, page, cdp, label) {
  const runtime = await application.evaluate(({ app }) => ({
    main: process.memoryUsage(),
    processes: app.getAppMetrics().map(metric => ({
      type: metric.type,
      name: metric.name || null,
      serviceName: metric.serviceName || null,
      pid: metric.pid,
      creationTime: metric.creationTime,
      workingSetMb: (metric.memory?.workingSetSize || 0) / 1024,
      peakWorkingSetMb: (metric.memory?.peakWorkingSetSize || 0) / 1024,
      privateMb: Number.isFinite(metric.memory?.privateBytes)
        ? metric.memory.privateBytes / 1024
        : null
    }))
  }));
  const renderer = await page.evaluate(() => ({
    heapUsedMb: performance.memory
      ? performance.memory.usedJSHeapSize / (1024 * 1024)
      : null,
    heapTotalMb: performance.memory
      ? performance.memory.totalJSHeapSize / (1024 * 1024)
      : null,
    graphRows: document.querySelectorAll('.graph-row').length
  }));
  const dom = await cdp.send('Memory.getDOMCounters');
  const privateValues = runtime.processes.map(metric => metric.privateMb)
    .filter(Number.isFinite);
  return {
    label,
    totalWorkingSetMb: runtime.processes.reduce(
      (sum, metric) => sum + metric.workingSetMb,
      0
    ),
    totalPrivateMb: privateValues.length
      ? privateValues.reduce((sum, value) => sum + value, 0)
      : null,
    mainHeapUsedMb: runtime.main.heapUsed / (1024 * 1024),
    rendererHeapMb: renderer.heapUsedMb,
    rendererHeapTotalMb: renderer.heapTotalMb,
    dom: { ...dom, graphRows: renderer.graphRows },
    processes: runtime.processes
  };
}

function memoryValue(sample) {
  return Number.isFinite(sample.totalPrivateMb)
    ? sample.totalPrivateMb
    : sample.totalWorkingSetMb;
}

function isStable(samples) {
  if (samples.length < 5) return false;
  const values = samples.slice(-5).map(memoryValue);
  const spread = Math.max(...values) - Math.min(...values);
  const median = percentile(values, 0.5);
  return spread <= Math.max(2, median * 0.01);
}

async function waitForRendererIdle(page) {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(resolve, { timeout: 1000 });
      } else {
        resolve();
      }
    }));
  }));
}

async function readStableMemory(application, page, cdp, label) {
  await waitForRendererIdle(page);
  const samples = [];
  for (let index = 0; index < 20; index += 1) {
    samples.push(await readMemory(application, page, cdp, label));
    if (isStable(samples)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const candidates = samples.slice(-Math.min(5, samples.length));
  const medianValue = percentile(candidates.map(memoryValue), 0.5);
  const selected = candidates.reduce((closest, sample) => (
    Math.abs(memoryValue(sample) - medianValue) < Math.abs(memoryValue(closest) - medianValue)
      ? sample
      : closest
  ));
  return {
    ...selected,
    label,
    stability: {
      stable: isStable(samples),
      samples: samples.length,
      observedRangeMb: Math.max(...candidates.map(memoryValue))
        - Math.min(...candidates.map(memoryValue))
    }
  };
}

function memoryDelta(after, before) {
  const tab = sample => sample.processes.find(process => process.type === 'Tab');
  return {
    totalWorkingSetMb: after.totalWorkingSetMb - before.totalWorkingSetMb,
    totalPrivateMb: Number.isFinite(after.totalPrivateMb) && Number.isFinite(before.totalPrivateMb)
      ? after.totalPrivateMb - before.totalPrivateMb
      : null,
    rendererWorkingSetMb: (tab(after)?.workingSetMb || 0) - (tab(before)?.workingSetMb || 0),
    rendererPrivateMb: Number.isFinite(tab(after)?.privateMb) && Number.isFinite(tab(before)?.privateMb)
      ? tab(after).privateMb - tab(before).privateMb
      : null,
    rendererHeapMb: after.rendererHeapMb - before.rendererHeapMb,
    domNodes: after.dom.nodes - before.dom.nodes
  };
}

async function installSwitchInstrumentation(page) {
  await page.evaluate(() => {
    const records = [];
    const state = { activeSwitch: null, records };
    const wrap = (owner, method, label) => {
      const implementation = owner[method].bind(owner);
      owner[method] = async (...args) => {
        const switchId = state.activeSwitch;
        const startedAt = performance.now();
        try {
          return await implementation(...args);
        } finally {
          records.push({
            switchId,
            label,
            durationMs: performance.now() - startedAt
          });
        }
      };
    };
    const app = window.app;
    wrap(app.components.graphView, 'load', 'graph');
    wrap(app.components.branchList, 'load', 'branches');
    wrap(app.components.changes, 'load', 'changes');
    wrap(app.components.changes, 'refresh', 'workingTree');
    wrap(app.components.changes, 'refreshIdentity', 'identity');
    wrap(app.components.pullRequests, 'load', 'pullRequests');
    wrap(app, 'loadStashes', 'stashes');
    wrap(app, 'loadTags', 'tags');
    wrap(app, 'updateStatus', 'status');
    window.__workspacePerformance = state;
  });
}

async function switchRepository(page, target, switchId) {
  const startedAt = nodePerformance.now();
  await page.evaluate(({ index, id }) => {
    window.__workspacePerformance.activeSwitch = id;
    document.querySelectorAll('.repo-tab')[index].click();
  }, { index: target.index, id: switchId });
  await page.waitForFunction(({ repoPath, subject }) => {
    const activeTitle = document.querySelector('.repo-tab.active .repo-tab-name')?.title;
    const firstSubject = document.querySelector('.graph-row .graph-commit-message')?.textContent;
    return window.app.state.repo?.path === repoPath
      && activeTitle === repoPath
      && firstSubject?.includes(subject);
  }, { repoPath: target.path, subject: target.subject });
  const graphReadyMs = nodePerformance.now() - startedAt;
  await page.waitForFunction(() => {
    const workspace = document.getElementById('workspace');
    return ['interactive', 'settled'].includes(workspace?.dataset.loadState)
      || workspace?.getAttribute('aria-busy') === 'false';
  });
  const interactiveMs = nodePerformance.now() - startedAt;
  await page.waitForFunction(() => {
    const workspace = document.getElementById('workspace');
    return workspace?.dataset.loadState === 'settled'
      || (!workspace?.dataset.loadState && workspace?.getAttribute('aria-busy') === 'false');
  });
  const settledMs = nodePerformance.now() - startedAt;
  const loaders = await page.evaluate(id => {
    const state = window.__workspacePerformance;
    state.activeSwitch = null;
    return state.records.filter(record => record.switchId === id);
  }, switchId);
  return { target: target.subject, graphReadyMs, interactiveMs, settledMs, loaders };
}

async function measureRemoteFetch(page, target) {
  await page.evaluate(index => document.querySelectorAll('.repo-tab')[index].click(), target.index);
  await page.waitForFunction(repoPath => (
    window.app.state.repo?.path === repoPath
    && document.getElementById('workspace')?.dataset.loadState === 'settled'
  ), target.path);
  await page.evaluate(() => {
    const state = window.__workspacePerformance;
    state.activeSwitch = 'remote-fetch';
    state.remoteFetch = {
      openRepoCalls: 0,
      loadStates: [],
      graphRow: document.querySelector('.graph-row')
    };
    const openRepo = window.app.openRepo.bind(window.app);
    window.app.openRepo = (...args) => {
      state.remoteFetch.openRepoCalls += 1;
      return openRepo(...args);
    };
    new MutationObserver(() => {
      state.remoteFetch.loadStates.push(
        document.getElementById('workspace')?.dataset.loadState
      );
    }).observe(document.getElementById('workspace'), {
      attributes: true,
      attributeFilter: ['data-load-state']
    });
  });
  const startedAt = nodePerformance.now();
  await page.evaluate(() => window.app.doFetch());
  const durationMs = nodePerformance.now() - startedAt;
  return page.evaluate(duration => {
    const state = window.__workspacePerformance;
    const telemetry = state.remoteFetch;
    state.activeSwitch = null;
    return {
      durationMs: duration,
      loaders: state.records.filter(record => record.switchId === 'remote-fetch'),
      contracts: {
        avoidsGlobalRepositoryReload: telemetry.openRepoCalls === 0,
        avoidsGlobalLoadingState: !telemetry.loadStates.includes('loading'),
        preservesGraphRow: telemetry.graphRow === document.querySelector('.graph-row')
      }
    };
  }, durationMs);
}

async function runBenchmark({ diagnosticGc = false } = {}) {
  const primary = createElectronFixture({ withRemote: true });
  const secondary = createRepository();
  prepareRepository(secondary, 'Secondary performance repository');
  let application;
  try {
    application = await electron.launch({
      args: [
        projectRoot,
        '--enable-precise-memory-info',
        `--user-data-dir=${primary.userData}`
      ],
      cwd: projectRoot
    });
    const page = await application.firstWindow();
    const cdp = await page.context().newCDPSession(page);
    await page.waitForFunction(() => (
      window.app?.components?.graphView
      && window.app?.components?.repoTabs
      && !document.getElementById('welcome-screen')?.classList.contains('is-hidden')
    ));
    await installSwitchInstrumentation(page);
    const memory = [await readStableMemory(application, page, cdp, 'base-welcome')];

    await page.evaluate(repoPath => window.app.components.repoTabs.addRepo(repoPath), primary.repository);
    await page.locator('.repo-tab.active').waitFor();
    await page.waitForFunction(() => (
      document.getElementById('workspace')?.dataset.loadState === 'settled'
      && document.querySelector('.graph-row .graph-commit-message')?.textContent
        .includes('Initial fixture commit')
    ));
    memory.push(await readStableMemory(application, page, cdp, 'one-repository-settled'));

    await page.evaluate(repoPath => window.app.components.repoTabs.addRepo(repoPath), secondary.repository);
    await page.waitForFunction(repoPath => (
      window.app.state.repo?.path === repoPath
      && document.getElementById('workspace')?.dataset.loadState === 'settled'
      && document.querySelector('.graph-row .graph-commit-message')?.textContent
        .includes('Secondary performance repository')
    ), secondary.repository);
    memory.push(await readStableMemory(application, page, cdp, 'two-repositories-settled'));

    const targets = [
      { index: 0, path: primary.repository, subject: 'Initial fixture commit' },
      { index: 1, path: secondary.repository, subject: 'Secondary performance repository' }
    ];
    const switches = [];
    for (let index = 0; index < 10; index += 1) {
      switches.push(await switchRepository(page, targets[index % 2], `switch-${index}`));
    }
    memory.push(await readMemory(application, page, cdp, 'after-ten-switches-immediate'));
    memory.push(await readStableMemory(application, page, cdp, 'after-ten-switches-idle'));
    if (diagnosticGc) {
      await cdp.send('HeapProfiler.collectGarbage');
      memory.push(await readStableMemory(
        application,
        page,
        cdp,
        'after-diagnostic-garbage-collection'
      ));
    }
    const remoteFetch = await measureRemoteFetch(page, {
      index: 0,
      path: primary.repository
    });

    const loaderLabels = [...new Set(
      switches.flatMap(sample => sample.loaders.map(loader => loader.label))
    )];
    return {
      graphReadySummary: summarize(switches.map(sample => sample.graphReadyMs)),
      interactiveSummary: summarize(switches.map(sample => sample.interactiveMs)),
      settledSummary: summarize(switches.map(sample => sample.settledMs)),
      loaderSummary: Object.fromEntries(loaderLabels.map(label => [
        label,
        summarize(switches.flatMap(sample => sample.loaders
          .filter(loader => loader.label === label)
          .map(loader => loader.durationMs)))
      ])),
      switches,
      remoteFetch,
      memory,
      memoryDeltas: {
        oneRepositoryFromBase: memoryDelta(memory[1], memory[0]),
        secondRepository: memoryDelta(memory[2], memory[1]),
        switchChurnImmediate: memoryDelta(memory[3], memory[2]),
        idleReclaim: memoryDelta(memory[4], memory[3]),
        residualAfterSwitches: memoryDelta(memory[4], memory[2]),
        ...(memory[5]
          ? { diagnosticGcReclaim: memoryDelta(memory[5], memory[4]) }
          : {})
      }
    };
  } finally {
    if (application) await application.close().catch(() => {});
    primary.cleanup();
    secondary.cleanup();
  }
}

async function main() {
  const runCount = Math.max(1, Math.min(5, Number(readArgument('runs', '1')) || 1));
  const diagnosticGc = readArgument('diagnostic-gc', 'false') === 'true';
  const runs = [];
  for (let index = 0; index < runCount; index += 1) {
    runs.push(await runBenchmark({ diagnosticGc }));
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
    diagnostics: { garbageCollectionRequested: diagnosticGc },
    summary: {
      graphReadyP95Ms: summarize(runs.map(run => run.graphReadySummary.p95Ms)),
      repositoryInteractiveP95Ms: summarize(runs.map(run => run.interactiveSummary.p95Ms)),
      repositorySettledP95Ms: summarize(runs.map(run => run.settledSummary.p95Ms)),
      remoteFetchMs: summarize(runs.map(run => run.remoteFetch.durationMs)),
      workingSetAfterSwitchesMb: summarize(runs.map(run =>
        run.memory.find(sample => sample.label === 'after-ten-switches-idle')?.totalWorkingSetMb
      )),
      privateAfterSwitchesMb: summarize(runs.map(run =>
        run.memory.find(sample => sample.label === 'after-ten-switches-idle')?.totalPrivateMb
      )),
      rendererPrivateResidualAfterSwitchesMb: summarize(runs.map(run =>
        run.memoryDeltas.residualAfterSwitches.rendererPrivateMb
      )),
      domNodeResidualAfterSwitches: summarize(runs.map(run =>
        run.memoryDeltas.residualAfterSwitches.domNodes
      ))
    },
    runs
  };
  const output = readArgument('output');
  if (output) {
    const outputPath = path.resolve(projectRoot, output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  const contractsPass = runs.every(run => (
    Object.values(run.remoteFetch.contracts).every(Boolean)
  ));
  if (!contractsPass) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
