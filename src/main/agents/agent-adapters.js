const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ADAPTERS = Object.freeze({
  codex: Object.freeze({
    id: 'codex', label: 'Codex', command: 'codex',
    createArgs: prompt => [prompt], resumeArgs: () => ['resume', '--last']
  }),
  claude: Object.freeze({
    id: 'claude', label: 'Claude Code', command: 'claude',
    createArgs: prompt => [prompt], resumeArgs: () => ['--continue']
  }),
  opencode: Object.freeze({
    id: 'opencode', label: 'OpenCode', command: 'opencode',
    createArgs: prompt => ['--prompt', prompt], resumeArgs: () => ['--continue']
  })
});

function getAdapter(id) {
  const adapter = ADAPTERS[id];
  if (!adapter) throw new Error('Unknown agent adapter');
  return adapter;
}

function resolveAgentExecutable(command, {
  environment = process.env,
  platform = process.platform,
  fileSystem = fs,
  pathModule = path
} = {}) {
  const searchPath = environment.PATH || environment.Path || '';
  const extensions = platform === 'win32' ? ['.exe', '.com'] : [''];
  for (const directory of searchPath.split(pathModule.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = pathModule.join(directory.replace(/^"|"$/g, ''), `${command}${extension}`);
      try {
        fileSystem.accessSync(candidate, platform === 'win32' ? fileSystem.constants.F_OK : fileSystem.constants.X_OK);
        return candidate;
      } catch { /* continue searching PATH */ }
    }
  }
  return null;
}

function detectAgentAdapters({ execute = execFile, resolveExecutable = resolveAgentExecutable } = {}) {
  return Promise.all(Object.values(ADAPTERS).map(adapter => new Promise(resolve => {
    const executable = resolveExecutable(adapter.command);
    if (!executable) {
      resolve({ id: adapter.id, label: adapter.label, available: false, version: '' });
      return;
    }
    execute(executable, ['--version'], { windowsHide: true, timeout: 3000 }, (error, stdout, stderr) => {
      const version = String(stdout || stderr || '').trim().split(/\r?\n/, 1)[0].slice(0, 120);
      resolve({ id: adapter.id, label: adapter.label, available: !error, version: error ? '' : version });
    });
  })));
}

module.exports = { ADAPTERS, getAdapter, detectAgentAdapters, resolveAgentExecutable };
