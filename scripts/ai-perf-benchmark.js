/* global document, requestAnimationFrame, window */
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { performance: nodePerformance } = require('node:perf_hooks');
const { _electron: electron } = require('playwright');
const { createElectronFixture } = require('../test/helpers/electron-fixture');
const { git } = require('../test/helpers/git-repository');

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

function startFakeProvider({ delayMs = 2000 } = {}) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let rawBody = '';
    request.on('data', chunk => { rawBody += chunk; });
    request.on('end', () => {
      requests.push({ url: request.url, method: request.method, body: rawBody });
      setTimeout(() => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          choices: [{
            message: {
              content: 'TITLE: feat(ai): generated summary\nBODY: Generated body for the benchmark.'
            }
          }]
        }));
      }, delayMs);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise(done => server.close(done))
      });
    });
  });
}

async function runBenchmark() {
  const provider = await startFakeProvider();
  const fixture = createElectronFixture();
  git(fixture.repository, 'add', 'dirty.txt');
  let application;
  try {
    application = await electron.launch({
      args: [
        projectRoot,
        '--enable-precise-memory-info',
        `--user-data-dir=${fixture.userData}`,
        fixture.deepLink
      ],
      cwd: projectRoot
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => (
      window.app?.components?.repoTabs
      && document.getElementById('workspace')?.dataset.loadState === 'settled'
    ), null, { timeout: 20000 });

    const configure = await page.evaluate(async baseUrl => {
      const settings = await window.gitTree.setAiSettings({
        provider: 'openai',
        baseUrl,
        model: 'benchmark-model',
        language: 'en'
      });
      const key = await window.gitTree.setAiKey('sk-benchmark-key');
      return { settings, key };
    }, provider.baseUrl);

    const settingsOpens = [];
    for (let index = 0; index < 3; index += 1) {
      const startedAt = nodePerformance.now();
      await page.evaluate(() => {
        window.app.components.settings.close();
        window.app.components.settings.open(null, { scope: 'full' });
      });
      await page.waitForFunction(() => {
        const overlay = document.getElementById('modal-overlay');
        return overlay && !overlay.classList.contains('is-hidden')
          && document.querySelector('.settings-dialog') !== null;
      }, null, { timeout: 20000 });
      settingsOpens.push(nodePerformance.now() - startedAt);
    }

    const heartbeat = await page.evaluate(async () => {
      const ticks = [];
      let running = true;
      const loop = () => {
        ticks.push(performance.now());
        if (running) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      const startedAt = performance.now();
      const result = await window.gitTree.generateCommitMessage(
        window.app.state.repo.path,
        { language: 'en' }
      );
      const durationMs = performance.now() - startedAt;
      running = false;
      const gaps = [];
      for (let index = 1; index < ticks.length; index += 1) {
        gaps.push(ticks[index] - ticks[index - 1]);
      }
      const sortedGaps = [...gaps].sort((left, right) => left - right);
      const p95Gap = sortedGaps.length
        ? sortedGaps[Math.min(sortedGaps.length - 1, Math.ceil(sortedGaps.length * 0.95) - 1)]
        : 0;
      return {
        result,
        durationMs,
        maxGapMs: gaps.length ? Math.max(...gaps) : 0,
        p95GapMs: p95Gap,
        ticks: ticks.length
      };
    });

    const requestBytes = provider.requests.length
      ? Buffer.byteLength(provider.requests[0].body)
      : 0;

    return {
      configured: configure.settings?.provider === 'openai' && configure.key?.keyConfigured === true,
      settingsOpens,
      heartbeat,
      requestBytes,
      providerRequests: provider.requests.length,
      contracts: {
        settingsOpenStaysFast: summarize(settingsOpens).p95Ms < 150,
        rendererHeartbeatSurvivesGeneration:
          heartbeat.p95GapMs < 50 && heartbeat.ticks > 100,
        generationReturnsStructuredOutput:
          Boolean(heartbeat.result?.summary && heartbeat.result?.body),
        promptPayloadIsBounded: requestBytes > 0 && requestBytes <= 24 * 1024 + 4096,
        providerReceivedExactlyOneRequest: provider.requests.length === 1
      }
    };
  } finally {
    if (application) await application.close().catch(() => {});
    fixture.cleanup();
    await provider.close();
  }
}

async function main() {
  const runs = [];
  const runCount = Math.max(1, Math.min(3, Number(readArgument('runs', '1')) || 1));
  for (let index = 0; index < runCount; index += 1) {
    runs.push(await runBenchmark());
  }
  const report = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.versions.node,
      cpu: os.cpus()[0]?.model || 'unknown'
    },
    summary: {
      settingsOpenP95Ms: summarize(runs.flatMap(run => run.settingsOpens)),
      generationDurationMs: summarize(runs.map(run => run.heartbeat.durationMs)),
      rendererMaxGapMs: summarize(runs.map(run => run.heartbeat.maxGapMs)),
      rendererP95GapMs: summarize(runs.map(run => run.heartbeat.p95GapMs)),
      requestPayloadBytes: summarize(runs.map(run => run.requestBytes))
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
  const contractsPass = runs.every(run => Object.values(run.contracts).every(Boolean));
  if (!contractsPass) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
