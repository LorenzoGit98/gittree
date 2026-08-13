const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactText(value, repositoryPaths = []) {
  let redacted = String(value || '');
  for (const repositoryPath of repositoryPaths.filter(Boolean)) {
    redacted = redacted.replace(
      new RegExp(escapeRegularExpression(repositoryPath), 'gi'),
      '[REDACTED_PATH]'
    );
  }
  return redacted
    .replace(/https?:\/\/[^\s"']+/gi, '[REDACTED_URL]')
    .replace(/\b(?:ghp|gho|glpat|pat)[-_A-Za-z0-9]{8,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_TOKEN]')
    .replace(/(authorization[=:]\s*)[^\s,;]+/gi, '$1[REDACTED_TOKEN]')
    .replace(/(x-api-key[=:]\s*)[^\s,;]+/gi, '$1[REDACTED_TOKEN]')
    .replace(/(token[=:]\s*)[^\s,;]+/gi, '$1[REDACTED_TOKEN]')
    .replace(/\b[A-Za-z]:\\[^\r\n\t"']+/g, '[REDACTED_PATH]')
    .replace(/(^|[\s"'=])\/(?:Users|home|tmp|var|private|opt)\/[^\s,"']+/g, '$1[REDACTED_PATH]');
}

function repositoryIdentifier(repositoryPath) {
  return crypto.createHash('sha256').update(String(repositoryPath)).digest('hex').slice(0, 16);
}

function safeJson(value, repositoryPaths) {
  return JSON.parse(redactText(JSON.stringify(value || {}), repositoryPaths));
}

function buildDiagnosticsData({
  versions,
  system,
  updateState,
  repositories = [],
  logs = '',
  checks = {}
}) {
  const repositoryPaths = repositories.map(repository => repository.path).filter(Boolean);
  return {
    summary: {
      versions: { ...versions },
      system: { ...system },
      updateState: safeJson({
        status: updateState?.status || 'unknown',
        currentVersion: updateState?.currentVersion || versions.app,
        availableVersion: updateState?.availableVersion || null,
        progress: Number(updateState?.progress) || 0
      }, repositoryPaths),
      repositoryCount: repositories.length,
      repositories: repositories.map(repository => ({
        id: repositoryIdentifier(repository.path)
      }))
    },
    logs: redactText(logs, repositoryPaths),
    checks: safeJson(checks, repositoryPaths)
  };
}

function readLogs(logger) {
  if (!logger?.file) return '';
  return [logger.file, `${logger.file}.1`]
    .filter(filename => fs.existsSync(filename))
    .map(filename => fs.readFileSync(filename, 'utf8').slice(-1_000_000))
    .join('\n');
}

class DiagnosticsExporter {
  constructor({
    app,
    showSaveDialog,
    logger,
    getGitVersion,
    getUpdateState,
    getRepositories,
    getChecks = () => ({ quality: 'not-run-in-app' })
  }) {
    this.app = app;
    this.showSaveDialog = showSaveDialog;
    this.logger = logger;
    this.getGitVersion = getGitVersion;
    this.getUpdateState = getUpdateState;
    this.getRepositories = getRepositories;
    this.getChecks = getChecks;
  }

  async export() {
    const date = new Date().toISOString().slice(0, 10);
    const result = await this.showSaveDialog({
      title: 'Export GitTree diagnostics',
      defaultPath: `GitTree-diagnostics-${date}.zip`,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const diagnostics = buildDiagnosticsData({
      versions: {
        app: this.app.getVersion(),
        electron: process.versions.electron || null,
        node: process.versions.node,
        git: await this.getGitVersion()
      },
      system: { platform: os.platform(), release: os.release(), arch: os.arch() },
      updateState: this.getUpdateState(),
      repositories: this.getRepositories(),
      logs: readLogs(this.logger),
      checks: this.getChecks()
    });
    const zip = new AdmZip();
    zip.addFile('summary.json', Buffer.from(JSON.stringify(diagnostics.summary, null, 2)));
    zip.addFile('logs.txt', Buffer.from(diagnostics.logs));
    zip.addFile('checks.json', Buffer.from(JSON.stringify(diagnostics.checks, null, 2)));
    await fs.promises.mkdir(path.dirname(result.filePath), { recursive: true });
    await new Promise((resolve, reject) => {
      zip.writeZip(result.filePath, error => error ? reject(error) : resolve());
    });
    return { success: true };
  }
}

module.exports = { DiagnosticsExporter, buildDiagnosticsData, redactText };
