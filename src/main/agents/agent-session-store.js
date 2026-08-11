const fs = require('node:fs');
const path = require('node:path');

const ACTIVE_STATUSES = new Set(['queued', 'preparing', 'running', 'stopping']);
const MAX_EVENTS = 200;

function defaults() {
  return {
    version: 1,
    settings: {
      agentsEnabled: true,
      worktreeRoot: '',
      maxConcurrent: 4,
      enabledAdapters: ['codex', 'claude', 'opencode']
    },
    tasks: []
  };
}

function sanitizeTask(task, { restore = false } = {}) {
  const clean = { ...task };
  delete clean.prompt;
  delete clean._prompt;
  delete clean._resume;
  clean.events = Array.isArray(clean.events) ? clean.events.slice(-MAX_EVENTS) : [];
  if (restore && ACTIVE_STATUSES.has(clean.status)) clean.status = 'interrupted';
  return clean;
}

class AgentSessionStore {
  constructor({ storagePath, fileSystem = fs } = {}) {
    if (!storagePath) throw new Error('Agent session storage path is required');
    this.storagePath = storagePath;
    this.fs = fileSystem;
  }

  load() {
    if (!this.fs.existsSync(this.storagePath)) return defaults();
    try {
      const stored = JSON.parse(this.fs.readFileSync(this.storagePath, 'utf8'));
      const initial = defaults();
      return {
        version: 1,
        settings: {
          ...initial.settings,
          ...(stored.settings || {}),
          maxConcurrent: Number.isInteger(stored.settings?.maxConcurrent)
            ? Math.min(32, Math.max(1, stored.settings.maxConcurrent))
            : initial.settings.maxConcurrent,
          enabledAdapters: Array.isArray(stored.settings?.enabledAdapters)
            ? stored.settings.enabledAdapters.filter(id => ['codex', 'claude', 'opencode'].includes(id))
            : initial.settings.enabledAdapters
        },
        tasks: Array.isArray(stored.tasks)
          ? stored.tasks.map(task => sanitizeTask(task, { restore: true }))
          : []
      };
    } catch {
      return defaults();
    }
  }

  save(state) {
    const payload = {
      version: 1,
      settings: { ...defaults().settings, ...(state.settings || {}) },
      tasks: Array.isArray(state.tasks) ? state.tasks.map(task => sanitizeTask(task)) : []
    };
    const directory = path.dirname(this.storagePath);
    this.fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.storagePath}.${process.pid}.${Date.now()}.tmp`;
    this.fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    this.fs.renameSync(temporaryPath, this.storagePath);
  }
}

module.exports = AgentSessionStore;
module.exports.defaults = defaults;
module.exports.sanitizeTask = sanitizeTask;
