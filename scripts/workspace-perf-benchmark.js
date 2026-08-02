/* global document, window */
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

async function readMemory(application, page, label) {
  const mainMetrics = await application.evaluate(({ app }) => app.getAppMetrics().map(metric => ({
    type: metric.type,
    pid: metric.pid,
    workingSetMb: (metric.memory?.workingSetSize || 0) / 1024,
    privateMb: (metric.memory?.privateBytes || 0) / 1024,
    sharedMb: (metric.memory?.sharedBytes || 0) / 1024
  })));
  const rendererHeapMb = await page.evaluate(() => performance.memory
    ? performance.memory.usedJSHeapSize / (1024 * 1024)
    : null);
  return {
    label,
    totalWorkingSetMb: mainMetrics.reduce((sum, metric) => sum + metric.workingSetMb, 0),
    totalPrivateMb: mainMetrics.reduce((sum, metric) => sum + metric.privateMb, 0),
    rendererHeapMb,
    processes: mainMetrics
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
    const workspace = document.getElementById('workspace');
    return window.app.state.repo?.path === repoPath
      && activeTitle === repoPath
      && firstSubject?.includes(subject)
      && workspace?.getAttribute('aria-busy') === 'false';
  }, { repoPath: target.path, subject: target.subject });
  const durationMs = nodePerformance.now() - startedAt;
  const loaders = await page.evaluate(id => {
    const state = window.__workspacePerformance;
    state.activeSwitch = null;
    return state.records.filter(record => record.switchId === id);
  }, switchId);
  return { target: target.subject, durationMs, loaders };
}

async function runBenchmark() {
  const primary = createElectronFixture();
  const secondary = createRepository();
  prepareRepository(secondary, 'Secondary performance repository');
  let application;
  try {
    application = await electron.launch({
      args: [
        projectRoot,
        '--enable-precise-memory-info',
        `--user-data-dir=${primary.userData}`,
        primary.deepLink
      ],
      cwd: projectRoot
    });
    const page = await application.firstWindow();
    await page.locator('.repo-tab.active').waitFor();
    await page.locator('.graph-row').first().waitFor();
    const memory = [await readMemory(application, page, 'one-repository')];

    await page.evaluate(repoPath => window.app.components.repoTabs.addRepo(repoPath), secondary.repository);
    await page.waitForFunction(repoPath => (
      window.app.state.repo?.path === repoPath
      && document.getElementById('workspace')?.getAttribute('aria-busy') === 'false'
      && document.querySelector('.graph-row .graph-commit-message')?.textContent
        .includes('Secondary performance repository')
    ), secondary.repository);
    memory.push(await readMemory(application, page, 'two-repositories'));

    await installSwitchInstrumentation(page);
    const targets = [
      { index: 0, path: primary.repository, subject: 'Initial fixture commit' },
      { index: 1, path: secondary.repository, subject: 'Secondary performance repository' }
    ];
    const switches = [];
    for (let index = 0; index < 10; index += 1) {
      switches.push(await switchRepository(page, targets[index % 2], `switch-${index}`));
    }
    memory.push(await readMemory(application, page, 'after-ten-switches'));

    const loaderLabels = [...new Set(
      switches.flatMap(sample => sample.loaders.map(loader => loader.label))
    )];
    return {
      switchSummary: summarize(switches.map(sample => sample.durationMs)),
      loaderSummary: Object.fromEntries(loaderLabels.map(label => [
        label,
        summarize(switches.flatMap(sample => sample.loaders
          .filter(loader => loader.label === label)
          .map(loader => loader.durationMs)))
      ])),
      switches,
      memory
    };
  } finally {
    if (application) await application.close().catch(() => {});
    primary.cleanup();
    secondary.cleanup();
  }
}

async function main() {
  const runCount = Math.max(1, Math.min(5, Number(readArgument('runs', '1')) || 1));
  const runs = [];
  for (let index = 0; index < runCount; index += 1) runs.push(await runBenchmark());
  const report = {
    schemaVersion: 1,
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
      repositorySwitchP50Ms: summarize(runs.map(run => run.switchSummary.p50Ms)),
      repositorySwitchP95Ms: summarize(runs.map(run => run.switchSummary.p95Ms)),
      workingSetAfterSwitchesMb: summarize(runs.map(run =>
        run.memory.find(sample => sample.label === 'after-ten-switches')?.totalWorkingSetMb
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
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
