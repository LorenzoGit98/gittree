const fs = require('node:fs');
const path = require('node:path');

function defaults() {
  return {
    version: 1,
    settings: {
      provider: 'opencode',
      baseUrl: '',
      model: '',
      language: 'auto'
    }
  };
}

const PROVIDERS = ['opencode', 'openai', 'anthropic'];
const LANGUAGES = ['auto', 'en', 'it'];

function sanitizeSettings(stored = {}) {
  const initial = defaults().settings;
  const baseUrl = typeof stored.baseUrl === 'string' ? stored.baseUrl.trim() : '';
  return {
    provider: PROVIDERS.includes(stored.provider) ? stored.provider : initial.provider,
    baseUrl: baseUrl.length <= 2048 ? baseUrl : '',
    model: typeof stored.model === 'string'
      ? stored.model.trim().slice(0, 200)
      : initial.model,
    language: LANGUAGES.includes(stored.language) ? stored.language : initial.language
  };
}

class AiSettingsStore {
  constructor({ storagePath, fileSystem = fs } = {}) {
    if (!storagePath) throw new Error('AI settings storage path is required');
    this.storagePath = storagePath;
    this.fs = fileSystem;
  }

  load() {
    if (!this.fs.existsSync(this.storagePath)) return defaults();
    try {
      const stored = JSON.parse(this.fs.readFileSync(this.storagePath, 'utf8'));
      return {
        version: 1,
        settings: sanitizeSettings(stored.settings)
      };
    } catch {
      return defaults();
    }
  }

  save(state) {
    const payload = {
      version: 1,
      settings: sanitizeSettings(state.settings)
    };
    const directory = path.dirname(this.storagePath);
    this.fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.storagePath}.${process.pid}.${Date.now()}.tmp`;
    this.fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    this.fs.renameSync(temporaryPath, this.storagePath);
  }
}

module.exports = AiSettingsStore;
module.exports.defaults = defaults;
module.exports.sanitizeSettings = sanitizeSettings;
