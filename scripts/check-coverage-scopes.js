const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const c8Bin = require.resolve('c8/bin/c8.js');

const SCOPES = {
  git: {
    include: ['src/main/git-service.js', 'src/main/git/**/*.js'],
    gate: { lines: 82, branches: 70, functions: 90 },
    target: { lines: 82, branches: 70, functions: 90 }
  },
  runtime: {
    include: [
      'src/main/application-runtime.js',
      'src/main/deep-link.js',
      'src/main/diagnostics-exporter.js',
      'src/main/git-version.js',
      'src/main/inspector-window-controller.js',
      'src/main/ipc/**/*.js',
      'src/main/logger.js',
      'src/main/main-application.js',
      'src/main/oauth-config.js',
      'src/main/provider-links.js',
      'src/main/repo-manager.js',
      'src/main/repository-workspace.js',
      'src/main/repository-scanner.js',
      'src/main/update-service.js'
    ],
    gate: { lines: 75, branches: 60, functions: 75 },
    target: { lines: 75, branches: 60, functions: 75 }
  },
  hosting: {
    include: ['src/main/hosting-service.js', 'src/main/hosting/providers/**/*.js'],
    gate: { lines: 90, branches: 70, functions: 90 },
    target: { lines: 90, branches: 70, functions: 90 }
  },
  renderer: {
    include: [
      'src/renderer/dialog-service.js',
      'src/renderer/html-encoder.js',
      'src/renderer/repository-load-session.js',
      'src/renderer/components/branch-naming.js',
      'src/renderer/components/conflict-highlight.js',
      'src/renderer/components/diff-parser.js',
      'src/renderer/components/graph-layout.js'
    ],
    gate: { lines: 70, branches: 60, functions: 70 },
    target: { lines: 70, branches: 60, functions: 70 }
  }
};

function buildC8Arguments(name, scope) {
  return [
    c8Bin,
    'report',
    '--all',
    '--exclude-after-remap',
    '--temp-directory=coverage/tmp',
    `--reports-dir=coverage/scopes/${name}`,
    '--reporter=text-summary',
    '--check-coverage',
    `--lines=${scope.gate.lines}`,
    `--branches=${scope.gate.branches}`,
    `--functions=${scope.gate.functions}`,
    ...scope.include.map(pattern => `--include=${pattern}`)
  ];
}

function run(names = Object.keys(SCOPES)) {
  for (const name of names) {
    const scope = SCOPES[name];
    if (!scope) throw new Error(`Unknown coverage scope: ${name}`);
    process.stdout.write(
      `\n[coverage:${name}] gate ${JSON.stringify(scope.gate)}; target ${JSON.stringify(scope.target)}\n`
    );
    const result = spawnSync(process.execPath, buildC8Arguments(name, scope), {
      cwd: root,
      stdio: 'inherit'
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Coverage scope ${name} failed with exit code ${result.status}`);
    }
  }
}

if (require.main === module) {
  try {
    run(process.argv.slice(2).length ? process.argv.slice(2) : undefined);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { SCOPES, buildC8Arguments, run };
