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

function accessibleFile(candidate, fileSystem, mode) {
  if (!candidate) return false;
  try {
    fileSystem.accessSync(candidate, mode);
    return fileSystem.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function windowsAdapterFallbacks(command, environment, fileSystem, pathModule) {
  const candidates = [];
  if (command === 'opencode' && environment.APPDATA) {
    candidates.push(pathModule.join(
      environment.APPDATA,
      'npm',
      'node_modules',
      'opencode-ai',
      'bin',
      'opencode.exe'
    ));
  }
  if (command === 'codex' && environment.LOCALAPPDATA) {
    const runtimeRoot = pathModule.join(environment.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    try {
      const runtimeCandidates = fileSystem.readdirSync(runtimeRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => pathModule.join(runtimeRoot, entry.name, 'codex.exe'))
        .filter(candidate => accessibleFile(candidate, fileSystem, fileSystem.constants.F_OK))
        .sort((left, right) => (
          fileSystem.statSync(right).mtimeMs - fileSystem.statSync(left).mtimeMs
        ));
      candidates.push(...runtimeCandidates);
    } catch { /* Codex Desktop is not installed */ }
  }
  return candidates;
}

function resolveAgentExecutable(command, {
  environment = process.env,
  platform = process.platform,
  fileSystem = fs,
  pathModule = path
} = {}) {
  const searchPath = environment.PATH || environment.Path || '';
  const extensions = platform === 'win32' ? ['.exe', '.com'] : [''];
  const directCandidates = [];
  for (const directory of searchPath.split(pathModule.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      directCandidates.push(pathModule.join(
        directory.replace(/^"|"$/g, ''),
        `${command}${extension}`
      ));
    }
  }
  const mode = platform === 'win32' ? fileSystem.constants.F_OK : fileSystem.constants.X_OK;
  const availableDirect = directCandidates.filter(candidate => accessibleFile(
    candidate, fileSystem, mode
  ));
  if (platform !== 'win32') return availableDirect[0] || null;

  const unrestricted = availableDirect.filter(candidate => (
    !candidate.toLowerCase().includes('\\program files\\windowsapps\\')
  ));
  const fallbacks = windowsAdapterFallbacks(command, environment, fileSystem, pathModule);
  return unrestricted[0] || fallbacks[0] || availableDirect[0] || null;
}

function detectAgentAdapters({ execute = execFile, resolveExecutable = resolveAgentExecutable } = {}) {
  return Promise.all(Object.values(ADAPTERS).map(adapter => new Promise(resolve => {
    const executable = resolveExecutable(adapter.command);
    if (!executable) {
      resolve({ id: adapter.id, label: adapter.label, available: false, version: '' });
      return;
    }
    try {
      execute(executable, ['--version'], { windowsHide: true, timeout: 3000 }, (
        error, stdout, stderr
      ) => {
        const started = !error || typeof error.code === 'number';
        const version = error
          ? ''
          : String(stdout || stderr || '').trim().split(/\r?\n/, 1)[0].slice(0, 120);
        resolve({
          id: adapter.id,
          label: adapter.label,
          available: started,
          version
        });
      });
    } catch {
      resolve({ id: adapter.id, label: adapter.label, available: false, version: '' });
    }
  })));
}

module.exports = { ADAPTERS, getAdapter, detectAgentAdapters, resolveAgentExecutable };
