/* global document, window */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance: nodePerformance } = require('node:perf_hooks');
const { _electron: electron } = require('playwright');
const { createRepository, toWindowsShortPath } = require('../test/helpers/git-repository');

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

function buildFixture() {
  const repository = createRepository();
  repository.write('README.md', '# Benchmark fixture\n');
  repository.git('add', 'README.md');
  repository.git('commit', '-m', 'Initial commit');
  for (let index = 1; index <= 30; index += 1) {
    repository.write(`src/module-${index % 5}.js`, `// change ${index}\n`);
    repository.git('add', '.');
    repository.git('commit', '-m', `Commit ${index}`);
  }
  repository.git('branch', 'feature/perf');
  repository.git('checkout', 'feature/perf');
  for (let index = 1; index <= 12; index += 1) {
    repository.write(`src/feature-${index}.js`, `// feature ${index}\n`);
    repository.git('add', '.');
    repository.git('commit', '-m', `Feature ${index}`);
  }
  repository.git('checkout', 'main');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gittree-modal-bench-'));
  return {
    repository,
    userData,
    deepLink: `gittree://open?path=${encodeURIComponent(toWindowsShortPath(repository.repository))}`,
    cleanup() {
      repository.cleanup();
      fs.rmSync(userData, { recursive: true, force: true });
    }
  };
}

function openAndMeasure(page, evaluateFn, marker, contentMarker = marker) {
  return async () => {
    const startedAt = nodePerformance.now();
    await page.evaluate(evaluateFn);
    const visibleMs = await page.waitForFunction(
      marker,
      null,
      { timeout: 20000 }
    ).then(() => nodePerformance.now() - startedAt);
    const contentMs = await page.waitForFunction(
      contentMarker,
      null,
      { timeout: 20000 }
    ).then(() => nodePerformance.now() - startedAt);
    return { visibleMs, contentMs };
  };
}

async function runBenchmark() {
  const fixture = buildFixture();
  let application;
  try {
    application = await electron.launch({
      args: [
        projectRoot,
        '--enable-precise-memory-info',
        `--user-data-dir=${fixture.userData}`,
        fixture.deepLink
      ],
      cwd: projectRoot,
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
    });
    const page = await application.firstWindow();
    application.on('close', () => console.log('APP CLOSED'));
    page.on('crash', () => console.log('PAGE CRASH'));
    page.on('console', message => {
      if (message.type() === 'error') console.log('RENDERER ERROR:', message.text());
    });
    await page.waitForFunction(() => (
      window.app?.components?.repoTabs
      && document.getElementById('workspace')?.dataset.loadState === 'settled'
    ), null, { timeout: 20000 });

    const surfaces = {
      settings: openAndMeasure(page, () => {
        window.app.components.settings.open(null, { scope: 'full' });
      }, () => {
        const overlay = document.getElementById('modal-overlay');
        return overlay && !overlay.classList.contains('is-hidden')
          && document.querySelector('.settings-dialog') !== null;
      }, () => (
        document.querySelectorAll('.agent-adapter-settings .settings-toolbar-row').length > 0
      )),
      gitflow: openAndMeasure(page, () => {
        window.app.components.gitflow.open();
      }, () => (
        document.querySelector('.gitflow-dialog') !== null
      ), () => (
        document.querySelector('.gitflow-panel') !== null
      )),
      prCreate: openAndMeasure(page, () => {
        window.app.components.pullRequests.openCreateDialog({ force: true });
      }, () => (
        document.querySelector('.pr-create-dialog') !== null
      ), () => (
        document.querySelector('.pr-create-form') !== null
      )),
      tagCreate: openAndMeasure(page, () => {
        window.app.components.commitContextMenu.createTagDialog(
          window.app.state.repo,
          'main'
        );
      }, () => (
        document.querySelector('.tag-create-dialog') !== null
      )),
      merge: openAndMeasure(page, () => {
        window.app.components.merge.open('feature/perf', 'main');
      }, () => {
        const shell = document.getElementById('merge-preview-overlay');
        return shell && !shell.classList.contains('is-hidden');
      }, () => (
        document.querySelector('#merge-preview-overlay .merge-modal-card') !== null
      ))
    };

    const results = {};
    console.log('pre-loop state:', await page.evaluate(() => ({
      loadState: document.getElementById('workspace')?.dataset.loadState,
      hasApp: Boolean(window.app),
      hasSettings: Boolean(window.app?.components?.settings)
    })));
    for (const [name, measure] of Object.entries(surfaces)) {
      console.log(`measuring ${name}...`);
      const samples = [];
      for (let index = 0; index < 3; index += 1) {
        samples.push(await measure());
        await page.evaluate(() => {
          window.app.components.settings?.close();
          window.app.components.gitflow?.close();
          window.app.components.merge?.hide();
          const overlay = document.getElementById('modal-overlay');
          if (overlay) overlay.classList.add('is-hidden');
          const dialog = document.getElementById('modal-dialog');
          if (dialog) {
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = '';
          }
        });
      }
      results[name] = samples;
    }
    return results;
  } finally {
    if (application) await application.close().catch(() => {});
    fixture.cleanup();
  }
}

async function main() {
  const runs = [];
  const runCount = Math.max(1, Math.min(3, Number(readArgument('runs', '1')) || 1));
  for (let index = 0; index < runCount; index += 1) {
    runs.push(await runBenchmark());
  }
  const names = Object.keys(runs[0]);
  const report = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.versions.node,
      cpu: os.cpus()[0]?.model || 'unknown'
    },
    summary: Object.fromEntries(names.map(name => [
      name,
      {
        visibleMs: summarize(runs.flatMap(run => run[name].map(sample => sample.visibleMs))),
        contentMs: summarize(runs.flatMap(run => run[name].map(sample => sample.contentMs)))
      }
    ])),
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
